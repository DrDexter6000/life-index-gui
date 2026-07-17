import { useMutation, useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  hostAgentAPI,
  type HostAgentMetadataProposalRequest,
  type HostAgentQueryResponse,
  type HostAgentStreamEvent,
} from '@/lib/api-client';
import { getHostAgentCapability } from '@/lib/health-status';

export type HostAgentStreamStatus = 'idle' | 'connecting' | 'streaming' | 'complete' | 'error' | 'cancelled';
export type HostAgentStreamPhase =
  | 'idle'
  | 'connecting'
  | 'planning'
  | 'calling_host_agent'
  | 'searching'
  | 'answering'
  | 'complete'
  | 'error'
  | 'cancelled';

export const DEFAULT_HOST_AGENT_STREAM_TIMEOUT_MS = 600_000;

type HostAgentTerminalState = 'final' | 'error' | 'cancelled' | 'timeout';

interface ActiveHostAgentRequest {
  sequence: number;
  turnId: string;
  controller: AbortController;
  terminal: HostAgentTerminalState | null;
}

export interface HostAgentConversationTurn {
  id: string;
  query: string;
  status: HostAgentStreamStatus;
  phase: HostAgentStreamPhase;
  statusMessage: string | null;
  evidencePreview: HostAgentQueryResponse['evidence'];
  deltaText: string;
  finalResponse: HostAgentQueryResponse | null;
  error: Error | null;
  events: HostAgentStreamEvent[];
}

let conversationSequence = 0;
let turnSequence = 0;

function createConversationId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  conversationSequence += 1;
  return `host-conv-${Date.now().toString(36)}-${conversationSequence}`;
}

function createTurnId(): string {
  turnSequence += 1;
  return `host-turn-${Date.now().toString(36)}-${turnSequence}`;
}

export const hostAgentKeys = {
  all: ['host-agent'] as const,
  health: () => [...hostAgentKeys.all, 'health'] as const,
  metadataProposal: () => [...hostAgentKeys.all, 'metadata-proposal'] as const,
  stream: () => [...hostAgentKeys.all, 'stream'] as const,
};

export function mapHostAgentStreamPhase(rawPhase?: string | null): HostAgentStreamPhase {
  const normalized = (rawPhase ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (!normalized) return 'planning';
  if (normalized.includes('cancel')) return 'cancelled';
  if (normalized.includes('error') || normalized.includes('fail')) return 'error';
  if (normalized.includes('complete') || normalized.includes('done')) return 'complete';
  if (normalized.includes('connect')) return 'connecting';
  if (normalized.includes('call') || normalized.includes('host_agent') || normalized.includes('runtime')) {
    return 'calling_host_agent';
  }
  if (normalized.includes('search') || normalized.includes('evidence') || normalized.includes('retriev')) {
    return 'searching';
  }
  if (normalized.includes('answer') || normalized.includes('synth') || normalized.includes('write')) {
    return 'answering';
  }
  return 'planning';
}

export function useHostAgentHealth() {
  return useQuery({
    queryKey: hostAgentKeys.health(),
    queryFn: () => hostAgentAPI.getHealth(),
    staleTime: 10 * 1000,
    retry: 1,
  });
}

export function useHostAgentCapability() {
  const { data, isLoading, isError } = useHostAgentHealth();
  return getHostAgentCapability(data, {
    isLoading,
    isError,
  });
}

export function useHostAgentMetadataProposal() {
  return useMutation({
    mutationKey: hostAgentKeys.metadataProposal(),
    mutationFn: (request: HostAgentMetadataProposalRequest) => hostAgentAPI.proposeMetadata(request),
  });
}

export function useHostAgentStream() {
  const [conversationId, setConversationId] = useState(createConversationId);
  const [turns, setTurns] = useState<HostAgentConversationTurn[]>([]);
  const [status, setStatus] = useState<HostAgentStreamStatus>('idle');
  const [phase, setPhase] = useState<HostAgentStreamPhase>('idle');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [evidencePreview, setEvidencePreview] = useState<HostAgentQueryResponse['evidence']>([]);
  const [deltaText, setDeltaText] = useState('');
  const [finalResponse, setFinalResponse] = useState<HostAgentQueryResponse | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [events, setEvents] = useState<HostAgentStreamEvent[]>([]);
  const activeRequestRef = useRef<ActiveHostAgentRequest | null>(null);
  const requestSequenceRef = useRef(0);

  const start = useCallback(async (rawQuery: string) => {
    const query = rawQuery.trim();
    if (!query) return;

    const previous = activeRequestRef.current;
    if (previous && previous.terminal === null) {
      previous.terminal = 'cancelled';
      previous.controller.abort();
      const cancellationError = new Error('Host Agent request cancelled by a newer request.');
      setTurns((current) => current.map((turn) => (
        turn.id === previous.turnId
          ? {
            ...turn,
            status: 'cancelled',
            phase: 'cancelled',
            error: cancellationError,
          }
          : turn
      )));
    } else {
      previous?.controller.abort();
    }

    requestSequenceRef.current += 1;
    const sequence = requestSequenceRef.current;
    const controller = new AbortController();
    const turnId = createTurnId();
    const request: ActiveHostAgentRequest = {
      sequence,
      turnId,
      controller,
      terminal: null,
    };
    activeRequestRef.current = request;
    const nextTurn: HostAgentConversationTurn = {
      id: turnId,
      query,
      status: 'connecting',
      phase: 'connecting',
      statusMessage: null,
      evidencePreview: [],
      deltaText: '',
      finalResponse: null,
      error: null,
      events: [],
    };

    const updateTurn = (patch: Partial<HostAgentConversationTurn>) => {
      if (activeRequestRef.current?.sequence !== sequence || controller.signal.aborted) return;
      setTurns((current) => current.map((turn) => (
        turn.id === turnId ? { ...turn, ...patch } : turn
      )));
    };

    const isCurrent = () => (
      activeRequestRef.current?.sequence === sequence && !controller.signal.aborted
    );

    const terminalErrorForEvent = (data: unknown): Error => {
      if (data && typeof data === 'object') {
        const eventData = data as { code?: unknown; error?: { code?: unknown } };
        const code = typeof eventData.code === 'string'
          ? eventData.code
          : typeof eventData.error?.code === 'string'
            ? eventData.error.code
            : '';
        if (code && /^[A-Za-z0-9_.:-]{1,80}$/.test(code)) {
          return new Error(`Host Agent stream error: ${code}`);
        }
      }
      return new Error('Host Agent stream error.');
    };

    const finishWithError = (terminal: 'error' | 'cancelled' | 'timeout', nextError: Error) => {
      if (!isCurrent() || request.terminal !== null) return;
      request.terminal = terminal;
      setError(nextError);
      setFinalResponse(null);
      setPhase(terminal === 'cancelled' ? 'cancelled' : 'error');
      setStatus(terminal === 'cancelled' ? 'cancelled' : 'error');
      updateTurn({
        status: terminal === 'cancelled' ? 'cancelled' : 'error',
        phase: terminal === 'cancelled' ? 'cancelled' : 'error',
        error: nextError,
        finalResponse: null,
        events: collected,
      });
    };

    setStatus('connecting');
    setPhase('connecting');
    setStatusMessage(null);
    setEvidencePreview([]);
    setDeltaText('');
    setFinalResponse(null);
    setError(null);
    setEvents([]);
    setTurns((current) => [...current, nextTurn]);

    const collected: HostAgentStreamEvent[] = [];
    let accumulatedDeltaText = '';
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    try {
      timeoutId = globalThis.setTimeout(() => {
        if (request.terminal === null && isCurrent()) {
          finishWithError('timeout', new Error('Host Agent stream timed out before a final response.'));
          controller.abort();
        }
      }, DEFAULT_HOST_AGENT_STREAM_TIMEOUT_MS);

      for await (const event of hostAgentAPI.stream(query, {
        signal: controller.signal,
        conversationId,
      })) {
        if (!isCurrent() || request.terminal !== null) break;
        collected.push(event);
        setEvents([...collected]);
        updateTurn({ events: [...collected] });

        if (event.type === 'status') {
          const nextPhase = mapHostAgentStreamPhase(event.data.phase);
          setStatus('streaming');
          setPhase(nextPhase);
          setStatusMessage(event.data.message ?? event.data.phase ?? null);
          updateTurn({
            status: 'streaming',
            phase: nextPhase,
            statusMessage: event.data.message ?? event.data.phase ?? null,
          });
        }

        if (event.type === 'evidence') {
          setStatus('streaming');
          setPhase('searching');
          setEvidencePreview(event.data);
          updateTurn({ status: 'streaming', phase: 'searching', evidencePreview: event.data });
        }

        if (event.type === 'delta') {
          setStatus('streaming');
          setPhase('answering');
          accumulatedDeltaText += event.data.text;
          setDeltaText(accumulatedDeltaText);
          updateTurn({ status: 'streaming', phase: 'answering', deltaText: accumulatedDeltaText });
        }

        if (event.type === 'error') {
          finishWithError('error', terminalErrorForEvent(event.data));
          break;
        }

        if (event.type === 'final') {
          request.terminal = 'final';
          setFinalResponse(event.data);
          setEvidencePreview(event.data.evidence);
          setPhase('complete');
          setStatus('complete');
          updateTurn({
            status: 'complete',
            phase: 'complete',
            finalResponse: event.data,
            evidencePreview: event.data.evidence,
            events: [...collected],
          });
          break;
        }
      }

      if (request.terminal === null && isCurrent()) {
        finishWithError('error', new Error('Host Agent stream ended before a final response.'));
      }
    } catch (err) {
      if (!isCurrent() || request.terminal !== null) return;
      const error = err instanceof Error ? err : new Error(String(err));
      if (controller.signal.aborted) {
        finishWithError('cancelled', new Error('Host Agent request cancelled.'));
      } else {
        finishWithError('error', error);
      }
    } finally {
      if (timeoutId !== null) globalThis.clearTimeout(timeoutId);
      if (activeRequestRef.current?.sequence === sequence) {
        activeRequestRef.current = null;
      }
    }
  }, [conversationId]);

  const cancel = useCallback(() => {
    const active = activeRequestRef.current;
    if (!active || active.terminal !== null) return;
    active.terminal = 'cancelled';
    active.controller.abort();
    requestSequenceRef.current += 1;
    activeRequestRef.current = null;
    const cancellationError = new Error('Host Agent request cancelled.');
    setError(cancellationError);
    setFinalResponse(null);
    setPhase('cancelled');
    setStatus('cancelled');
    setTurns((current) => current.map((turn) => (
      turn.id === active.turnId
        ? {
          ...turn,
          status: 'cancelled',
          phase: 'cancelled',
          error: cancellationError,
          finalResponse: null,
        }
        : turn
    )));
  }, []);

  const reset = useCallback(() => {
    activeRequestRef.current?.controller.abort();
    requestSequenceRef.current += 1;
    activeRequestRef.current = null;
    setConversationId(createConversationId());
    setTurns([]);
    setStatus('idle');
    setPhase('idle');
    setStatusMessage(null);
    setEvidencePreview([]);
    setDeltaText('');
    setFinalResponse(null);
    setError(null);
    setEvents([]);
  }, []);

  useEffect(() => () => {
    activeRequestRef.current?.controller.abort();
    requestSequenceRef.current += 1;
    activeRequestRef.current = null;
  }, []);

  return {
    conversationId,
    turns,
    status,
    phase,
    statusMessage,
    evidencePreview,
    evidenceCount: evidencePreview.length,
    deltaText,
    finalResponse,
    error,
    events,
    start,
    cancel,
    reset,
  };
}

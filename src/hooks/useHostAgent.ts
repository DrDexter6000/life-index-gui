import { useMutation, useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  hostAgentAPI,
  type HostAgentMetadataProposalRequest,
  type HostAgentQueryResponse,
  type HostAgentStreamEvent,
} from '@/lib/api-client';

export type HostAgentStreamStatus = 'idle' | 'connecting' | 'streaming' | 'complete' | 'error';
export type HostAgentStreamPhase =
  | 'idle'
  | 'connecting'
  | 'planning'
  | 'searching'
  | 'answering'
  | 'complete'
  | 'error';

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

export function useHostAgentHealth() {
  return useQuery({
    queryKey: hostAgentKeys.health(),
    queryFn: () => hostAgentAPI.getHealth(),
    staleTime: 10 * 1000,
    retry: 1,
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
  const abortRef = useRef<AbortController | null>(null);

  const start = useCallback(async (rawQuery: string) => {
    const query = rawQuery.trim();
    if (!query) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const turnId = createTurnId();
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
      setTurns((current) => current.map((turn) => (
        turn.id === turnId ? { ...turn, ...patch } : turn
      )));
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

    try {
      for await (const event of hostAgentAPI.stream(query, {
        signal: controller.signal,
        conversationId,
      })) {
        collected.push(event);
        setEvents([...collected]);
        updateTurn({ events: [...collected] });

        if (event.type === 'status') {
          const nextPhase = event.data.phase === 'searching' ? 'searching' : 'planning';
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

        if (event.type === 'final') {
          setFinalResponse(event.data);
          setEvidencePreview(event.data.evidence);
          updateTurn({
            finalResponse: event.data,
            evidencePreview: event.data.evidence,
          });
        }
      }

      setEvents(collected);
      setPhase('complete');
      setStatus('complete');
      updateTurn({
        status: 'complete',
        phase: 'complete',
        events: collected,
      });
    } catch (err) {
      if (controller.signal.aborted) return;
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      setFinalResponse(null);
      setPhase('error');
      setStatus('error');
      updateTurn({
        status: 'error',
        phase: 'error',
        error,
        finalResponse: null,
        events: collected,
      });
    }
  }, [conversationId]);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
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
    abortRef.current?.abort();
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
    reset,
  };
}

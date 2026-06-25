import { useMutation, useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  agentBridgeAPI,
  type AgentBridgeQueryResponse,
  type AgentBridgeStreamEvent,
} from '@/lib/api-client';

export type AgentBridgeStreamStatus = 'idle' | 'connecting' | 'streaming' | 'complete' | 'error';
export type AgentBridgeStreamPhase =
  | 'idle'
  | 'connecting'
  | 'warming'
  | 'planning'
  | 'searching'
  | 'answering'
  | 'complete'
  | 'error';
export type AgentBridgeStreamScaffold = AgentBridgeQueryResponse['scaffold'];
export type AgentBridgeStreamEvidencePreview = AgentBridgeQueryResponse['evidence'];
export interface AgentBridgeConversationTurn {
  id: string;
  query: string;
  status: AgentBridgeStreamStatus;
  phase: AgentBridgeStreamPhase;
  statusMessage: string | null;
  scaffold: AgentBridgeStreamScaffold | null;
  evidencePreview: AgentBridgeStreamEvidencePreview;
  deltaText: string;
  finalResponse: AgentBridgeQueryResponse | null;
  error: Error | null;
  events: AgentBridgeStreamEvent[];
}

let conversationSequence = 0;
let turnSequence = 0;

function createConversationId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  conversationSequence += 1;
  return `gui-conv-${Date.now().toString(36)}-${conversationSequence}`;
}

function createTurnId(): string {
  turnSequence += 1;
  return `turn-${Date.now().toString(36)}-${turnSequence}`;
}

// ── Agent Bridge query keys ───────────────────────────────────────────────

export const agentBridgeKeys = {
  all: ['agent-bridge'] as const,
  probe: () => [...agentBridgeKeys.all, 'probe'] as const,
  health: () => [...agentBridgeKeys.all, 'health'] as const,
  query: () => [...agentBridgeKeys.all, 'query'] as const,
  stream: () => [...agentBridgeKeys.all, 'stream'] as const,
};

/**
 * Safe preflight: does not send journal evidence or run synthesis.
 */
export function useAgentBridgeProbe() {
  return useQuery({
    queryKey: agentBridgeKeys.probe(),
    queryFn: () => agentBridgeAPI.getProbe(),
    staleTime: 30 * 1000,
    retry: 1,
  });
}

export function useAgentBridgeHealth() {
  return useQuery({
    queryKey: agentBridgeKeys.health(),
    queryFn: () => agentBridgeAPI.getHealth(),
    staleTime: 10 * 1000,
    retry: 1,
  });
}

/**
 * Explicit user-triggered handoff. This may send CLI-provided evidence to the
 * configured host-agent endpoint, so it is a mutation and never auto-runs.
 */
export function useAgentBridgeQuery() {
  return useMutation({
    mutationKey: agentBridgeKeys.query(),
    mutationFn: (query: string) => agentBridgeAPI.query(query),
  });
}

/**
 * Live streaming handoff. Accumulates delta text and the final rich envelope.
 * Does not start until ``start(query)`` is called.
 */
export function useAgentBridgeStream() {
  const [conversationId, setConversationId] = useState(createConversationId);
  const [turns, setTurns] = useState<AgentBridgeConversationTurn[]>([]);
  const [status, setStatus] = useState<AgentBridgeStreamStatus>('idle');
  const [phase, setPhase] = useState<AgentBridgeStreamPhase>('idle');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [scaffold, setScaffold] = useState<AgentBridgeStreamScaffold | null>(null);
  const [evidencePreview, setEvidencePreview] = useState<AgentBridgeStreamEvidencePreview>([]);
  const [deltaText, setDeltaText] = useState('');
  const [finalResponse, setFinalResponse] = useState<AgentBridgeQueryResponse | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [events, setEvents] = useState<AgentBridgeStreamEvent[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  const start = useCallback(async (rawQuery: string) => {
    const query = rawQuery.trim();
    if (!query) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const turnId = createTurnId();
    const nextTurn: AgentBridgeConversationTurn = {
      id: turnId,
      query,
      status: 'connecting',
      phase: 'connecting',
      statusMessage: null,
      scaffold: null,
      evidencePreview: [],
      deltaText: '',
      finalResponse: null,
      error: null,
      events: [],
    };

    const updateTurn = (patch: Partial<AgentBridgeConversationTurn>) => {
      setTurns((current) => current.map((turn) => (
        turn.id === turnId ? { ...turn, ...patch } : turn
      )));
    };

    setStatus('connecting');
    setPhase('connecting');
    setStatusMessage(null);
    setScaffold(null);
    setEvidencePreview([]);
    setDeltaText('');
    setFinalResponse(null);
    setError(null);
    setEvents([]);
    setTurns((current) => [...current, nextTurn]);

    const collected: AgentBridgeStreamEvent[] = [];
    let accumulatedDeltaText = '';
    try {
      for await (const event of agentBridgeAPI.stream(query, {
        signal: controller.signal,
        conversationId,
      })) {
        collected.push(event);
        setEvents([...collected]);
        updateTurn({ events: [...collected] });
        if (event.type === 'status') {
          setStatus('streaming');
          setPhase(event.data.phase === 'warming' ? 'warming' : 'connecting');
          setStatusMessage(event.data.message ?? event.data.phase ?? null);
          updateTurn({
            status: 'streaming',
            phase: event.data.phase === 'warming' ? 'warming' : 'connecting',
            statusMessage: event.data.message ?? event.data.phase ?? null,
          });
        }
        if (event.type === 'scaffold') {
          setStatus('streaming');
          setPhase('planning');
          setScaffold(event.data);
          updateTurn({ status: 'streaming', phase: 'planning', scaffold: event.data });
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
          setScaffold(event.data.scaffold);
          setEvidencePreview(event.data.evidence);
          updateTurn({
            finalResponse: event.data,
            scaffold: event.data.scaffold,
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
    setScaffold(null);
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
    scaffold,
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

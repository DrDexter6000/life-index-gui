"""Deterministic conformance harness for the production HTTP/SSE driver."""

from __future__ import annotations

from collections.abc import Iterable
from typing import Any

from host_agent_bridge.fake_host import FakeNeutralVectorHarness
from host_agent_bridge.http_sse_driver import (
    HTTP_SSE_BINDING_KIND,
    HTTP_SSE_BINDING_VERSION,
    NEUTRAL_INTERFACE_VERSION,
    HttpSseBindingDriver,
)
from host_agent_bridge.neutral_contract import (
    ClientContextSnapshot,
    ErrorEvent,
    FinalEvent,
    NeutralEvent,
    NeutralInvocation,
)
from host_agent_bridge.neutral_vectors import NeutralVector, VectorObservation
from host_agent_bridge.session_guard import NeutralKernelError, NeutralSessionGuard


class _VectorWireClient:
    """In-memory current-wire source used only by the deterministic harness."""

    def __init__(
        self,
        *,
        health: dict[str, Any],
        query_frames: list[tuple[str, Any]],
        metadata: dict[str, Any] | None,
        invoke_exception: Exception | None,
    ) -> None:
        self.health = health
        self.query_frames = query_frames
        self.metadata = metadata
        self.invoke_exception = invoke_exception
        self.readiness_call_count = 0
        self.invoke_call_count = 0

    def get_json(self, path: str) -> dict[str, Any]:
        if path != "/health":
            raise AssertionError(f"unexpected vector GET path: {path}")
        self.readiness_call_count += 1
        return self.health

    def post_sse(self, path: str, payload: dict[str, Any]) -> list[tuple[str, Any]]:
        del payload
        if path != "/query/stream":
            raise AssertionError(f"unexpected vector SSE path: {path}")
        self.invoke_call_count += 1
        if self.invoke_exception is not None:
            raise self.invoke_exception
        return self.query_frames

    def post_json(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        del payload
        if path != "/metadata/propose":
            raise AssertionError(f"unexpected vector JSON path: {path}")
        self.invoke_call_count += 1
        if self.invoke_exception is not None:
            raise self.invoke_exception
        if self.metadata is None:
            raise AssertionError("metadata vector did not materialize a response")
        return self.metadata


class _ObservedHttpSseBindingDriver(HttpSseBindingDriver):
    """Harness-only bounded observations without retaining invocation payloads."""

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self.observed_invoke_count = 0
        self.received_neutral_invocation = False
        self.payload_request_id_bound = False
        self.invocation_payload_immutable = False

    def invoke(self, invocation: NeutralInvocation) -> Iterable[NeutralEvent | dict[str, Any]]:
        self.observed_invoke_count += 1
        self.received_neutral_invocation = isinstance(invocation, NeutralInvocation)
        self.payload_request_id_bound = (
            invocation.domain_payload.get("request_id") == invocation.request.request_id
        )
        try:
            invocation.domain_payload["harness_mutation_probe"] = True
        except TypeError:
            self.invocation_payload_immutable = True
        else:  # pragma: no cover - Package K contract regression defense
            self.invocation_payload_immutable = False
        return super().invoke(invocation)


class HttpNeutralVectorHarness(FakeNeutralVectorHarness):
    """Execute the frozen neutral inventory through the current HTTP binding."""

    def __init__(self, *, available_capability_ids: tuple[str, ...]) -> None:
        super().__init__(
            available_capability_ids=available_capability_ids,
            binding_kind=HTTP_SSE_BINDING_KIND,
            binding_version=HTTP_SSE_BINDING_VERSION,
            interface_version=NEUTRAL_INTERFACE_VERSION,
        )
        self.not_applicable_reasons: dict[str, str] = {}
        self.http_materialization_reasons: dict[str, str] = {}
        self.locally_executed_vectors: set[str] = set()

    def execute(self, vector: NeutralVector) -> VectorObservation:
        self.seen_vectors.append(vector)
        self.materialized_binding_identities.append(
            (HTTP_SSE_BINDING_KIND, HTTP_SSE_BINDING_VERSION)
        )
        if vector.applicability.category == "synthetic-binding":
            self.http_materialization_reasons[vector.name] = (
                "applicable: deterministic malformed current-wire materialization reaches the neutral guard"
            )

        context = self._materialize_context(vector.context) if vector.context is not None else None
        profile = self._materialize_profile(vector.profile)
        authority = self._materialize_authority(vector.authority, profile)
        request = (
            self._materialize_request(vector.request, context, profile, authority)
            if vector.request is not None and context is not None
            else None
        )
        payload = self._materialize_domain_payload(vector.request) if vector.request is not None else {}
        health = self._materialize_current_health(vector)
        query_frames, metadata = self._materialize_current_result(vector, request)
        client = _VectorWireClient(
            health=health,
            query_frames=query_frames,
            metadata=metadata,
            invoke_exception=(
                RuntimeError("synthetic unsafe HTTP binding detail")
                if vector.action == "binding-exception"
                else None
            ),
        )
        driver = _ObservedHttpSseBindingDriver(
            client,
            interface_version=(
                NEUTRAL_INTERFACE_VERSION
                if vector.readiness.interface_version_relation == "match"
                else f"{NEUTRAL_INTERFACE_VERSION}.unsupported"
            ),
            binding_kind=(
                HTTP_SSE_BINDING_KIND
                if vector.readiness.binding_identity_relation == "match"
                else f"{HTTP_SSE_BINDING_KIND}.mismatch"
            ),
            binding_version=HTTP_SSE_BINDING_VERSION,
            supported_operations=vector.readiness.supported_operations,
        )
        guard = NeutralSessionGuard(
            driver,
            available_capability_ids=self._available_capability_ids,
            interface_versions=(NEUTRAL_INTERFACE_VERSION,),
            binding_kind=HTTP_SSE_BINDING_KIND,
            binding_version=HTTP_SSE_BINDING_VERSION,
        )

        reason = ""
        terminal: FinalEvent | ErrorEvent | None = None
        available: bool | None = None
        retry_stable: bool | None = None
        try:
            if vector.action == "readiness":
                ready = guard.readiness(profile, authority)
                reason = ready.code
                available = ready.available
            elif vector.action == "cancel-symmetry":
                self.locally_executed_vectors.add(vector.name)
                reason = self._observe_cancel_symmetry()
            else:
                if request is None or context is None:
                    raise AssertionError(f"{vector.name}: action requires request and context specs")
                if vector.action == "invoke":
                    terminal = guard.invoke(
                        request, profile, authority, context, domain_payload=payload
                    )[-1]
                elif vector.action == "cancel-before":
                    self.locally_executed_vectors.add(vector.name)
                    first = guard.cancel(request.request_id, provenance_ref="prov:cancel")
                    returned = guard.invoke(
                        request, profile, authority, context, domain_payload=payload
                    )
                    terminal = returned[-1]
                    retry_stable = returned == (first,) and terminal is first
                elif vector.action == "cancel-duplicate":
                    self.locally_executed_vectors.add(vector.name)
                    first = guard.cancel(request.request_id, provenance_ref="prov:cancel")
                    terminal = guard.cancel(request.request_id, provenance_ref="prov:ignored")
                    retry_stable = terminal is first
                elif vector.action == "cancel-after-terminal":
                    self.locally_executed_vectors.add(vector.name)
                    first = guard.invoke(
                        request, profile, authority, context, domain_payload=payload
                    )[-1]
                    terminal = guard.cancel(request.request_id, provenance_ref="prov:cancel")
                    retry_stable = terminal is first
                elif vector.action == "request-reuse":
                    guard.invoke(request, profile, authority, context, domain_payload=payload)
                    terminal = guard.terminal_for(request.request_id)
                    if vector.followup_mutation is None:
                        raise AssertionError(f"{vector.name}: request reuse requires a mutation")
                    changed = request.model_copy(
                        update={"tool_trace_ref": vector.followup_mutation.tool_trace_ref}
                    )
                    guard.invoke(changed, profile, authority, context, domain_payload=payload)
                elif vector.action in {"invoke-retry", "binding-exception"}:
                    first = guard.invoke(
                        request, profile, authority, context, domain_payload=payload
                    )
                    terminal = first[-1]
                    second = guard.invoke(
                        request, profile, authority, context, domain_payload=payload
                    )
                    retry_stable = second == first and second[0] is terminal
                else:  # pragma: no cover - Literal exhaustiveness guard
                    raise AssertionError(f"{vector.name}: unknown action {vector.action}")
        except NeutralKernelError as exc:
            reason = exc.code
            if request is not None:
                terminal = guard.terminal_for(request.request_id)
        else:
            if terminal is not None:
                reason = terminal.code if isinstance(terminal, ErrorEvent) else "FINAL"

        observed_terminal = None
        if isinstance(terminal, FinalEvent):
            observed_terminal = "final"
        elif isinstance(terminal, ErrorEvent):
            observed_terminal = "error"

        guarded_invocation: bool | None = None
        payload_request_id_bound: bool | None = None
        immutable_json: bool | None = None
        if "opaque-invocation" in vector.coverage:
            guarded_invocation = (
                driver.observed_invoke_count == 1 and driver.received_neutral_invocation
            )
            payload_request_id_bound = (
                guarded_invocation and request is not None and driver.payload_request_id_bound
            )
        if "deep-immutable-json" in vector.coverage:
            immutable_json = self._observe_http_deep_immutability(driver, terminal, context)

        return VectorObservation(
            reason=reason,
            terminal=observed_terminal,
            readiness_call_count=client.readiness_call_count,
            invoke_call_count=client.invoke_call_count,
            available=available,
            provenance_ref=(
                terminal.provenance_ref
                if "provenance" in vector.coverage and terminal is not None
                else None
            ),
            retry_stable=retry_stable,
            guarded_invocation=guarded_invocation,
            payload_request_id_bound=payload_request_id_bound,
            immutable_json=immutable_json,
        )

    @staticmethod
    def _materialize_current_health(vector: NeutralVector) -> dict[str, Any]:
        available = vector.readiness.available
        return {
            "schema_version": "gui.host_agent.health.v1",
            "running": available,
            "ready": available,
            "degraded": not available,
            "mode": "READY" if available else "UNAVAILABLE",
            "reason": vector.readiness.reason,
            "runtime": {"kind": "deterministic-http-vector", "interface_version": "v1"},
            "checks": [],
        }

    def _materialize_current_result(
        self,
        vector: NeutralVector,
        request: Any,
    ) -> tuple[list[tuple[str, Any]], dict[str, Any] | None]:
        if request is None:
            return [], None
        if request.operation == "metadata.propose":
            if len(vector.raw_events) != 1 or vector.raw_events[0].kind != "final":
                return [], None
            spec = vector.raw_events[0]
            response_request_id = (
                request.request_id
                if spec.request_relation == "match"
                else f"{request.request_id}.mismatch"
            )
            return [], {
                "schema_version": "gui.host_agent.metadata_proposal.v1",
                "request_id": response_request_id,
                "mode": spec.mode,
                "reason": "synthetic-http-vector",
                "fields": {"title": {"value": "Synthetic vector title"}}
                if spec.mode == "PROPOSED"
                else {},
                "warnings": [],
                "policy": {"preserve_user_fields": True},
                "provenance_ref": spec.provenance_ref or "prov:final",
            }

        frames: list[tuple[str, Any]] = []
        for spec in vector.raw_events:
            event_request_id = (
                request.request_id
                if spec.request_relation == "match"
                else f"{request.request_id}.mismatch"
            )
            common = {"request_id": event_request_id, "sequence": spec.sequence}
            if spec.kind == "invalid":
                frames.append(("malformed", {**common, "unexpected": "current-wire-event"}))
            elif spec.kind == "status":
                frames.append(
                    ("status", {**common, "phase": spec.phase, "message": spec.message})
                )
            elif spec.kind == "evidence":
                frames.append(
                    (
                        "evidence",
                        {
                            **common,
                            "evidence": dict(spec.evidence),
                            "provenance_ref": spec.provenance_ref or "prov:evidence",
                        },
                    )
                )
            elif spec.kind == "final":
                domain_request_id = (
                    event_request_id
                    if spec.domain_request_relation == "match"
                    else f"{event_request_id}.mismatch"
                )
                envelope = {
                    "schema_version": "gui.host_agent.query_response.v1",
                    "request_id": domain_request_id,
                    "conversation_id": "vector-conversation",
                    "source": "host-agent",
                    "mode": spec.mode,
                    "reason": "synthetic-http-vector",
                    "query": "Synthetic vector query",
                    "answer": {
                        "mode": spec.mode,
                        "reason": "synthetic-http-vector",
                        "summary": "Synthetic vector result.",
                        "insights": [],
                        "gap": None,
                        "suggestions": [],
                    },
                    "evidence": (
                        [
                            {
                                "id": "synthetic/vector.md",
                                "rel_path": "Journals/synthetic/vector.md",
                                "title": "Synthetic vector evidence",
                                "date": "2026-07-03",
                            }
                        ]
                        if spec.mode == "GROUNDED"
                        else []
                    ),
                    "tool_trace": [],
                    "sequence": spec.sequence,
                    "provenance_ref": spec.provenance_ref or "prov:final",
                }
                frames.append(("final", envelope))
            else:
                frames.append(
                    (
                        "error",
                        {
                            **common,
                            "code": spec.code,
                            "reason": "synthetic-tool-failure",
                            "retryable": spec.retryable,
                            "provider_outcome": spec.provider_outcome,
                            "effect_known": spec.effect_known,
                            "presentation_state": spec.presentation_state.upper(),
                            "provenance_ref": spec.provenance_ref,
                            "raw_detail": spec.unchanged_provider_error_or_outcome,
                        },
                    )
                )
        return frames, None

    @staticmethod
    def _observe_http_deep_immutability(
        driver: _ObservedHttpSseBindingDriver,
        terminal: FinalEvent | ErrorEvent | None,
        context: ClientContextSnapshot | None,
    ) -> bool:
        if (
            driver.observed_invoke_count != 1
            or not driver.invocation_payload_immutable
            or terminal is None
            or context is None
        ):
            return False
        try:
            context.client_location.value["mutation"] = True
        except TypeError:
            pass
        else:
            return False
        if isinstance(terminal, FinalEvent):
            try:
                terminal.domain_envelope["mutation"] = True
            except TypeError:
                return True
            return False
        return True


__all__ = ["HttpNeutralVectorHarness"]

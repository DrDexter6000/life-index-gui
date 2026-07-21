"""Binding-neutral Host Agent kernel scenarios, observations, and runner."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any, Literal, Protocol

from host_agent_bridge.neutral_contract import SessionOperation, _freeze_json

VectorAction = Literal[
    "readiness",
    "invoke",
    "cancel-before",
    "cancel-duplicate",
    "cancel-after-terminal",
    "request-reuse",
    "invoke-retry",
    "binding-exception",
    "cancel-symmetry",
]
ExpectedTerminal = Literal["final", "error"] | None
Relation = Literal["match", "mismatch"]
ApplicabilityCategory = Literal["all-bindings", "synthetic-binding"]


@dataclass(frozen=True, slots=True)
class FactSpec:
    value: Any
    source: str = "synthetic-client"
    observed_at_or_freshness: str = "fresh"
    manual_override: bool = False
    provenance: str = "prov:fact"


@dataclass(frozen=True, slots=True)
class ContextSpec:
    context_id: str = "context-vector"
    locale: str = "en-NG"
    timezone: FactSpec = FactSpec("Africa/Lagos", source="client-settings", provenance="prov:timezone")
    client_location: FactSpec = FactSpec(
        _freeze_json({"city": "Synthetic City", "coordinates": [6.45, 3.39]}),
        source="user",
        manual_override=True,
        provenance="prov:location",
    )
    weather: FactSpec = FactSpec(
        _freeze_json({"condition": "synthetic-rain", "temperature_c": 27.0}),
        source="synthetic-provider",
        provenance="prov:weather",
    )


@dataclass(frozen=True, slots=True)
class ProfileSpec:
    profile_id: str = "profile-vector"
    capability_slots: tuple[int, ...] = (0, 1, 2)
    include_unavailable_capability: bool = False
    allowed_session_operations: tuple[SessionOperation, ...] = ("query", "metadata.propose")


@dataclass(frozen=True, slots=True)
class AuthoritySpec:
    session_id: str = "session-vector"
    data_scope_ref: str = "scope:synthetic"
    allowed_session_operations: tuple[SessionOperation, ...] = ("query", "metadata.propose")
    profile_relation: Relation = "match"
    explicit_user_confirmation_state: str = "not_required"
    explicit_user_confirmation_ref: str | None = None


@dataclass(frozen=True, slots=True)
class ReadinessSpec:
    interface_version_relation: Relation = "match"
    binding_identity_relation: Relation = "match"
    supported_operations: tuple[SessionOperation, ...] = ("query", "metadata.propose")
    available: bool = True
    reason: str = "READY"
    code: str = "READY"


@dataclass(frozen=True, slots=True)
class RequestSpec:
    request_id: str
    operation: SessionOperation = "query"
    session_relation: Relation = "match"
    context_relation: Relation = "match"
    profile_relation: Relation = "match"
    binding_identity_relation: Relation = "match"
    capability_slots: tuple[int, ...] = (0,)
    include_unavailable_capability: bool = False
    tool_trace_ref: str | None = "trace:vector"
    payload_request_id_relation: Literal["absent", "match", "mismatch", "null"] = "absent"
    domain_payload: Mapping[str, Any] = field(
        default_factory=lambda: _freeze_json(
            {"input": {"kind": "synthetic", "items": ["one", "two"]}},
            path="request_spec.domain_payload",
        )
    )


@dataclass(frozen=True, slots=True)
class RequestMutationSpec:
    tool_trace_ref: str = "trace:different"


@dataclass(frozen=True, slots=True)
class EventSpec:
    kind: Literal["status", "evidence", "final", "error", "invalid"]
    sequence: int
    request_relation: Relation = "match"
    domain_request_relation: Relation = "match"
    provenance_ref: str | None = None
    phase: str = "synthetic"
    message: str = "Synthetic status."
    evidence: Mapping[str, Any] = field(
        default_factory=lambda: _freeze_json({"id": "synthetic-evidence"})
    )
    mode: str = "GROUNDED"
    code: str = "TOOL_FAILED"
    layer: Literal["session", "binding", "tool"] = "tool"
    safe_message: str = "Synthetic tool failure."
    retryable: bool = False
    unchanged_provider_error_or_outcome: Any | None = None
    effect_known: bool = False
    presentation_state: Literal["failed", "canceled"] = "failed"
    provider_outcome: Literal["succeeded", "failed", "unknown"] = "failed"


@dataclass(frozen=True, slots=True)
class VectorApplicability:
    category: ApplicabilityCategory = "all-bindings"
    reason: str = "Uses only neutral session semantics."


@dataclass(frozen=True, slots=True)
class VectorOracle:
    reason: str
    terminal: ExpectedTerminal = None
    readiness_call_count: int = 0
    invoke_call_count: int = 0
    available: bool | None = None
    provenance_ref: str | None = None
    retry_stable: bool | None = None
    guarded_invocation: bool | None = None
    payload_request_id_bound: bool | None = None
    immutable_json: bool | None = None


@dataclass(frozen=True, slots=True)
class NeutralVector:
    """One immutable binding-neutral causal scenario and exact oracle."""

    name: str
    coverage: tuple[str, ...]
    action: VectorAction
    readiness: ReadinessSpec
    profile: ProfileSpec
    authority: AuthoritySpec
    request: RequestSpec | None
    context: ContextSpec | None
    raw_events: tuple[EventSpec, ...]
    followup_mutation: RequestMutationSpec | None
    applicability: VectorApplicability
    oracle: VectorOracle

    @property
    def expected_reason(self) -> str:
        return self.oracle.reason

    @property
    def expected_terminal(self) -> ExpectedTerminal:
        return self.oracle.terminal

    @property
    def expected_readiness_calls(self) -> int:
        return self.oracle.readiness_call_count

    @property
    def expected_invoke_calls(self) -> int:
        return self.oracle.invoke_call_count


@dataclass(frozen=True, slots=True)
class VectorObservation:
    reason: str
    terminal: ExpectedTerminal
    readiness_call_count: int
    invoke_call_count: int
    available: bool | None = None
    provenance_ref: str | None = None
    retry_stable: bool | None = None
    guarded_invocation: bool | None = None
    payload_request_id_bound: bool | None = None
    immutable_json: bool | None = None


class NeutralVectorHarness(Protocol):
    """Materialize and execute an unchanged neutral vector for one binding."""

    def execute(self, vector: NeutralVector) -> VectorObservation:
        ...


@dataclass(frozen=True, slots=True)
class VectorResult:
    name: str
    passed: bool
    expected_reason: str
    expected_terminal: ExpectedTerminal
    readiness_call_count: int
    invoke_call_count: int


def _oracle(
    reason: str,
    *,
    terminal: ExpectedTerminal = None,
    readiness_calls: int = 0,
    invoke_calls: int = 0,
    available: bool | None = None,
    provenance: str | None = None,
    retry_stable: bool | None = None,
    guarded_invocation: bool | None = None,
    payload_request_id_bound: bool | None = None,
    immutable_json: bool | None = None,
) -> VectorOracle:
    return VectorOracle(
        reason=reason,
        terminal=terminal,
        readiness_call_count=readiness_calls,
        invoke_call_count=invoke_calls,
        available=available,
        provenance_ref=provenance,
        retry_stable=retry_stable,
        guarded_invocation=guarded_invocation,
        payload_request_id_bound=payload_request_id_bound,
        immutable_json=immutable_json,
    )


def _vector(
    name: str,
    coverage: tuple[str, ...],
    oracle: VectorOracle,
    *,
    action: VectorAction = "invoke",
    readiness: ReadinessSpec = ReadinessSpec(),
    profile: ProfileSpec = ProfileSpec(),
    authority: AuthoritySpec = AuthoritySpec(),
    request: RequestSpec | None = None,
    context: ContextSpec | None = ContextSpec(),
    raw_events: tuple[EventSpec, ...] = (),
    followup_mutation: RequestMutationSpec | None = None,
    applicability: VectorApplicability = VectorApplicability(),
) -> NeutralVector:
    return NeutralVector(
        name=name,
        coverage=coverage,
        action=action,
        readiness=readiness,
        profile=profile,
        authority=authority,
        request=request,
        context=context,
        raw_events=raw_events,
        followup_mutation=followup_mutation,
        applicability=applicability,
        oracle=oracle,
    )


def _request(request_id: str, **changes: Any) -> RequestSpec:
    values = {
        "request_id": request_id,
        "operation": "query",
        "session_relation": "match",
        "context_relation": "match",
        "profile_relation": "match",
        "binding_identity_relation": "match",
        "capability_slots": (0,),
        "include_unavailable_capability": False,
        "tool_trace_ref": "trace:vector",
        "payload_request_id_relation": "absent",
        "domain_payload": _freeze_json(
            {"input": {"kind": "synthetic", "items": ["one", "two"]}},
            path="request_spec.domain_payload",
        ),
    }
    values.update(changes)
    return RequestSpec(**values)


def _final(sequence: int = 1, **changes: Any) -> EventSpec:
    values = {"kind": "final", "sequence": sequence, "provenance_ref": "prov:final"}
    values.update(changes)
    return EventSpec(**values)


NEUTRAL_VECTORS: tuple[NeutralVector, ...] = (
    _vector(
        "readiness-ready",
        ("readiness-ready",),
        _oracle("READY", readiness_calls=1, available=True),
        action="readiness",
        request=None,
    ),
    _vector(
        "readiness-unavailable",
        ("readiness-unavailable",),
        _oracle("OFFLINE", readiness_calls=1, available=False),
        action="readiness",
        readiness=ReadinessSpec(available=False, reason="OFFLINE", code="OFFLINE"),
        request=None,
    ),
    _vector(
        "readiness-unsupported-version",
        ("readiness-version",),
        _oracle("UNSUPPORTED_VERSION", readiness_calls=1, available=False),
        action="readiness",
        readiness=ReadinessSpec(interface_version_relation="mismatch"),
        request=None,
    ),
    _vector(
        "readiness-unsupported-operation",
        ("readiness-operation",),
        _oracle("UNSUPPORTED_VERSION", readiness_calls=1, available=False),
        action="readiness",
        readiness=ReadinessSpec(supported_operations=("query",)),
        request=None,
    ),
    _vector(
        "invoke-under-unavailable-readiness",
        ("invoke-unavailable",),
        _oracle("UNAVAILABLE", readiness_calls=1),
        readiness=ReadinessSpec(available=False, reason="OFFLINE", code="OFFLINE"),
        request=_request("vector-invoke-unavailable"),
    ),
    _vector(
        "invoke-under-unsupported-version",
        ("invoke-version",),
        _oracle("UNSUPPORTED_VERSION", readiness_calls=1),
        readiness=ReadinessSpec(interface_version_relation="mismatch"),
        request=_request("vector-invoke-version"),
    ),
    _vector(
        "invoke-under-unsupported-operation",
        ("invoke-operation",),
        _oracle("UNSUPPORTED_VERSION", readiness_calls=1),
        readiness=ReadinessSpec(supported_operations=("metadata.propose",)),
        request=_request("vector-invoke-operation"),
    ),
    _vector(
        "invoke-under-binding-identity-mismatch-readiness",
        ("invoke-binding",),
        _oracle("UNSUPPORTED_VERSION", readiness_calls=1),
        readiness=ReadinessSpec(binding_identity_relation="mismatch"),
        request=_request("vector-invoke-binding-readiness"),
    ),
    _vector(
        "domain-payload-request-correlation-denial",
        ("domain-payload-correlation",),
        _oracle("DOMAIN_REQUEST_MISMATCH"),
        request=_request(
            "vector-domain-payload-mismatch",
            payload_request_id_relation="mismatch",
        ),
    ),
    _vector(
        "domain-payload-null-request-correlation-denial",
        ("domain-payload-correlation",),
        _oracle("DOMAIN_REQUEST_MISMATCH"),
        request=_request(
            "vector-domain-payload-null",
            payload_request_id_relation="null",
        ),
    ),
    _vector(
        "guarded-opaque-invocation-and-deep-immutable-json",
        ("opaque-invocation", "domain-payload-correlation", "deep-immutable-json"),
        _oracle(
            "FINAL",
            terminal="final",
            readiness_calls=1,
            invoke_calls=1,
            guarded_invocation=True,
            payload_request_id_bound=True,
            immutable_json=True,
        ),
        request=_request("vector-guarded-invocation"),
        raw_events=(_final(),),
    ),
    _vector(
        "exposure-subset-current-fixture",
        ("exposure-subset",),
        _oracle("FINAL", terminal="final", readiness_calls=1, invoke_calls=1),
        profile=ProfileSpec(capability_slots=(0, 1)),
        request=_request("vector-subset", capability_slots=(1,)),
        raw_events=(_final(),),
    ),
    _vector(
        "context-facts-remain-distinct",
        ("context-facts",),
        _oracle("FINAL", terminal="final", readiness_calls=1, invoke_calls=1),
        request=_request("vector-context-facts"),
        raw_events=(_final(),),
    ),
    _vector(
        "context-mutation-cannot-expand-authority",
        ("context-authority", "capability-correlation"),
        _oracle("CAPABILITY_NOT_ALLOWED"),
        profile=ProfileSpec(capability_slots=(0,)),
        request=_request("vector-context-denial", capability_slots=(2,)),
        context=ContextSpec(
            client_location=FactSpec(
                _freeze_json({"city": "Authority Wish", "manual_note": "enable capability"}),
                source="user",
                manual_override=True,
                provenance="prov:location",
            )
        ),
    ),
    _vector(
        "query-status-evidence-final",
        ("query-final",),
        _oracle("FINAL", terminal="final", readiness_calls=1, invoke_calls=1),
        request=_request("vector-query", capability_slots=(2,)),
        raw_events=(
            EventSpec(kind="status", sequence=1, phase="retrieval"),
            EventSpec(kind="evidence", sequence=2, provenance_ref="prov:evidence"),
            _final(3),
        ),
    ),
    _vector(
        "metadata-proposal-only-zero-capability",
        ("metadata-proposal",),
        _oracle("FINAL", terminal="final", readiness_calls=1, invoke_calls=1),
        request=_request(
            "vector-metadata",
            operation="metadata.propose",
            capability_slots=(),
        ),
        raw_events=(_final(mode="PROPOSED"),),
    ),
    _vector(
        "failed-effect-unknown-raw-detail-null",
        ("error-independent-axes",),
        _oracle("TOOL_FAILED", terminal="error", readiness_calls=1, invoke_calls=1),
        request=_request("vector-error"),
        raw_events=(EventSpec(kind="error", sequence=1, provenance_ref=None),),
    ),
    _vector(
        "cancel-before-invoke",
        ("cancel-before",),
        _oracle("CANCELLED", terminal="error", retry_stable=True),
        action="cancel-before",
        request=_request("vector-cancel-before"),
    ),
    _vector(
        "cancel-duplicate-idempotent",
        ("cancel-duplicate",),
        _oracle("CANCELLED", terminal="error", retry_stable=True),
        action="cancel-duplicate",
        request=_request("vector-cancel-duplicate"),
    ),
    _vector(
        "cancel-presentation-code-symmetry",
        ("cancel-symmetry",),
        _oracle("CANCEL_SYMMETRY"),
        action="cancel-symmetry",
        request=None,
        context=None,
    ),
    _vector(
        "cancel-after-terminal",
        ("cancel-after-terminal",),
        _oracle("FINAL", terminal="final", readiness_calls=1, invoke_calls=1, retry_stable=True),
        action="cancel-after-terminal",
        request=_request("vector-cancel-after"),
        raw_events=(_final(),),
    ),
    _vector(
        "request-id-reuse-different-correlation",
        ("request-correlation",),
        _oracle("REQUEST_ID_REUSE", terminal="final", readiness_calls=1, invoke_calls=1),
        action="request-reuse",
        request=_request("vector-reuse"),
        raw_events=(_final(),),
        followup_mutation=RequestMutationSpec(),
    ),
    _vector(
        "session-correlation-denial",
        ("session-correlation",),
        _oracle("SESSION_MISMATCH"),
        request=_request("vector-session", session_relation="mismatch"),
    ),
    _vector(
        "context-correlation-denial",
        ("context-correlation",),
        _oracle("CONTEXT_MISMATCH"),
        request=_request("vector-context", context_relation="mismatch"),
    ),
    _vector(
        "profile-correlation-denial",
        ("profile-correlation",),
        _oracle("PROFILE_MISMATCH"),
        request=_request("vector-profile", profile_relation="mismatch"),
    ),
    _vector(
        "authority-profile-correlation-denial",
        ("profile-correlation",),
        _oracle("PROFILE_MISMATCH"),
        authority=AuthoritySpec(profile_relation="mismatch"),
        request=_request("vector-authority-profile"),
    ),
    _vector(
        "binding-correlation-denial",
        ("binding-correlation",),
        _oracle("BINDING_MISMATCH"),
        request=_request("vector-binding", binding_identity_relation="mismatch"),
    ),
    _vector(
        "profile-capability-outside-injected-authority",
        ("capability-correlation",),
        _oracle("CAPABILITY_NOT_AVAILABLE"),
        profile=ProfileSpec(include_unavailable_capability=True),
        request=_request("vector-capability-unavailable"),
    ),
    _vector(
        "invalid-event-becomes-stable-binding-error",
        ("invalid-event", "post-dispatch-stable-error"),
        _oracle(
            "EVENT_INVALID",
            terminal="error",
            readiness_calls=1,
            invoke_calls=1,
            retry_stable=True,
        ),
        action="invoke-retry",
        request=_request("vector-invalid-event"),
        raw_events=(EventSpec(kind="invalid", sequence=1),),
        applicability=VectorApplicability(
            category="synthetic-binding",
            reason="Requires injection of a malformed binding event.",
        ),
    ),
    _vector(
        "event-request-correlation-denial",
        ("event-correlation",),
        _oracle("EVENT_REQUEST_MISMATCH", terminal="error", readiness_calls=1, invoke_calls=1),
        request=_request("vector-event-request"),
        raw_events=(_final(request_relation="mismatch"),),
    ),
    _vector(
        "provenance-chain-preserved",
        ("provenance",),
        _oracle(
            "FINAL",
            terminal="final",
            readiness_calls=1,
            invoke_calls=1,
            provenance="prov:unchanged-final",
        ),
        request=_request("vector-provenance"),
        raw_events=(_final(provenance_ref="prov:unchanged-final"),),
    ),
    _vector(
        "duplicate-terminal-rejected",
        ("duplicate-terminal",),
        _oracle("DUPLICATE_TERMINAL", terminal="error", readiness_calls=1, invoke_calls=1),
        request=_request("vector-duplicate-terminal"),
        raw_events=(_final(1), _final(2)),
        applicability=VectorApplicability(
            category="synthetic-binding",
            reason="Requires injection of two binding terminal events.",
        ),
    ),
    _vector(
        "late-status-rejected",
        ("late-frame", "post-dispatch-stable-error"),
        _oracle(
            "LATE_FRAME",
            terminal="error",
            readiness_calls=1,
            invoke_calls=1,
            retry_stable=True,
        ),
        action="invoke-retry",
        request=_request("vector-late"),
        raw_events=(_final(1), EventSpec(kind="status", sequence=2, phase="late")),
        applicability=VectorApplicability(
            category="synthetic-binding",
            reason="Requires injection of a post-terminal event.",
        ),
    ),
    _vector(
        "non-monotonic-sequence-rejected",
        ("event-correlation",),
        _oracle("EVENT_SEQUENCE", terminal="error", readiness_calls=1, invoke_calls=1),
        request=_request("vector-sequence"),
        raw_events=(EventSpec(kind="status", sequence=2), _final(1)),
        applicability=VectorApplicability(
            category="synthetic-binding",
            reason="Requires injection of a non-monotonic event sequence.",
        ),
    ),
    _vector(
        "missing-terminal-becomes-stable-binding-error",
        ("post-dispatch-stable-error",),
        _oracle(
            "MISSING_TERMINAL",
            terminal="error",
            readiness_calls=1,
            invoke_calls=1,
            retry_stable=True,
        ),
        action="invoke-retry",
        request=_request("vector-missing-terminal"),
        raw_events=(EventSpec(kind="status", sequence=1, phase="only"),),
        applicability=VectorApplicability(
            category="synthetic-binding",
            reason="Requires completion of a binding stream without a terminal.",
        ),
    ),
    _vector(
        "binding-exception-becomes-safe-stable-error",
        ("post-dispatch-stable-error",),
        _oracle(
            "BINDING_FAILURE",
            terminal="error",
            readiness_calls=1,
            invoke_calls=1,
            retry_stable=True,
        ),
        action="binding-exception",
        request=_request("vector-binding-exception"),
        applicability=VectorApplicability(
            category="synthetic-binding",
            reason="Requires deterministic injection of a binding exception.",
        ),
    ),
)


def run_neutral_vectors(
    vectors: Sequence[NeutralVector],
    harness: NeutralVectorHarness,
) -> tuple[VectorResult, ...]:
    """Execute unchanged vectors and centrally compare observations to oracles."""

    results: list[VectorResult] = []
    for vector in vectors:
        observation = harness.execute(vector)
        expected = VectorObservation(
            reason=vector.oracle.reason,
            terminal=vector.oracle.terminal,
            readiness_call_count=vector.oracle.readiness_call_count,
            invoke_call_count=vector.oracle.invoke_call_count,
            available=vector.oracle.available,
            provenance_ref=vector.oracle.provenance_ref,
            retry_stable=vector.oracle.retry_stable,
            guarded_invocation=vector.oracle.guarded_invocation,
            payload_request_id_bound=vector.oracle.payload_request_id_bound,
            immutable_json=vector.oracle.immutable_json,
        )
        if observation != expected:
            raise AssertionError(
                f"{vector.name}: observation {observation!r} did not match oracle {expected!r}"
            )
        results.append(
            VectorResult(
                name=vector.name,
                passed=True,
                expected_reason=vector.oracle.reason,
                expected_terminal=vector.oracle.terminal,
                readiness_call_count=observation.readiness_call_count,
                invoke_call_count=observation.invoke_call_count,
            )
        )
    return tuple(results)


__all__ = [
    "AuthoritySpec",
    "ContextSpec",
    "EventSpec",
    "FactSpec",
    "NEUTRAL_VECTORS",
    "NeutralVector",
    "NeutralVectorHarness",
    "ProfileSpec",
    "ReadinessSpec",
    "RequestMutationSpec",
    "RequestSpec",
    "VectorApplicability",
    "VectorObservation",
    "VectorOracle",
    "VectorResult",
    "run_neutral_vectors",
]

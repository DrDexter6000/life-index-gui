"""Minimal transport-neutral contracts for a Life Index Host Agent session.

This module deliberately owns no transport frames, tool schemas, effect registry,
runtime names, domain logic, or data access.  Capability values are opaque IDs
whose authority is injected by the caller.
"""

from __future__ import annotations

import math
from collections.abc import Mapping
from typing import Any, Literal, Self, TypeAlias

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    TypeAdapter,
    ValidationInfo,
    field_validator,
    model_validator,
)

SessionOperation: TypeAlias = Literal["query", "metadata.propose"]
ErrorLayer: TypeAlias = Literal["session", "binding", "tool"]
PresentationState: TypeAlias = Literal["failed", "canceled"]
ProviderOutcome: TypeAlias = Literal["succeeded", "failed", "unknown"]


class FrozenJsonDict(dict[str, Any]):
    """Small immutable dict preserving ordinary JSON mapping behavior."""

    @staticmethod
    def _immutable(*_args: object, **_kwargs: object) -> None:
        raise TypeError("frozen JSON object does not support mutation")

    __setitem__ = _immutable
    __delitem__ = _immutable
    clear = _immutable
    pop = _immutable
    popitem = _immutable
    setdefault = _immutable
    update = _immutable
    __ior__ = _immutable

    def copy(self) -> "FrozenJsonDict":
        return self


def _freeze_json(value: Any, *, path: str = "value") -> Any:
    if value is None or isinstance(value, (str, bool, int)):
        return value
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ValueError(f"{path} must contain only finite JSON numbers")
        return value
    if isinstance(value, (list, tuple)):
        return tuple(_freeze_json(item, path=f"{path}[{index}]") for index, item in enumerate(value))
    if isinstance(value, Mapping):
        frozen: dict[str, Any] = {}
        for key, item in value.items():
            if not isinstance(key, str):
                raise ValueError(f"{path} JSON object keys must be strings")
            frozen[key] = _freeze_json(item, path=f"{path}.{key}")
        return FrozenJsonDict(frozen)
    raise ValueError(f"{path} must be JSON-compatible")


class NeutralModel(BaseModel):
    """Strict immutable base for the neutral kernel."""

    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)

    def model_copy(
        self,
        *,
        update: Mapping[str, Any] | None = None,
        deep: bool = False,
    ) -> Self:
        """Return a revalidated copy so trusted updates cannot bypass freezing."""

        del deep  # Validation reconstructs nested values regardless of shallow/deep intent.
        values = {name: getattr(self, name) for name in type(self).model_fields}
        if update:
            values.update(update)
        return type(self).model_validate(values, context=self._copy_validation_context())

    def _copy_validation_context(self) -> dict[str, object] | None:
        return None


class ContextFact(NeutralModel):
    value: Any
    source: str = Field(min_length=1)
    observed_at_or_freshness: str = Field(min_length=1)
    manual_override: bool
    provenance: str = Field(min_length=1)

    @field_validator("value")
    @classmethod
    def validate_value(cls, value: Any) -> Any:
        return _freeze_json(value)


class ClientContextSnapshot(NeutralModel):
    context_id: str = Field(min_length=1)
    locale: str = Field(min_length=1)
    timezone: ContextFact
    client_location: ContextFact
    weather: ContextFact


class SessionExposureProfile(NeutralModel):
    profile_id: str = Field(min_length=1)
    capability_ids: tuple[str, ...]
    allowed_session_operations: tuple[SessionOperation, ...]

    @field_validator("capability_ids")
    @classmethod
    def validate_capability_ids(cls, values: tuple[str, ...]) -> tuple[str, ...]:
        if any(not value for value in values):
            raise ValueError("capability_ids must contain non-empty opaque IDs")
        if len(set(values)) != len(values):
            raise ValueError("capability_ids must not contain duplicates")
        return values

    @field_validator("allowed_session_operations")
    @classmethod
    def validate_operations(cls, values: tuple[SessionOperation, ...]) -> tuple[SessionOperation, ...]:
        if len(set(values)) != len(values):
            raise ValueError("allowed_session_operations must not contain duplicates")
        return values


class SessionAuthority(NeutralModel):
    session_id: str = Field(min_length=1)
    data_scope_ref: str = Field(min_length=1)
    allowed_session_operations: tuple[SessionOperation, ...]
    exposure_profile_ref: str = Field(min_length=1)
    explicit_user_confirmation_state: str = Field(min_length=1)
    explicit_user_confirmation_ref: str | None

    @field_validator("allowed_session_operations")
    @classmethod
    def validate_operations(cls, values: tuple[SessionOperation, ...]) -> tuple[SessionOperation, ...]:
        if len(set(values)) != len(values):
            raise ValueError("allowed_session_operations must not contain duplicates")
        return values


class NeutralSessionRequest(NeutralModel):
    request_id: str = Field(min_length=1)
    operation: SessionOperation
    session_id: str = Field(min_length=1)
    context_id: str = Field(min_length=1)
    exposure_profile_ref: str = Field(min_length=1)
    binding_kind: str = Field(min_length=1)
    binding_version: str = Field(min_length=1)
    requested_capability_ids: tuple[str, ...]
    cli_package_version_ref: str | None = None
    cli_schema_version_ref: str | None = None
    tool_trace_ref: str | None = None
    provenance_ref: str | None = None
    context_snapshot: ClientContextSnapshot

    @field_validator("requested_capability_ids")
    @classmethod
    def validate_requested_capabilities(cls, values: tuple[str, ...]) -> tuple[str, ...]:
        if any(not value for value in values):
            raise ValueError("requested_capability_ids must contain non-empty opaque IDs")
        if len(set(values)) != len(values):
            raise ValueError("requested_capability_ids must not contain duplicates")
        return values

    @model_validator(mode="after")
    def validate_embedded_context(self) -> "NeutralSessionRequest":
        if self.context_snapshot.context_id != self.context_id:
            raise ValueError("context_snapshot.context_id must match context_id")
        return self


_GUARDED_INVOCATION_TOKEN = object()


class NeutralInvocation(NeutralModel):
    """Opaque, evaluated invocation created only after guard validation."""

    request: NeutralSessionRequest
    data_scope_ref: str = Field(min_length=1)
    exposure_profile_ref: str = Field(min_length=1)
    capability_ids: tuple[str, ...]
    allowed_session_operations: tuple[SessionOperation, ...]
    explicit_user_confirmation_state: str = Field(min_length=1)
    explicit_user_confirmation_ref: str | None
    domain_payload: dict[str, Any]

    @model_validator(mode="before")
    @classmethod
    def require_guard_construction(cls, value: object, info: ValidationInfo) -> object:
        context = info.context or {}
        if context.get("guarded_invocation_token") is not _GUARDED_INVOCATION_TOKEN:
            raise ValueError("NeutralInvocation must be constructed by the session guard")
        return value

    @field_validator("capability_ids")
    @classmethod
    def validate_capability_ids(cls, values: tuple[str, ...]) -> tuple[str, ...]:
        if any(not value for value in values) or len(set(values)) != len(values):
            raise ValueError("capability_ids must contain distinct non-empty opaque IDs")
        return values

    @field_validator("allowed_session_operations")
    @classmethod
    def validate_operations(cls, values: tuple[SessionOperation, ...]) -> tuple[SessionOperation, ...]:
        if len(set(values)) != len(values):
            raise ValueError("allowed_session_operations must not contain duplicates")
        return values

    @field_validator("domain_payload")
    @classmethod
    def validate_domain_payload(cls, value: dict[str, Any]) -> dict[str, Any]:
        return _freeze_json(value, path="domain_payload")

    def _copy_validation_context(self) -> dict[str, object]:
        return {"guarded_invocation_token": _GUARDED_INVOCATION_TOKEN}


def _build_neutral_invocation(
    *,
    request: NeutralSessionRequest,
    authority: SessionAuthority,
    profile: SessionExposureProfile,
    domain_payload: Mapping[str, Any],
) -> NeutralInvocation:
    """Private construction seam used by ``NeutralSessionGuard`` only."""

    return NeutralInvocation.model_validate(
        {
            "request": request,
            "data_scope_ref": authority.data_scope_ref,
            "exposure_profile_ref": profile.profile_id,
            "capability_ids": profile.capability_ids,
            "allowed_session_operations": authority.allowed_session_operations,
            "explicit_user_confirmation_state": authority.explicit_user_confirmation_state,
            "explicit_user_confirmation_ref": authority.explicit_user_confirmation_ref,
            "domain_payload": dict(domain_payload),
        },
        context={"guarded_invocation_token": _GUARDED_INVOCATION_TOKEN},
    )


class NeutralReadiness(NeutralModel):
    interface_version: str = Field(min_length=1)
    supported_operations: tuple[SessionOperation, ...]
    binding_kind: str = Field(min_length=1)
    binding_version: str = Field(min_length=1)
    available: bool
    reason: str = Field(min_length=1)
    code: str = Field(min_length=1)

    @field_validator("supported_operations")
    @classmethod
    def validate_operations(cls, values: tuple[SessionOperation, ...]) -> tuple[SessionOperation, ...]:
        if len(set(values)) != len(values):
            raise ValueError("supported_operations must not contain duplicates")
        return values


class StatusEvent(NeutralModel):
    request_id: str = Field(min_length=1)
    sequence: int = Field(ge=0)
    phase: str = Field(min_length=1)
    message: str = Field(min_length=1)


class EvidenceEvent(NeutralModel):
    request_id: str = Field(min_length=1)
    sequence: int = Field(ge=0)
    evidence: dict[str, Any]
    provenance_ref: str = Field(min_length=1)

    @field_validator("evidence")
    @classmethod
    def validate_evidence(cls, value: dict[str, Any]) -> dict[str, Any]:
        return _freeze_json(value, path="evidence")


class FinalEvent(NeutralModel):
    request_id: str = Field(min_length=1)
    sequence: int = Field(ge=0)
    domain_envelope: dict[str, Any]
    provenance_ref: str = Field(min_length=1)

    @field_validator("domain_envelope")
    @classmethod
    def validate_domain_envelope_json(cls, value: dict[str, Any]) -> dict[str, Any]:
        return _freeze_json(value, path="domain_envelope")

    @model_validator(mode="after")
    def validate_domain_request_id(self) -> "FinalEvent":
        if self.domain_envelope.get("request_id") != self.request_id:
            raise ValueError("domain envelope request_id must match event request_id")
        return self


class ErrorEvent(NeutralModel):
    request_id: str = Field(min_length=1)
    sequence: int = Field(ge=0)
    code: str = Field(min_length=1)
    layer: ErrorLayer
    safe_message: str = Field(min_length=1)
    retryable: bool
    unchanged_provider_error_or_outcome: Any | None
    provenance_ref: str | None
    effect_known: bool
    presentation_state: PresentationState
    provider_outcome: ProviderOutcome

    @field_validator("unchanged_provider_error_or_outcome")
    @classmethod
    def validate_provider_detail(cls, value: Any | None) -> Any | None:
        return _freeze_json(value, path="unchanged_provider_error_or_outcome")

    @model_validator(mode="after")
    def validate_canceled_presentation(self) -> "ErrorEvent":
        if self.code == "CANCELLED" and self.presentation_state != "canceled":
            raise ValueError("CANCELLED error requires presentation_state=canceled")
        if self.presentation_state == "canceled" and self.code != "CANCELLED":
            raise ValueError("presentation_state=canceled requires code=CANCELLED")
        return self


NeutralEvent: TypeAlias = StatusEvent | EvidenceEvent | FinalEvent | ErrorEvent
_NEUTRAL_EVENT_ADAPTER = TypeAdapter(NeutralEvent)


def validate_neutral_event(value: object) -> NeutralEvent:
    """Validate one raw neutral event without transport-specific repair."""

    return _NEUTRAL_EVENT_ADAPTER.validate_python(value)


__all__ = [
    "ClientContextSnapshot",
    "ContextFact",
    "ErrorEvent",
    "EvidenceEvent",
    "FinalEvent",
    "NeutralEvent",
    "NeutralInvocation",
    "NeutralReadiness",
    "NeutralSessionRequest",
    "ProviderOutcome",
    "SessionAuthority",
    "SessionExposureProfile",
    "SessionOperation",
    "StatusEvent",
    "validate_neutral_event",
]

"""Canonical, runtime-neutral v1 Host Agent Handoff contracts.

The bridge and backend relay both use these models as the single wire-shape
authority.  Models intentionally allow additive fields so a newer host agent
can extend a v1 envelope without making the GUI silently reinterpret it.
Validation is strict about types and existing mode/evidence relationships;
there is no coercion, aliasing, extraction, or semantic repair here.
"""

from __future__ import annotations

import json
import math
from typing import Any, Literal, NoReturn

from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

HEALTH_SCHEMA = "gui.host_agent.health.v1"
QUERY_SCHEMA = "gui.host_agent.query_response.v1"
METADATA_SCHEMA = "gui.host_agent.metadata_proposal.v1"
METADATA_FIELD_KEYS = (
    "title",
    "abstract",
    "project",
    "topics",
    "moods",
    "people",
    "tags",
    "links",
)
_METADATA_FIELD_KEY_SET = frozenset(METADATA_FIELD_KEYS)

HealthMode = Literal["READY", "NOT_READY", "UNAVAILABLE"]
QueryMode = Literal["GROUNDED", "UNGROUNDED", "PARTIAL", "SCAFFOLD", "UNAVAILABLE"]
MetadataMode = Literal["PROPOSED", "UNAVAILABLE"]


class ContractModel(BaseModel):
    """Base model for v1 envelopes and their nested objects.

    ``extra='allow'`` is the v1 forward-compatibility rule: additive fields
    are preserved by callers rather than dropped.  ``strict=True`` prevents
    Pydantic from converting malformed wire values into a different shape.
    """

    model_config = ConfigDict(extra="allow", strict=True)


class HealthPayload(ContractModel):
    schema_version: Literal[HEALTH_SCHEMA]
    running: bool
    ready: bool
    degraded: bool | None = None
    mode: HealthMode
    reason: str = Field(min_length=1)
    runtime: dict[str, Any]
    checks: list[dict[str, Any]] = Field(default_factory=list)


class EvidenceItem(ContractModel):
    id: str = Field(min_length=1)
    rel_path: str = Field(min_length=1)
    title: str = Field(min_length=1)
    date: str = Field(min_length=1)


class Insight(ContractModel):
    theme: str = Field(min_length=1)
    quote: str | None = None
    date: str | None = None
    interpretation: str | None = None
    evidence_refs: list[str] = Field(default_factory=list)


class QueryAnswer(ContractModel):
    mode: QueryMode
    reason: str | None = None
    summary: str
    insights: list[Insight] = Field(default_factory=list)
    gap: str | None = None
    suggestions: list[str] = Field(default_factory=list)


class QueryResponse(ContractModel):
    schema_version: Literal[QUERY_SCHEMA]
    request_id: str | None = None
    conversation_id: str | None = None
    source: Literal["host-agent"]
    mode: QueryMode
    reason: str | None = None
    query: str
    answer: QueryAnswer
    evidence: list[EvidenceItem]
    tool_trace: list[dict[str, Any]] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_mode_evidence_relationship(self) -> "QueryResponse":
        if self.answer.mode != self.mode:
            raise ValueError("answer.mode must match top-level mode")
        if self.mode == "GROUNDED" and not self.evidence:
            raise ValueError("GROUNDED query response requires evidence")
        if self.mode == "UNGROUNDED" and self.evidence:
            raise ValueError("UNGROUNDED query response must not include evidence")
        return self


MetadataValue = str | list[str] | None


class MetadataField(ContractModel):
    value: MetadataValue = None
    field_source: str | None = None
    confidence: float | None = None
    rationale: str | None = None
    evidence_spans: list[str] = Field(default_factory=list)


class MetadataProposal(ContractModel):
    schema_version: Literal[METADATA_SCHEMA]
    request_id: str | None = None
    mode: MetadataMode
    reason: str = Field(min_length=1)
    fields: dict[str, MetadataField]
    warnings: list[str]
    policy: dict[str, Any] | None = None

    @model_validator(mode="after")
    def validate_mode_fields_relationship(self) -> "MetadataProposal":
        unknown_fields = set(self.fields) - _METADATA_FIELD_KEY_SET
        if unknown_fields:
            raise ValueError("metadata fields contain unsupported keys")
        if self.mode == "PROPOSED" and not self.fields:
            raise ValueError("PROPOSED metadata proposal requires fields")
        if self.mode == "UNAVAILABLE" and self.fields:
            raise ValueError("UNAVAILABLE metadata proposal must not include fields")
        return self


def _reject_json_constant(_value: str) -> NoReturn:
    raise ValueError("host-agent-envelope-invalid")


def _parse_json_float(raw: str) -> float:
    value = float(raw)
    if not math.isfinite(value):
        raise ValueError("host-agent-envelope-invalid")
    return value


def _reject_duplicate_object_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    value: dict[str, Any] = {}
    for key, item in pairs:
        if key in value:
            raise ValueError("host-agent-envelope-invalid")
        value[key] = item
    return value


def parse_exact_json_value(raw: str) -> Any:
    """Parse one complete JSON value with strict wire-level semantics."""

    try:
        return json.loads(
            raw,
            parse_constant=_reject_json_constant,
            parse_float=_parse_json_float,
            object_pairs_hook=_reject_duplicate_object_keys,
        )
    except (TypeError, ValueError, json.JSONDecodeError) as exc:
        raise ValueError("host-agent-envelope-invalid") from exc


def parse_exact_json_object(raw: str) -> dict[str, Any]:
    """Parse one complete JSON object without repairing or extracting text."""

    value = parse_exact_json_value(raw)
    if not isinstance(value, dict):
        raise ValueError("host-agent-envelope-invalid")
    return value


def validate_health(payload: object) -> HealthPayload:
    return HealthPayload.model_validate(payload)


def validate_query_response(payload: object) -> QueryResponse:
    return QueryResponse.model_validate(payload)


def validate_metadata_proposal(payload: object) -> MetadataProposal:
    return MetadataProposal.model_validate(payload)


# Explicit aliases make the family names discoverable to downstream adapters
# without creating runtime/provider-specific branches.
HostAgentHealthV1 = HealthPayload
HostAgentQueryResponseV1 = QueryResponse
HostAgentMetadataProposalV1 = MetadataProposal

__all__ = [
    "HEALTH_SCHEMA",
    "QUERY_SCHEMA",
    "METADATA_SCHEMA",
    "METADATA_FIELD_KEYS",
    "ContractModel",
    "HealthMode",
    "QueryMode",
    "MetadataMode",
    "HealthPayload",
    "EvidenceItem",
    "Insight",
    "QueryAnswer",
    "QueryResponse",
    "MetadataField",
    "MetadataProposal",
    "HostAgentHealthV1",
    "HostAgentQueryResponseV1",
    "HostAgentMetadataProposalV1",
    "parse_exact_json_value",
    "parse_exact_json_object",
    "validate_health",
    "validate_query_response",
    "validate_metadata_proposal",
    "ValidationError",
]

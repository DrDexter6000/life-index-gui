"""Executable conformance checks for the public Host Agent handoff contract."""

from __future__ import annotations

import json
from pathlib import Path
import sys

import pytest
from fastapi.testclient import TestClient

from host_agent_bridge import conformance
from host_agent_bridge.contracts import (
    MetadataProposal,
    parse_exact_json_object,
    parse_exact_json_value,
    validate_metadata_proposal,
)
from host_agent_bridge.server import app


client = TestClient(app)


class TestClientHostAgent:
    def get_json(self, path: str) -> dict:
        response = client.get(path)
        assert response.status_code == 200
        return response.json()

    def post_json(self, path: str, payload: dict) -> dict:
        response = client.post(path, json=payload)
        assert response.status_code == 200
        return response.json()

    def post_sse(self, path: str, payload: dict) -> list[tuple[str, dict]]:
        response = client.post(path, json=payload, headers={"accept": "text/event-stream"})
        assert response.status_code == 200
        frames: list[tuple[str, dict]] = []
        for chunk in response.text.strip().split("\n\n"):
            event_type = "message"
            data_text = ""
            for line in chunk.splitlines():
                if line.startswith("event: "):
                    event_type = line.removeprefix("event: ")
                if line.startswith("data: "):
                    data_text = line.removeprefix("data: ")
            if data_text:
                frames.append((event_type, json.loads(data_text)))
        return frames


def _runtime_path(*parts: str) -> Path:
    return Path(__file__).resolve().parents[1] / "examples" / "host-agent-runtime" / Path(*parts)


def _external_agent_command(tmp_path: Path) -> Path:
    script = tmp_path / "external_headless_agent.py"
    script.write_text(
        "\n".join(
            [
                "import json",
                "import os",
                "import sys",
                "request = json.loads(sys.stdin.read() or '{}')",
                "Path = __import__('pathlib').Path",
                "Path(os.environ['SPAWN_MARKER']).write_text('spawned', encoding='utf-8')",
                "if 'draft' in request:",
                "    payload = {",
                "        'schema_version': 'gui.host_agent.metadata_proposal.v1',",
                "        'request_id': request.get('request_id'),",
                "        'mode': 'PROPOSED',",
                "        'reason': 'external-headless-agent-proposed-fields',",
                "        'fields': {'title': {'value': 'External command title', 'field_source': 'host-agent'}},",
                "        'warnings': [],",
                "        'policy': {'preserve_user_fields': True},",
                "    }",
                "else:",
                "    payload = {",
                "        'schema_version': 'gui.host_agent.query_response.v1',",
                "        'request_id': request.get('request_id'),",
                "        'conversation_id': request.get('conversation_id'),",
                "        'source': 'host-agent',",
                "        'mode': 'GROUNDED',",
                "        'reason': 'external-headless-agent-cited-evidence',",
                "        'query': request.get('query') or '',",
                "        'answer': {",
                "            'mode': 'GROUNDED',",
                "            'reason': 'external-headless-agent-cited-evidence',",
                "            'summary': 'External command returned a grounded answer.',",
                "            'insights': [],",
                "            'gap': None,",
                "            'suggestions': [],",
                "        },",
                "        'evidence': [{'id': 'demo/1', 'rel_path': 'Journals/demo/1.md', 'title': 'Demo Evidence', 'date': '2026-07-03'}],",
                "        'tool_trace': [{'tool': 'external-command', 'status': 'ok'}],",
                "    }",
                "print(json.dumps(payload, ensure_ascii=False, separators=(',', ':')))",
            ]
        ),
        encoding="utf-8",
    )
    return script


def test_conformance_kit_accepts_unconfigured_offline_bridge(monkeypatch):
    monkeypatch.delenv("LIFE_INDEX_HOST_AGENT_ARGV_JSON", raising=False)
    monkeypatch.delenv("LIFE_INDEX_HOST_AGENT_COMMAND", raising=False)

    result = conformance.run_conformance(TestClientHostAgent(), expected_mode="unavailable")

    assert "health unavailable envelope" in result.passed
    assert "query unavailable final" in result.passed
    assert "metadata unavailable proposal" in result.passed


def test_conformance_kit_passes_provider_neutral_stdio_runtime(monkeypatch):
    runtime = _runtime_path("stdio-json-agent", "stdio_json_agent.py")
    monkeypatch.setenv("LIFE_INDEX_HOST_AGENT_ARGV_JSON", json.dumps([sys.executable, str(runtime)]))
    monkeypatch.setenv("LIFE_INDEX_HOST_AGENT_TIMEOUT_SECONDS", "5")

    result = conformance.run_conformance(TestClientHostAgent(), expected_mode="ready")

    assert "health ready envelope" in result.passed
    assert "query stream grounded final" in result.passed
    assert "metadata proposal envelope" in result.passed


def test_conformance_kit_accepts_ready_bridge_with_unavailable_adapter_runtime(monkeypatch):
    adapter = _runtime_path("command-json-adapter", "command_json_adapter.py")
    monkeypatch.setenv("LIFE_INDEX_HOST_AGENT_ARGV_JSON", json.dumps([sys.executable, str(adapter)]))
    monkeypatch.setenv("LIFE_INDEX_HOST_AGENT_TIMEOUT_SECONDS", "5")
    monkeypatch.delenv("LIFE_INDEX_HOST_AGENT_ADAPTER_ARGV_JSON", raising=False)
    monkeypatch.delenv("LIFE_INDEX_HOST_AGENT_ADAPTER_COMMAND", raising=False)

    result = conformance.run_conformance(TestClientHostAgent(), expected_mode="runtime-unavailable")

    assert "health ready envelope" in result.passed
    assert "query unavailable final" in result.passed
    assert "metadata unavailable proposal" in result.passed


def test_conformance_kit_passes_command_json_adapter_with_spawned_external_command(monkeypatch, tmp_path):
    adapter = _runtime_path("command-json-adapter", "command_json_adapter.py")
    external = _external_agent_command(tmp_path)
    marker = tmp_path / "spawn-marker.txt"

    monkeypatch.setenv("SPAWN_MARKER", str(marker))
    monkeypatch.setenv("LIFE_INDEX_HOST_AGENT_ARGV_JSON", json.dumps([sys.executable, str(adapter)]))
    monkeypatch.setenv("LIFE_INDEX_HOST_AGENT_ADAPTER_ARGV_JSON", json.dumps([sys.executable, str(external)]))
    monkeypatch.setenv("LIFE_INDEX_HOST_AGENT_ADAPTER_TIMEOUT_SECONDS", "5")
    monkeypatch.setenv("LIFE_INDEX_HOST_AGENT_TIMEOUT_SECONDS", "5")

    result = conformance.run_conformance(TestClientHostAgent(), expected_mode="ready")

    assert "query stream grounded final" in result.passed
    assert "metadata proposal envelope" in result.passed
    assert marker.read_text(encoding="utf-8") == "spawned"


def test_command_json_adapter_rejects_wrapped_query_output_without_extraction(monkeypatch, tmp_path):
    adapter = _runtime_path("command-json-adapter", "command_json_adapter.py")
    external = tmp_path / "wrapped_query_agent.py"
    external.write_text(
        "import json\n"
        "import sys\n"
        "request = json.loads(sys.stdin.read() or '{}')\n"
        "payload = {\n"
        "    'schema_version': 'gui.host_agent.query_response.v1',\n"
        "    'request_id': request.get('request_id'),\n"
        "    'conversation_id': request.get('conversation_id'),\n"
        "    'source': 'host-agent',\n"
        "    'mode': 'GROUNDED',\n"
        "    'reason': 'wrapped-query',\n"
        "    'query': request.get('query') or '',\n"
        "    'answer': {'mode': 'GROUNDED', 'summary': 'Wrapped answer', 'insights': [], 'gap': None, 'suggestions': []},\n"
        "    'evidence': [{'id': 'demo/1', 'rel_path': 'Journals/demo/1.md', 'title': 'Demo', 'date': '2026-07-03'}],\n"
        "    'tool_trace': [],\n"
        "}\n"
        "print('progress before final')\n"
        "print(json.dumps(payload, ensure_ascii=False, separators=(',', ':')))\n",
        encoding="utf-8",
    )
    monkeypatch.setenv("LIFE_INDEX_HOST_AGENT_ARGV_JSON", json.dumps([sys.executable, str(adapter)]))
    monkeypatch.setenv("LIFE_INDEX_HOST_AGENT_ADAPTER_ARGV_JSON", json.dumps([sys.executable, str(external)]))
    monkeypatch.setenv("LIFE_INDEX_HOST_AGENT_ADAPTER_TIMEOUT_SECONDS", "5")
    monkeypatch.setenv("LIFE_INDEX_HOST_AGENT_TIMEOUT_SECONDS", "5")

    frames = TestClientHostAgent().post_sse(
        "/query/stream",
        {"query": "What did I write?", "request_id": "wrapped-query-1"},
    )
    final = [data for event, data in frames if event == "final"][-1]

    assert final["mode"] == "UNAVAILABLE"
    assert final["reason"] == "host-agent-envelope-invalid"


def test_command_json_adapter_rejects_wrapped_metadata_output_without_extraction(monkeypatch, tmp_path):
    adapter = _runtime_path("command-json-adapter", "command_json_adapter.py")
    external = tmp_path / "invalid_metadata_agent.py"
    external.write_text(
        "import json\n"
        "import sys\n"
        "request = json.loads(sys.stdin.read() or '{}')\n"
        "payload = {\n"
        "    'schema_version': 'gui.host_agent.metadata_proposal.v1',\n"
        "    'request_id': request.get('request_id'),\n"
        "    'mode': 'PROPOSED',\n"
        "    'reason': 'wrapped-metadata',\n"
        "    'fields': {'title': {'value': 'Wrapped title', 'field_source': 'host-agent'}},\n"
        "    'warnings': [],\n"
        "}\n"
        "print('metadata progress before final')\n"
        "print(json.dumps(payload, ensure_ascii=False, separators=(',', ':')))\n",
        encoding="utf-8",
    )
    monkeypatch.setenv("LIFE_INDEX_HOST_AGENT_ARGV_JSON", json.dumps([sys.executable, str(adapter)]))
    monkeypatch.setenv("LIFE_INDEX_HOST_AGENT_ADAPTER_ARGV_JSON", json.dumps([sys.executable, str(external)]))
    monkeypatch.setenv("LIFE_INDEX_HOST_AGENT_ADAPTER_TIMEOUT_SECONDS", "5")
    monkeypatch.setenv("LIFE_INDEX_HOST_AGENT_TIMEOUT_SECONDS", "5")

    response = client.post(
        "/metadata/propose",
        json={"request_id": "invalid-metadata-1", "draft": {"content": "Draft"}},
    )
    assert response.status_code == 200
    final = response.json()

    assert final["mode"] == "UNAVAILABLE"
    assert final["reason"] == "host-agent-envelope-invalid"
    assert final["fields"] == {}


CANONICAL_METADATA_FIELDS = (
    "title",
    "abstract",
    "project",
    "topics",
    "moods",
    "people",
    "tags",
    "links",
)


@pytest.mark.parametrize("field_name", CANONICAL_METADATA_FIELDS)
def test_metadata_v1_accepts_each_canonical_field_and_preserves_additive_shapes(field_name):
    payload = {
        "schema_version": "gui.host_agent.metadata_proposal.v1",
        "request_id": "metadata-canonical-1",
        "mode": "PROPOSED",
        "reason": "canonical field fixture",
        "fields": {
            field_name: {
                "value": ["fixture"] if field_name in {"topics", "moods", "people", "tags", "links"} else "fixture",
                "future_nested": {"preserve": True},
            }
        },
        "warnings": [],
        "policy": {"preserve_user_fields": True},
        "future_root": {"provider_neutral": True},
    }

    validated = MetadataProposal.model_validate(payload)

    assert validated.model_dump()["future_root"] == {"provider_neutral": True}
    assert validated.model_dump()["fields"][field_name]["future_nested"] == {"preserve": True}


def test_metadata_v1_rejects_unknown_field_before_any_relay_can_filter_it():
    payload = {
        "schema_version": "gui.host_agent.metadata_proposal.v1",
        "request_id": "metadata-unknown-1",
        "mode": "PROPOSED",
        "reason": "third-party fixture",
        "fields": {"weather": {"value": "sunny"}},
        "warnings": [],
        "policy": {"preserve_user_fields": True},
    }

    with pytest.raises(ValueError):
        validate_metadata_proposal(payload)


def test_metadata_proposal_v2_is_rejected_without_a_second_wire_contract():
    payload = {
        "schema_version": "gui.host_agent.metadata_proposal.v2",
        "request_id": "metadata-v2-1",
        "mode": "PROPOSED",
        "reason": "v2 must remain unsupported",
        "fields": {"title": {"value": "Title"}},
        "warnings": [],
        "policy": {"preserve_user_fields": True},
    }

    with pytest.raises(ValueError):
        validate_metadata_proposal(payload)


def test_third_party_unknown_metadata_fixture_degrades_honestly(monkeypatch, tmp_path):
    payload = {
        "schema_version": "gui.host_agent.metadata_proposal.v1",
        "request_id": "third-party-unknown-1",
        "mode": "PROPOSED",
        "reason": "third-party fixture",
        "fields": {"weather": {"value": "sunny"}},
        "warnings": [],
        "policy": {"preserve_user_fields": True},
    }
    monkeypatch.setenv("LIFE_INDEX_HOST_AGENT_ARGV_JSON", json.dumps(_write_fake_runtime(tmp_path, payload)))

    response = client.post(
        "/metadata/propose",
        json={"request_id": "third-party-unknown-1", "draft": {"content": "Draft"}},
    )

    assert response.status_code == 200
    final = response.json()
    assert final["mode"] == "UNAVAILABLE"
    assert final["reason"] == "host-agent-envelope-invalid"
    assert final["fields"] == {}


def test_command_json_adapter_redacts_external_output_diagnostics(monkeypatch, tmp_path):
    adapter = _runtime_path("command-json-adapter", "command_json_adapter.py")
    external = tmp_path / "secret_failure_agent.py"
    external.write_text(
        "import sys\n"
        "sys.stdout.write('COMMAND-ADAPTER-SECRET-OUT')\n"
        "sys.stderr.write('COMMAND-ADAPTER-SECRET-ERR')\n"
        "raise SystemExit(7)\n",
        encoding="utf-8",
    )
    monkeypatch.setenv("LIFE_INDEX_HOST_AGENT_ARGV_JSON", json.dumps([sys.executable, str(adapter)]))
    monkeypatch.setenv("LIFE_INDEX_HOST_AGENT_ADAPTER_ARGV_JSON", json.dumps([sys.executable, str(external)]))
    monkeypatch.setenv("LIFE_INDEX_HOST_AGENT_ADAPTER_TIMEOUT_SECONDS", "5")
    monkeypatch.setenv("LIFE_INDEX_HOST_AGENT_TIMEOUT_SECONDS", "5")

    frames = TestClientHostAgent().post_sse(
        "/query/stream",
        {"query": "What did I write?"},
    )
    final = [data for event, data in frames if event == "final"][-1]

    assert final["mode"] == "UNAVAILABLE"
    assert final["reason"] == "host-agent-adapter-command-failed"
    diagnostics = final["diagnostics"]
    assert diagnostics["stdout_present"] is True
    assert diagnostics["stderr_present"] is True
    assert diagnostics["stdout_length"] > 0
    assert diagnostics["stderr_length"] > 0
    assert "stdout_tail" not in diagnostics
    assert "stderr_tail" not in diagnostics
    assert "COMMAND-ADAPTER-SECRET" not in json.dumps(final, ensure_ascii=False)


def _write_fake_runtime(tmp_path: Path, payload: object) -> list[str]:
    script = tmp_path / "contract_boundary_runtime.py"
    script.write_text(
        "import json\n"
        f"print(json.dumps({payload!r}, ensure_ascii=False, separators=(',', ':')))\n",
        encoding="utf-8",
    )
    return [sys.executable, str(script)]


def _query_envelope_for_contract_tests() -> dict:
    return {
        "schema_version": "gui.host_agent.query_response.v1",
        "request_id": "contract-query-1",
        "conversation_id": "contract-conversation-1",
        "source": "host-agent",
        "mode": "GROUNDED",
        "reason": "deterministic contract fixture",
        "query": "What did I write?",
        "answer": {
            "mode": "GROUNDED",
            "reason": "deterministic contract fixture",
            "summary": "One cited entry.",
            "insights": [],
            "gap": None,
            "suggestions": [],
        },
        "evidence": [
            {
                "id": "demo/2026-02-22-note.md",
                "rel_path": "Journals/demo/2026-02-22-note.md",
                "title": "Demo note",
                "date": "2026-02-22",
            }
        ],
        "tool_trace": [],
    }


def test_handoff_schemas_reject_grounded_without_evidence_and_invalid_mode_shapes(monkeypatch, tmp_path):
    malformed_grounded = _query_envelope_for_contract_tests()
    malformed_grounded["evidence"] = []

    malformed_answer_mode = _query_envelope_for_contract_tests()
    malformed_answer_mode["answer"]["mode"] = "UNGROUNDED"

    malformed_ungrounded_evidence = _query_envelope_for_contract_tests()
    malformed_ungrounded_evidence["mode"] = "UNGROUNDED"
    malformed_ungrounded_evidence["answer"]["mode"] = "UNGROUNDED"

    malformed_schema = _query_envelope_for_contract_tests()
    malformed_schema["schema_version"] = "gui.host_agent.query_response.v2"

    malformed_metadata = {
        "schema_version": "gui.host_agent.metadata_proposal.v1",
        "request_id": "contract-metadata-1",
        "mode": "PROPOSED",
        "reason": "malformed field shape",
        "fields": {"title": "scalar must not be coerced"},
        "warnings": [],
    }

    for payload, request_path, request_body in (
        (malformed_grounded, "/query/stream", {"query": "What did I write?"}),
        (malformed_answer_mode, "/query/stream", {"query": "What did I write?"}),
        (malformed_ungrounded_evidence, "/query/stream", {"query": "What did I write?"}),
        (malformed_schema, "/query/stream", {"query": "What did I write?"}),
        (malformed_metadata, "/metadata/propose", {"draft": {"content": "Draft"}}),
    ):
        monkeypatch.setenv(
            "LIFE_INDEX_HOST_AGENT_ARGV_JSON",
            json.dumps(_write_fake_runtime(tmp_path, payload)),
        )
        if request_path == "/query/stream":
            frames = TestClientHostAgent().post_sse(request_path, request_body)
            final = [data for event, data in frames if event == "final"][-1]
        else:
            response = client.post(request_path, json=request_body)
            assert response.status_code == 200
            final = response.json()
        assert final["mode"] == "UNAVAILABLE"
        assert final["reason"] == "host-agent-envelope-invalid"


def test_handoff_schemas_preserve_exact_valid_provider_neutral_payload_and_additive_fields(monkeypatch, tmp_path):
    envelope = _query_envelope_for_contract_tests()
    envelope["future_field"] = {"provider_neutral": True}
    monkeypatch.setenv(
        "LIFE_INDEX_HOST_AGENT_ARGV_JSON",
        json.dumps(_write_fake_runtime(tmp_path, envelope)),
    )

    frames = TestClientHostAgent().post_sse(
        "/query/stream",
        {"query": envelope["query"], "conversation_id": envelope["conversation_id"]},
    )
    final = [data for event, data in frames if event == "final"][-1]
    assert final == envelope


def test_handoff_schema_does_not_add_an_unavailable_evidence_constraint():
    envelope = _query_envelope_for_contract_tests()
    envelope["mode"] = "UNAVAILABLE"
    envelope["answer"]["mode"] = "UNAVAILABLE"

    # Existing v1 only constrains evidence for GROUNDED/UNGROUNDED.  The
    # strict validator must not invent a new UNAVAILABLE-no-evidence rule.
    conformance.validate_query_response(envelope)


@pytest.mark.parametrize(
    "raw",
    [
        '{"schema_version":"gui.host_agent.query_response.v1","value":NaN}',
        '{"schema_version":"gui.host_agent.query_response.v1","value":Infinity}',
        '{"schema_version":"gui.host_agent.query_response.v1","value":-Infinity}',
        '{"schema_version":"gui.host_agent.query_response.v1","nested":{"value":1,"value":2}}',
    ],
)
def test_parse_exact_json_object_rejects_non_json_constants_and_duplicate_keys(raw):
    with pytest.raises(ValueError) as exc_info:
        parse_exact_json_object(raw)

    assert str(exc_info.value) == "host-agent-envelope-invalid"


def test_parse_exact_json_object_accepts_valid_additive_fields():
    payload = parse_exact_json_object(
        '{"schema_version":"gui.host_agent.query_response.v1","future":{"value":true}}'
    )

    assert payload["future"] == {"value": True}


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ('"status text"', "status text"),
        ('["future","message"]', ["future", "message"]),
        ("true", True),
        ("null", None),
    ],
)
def test_parse_exact_json_value_accepts_valid_scalar_and_additive_json(raw, expected):
    assert parse_exact_json_value(raw) == expected


@pytest.mark.parametrize(
    "raw",
    [
        'event: status\ndata: {"phase":"first","phase":"second"}\n\n',
        'event: delta\ndata: {"score":NaN}\n\n',
    ],
)
def test_conformance_sse_rejects_duplicate_or_nonfinite_json(raw):
    with pytest.raises(conformance.ConformanceError) as exc_info:
        conformance.parse_sse(raw)

    assert "NaN" not in str(exc_info.value)
    assert "Infinity" not in str(exc_info.value)


def test_conformance_sse_accepts_valid_scalar_status_and_additive_delta():
    frames = conformance.parse_sse(
        'event: status\ndata: "status text"\n\n'
        'event: delta\ndata: ["future","delta"]\n\n'
    )

    assert frames == [("status", "status text"), ("delta", ["future", "delta"])]


@pytest.mark.parametrize(
    ("path", "method", "raw"),
    [
        (
            "/health",
            "get_json",
            '{"schema_version":"gui.host_agent.health.v1","reason":"first","reason":"second"}',
        ),
        (
            "/metadata/propose",
            "post_json",
            '{"schema_version":"gui.host_agent.metadata_proposal.v1","confidence":NaN}',
        ),
    ],
)
def test_url_client_rejects_duplicate_or_nonfinite_json_bodies(monkeypatch, path, method, raw):
    class _Response:
        def __enter__(self):
            return self

        def __exit__(self, _exc_type, _exc, _tb):
            return None

        def read(self):
            return raw.encode("utf-8")

    monkeypatch.setattr(
        conformance.urllib_request,
        "urlopen",
        lambda *_args, **_kwargs: _Response(),
    )

    client = conformance.UrlHostAgentClient("http://host-agent.invalid")
    with pytest.raises(conformance.ConformanceError) as exc_info:
        if method == "get_json":
            client.get_json(path)
        else:
            client.post_json(path, {})

    assert path in str(exc_info.value)
    assert "NaN" not in str(exc_info.value)


def test_conformance_sse_normalizes_crlf_status_and_final():
    frames = conformance.parse_sse(
        'event: status\r\ndata: "status text"\r\n\r\n'
        'event: final\r\ndata: {"mode":"PARTIAL"}\r\n\r\n'
    )

    assert frames == [("status", "status text"), ("final", {"mode": "PARTIAL"})]


@pytest.mark.parametrize("raw", ["1e999", "-1e999"])
def test_parse_exact_json_value_rejects_exponent_overflow_nonfinite(raw):
    with pytest.raises(ValueError) as exc_info:
        parse_exact_json_value(raw)

    assert str(exc_info.value) == "host-agent-envelope-invalid"

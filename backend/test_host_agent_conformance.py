"""Executable conformance checks for the public Host Agent handoff contract."""

from __future__ import annotations

import json
from pathlib import Path
import sys

from fastapi.testclient import TestClient

from host_agent_bridge import conformance
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

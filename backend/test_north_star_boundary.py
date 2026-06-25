"""Executable north-star boundary gate: the GUI must not embed model intelligence.

North star (CHARTER「北极星」APEX): Life Index = tools + Skills for agents;
intelligence — planning / multi-hop / reasoning / synthesis — belongs to the host
agent; the GUI is **presentation only** and reaches the agent through the
backend-mediated warm gateway. The GUI must therefore **never call an LLM
directly**. This gate fails if backend production code imports an LLM/model SDK.

This is the intelligence-boundary sibling of ``test_l1_boundary.py`` (the
data-access boundary). Together they machine-enforce "GUI = thin presentation
over CLI tools + host agent", which prose alone failed to hold.
"""

from __future__ import annotations

import ast
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
BACKEND_ROOT = PROJECT_ROOT / "backend"

# LLM / model SDKs the presentation-layer backend must never import. The GUI
# never calls a model directly; it forwards queries to the host agent via the
# warm gateway (see backend/adapter/agent_gateway_client.py, which raises rather
# than ever falling back to a direct model call).
FORBIDDEN_LLM_MODULES = {
    "anthropic",
    "openai",
    "cohere",
    "mistralai",
    "ollama",
    "litellm",
    "llama_cpp",
    "google.generativeai",
    "vertexai",
    "transformers",
}

_REASON = (
    "GUI is presentation-only and must never call an LLM directly; route through "
    "the backend-mediated gateway (CHARTER north-star APEX)."
)


def _production_python_files() -> list[Path]:
    files: list[Path] = []
    for path in BACKEND_ROOT.rglob("*.py"):
        if path.name.startswith("test_"):
            continue
        if "__pycache__" in path.parts:
            continue
        files.append(path)
    return files


def _forbidden_reason(module: str | None) -> str | None:
    if not module:
        return None
    top = module.split(".")[0]
    for forbidden in FORBIDDEN_LLM_MODULES:
        if module == forbidden or top == forbidden.split(".")[0]:
            return _REASON
    return None


def test_backend_does_not_call_llm_directly() -> None:
    violations: list[str] = []

    for path in _production_python_files():
        relative_path = path.relative_to(PROJECT_ROOT).as_posix()
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))

        for node in ast.walk(tree):
            line = getattr(node, "lineno", 1)

            if isinstance(node, ast.Import):
                for alias in node.names:
                    reason = _forbidden_reason(alias.name)
                    if reason:
                        violations.append(f"{relative_path}:{line}: import {alias.name} - {reason}")

            if isinstance(node, ast.ImportFrom) and node.module:
                reason = _forbidden_reason(node.module)
                if reason:
                    violations.append(
                        f"{relative_path}:{line}: from {node.module} import ... - {reason}"
                    )

    assert not violations, "North-star boundary violations found:\n" + "\n".join(violations)

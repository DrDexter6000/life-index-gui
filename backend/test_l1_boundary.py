"""Executable architecture gates for GUI/backend L1 access boundaries."""

from __future__ import annotations

import ast
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
BACKEND_ROOT = PROJECT_ROOT / "backend"

ALLOWLISTED_PRODUCTION_FILES = {
    Path("backend/config.py"),
}

FORBIDDEN_IMPORTS = {
    "sqlite3": "SQLite/user-data cache access belongs behind the CLI contract.",
    "fastapi.staticfiles": "Attachment/static-file serving needs a CLI-owned contract or documented R2 exception.",
}

FORBIDDEN_NAMES = {
    "FileResponse": "Direct file responses can bypass the CLI/backend contract.",
    "StaticFiles": "Static file mounts can bypass the CLI/backend contract.",
}

FORBIDDEN_CALL_NAMES = {
    "open": "Production backend code must not directly open user-data files.",
}

FORBIDDEN_CALL_ATTRS = {
    "exists": "Filesystem probes against user data must be CLI-mediated or explicitly excepted.",
    "is_dir": "Filesystem probes against user data must be CLI-mediated or explicitly excepted.",
    "is_file": "Filesystem probes against user data must be CLI-mediated or explicitly excepted.",
    "read_bytes": "Production backend code must not directly read user-data files.",
    "read_text": "Production backend code must not directly read user-data files.",
    "write_bytes": "Production backend code must not directly mutate user-data files.",
    "write_text": "Production backend code must not directly mutate user-data files.",
}

FORBIDDEN_STORAGE_LITERALS = {
    "entity_graph.yaml": "Graph data is a CLI/L2-owned surface.",
    "journals_fts.db": "SQLite/search indexes are CLI/L2-owned surfaces.",
    "journals_vec.db": "SQLite/vector indexes are CLI/L2-owned surfaces.",
    "metadata_cache.db": "SQLite/metadata caches are CLI/L2-owned surfaces.",
    "rollback-manifest.json": "Rollback manifests are CLI-internal surfaces.",
    "import-jobs": "Import job storage is CLI-internal surface.",
}


def _production_python_files() -> list[Path]:
    files: list[Path] = []
    for path in BACKEND_ROOT.rglob("*.py"):
        relative_path = path.relative_to(PROJECT_ROOT)
        if path.name.startswith("test_"):
            continue
        if "__pycache__" in path.parts:
            continue
        if relative_path in ALLOWLISTED_PRODUCTION_FILES:
            continue
        files.append(path)
    return files


def test_backend_production_code_does_not_bypass_l1_contract() -> None:
    violations: list[str] = []

    for path in _production_python_files():
        relative_path = path.relative_to(PROJECT_ROOT).as_posix()
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))

        for node in ast.walk(tree):
            line = getattr(node, "lineno", 1)

            if isinstance(node, ast.Import):
                for alias in node.names:
                    message = FORBIDDEN_IMPORTS.get(alias.name)
                    if message:
                        violations.append(f"{relative_path}:{line}: import {alias.name} - {message}")

            if isinstance(node, ast.ImportFrom) and node.module:
                message = FORBIDDEN_IMPORTS.get(node.module)
                if message:
                    violations.append(f"{relative_path}:{line}: from {node.module} import ... - {message}")

            if isinstance(node, ast.Name):
                message = FORBIDDEN_NAMES.get(node.id)
                if message:
                    violations.append(f"{relative_path}:{line}: {node.id} - {message}")

            if isinstance(node, ast.Call):
                if isinstance(node.func, ast.Name):
                    message = FORBIDDEN_CALL_NAMES.get(node.func.id)
                    if message:
                        violations.append(f"{relative_path}:{line}: {node.func.id}(...) - {message}")

                if isinstance(node.func, ast.Attribute):
                    message = FORBIDDEN_CALL_ATTRS.get(node.func.attr)
                    if message:
                        violations.append(f"{relative_path}:{line}: .{node.func.attr}(...) - {message}")

            if isinstance(node, ast.Constant) and isinstance(node.value, str):
                for literal, message in FORBIDDEN_STORAGE_LITERALS.items():
                    if literal in node.value:
                        violations.append(f"{relative_path}:{line}: literal {literal!r} - {message}")

    assert not violations, "L1 boundary violations found:\n" + "\n".join(violations)

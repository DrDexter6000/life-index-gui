"""Pytest shared configuration for the backend test suite.

Guards real-CLI contract tests from being executed without the required
environment, turning cryptic FileNotFoundError into a human-readable skip
reason.
"""

import os
import shutil

import pytest


def pytest_collection_modifyitems(config, items):
    """
    Guard real-CLI contract tests.

    If ``LIFE_INDEX_CLI`` is not set and ``life-index`` is not on PATH,
    skip all tests in ``test_real_*.py`` files with a human-readable reason.
    Running bare ``pytest backend`` without the required environment will
    otherwise produce confusing ``FileNotFoundError`` from ``subprocess.run``.
    """
    cli_env = os.environ.get("LIFE_INDEX_CLI")
    cli_on_path = shutil.which("life-index") is not None

    if cli_env or cli_on_path:
        return

    for item in items:
        if item.path.name.startswith("test_real_") and item.path.name.endswith(".py"):
            item.add_marker(
                pytest.mark.skip(
                    reason=(
                        "Real CLI tests require LIFE_INDEX_CLI to be set. "
                        "Run via .dev/test-backend.ps1 instead of bare pytest backend."
                    )
                )
            )

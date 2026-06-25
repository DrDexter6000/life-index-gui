"""Read-only real CLI contract tests."""

import shutil

import pytest

from backend import config
from backend.adapter.cli_adapter import CLIAdapter


@pytest.mark.skipif(
    shutil.which(config.CLI_COMMAND) is None,
    reason="life-index CLI is not installed on PATH",
)
@pytest.mark.asyncio
async def test_real_cli_handshake_read_only():
    """Real CLI version+health handshake works without mutating user data."""
    adapter = CLIAdapter(command=config.CLI_COMMAND, timeout=30.0)

    result = await adapter.handshake()

    assert result["cli_available"] is True
    assert result["compatible"] is True
    assert result["package_version"]
    assert result["health"] is not None
    assert result["status"] in {"ok", "degraded"}

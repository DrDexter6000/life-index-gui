"""Focused tests for structured CLI error envelope mapping."""

import json

import pytest

from backend.adapter.cli_adapter import CLIError
from backend.adapter.error_mapper import map_cli_error, map_import_error
from backend.models import errors as E


@pytest.mark.parametrize("status_field", ["ok", "success"])
def test_map_cli_error_rejects_positive_error_envelopes(status_field: str):
    """Only explicit negative envelopes may override fallback mapping."""
    stderr = json.dumps(
        {
            status_field: True,
            "error": {"code": "SHOULD_NOT_MAP", "message": "not an error envelope"},
        }
    )

    code, _message = map_cli_error(stderr)

    assert code == E.CLI_ERROR


@pytest.mark.parametrize("channel_name", ["stderr", "stdout"])
@pytest.mark.parametrize("code", ["CLI_VERSION_UNSUPPORTED", "CLI_VERSION_INVALID"])
def test_map_import_error_preserves_cli_version_error_from_negative_envelope(
    channel_name: str,
    code: str,
):
    """Version guard errors survive import routing from either CLI channel."""
    message = f"actionable {code.lower()} upgrade guidance"
    envelope = json.dumps(
        {
            "ok": False,
            "error": {"code": code, "message": message},
        }
    )
    exc = CLIError(
        returncode=2,
        stderr=envelope if channel_name == "stderr" else "not-json",
        stdout=envelope if channel_name == "stdout" else "",
    )

    mapped_code, mapped_message = map_import_error(exc)

    assert mapped_code == code
    assert mapped_message == message

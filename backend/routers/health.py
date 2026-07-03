"""Health check router — handshake and data-audit diagnostics."""

from fastapi import APIRouter, Depends

from backend.adapter.cli_adapter import CLIAdapter
from backend.models.response import APIResponse
from backend.version_info import compatibility_version_payload, enrich_handshake_version

router = APIRouter(tags=["health"])


def get_cli() -> CLIAdapter:
    return CLIAdapter()


@router.get("/health")
async def health_check(cli: CLIAdapter = Depends(get_cli)) -> APIResponse:
    """Verify FastAPI is running and the stable CLI contract is reachable."""
    return APIResponse.success(enrich_handshake_version(await cli.handshake()))


@router.get("/version")
async def version_check(cli: CLIAdapter = Depends(get_cli)) -> APIResponse:
    """Return the single GUI/CLI compatibility version surface."""
    return APIResponse.success(compatibility_version_payload(await cli.handshake()))


@router.get("/health/data-audit")
async def health_data_audit(cli: CLIAdapter = Depends(get_cli)) -> APIResponse:
    """Return CLI ``health --data-audit`` diagnostics.

    Read-only data cleanliness report.  GUI-safe per the M2 S1 maintenance
    surface inventory (section 1.2).
    """
    payload = await cli.data_audit()
    return APIResponse.success(payload)

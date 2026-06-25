"""Index diagnostics router — verify, index check, and cache dry-run."""

from fastapi import APIRouter, Depends

from backend.adapter.cli_adapter import CLIAdapter
from backend.models.response import APIResponse

router = APIRouter(tags=["index-diagnostics"])


def get_cli() -> CLIAdapter:
    return CLIAdapter()


@router.get("/index/check")
async def index_check(cli: CLIAdapter = Depends(get_cli)) -> APIResponse:
    """Return CLI ``index --check --json`` diagnostics.

    Read-only index health report.  GUI-safe per the M2 S1 maintenance
    surface inventory (section 3.1).
    """
    payload = await cli.index_check()
    return APIResponse.success(payload)


@router.get("/index/verify")
async def index_verify(cli: CLIAdapter = Depends(get_cli)) -> APIResponse:
    """Return CLI ``verify --json`` integrity diagnostics.

    Read-only integrity report.  GUI-safe per the M2 S1 maintenance
    surface inventory (section 2.1).
    """
    payload = await cli.verify()
    return APIResponse.success(payload)


@router.get("/index/cache-dry-run")
async def index_cache_dry_run(cli: CLIAdapter = Depends(get_cli)) -> APIResponse:
    """Return CLI ``index --cache-dry-run`` cache metadata diagnostics.

    Read-only cache-only metadata check.  GUI-safe per the M2 S1
    maintenance surface inventory (section 3.2).
    """
    payload = await cli.index_cache_dry_run()
    return APIResponse.success(payload)

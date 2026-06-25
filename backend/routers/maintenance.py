"""Maintenance Data Doctor router - audit, plan, and repair endpoints.

M33 contract consumption for CLI v1.2.4 maintenance commands.
Repair apply is a derived-artifact write and requires explicit confirmation.
"""

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from backend.adapter.cli_adapter import CLIAdapter
from backend.models.response import APIResponse

router = APIRouter(tags=["maintenance"])


def get_cli() -> CLIAdapter:
    return CLIAdapter()


class RepairApplyRequest(BaseModel):
    issueId: str
    confirmed: bool


@router.get("/maintenance/audit")
async def maintenance_audit(
    domain: str | None = None,
    cli: CLIAdapter = Depends(get_cli),
) -> APIResponse:
    """Return CLI ``maintenance audit --json`` diagnostics."""
    payload = await cli.maintenance_audit(domain=domain)
    return APIResponse.success(payload)


@router.get("/maintenance/plan")
async def maintenance_plan(
    issueId: str,
    cli: CLIAdapter = Depends(get_cli),
) -> APIResponse:
    """Return CLI ``maintenance plan --issue-id <id> --json`` repair plan."""
    payload = await cli.maintenance_plan(issueId)
    return APIResponse.success(payload)


@router.get("/maintenance/repair/dry-run")
async def maintenance_repair_dry_run(
    issueId: str,
    cli: CLIAdapter = Depends(get_cli),
) -> APIResponse:
    """Return CLI ``maintenance repair --dry-run --json`` preview."""
    payload = await cli.maintenance_repair_dry_run(issueId)
    return APIResponse.success(payload)


@router.post("/maintenance/repair/apply")
async def maintenance_repair_apply(
    body: RepairApplyRequest,
    cli: CLIAdapter = Depends(get_cli),
) -> APIResponse:
    """Run confirmed CLI ``maintenance repair --apply --json``."""
    if not body.confirmed:
        return APIResponse.error_response(
            "CONFIRMATION_REQUIRED",
            "Repair apply requires explicit confirmation.",
        )

    payload = await cli.maintenance_repair_apply(body.issueId)
    return APIResponse.success(payload)

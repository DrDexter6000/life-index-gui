"""Index Tree router — read-only evidence navigation through CLI envelopes."""

from fastapi import APIRouter, Depends, Query
from fastapi.responses import JSONResponse

from backend.adapter.cli_adapter import CLIAdapter, CLIError
from backend.models.response import APIResponse

router = APIRouter(prefix="/index-tree", tags=["index-tree"])

ALLOWED_LEVELS = {"all", "root", "year", "month"}
ALLOWED_SIGNALS = {"topic", "people", "project"}


def get_cli() -> CLIAdapter:
    return CLIAdapter()


@router.get("/nodes")
async def get_nodes(
    level: str = Query("all", description="Tree depth: all|root|year|month"),
    cli: CLIAdapter = Depends(get_cli),
) -> JSONResponse:
    """Return index-tree nodes from the public CLI envelope."""
    if level not in ALLOWED_LEVELS:
        return JSONResponse(
            status_code=400,
            content=APIResponse.error_response(
                "VALIDATION_ERROR",
                f"Invalid level '{level}'. Allowed: {', '.join(sorted(ALLOWED_LEVELS))}.",
                details={"allowed": sorted(ALLOWED_LEVELS), "received": level},
            ).model_dump(),
        )

    try:
        payload = await cli.run_json(
            ["index-tree", "nodes", "--level", level, "--json"]
        )
    except CLIError as exc:
        return JSONResponse(
            status_code=502,
            content=APIResponse.error_response(
                "CLI_ERROR",
                exc.stderr or "Index tree nodes command failed.",
            ).model_dump(),
        )

    return JSONResponse(
        status_code=200,
        content=APIResponse.success(payload).model_dump(),
    )


@router.get("/lens")
async def get_lens(
    signal: str = Query(..., description="Signal type: topic|people|project"),
    cli: CLIAdapter = Depends(get_cli),
) -> JSONResponse:
    """Return index-tree lens from the public CLI envelope."""
    if signal not in ALLOWED_SIGNALS:
        return JSONResponse(
            status_code=400,
            content=APIResponse.error_response(
                "VALIDATION_ERROR",
                f"Invalid signal '{signal}'. Allowed: {', '.join(sorted(ALLOWED_SIGNALS))}.",
                details={"allowed": sorted(ALLOWED_SIGNALS), "received": signal},
            ).model_dump(),
        )

    try:
        payload = await cli.run_json(
            ["index-tree", "lens", "--signal", signal, "--json"]
        )
    except CLIError as exc:
        return JSONResponse(
            status_code=502,
            content=APIResponse.error_response(
                "CLI_ERROR",
                exc.stderr or "Index tree lens command failed.",
            ).model_dump(),
        )

    return JSONResponse(
        status_code=200,
        content=APIResponse.success(payload).model_dump(),
    )


@router.get("/shadow")
async def get_shadow(
    query: str = Query(..., description="Shadow diagnostic query"),
    cli: CLIAdapter = Depends(get_cli),
) -> JSONResponse:
    """Return index-tree shadow diagnostics from the public CLI envelope.

    Diagnostic-only. Must not affect default search or smart-search ranking.
    """
    try:
        payload = await cli.run_json(
            ["index-tree", "shadow", "--query", query, "--json"]
        )
    except CLIError as exc:
        return JSONResponse(
            status_code=502,
            content=APIResponse.error_response(
                "CLI_ERROR",
                exc.stderr or "Index tree shadow command failed.",
            ).model_dump(),
        )

    return JSONResponse(
        status_code=200,
        content=APIResponse.success(payload).model_dump(),
    )

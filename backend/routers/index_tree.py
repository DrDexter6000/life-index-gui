"""Index Tree router — read-only canonical evidence navigation through CLI envelopes."""

from typing import Annotated

from fastapi import APIRouter, Body, Depends, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from backend.adapter.cli_adapter import CLIAdapter, CLIError
from backend.models.response import APIResponse

router = APIRouter(prefix="/index-tree", tags=["index-tree"])


def get_cli() -> CLIAdapter:
    return CLIAdapter()


class IndexTreeFilter(BaseModel):
    facet: str
    values: list[str] = Field(default_factory=list)


class IndexTreeNavigateRequest(BaseModel):
    dateFrom: str | None = None
    dateTo: str | None = None
    filters: list[IndexTreeFilter] = Field(default_factory=list)
    entityNeighbors: list[str] = Field(default_factory=list)
    entityRelations: list[str] = Field(default_factory=list)
    entityMaxHops: int | None = Field(default=None, ge=1, le=5)


@router.get("/discover")
async def discover(
    date_from: str | None = Query(None, alias="from"),
    date_to: str | None = Query(None, alias="to"),
    facet: Annotated[list[str] | None, Query()] = None,
    cli: CLIAdapter = Depends(get_cli),
) -> JSONResponse:
    """Return canonical facet menus; host/user chooses values, CLI executes only."""
    args = ["index-tree", "discover"]
    _append_date_range(args, date_from, date_to)
    for item in facet or []:
        args.extend(["--facet", item])
    args.append("--json")
    return await _run_index_tree(args, cli, "Index tree discover command failed.")


@router.post("/navigate")
async def navigate(
    request: IndexTreeNavigateRequest = Body(default_factory=IndexTreeNavigateRequest),
    cli: CLIAdapter = Depends(get_cli),
) -> JSONResponse:
    """Run deterministic structured navigation over host/user-selected values."""
    args = ["index-tree", "navigate"]
    _append_date_range(args, request.dateFrom, request.dateTo)
    for filter_item in request.filters:
        if not filter_item.values:
            continue
        args.extend(["--filter", f"{filter_item.facet}={'||'.join(filter_item.values)}"])
    for entity in request.entityNeighbors:
        args.extend(["--entity-neighbors", entity])
    for relation in request.entityRelations:
        args.extend(["--entity-relation", relation])
    if request.entityMaxHops is not None:
        args.extend(["--entity-max-hops", str(request.entityMaxHops)])
    args.append("--json")
    return await _run_index_tree(args, cli, "Index tree navigate command failed.")


@router.get("/ensure")
async def ensure(
    date_from: str | None = Query(None, alias="from"),
    date_to: str | None = Query(None, alias="to"),
    cli: CLIAdapter = Depends(get_cli),
) -> JSONResponse:
    """Ensure Index B freshness or return CLI journal fallback pointers."""
    args = ["index-tree", "ensure"]
    _append_date_range(args, date_from, date_to)
    args.append("--json")
    return await _run_index_tree(args, cli, "Index tree ensure command failed.")


@router.get("/shadow")
async def get_shadow(
    query: str = Query(..., description="Shadow diagnostic query"),
    cli: CLIAdapter = Depends(get_cli),
) -> JSONResponse:
    """Return index-tree shadow diagnostics.

    Diagnostic-only. Must not affect default search or smart-search ranking.
    """
    return await _run_index_tree(
        ["index-tree", "shadow", "--query", query, "--json"],
        cli,
        "Index tree shadow command failed.",
    )


def _append_date_range(args: list[str], date_from: str | None, date_to: str | None) -> None:
    if date_from:
        args.extend(["--from", date_from])
    if date_to:
        args.extend(["--to", date_to])


async def _run_index_tree(args: list[str], cli: CLIAdapter, fallback_message: str) -> JSONResponse:
    try:
        payload = await cli.run_json(args)
    except CLIError as exc:
        return JSONResponse(
            status_code=502,
            content=APIResponse.error_response(
                "CLI_ERROR",
                exc.stderr or fallback_message,
            ).model_dump(),
        )

    return JSONResponse(
        status_code=200,
        content=APIResponse.success(payload).model_dump(),
    )

"""Search router — full-text + semantic search via CLI."""

from fastapi import APIRouter
from pydantic import BaseModel, Field

from backend.adapter.cli_adapter import CLIAdapter, CLIError
from backend.adapter.error_mapper import map_cli_error
from backend.models.response import APIResponse
from backend.routers.journals import (
    JournalSummary,
    _path_to_id,
    _parse_metadata,
    _search_results,
)

router = APIRouter(tags=["search"])


class SearchRequest(BaseModel):
    query: str = ""
    topics: list[str] | None = None
    moods: list[str] | None = None
    people: list[str] | None = None
    dateStart: str | None = None
    dateEnd: str | None = None
    limit: int = 20
    level: int = 2


class SearchResponse(BaseModel):
    results: list[JournalSummary]
    total: int
    meta: dict = Field(default_factory=dict)


class SmartSearchRequest(BaseModel):
    query: str


class SmartSearchResponse(BaseModel):
    scaffold: list[dict]
    evidence: list[dict]
    provenance: str
    meta: dict = Field(default_factory=dict)


@router.post("/search")
async def search_journals(req: SearchRequest) -> APIResponse[SearchResponse]:
    """Search journals via CLI search command."""
    cli = CLIAdapter()

    args = [
        "search",
        "--level",
        str(req.level),
        "--limit",
        str(req.limit),
        "--no-semantic",
    ]

    if req.query:
        args.extend(["--query", req.query])

    if req.topics:
        for t in req.topics:
            args.extend(["--topic", t])

    if req.moods:
        args.extend(["--mood", ",".join(req.moods)])

    if req.people:
        args.extend(["--people", ",".join(req.people)])

    if req.dateStart:
        args.extend(["--date-from", req.dateStart])

    if req.dateEnd:
        args.extend(["--date-to", req.dateEnd])

    try:
        data = await cli.run_json(args, timeout=30.0)

        results = _search_results(data)

        journals: list[JournalSummary] = []
        for r in results[: req.limit]:
            meta = r.get("metadata", {})
            parsed = _parse_metadata(meta)
            journals.append(
                JournalSummary(
                    id=_path_to_id(r.get("rel_path", r.get("path", ""))),
                    title=r.get("title", meta.get("title", "")),
                    date=r.get("date", meta.get("date", "")),
                    abstract=parsed["abstract"],
                    topics=parsed["topics"],
                    moods=parsed["moods"],
                    people=parsed["people"],
                    tags=parsed["tags"],
                    location=parsed["location"],
                    project=parsed["project"],
                )
            )

        total = _search_total(data, len(results))
        cli_meta = _build_meta(data, args)
        return APIResponse.success(
            SearchResponse(results=journals, total=total, meta=cli_meta),
            meta=cli_meta,
        )

    except CLIError as e:
        code, msg = map_cli_error(e.stderr, e.returncode)
        return APIResponse.error_response(code, msg)
    except Exception:
        return APIResponse.error_response("SEARCH_ERROR", "搜索时遇到了问题")


@router.post("/smart-search")
async def smart_search(req: SmartSearchRequest) -> APIResponse[SmartSearchResponse]:
    """Smart-search via CLI deterministic scaffold/evidence mode.

    Uses ``life-index smart-search --query <q>`` without ``--use-llm``.
    Returns scaffold steps, evidence items, and provenance metadata.
    """
    if not req.query or not req.query.strip():
        return APIResponse.error_response("VALIDATION_ERROR", "查询内容不能为空")

    cli = CLIAdapter()
    args = build_smart_search_args(req.query.strip())

    try:
        data = await cli.run_json(args, timeout=60.0)

        if not isinstance(data, dict):
            data = {}

        scaffold = data.get("scaffold", [])
        evidence_raw = data.get("evidence", [])
        provenance = str(data.get("provenance", "deterministic"))

        evidence: list[dict] = []
        for item in evidence_raw:
            if not isinstance(item, dict):
                continue
            meta = item.get("metadata", {})
            parsed = _parse_metadata(meta)
            evidence.append({
                "id": _path_to_id(item.get("rel_path", item.get("path", ""))),
                "title": item.get("title", meta.get("title", "")),
                "date": item.get("date", meta.get("date", "")),
                "abstract": parsed["abstract"],
                "topics": parsed["topics"],
                "moods": parsed["moods"],
                "people": parsed["people"],
                "tags": parsed["tags"],
                "location": parsed["location"],
                "project": parsed["project"],
            })

        cli_meta = _build_meta(data, args)

        return APIResponse.success(
            SmartSearchResponse(
                scaffold=scaffold,
                evidence=evidence,
                provenance=provenance,
                meta=cli_meta,
            ),
            meta=cli_meta,
        )

    except CLIError as e:
        code, msg = map_cli_error(e.stderr, e.returncode)
        return APIResponse.error_response(code, msg)
    except Exception:
        return APIResponse.error_response("SMART_SEARCH_ERROR", "智能搜索时遇到了问题")


def _search_total(data: dict | list, fallback: int) -> int:
    if not isinstance(data, dict):
        return fallback
    for key in ("total_matches", "total_available", "total_found"):
        value = data.get(key)
        if value is not None:
            try:
                return int(value)
            except (TypeError, ValueError):
                break
    return fallback


def _build_meta(data: dict, command_args: list[str]) -> dict:
    """Extract CLI metadata for the response data."""
    meta: dict = {
        "command": ["life-index", *command_args],
    }
    if isinstance(data, dict):
        sv = data.get("schema_version")
        if sv is not None:
            meta["schemaVersion"] = sv
        prov = data.get("provenance")
        if prov is not None:
            meta["provenance"] = prov
        events = data.get("events")
        if events is not None:
            meta["events"] = events
    return meta


def build_smart_search_args(query: str) -> list[str]:
    """Build CLI args for smart-search without LLM orchestration.

    Smart-search uses the CLI's deterministic scaffold/evidence mode by
    default. ``--use-llm`` requires an explicit future product decision and
    is not the M1 default.
    """
    return ["smart-search", "--query", query]

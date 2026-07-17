"""Journals router — list, detail, write, and edit via CLI."""

import json
import re
import tempfile
from pathlib import Path

from fastapi import APIRouter, File, Form, Query, UploadFile
from pydantic import BaseModel, Field

from backend.adapter.cli_adapter import CLIAdapter, CLIError
from backend.adapter.error_mapper import map_cli_error
from backend.models.response import APIResponse

router = APIRouter(tags=["journals"])

class JournalSummary(BaseModel):
    id: str
    title: str
    date: str
    abstract: str | None = None
    topics: list[str] = []
    moods: list[str] = []
    people: list[str] = []
    tags: list[str] = []
    location: str | None = None
    project: str | None = None


class JournalAttachment(BaseModel):
    relPath: str
    filename: str
    contentType: str = "application/octet-stream"
    sizeBytes: int | None = None


class JournalDetail(BaseModel):
    id: str
    title: str
    date: str
    content: str
    abstract: str | None = None
    topics: list[str] = []
    moods: list[str] = []
    people: list[str] = []
    location: str | None = None
    weather: str | None = None
    project: str | None = None
    links: list[str] = []
    wordCount: int = 0
    attachments: list[JournalAttachment] = []


def _path_to_id(path: str) -> str:
    """Convert file path to URL-safe ID."""
    # e.g. "Journals/2026/01/life-index_2026-01-28_001.md" → "2026/01/life-index_2026-01-28_001"
    p = path.replace("\\", "/")
    m = re.search(r"(?:Journals/)?(\d{4}/\d{2}/life-index_[\d_-]+\w*)", p)
    if m:
        return m.group(1)
    return Path(p).stem


def _parse_list_field(raw):
    """Parse a field that may be a YAML list, comma-separated string, or single value."""
    if isinstance(raw, list):
        return [str(item).strip() for item in raw if str(item).strip()]
    if not raw:
        return []
    text = str(raw)
    # Handle Python repr of a list (legacy malformed data)
    if text.startswith("[") and text.endswith("]"):
        inner = text[1:-1]
        return [item.strip().strip("'\"\"") for item in inner.split(",") if item.strip()]
    return [t.strip() for t in text.split(",") if t.strip()]


def _parse_metadata(meta: dict) -> dict:
    """Extract standardized fields from CLI search metadata."""
    topics = _parse_list_field(meta.get("topic"))
    moods = _parse_list_field(meta.get("mood"))
    people = _parse_list_field(meta.get("people"))
    tags = _parse_list_field(meta.get("tags"))
    links = _parse_list_field(meta.get("links"))

    return {
        "topics": topics,
        "moods": moods,
        "people": people,
        "tags": tags,
        "location": meta.get("location"),
        "weather": meta.get("weather"),
        "project": meta.get("project", ""),
        "abstract": meta.get("abstract"),
        "links": links,
    }


def _search_results(data: dict | list) -> list[dict]:
    """Return the first supported search result list from CLI output."""
    if isinstance(data, list):
        return [r for r in data if isinstance(r, dict)]
    if not isinstance(data, dict):
        return []
    first_list: list[dict] | None = None
    for key in ("merged_results", "l2_results", "l1_results", "results"):
        value = data.get(key)
        if isinstance(value, list):
            results = [r for r in value if isinstance(r, dict)]
            if results:
                return results
            if first_list is None:
                first_list = results
    return first_list or []


def _is_journal_entry_result(result: dict) -> bool:
    """Return True for actual journal entries, excluding generated index/report docs."""
    path = (
        result.get("journal_route_path")
        or result.get("rel_path")
        or result.get("path")
        or ""
    )
    journal_id = _path_to_id(str(path))
    return re.match(r"^\d{4}/\d{2}/life-index_\d{4}-\d{2}-\d{2}_\d+", journal_id) is not None


def _journal_sort_key(result: dict) -> tuple[str, str]:
    meta = result.get("metadata", {})
    if not isinstance(meta, dict):
        meta = {}
    path = str(
        result.get("journal_route_path")
        or result.get("rel_path")
        or result.get("path")
        or ""
    )
    return (str(result.get("date") or meta.get("date") or ""), _path_to_id(path))


def _int_value(value, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _attachment_filename(value: object, rel_path: str) -> str:
    filename = str(value or "").strip()
    if filename:
        return filename
    return rel_path.replace("\\", "/").rsplit("/", 1)[-1] or "attachment"


def _parse_attachments(raw) -> list[JournalAttachment]:
    if not isinstance(raw, list):
        return []

    attachments: list[JournalAttachment] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        rel_path = str(
            item.get("rel_path")
            or item.get("relPath")
            or item.get("target_rel_path")
            or item.get("targetRelPath")
            or item.get("path")
            or ""
        ).strip()
        if not rel_path:
            continue
        size_value = item.get("size_bytes") or item.get("sizeBytes") or item.get("size")
        attachments.append(
            JournalAttachment(
                relPath=rel_path,
                filename=_attachment_filename(item.get("filename") or item.get("name"), rel_path),
                contentType=str(
                    item.get("content_type")
                    or item.get("contentType")
                    or item.get("media_type")
                    or item.get("mediaType")
                    or "application/octet-stream"
                ),
                sizeBytes=_int_value(size_value) if size_value is not None else None,
            )
        )
    return attachments


def _parse_cli_json_stdout(stdout: str) -> dict:
    """Parse CLI JSON stdout that may be preceded by log lines."""
    start = stdout.find("{")
    if start < 0:
        return {}
    try:
        payload = json.loads(stdout[start:])
    except json.JSONDecodeError:
        return {}
    return payload if isinstance(payload, dict) else {}


@router.get("/journals")
async def list_journals(
    limit: int = Query(default=10, ge=1, le=50),
) -> APIResponse[list[JournalSummary]]:
    """List recent journals using CLI journal list --recent."""
    cli = CLIAdapter()
    try:
        payload = await cli.run_json(
            [
                "journal",
                "list",
                "--recent",
                "--limit",
                str(limit),
                "--json",
            ]
        )

        items: list[dict] = []
        if isinstance(payload, dict):
            data = payload.get("data")
            if isinstance(data, dict):
                raw_items = data.get("items")
                if isinstance(raw_items, list):
                    items = [r for r in raw_items if isinstance(r, dict)]

        results = [r for r in items if _is_journal_entry_result(r)]

        journals: list[JournalSummary] = []
        for r in results[:limit]:
            meta = r.get("metadata", {})
            if not isinstance(meta, dict):
                meta = {}
            parsed = _parse_metadata(meta)
            journals.append(
                JournalSummary(
                    id=_path_to_id(
                        r.get("rel_path", r.get("journal_route_path", ""))
                    ),
                    title=r.get("title", "") or meta.get("title", ""),
                    date=r.get("date", meta.get("date", "")),
                    abstract=parsed["abstract"],
                    topics=parsed["topics"],
                    moods=parsed["moods"],
                    location=parsed["location"],
                )
            )

        return APIResponse.success(journals)
    except CLIError as e:
        code, msg = map_cli_error(e.stderr, e.returncode)
        return APIResponse.error_response(code, msg)


@router.get("/journals/{journal_id:path}")
async def get_journal(journal_id: str) -> APIResponse[JournalDetail]:
    """Read a single journal entry by ID through the stable CLI journal contract."""
    cli = CLIAdapter()
    try:
        data = await cli.run_json(
            [
                "journal",
                "get",
                "--path",
                f"Journals/{journal_id}.md",
                "--json",
            ],
            timeout=30.0,
        )

        if isinstance(data, dict) and data.get("success") is False:
            error = data.get("error")
            error_data = error if isinstance(error, dict) else {}
            return APIResponse.error_response(
                str(error_data.get("code") or "NOT_FOUND"),
                str(error_data.get("message") or f"Journal not found: {journal_id}"),
            )

        match = data.get("data") if isinstance(data, dict) else None
        if not isinstance(match, dict):
            return APIResponse.error_response(
                "NOT_FOUND", f"Journal not found: {journal_id}"
            )

        meta = match.get("metadata", {})
        parsed = _parse_metadata(meta)
        content = (
            match.get("full_content") or match.get("content") or match.get("snippet") or ""
        )
        return APIResponse.success(
            JournalDetail(
                id=journal_id,
                title=match.get("title") or meta.get("title", ""),
                date=match.get("date", meta.get("date", "")),
                content=content,
                abstract=parsed["abstract"],
                topics=parsed["topics"],
                moods=parsed["moods"],
                people=parsed["people"],
                location=parsed["location"],
                weather=parsed["weather"],
                project=parsed["project"],
                links=parsed["links"],
                wordCount=_int_value(match.get("word_count") or match.get("wordCount")),
                attachments=_parse_attachments(match.get("attachments")),
            )
        )
    except CLIError as e:
        code, msg = map_cli_error(e.stderr, e.returncode)
        return APIResponse.error_response(code, msg)


# ── Write helpers ─────────────────────────────────────────────────────────


def _safe_attachment_staging_filename(value: object) -> str:
    """Return one safe basename for request-local attachment staging."""
    filename = str(value or "").replace("\\", "/").rsplit("/", 1)[-1]
    stem = filename.split(".", 1)[0].upper()
    windows_reserved = {
        "CON",
        "PRN",
        "AUX",
        "NUL",
        *(f"COM{number}" for number in range(1, 10)),
        *(f"LPT{number}" for number in range(1, 10)),
    }
    if (
        not filename
        or not filename.strip()
        or filename in {".", ".."}
        or "\x00" in filename
        or any(ord(character) < 32 or character in '<>:"/\\|?*' for character in filename)
        or filename.rstrip(". ") != filename
        or stem in windows_reserved
    ):
        return "attachment"
    return filename


async def _prepare_attachments(files: list[UploadFile], temp_dir: str) -> list[dict]:
    """Stage uploaded files in an OS temp directory and return attachment descriptors.

    Mirrors backend/adapter/import_adapter.py write_temp_plan(): files land in
    OS-managed temp space, never inside LIFE_INDEX_DATA_DIR, and are removed
    once the request context exits.
    """
    attachments: list[dict] = []
    for file in files:
        contents = await file.read()
        filename = _safe_attachment_staging_filename(file.filename)
        staging_dir = Path(tempfile.mkdtemp(dir=temp_dir))
        staged_path = staging_dir / filename
        with staged_path.open("xb") as staged_file:
            staged_file.write(contents)
        attachments.append(
            {"source_path": str(staged_path.resolve()), "description": ""}
        )
    return attachments


async def _run_create(cli: CLIAdapter, data: dict) -> APIResponse[dict]:
    """Run CLI write and package the result envelope."""
    stdout = await cli.run_serialized(
        ["write", "write", "--data", json.dumps(data, ensure_ascii=False)],
        timeout=30.0,
    )
    stdout_str = stdout.strip()
    cli_payload = _parse_cli_json_stdout(stdout_str)
    result: dict = {"raw": stdout_str} if stdout_str else {}
    journal_path = cli_payload.get("journal_path")
    if journal_path:
        result["id"] = _path_to_id(str(journal_path))
        result["journalPath"] = str(journal_path)
    if "needs_confirmation" in cli_payload:
        result["needsConfirmation"] = bool(cli_payload.get("needs_confirmation"))
    if "confirmation" in cli_payload:
        result["confirmation"] = cli_payload.get("confirmation")
    # Extract journal ID from output path like "Journals/2026/01/life-index_...md"
    m = re.search(r"Journals/(\d{4}/\d{2}/life-index_[\d_-]+\w*)\.md", stdout_str)
    if m and "id" not in result:
        result["id"] = m.group(1)
    return APIResponse.success(result)


# ── Write models ──────────────────────────────────────────────────────────


class JournalEditRequest(BaseModel):
    """Payload for editing an existing journal entry."""

    title: str | None = None
    content_append: str | None = Field(None, alias="contentAppend")
    content_replace: str | None = Field(None, alias="contentReplace")
    location: str | None = None
    weather: str | None = None
    topic: str | None = None
    mood: str | None = None
    people: str | None = None
    project: str | None = None
    abstract: str | None = None
    tags: str | None = None
    links: str | None = None

    model_config = {"populate_by_name": True}


# ── Write endpoints ───────────────────────────────────────────────────────


@router.post("/journals")
async def create_journal(
    title: str = Form(...),
    content: str = Form(...),
    date: str = Form(default=""),
    location: str | None = Form(default=None),
    weather: str | None = Form(default=None),
    topic: str | None = Form(default=None),
    mood: str | None = Form(default=None),
    people: str | None = Form(default=None),
    project: str | None = Form(default=None),
    abstract: str | None = Form(default=None),
    tags: str | None = Form(default=None),
    links: str | None = Form(default=None),
    files: list[UploadFile] = File(default=[]),
) -> APIResponse[dict]:
    """Create a new journal entry via CLI write command (serialized).

    Accepts multipart/form-data so attachments can be uploaded at create time.
    Files are staged in an OS temp directory and passed to the CLI via
    --data attachments[].source_path; the CLI copies them into the journal's
    attachment directory. The temp directory is removed when the request ends.
    """
    cli = CLIAdapter()

    # Build the data dict for CLI --data flag
    data: dict = {"title": title, "content": content}
    if date:
        data["date"] = date
    if location:
        data["location"] = location
    if weather:
        data["weather"] = weather
    if topic:
        data["topic"] = topic
    if mood:
        data["mood"] = mood
    if people:
        data["people"] = people
    if project:
        data["project"] = project
    if abstract:
        data["abstract"] = abstract
    if tags:
        data["tags"] = tags
    if links:
        data["links"] = links

    try:
        if files:
            with tempfile.TemporaryDirectory() as temp_dir:
                data["attachments"] = await _prepare_attachments(files, temp_dir)
                return await _run_create(cli, data)
        return await _run_create(cli, data)
    except CLIError as e:
        code, msg = map_cli_error(e.stderr, e.returncode)
        return APIResponse.error_response(code, msg)


@router.put("/journals/{journal_id:path}")
async def edit_journal(
    journal_id: str,
    body: JournalEditRequest,
) -> APIResponse[dict]:
    """Edit an existing journal entry via CLI edit command (serialized)."""
    cli = CLIAdapter()

    # Build CLI edit args
    journal_path = f"Journals/{journal_id}.md"
    args = ["edit", "--journal", journal_path]

    if body.title is not None:
        args.extend(["--set-title", body.title])
    if body.location is not None:
        args.extend(["--set-location", body.location])
    if body.weather is not None:
        args.extend(["--set-weather", body.weather])
    if body.topic is not None:
        args.extend(["--set-topic", body.topic])
    if body.mood is not None:
        args.extend(["--set-mood", body.mood])
    if body.people is not None:
        args.extend(["--set-people", body.people])
    if body.project is not None:
        args.extend(["--set-project", body.project])
    if body.abstract is not None:
        args.extend(["--set-abstract", body.abstract])
    if body.tags is not None:
        args.extend(["--set-tags", body.tags])
    if body.links is not None:
        args.extend(["--set-links", body.links])
    if body.content_append is not None:
        args.extend(["--append-content", body.content_append])
    if body.content_replace is not None:
        args.extend(["--replace-content", body.content_replace])

    # No fields to update
    if len(args) <= 3:
        return APIResponse.error_response(
            "VALIDATION_ERROR", "At least one field must be provided for update"
        )

    try:
        stdout = await cli.run_serialized(args, timeout=30.0)
        result = {"raw": stdout.strip()} if stdout.strip() else {}
        return APIResponse.success(result)
    except CLIError as e:
        code, msg = map_cli_error(e.stderr, e.returncode)
        return APIResponse.error_response(code, msg)

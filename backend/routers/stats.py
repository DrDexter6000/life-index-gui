"""Stats router — dashboard statistics and heatmap via supported CLI surfaces."""

import calendar
from collections import Counter
from datetime import datetime

from fastapi import APIRouter, Query
from pydantic import BaseModel

from backend.adapter.cli_adapter import CLIAdapter, CLIError
from backend.adapter.error_mapper import map_cli_error
from backend.models.response import APIResponse

router = APIRouter(tags=["stats"])

STATS_SEARCH_LIMIT = 500


class DashboardStats(BaseModel):
    totalJournals: int
    totalWords: int
    activeDays: int
    streakDays: int
    avgWordsPerDay: int


class TopicDistribution(BaseModel):
    name: str
    count: int
    color: str = "#CBD5E1"


class MoodFrequency(BaseModel):
    name: str
    count: int


class HeatmapDay(BaseModel):
    date: str
    count: int
    level: int


async def _load_stats_source(cli: CLIAdapter) -> tuple[dict, list[dict]]:
    """Load read-only dashboard inputs from supported CLI commands."""
    health = await cli.run_json(["health"])
    search = await cli.run_json(
        [
            "search",
            "--query",
            ".",
            "--level",
            "2",
            "--limit",
            str(STATS_SEARCH_LIMIT),
            "--no-semantic",
        ]
    )
    return _as_dict(health), _search_results(search)


def _as_dict(value) -> dict:
    return value if isinstance(value, dict) else {}


def _search_results(data: dict | list) -> list[dict]:
    if isinstance(data, list):
        return [r for r in data if isinstance(r, dict)]
    if not isinstance(data, dict):
        return []
    for key in ("l2_results", "merged_results", "l1_results", "results"):
        value = data.get(key)
        if isinstance(value, list):
            return [r for r in value if isinstance(r, dict)]
    return []


def _parse_list_field(raw) -> list[str]:
    if isinstance(raw, list):
        return [str(item).strip() for item in raw if str(item).strip()]
    if not raw:
        return []
    text = str(raw)
    if text.startswith("[") and text.endswith("]"):
        inner = text[1:-1]
        return [item.strip().strip("'\"\"") for item in inner.split(",") if item.strip()]
    return [item.strip() for item in text.split(",") if item.strip()]


def _int_value(value, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _result_date(result: dict) -> str:
    meta = _as_dict(result.get("metadata"))
    return str(result.get("date") or meta.get("date") or "")[:10]


def _result_word_count(result: dict) -> int:
    meta = _as_dict(result.get("metadata"))
    return _int_value(
        result.get("word_count")
        or result.get("wordCount")
        or meta.get("word_count")
        or meta.get("wordCount")
    )


def _term_counts(results: list[dict], field: str) -> list[tuple[str, int]]:
    counter: Counter[str] = Counter()
    for result in results:
        meta = _as_dict(result.get("metadata"))
        counter.update(_parse_list_field(meta.get(field)))
    return counter.most_common(10)


def _health_journal_count(health: dict, fallback: int) -> int:
    data = _as_dict(health.get("data"))
    direct = _int_value(
        health.get("journal_count")
        or health.get("journalCount")
        or data.get("journal_count")
        or data.get("journalCount")
    )
    if direct:
        return direct

    checks = data.get("checks")
    if isinstance(checks, list):
        for check in checks:
            check_data = _as_dict(check)
            if check_data.get("name") == "data_directory":
                count = _int_value(
                    check_data.get("journal_count") or check_data.get("journalCount")
                )
                if count:
                    return count

    return fallback


def _level(count: int) -> int:
    """Map journal count to heatmap level (0-4)."""
    if count <= 0:
        return 0
    if count >= 4:
        return 4
    return count


@router.get("/stats")
async def get_stats() -> APIResponse[DashboardStats]:
    """Aggregate dashboard statistics via supported CLI commands."""
    cli = CLIAdapter()
    try:
        health, results = await _load_stats_source(cli)
        dates = {date for result in results if (date := _result_date(result))}
        total_words = sum(_result_word_count(result) for result in results)
        active_days = len(dates)
        return APIResponse.success(
            DashboardStats(
                totalJournals=_health_journal_count(health, len(results)),
                totalWords=total_words,
                activeDays=active_days,
                streakDays=0,
                avgWordsPerDay=total_words // active_days if active_days else 0,
            )
        )
    except CLIError as e:
        code, msg = map_cli_error(e.stderr, e.returncode)
        return APIResponse.error_response(code, msg)


@router.get("/topics")
async def get_topics() -> APIResponse[list[TopicDistribution]]:
    """Topic distribution across journals returned by supported search."""
    cli = CLIAdapter()
    try:
        _, results = await _load_stats_source(cli)
        return APIResponse.success(
            [
                TopicDistribution(name=name, count=count)
                for name, count in _term_counts(results, "topic")
            ]
        )
    except CLIError as e:
        code, msg = map_cli_error(e.stderr, e.returncode)
        return APIResponse.error_response(code, msg)


@router.get("/moods")
async def get_moods() -> APIResponse[list[MoodFrequency]]:
    """Mood frequency across journals returned by supported search."""
    cli = CLIAdapter()
    try:
        _, results = await _load_stats_source(cli)
        return APIResponse.success(
            [
                MoodFrequency(name=name, count=count)
                for name, count in _term_counts(results, "mood")
            ]
        )
    except CLIError as e:
        code, msg = map_cli_error(e.stderr, e.returncode)
        return APIResponse.error_response(code, msg)


@router.get("/heatmap")
async def get_heatmap(
    year: int = Query(default=None, description="Year (default: current year)"),
    month: int = Query(
        default=None, ge=1, le=12, description="Month (default: current month)"
    ),
) -> APIResponse[list[HeatmapDay]]:
    """Monthly heatmap: per-day journal counts for a given month."""
    now = datetime.now()
    y = year or now.year
    m = month or now.month

    cli = CLIAdapter()
    try:
        _, results = await _load_stats_source(cli)
        counts: Counter[str] = Counter(
            date
            for result in results
            if (date := _result_date(result)) and date.startswith(f"{y:04d}-{m:02d}-")
        )

        days_in_month = calendar.monthrange(y, m)[1]
        days: list[HeatmapDay] = []
        for day in range(1, days_in_month + 1):
            date_str = f"{y:04d}-{m:02d}-{day:02d}"
            cnt = counts.get(date_str, 0)
            days.append(HeatmapDay(date=date_str, count=cnt, level=_level(cnt)))

        return APIResponse.success(days)
    except CLIError as e:
        code, msg = map_cli_error(e.stderr, e.returncode)
        return APIResponse.error_response(code, msg)

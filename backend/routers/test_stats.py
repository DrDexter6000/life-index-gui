"""Tests for stats router — dashboard data composed from supported CLI commands."""

from unittest.mock import AsyncMock, MagicMock, patch

from fastapi.testclient import TestClient

from backend.main import app

client = TestClient(app)


def _make_stats_data(
    *,
    journal_count: int = 42,
    results: list | None = None,
):
    """Build supported CLI health/search responses for stats tests."""
    return {"status": "healthy", "journal_count": journal_count}, {
        "l2_results": results or []
    }


def _journal_result(
    *,
    date: str = "2026-04-01",
    topic=None,
    mood=None,
    word_count: int = 100,
):
    return {
        "rel_path": f"Journals/{date[:4]}/{date[5:7]}/life-index_{date}_001.md",
        "date": date,
        "word_count": word_count,
        "metadata": {"topic": topic or [], "mood": mood or []},
    }


def _mock_stats_cli(
    *,
    journal_count: int = 42,
    results: list | None = None,
    health_data: dict | None = None,
):
    default_health_data, search_data = _make_stats_data(
        journal_count=journal_count, results=results
    )
    health_data = health_data or default_health_data
    commands = []

    async def run_json(args):
        commands.append(args)
        if args[0] == "health":
            return health_data
        if args[0] == "search":
            return search_data
        raise AssertionError(f"unsupported command in stats router: {args}")

    mock_adapter = MagicMock()
    mock_adapter.run_json = AsyncMock(side_effect=run_json)
    return mock_adapter, commands


def test_get_stats_success():
    """GET /api/stats composes stats without calling unsupported CLI stats."""
    mock_adapter, commands = _mock_stats_cli(
        journal_count=42,
        results=[
            _journal_result(date="2026-04-01", word_count=100),
            _journal_result(date="2026-04-02", word_count=200),
        ],
    )

    with patch("backend.routers.stats.CLIAdapter", return_value=mock_adapter):
        response = client.get("/api/stats")

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    data = payload["data"]
    assert data["totalJournals"] == 42
    assert data["totalWords"] == 300
    assert data["activeDays"] == 2
    assert data["streakDays"] == 0
    assert data["avgWordsPerDay"] == 150
    assert all(command[0] != "stats" for command in commands)


def test_get_stats_reads_journal_count_from_health_checks():
    """GET /api/stats reads real health envelope data_directory journal_count."""
    mock_adapter, commands = _mock_stats_cli(
        health_data={
            "success": True,
            "data": {
                "status": "degraded",
                "checks": [
                    {"name": "data_directory", "status": "ok", "journal_count": 77}
                ],
            },
        },
        results=[_journal_result(date="2026-04-01", word_count=100)],
    )

    with patch("backend.routers.stats.CLIAdapter", return_value=mock_adapter):
        response = client.get("/api/stats")

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["data"]["totalJournals"] == 77
    assert all(command[0] != "stats" for command in commands)


def test_get_stats_error():
    """GET /api/stats returns error envelope on CLI failure."""
    from backend.adapter.cli_adapter import CLIError

    mock_adapter = MagicMock()
    mock_adapter.run_json = AsyncMock(
        side_effect=CLIError(1, "health command failed")
    )

    with patch("backend.routers.stats.CLIAdapter", return_value=mock_adapter):
        response = client.get("/api/stats")

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is False
    assert payload["error"]["code"] == "CLI_ERROR"


def test_get_topics_success():
    """GET /api/topics returns topic distribution via CLI."""
    mock_adapter, commands = _mock_stats_cli(
        results=[
            _journal_result(topic=["Work", "Life"]),
            _journal_result(topic="Work"),
        ]
    )

    with patch("backend.routers.stats.CLIAdapter", return_value=mock_adapter):
        response = client.get("/api/topics")

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    data = payload["data"]
    by_name = {t["name"]: t for t in data}
    assert by_name["Work"]["count"] == 2
    assert by_name["Life"]["count"] == 1
    assert by_name["Work"]["color"] == "#CBD5E1"
    assert all(command[0] != "stats" for command in commands)


def test_get_moods_success():
    """GET /api/moods returns mood frequency via CLI."""
    mock_adapter, commands = _mock_stats_cli(
        results=[
            _journal_result(mood=["Calm", "Happy"]),
            _journal_result(mood="Calm"),
        ]
    )

    with patch("backend.routers.stats.CLIAdapter", return_value=mock_adapter):
        response = client.get("/api/moods")

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    data = payload["data"]
    assert len(data) <= 10
    by_name = {m["name"]: m for m in data}
    assert by_name["Calm"]["count"] == 2
    assert by_name["Happy"]["count"] == 1
    assert all(command[0] != "stats" for command in commands)


def test_get_heatmap_success():
    """GET /api/heatmap composes per-day counts from supported search output."""
    mock_adapter, commands = _mock_stats_cli(
        results=[
            _journal_result(date="2026-04-01"),
            _journal_result(date="2026-04-02"),
            _journal_result(date="2026-04-02"),
        ]
    )

    with patch("backend.routers.stats.CLIAdapter", return_value=mock_adapter):
        response = client.get("/api/heatmap?year=2026&month=4")

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    data = payload["data"]
    assert len(data) == 30
    day1 = next(d for d in data if d["date"] == "2026-04-01")
    day2 = next(d for d in data if d["date"] == "2026-04-02")
    assert day1["count"] == 1
    assert day1["level"] == 1
    assert day2["count"] == 2
    assert day2["level"] == 2
    assert all(command[0] != "stats" for command in commands)

from pathlib import Path


def test_query_prompt_preserves_user_query_language_contract():
    prompt = Path(__file__).with_name("prompts").joinpath("query.md").read_text(encoding="utf-8")

    assert "Chinese characters" not in prompt
    assert "must be Chinese" not in prompt
    assert "Use the user's dominant query language" in prompt
    assert "mixed-language" in prompt


def test_native_query_prompt_requests_only_native_answer_text_and_canonical_links():
    prompt = Path(__file__).with_name("prompts").joinpath("query-native.md").read_text(encoding="utf-8")

    assert "natural language or Markdown" in prompt
    assert "[descriptive label](/journal/" in prompt
    for mechanical_field in (
        "schema_version",
        "request_id",
        "conversation_id",
        "source",
        "answer.mode",
        "evidence",
        "tool_trace",
    ):
        assert mechanical_field not in prompt

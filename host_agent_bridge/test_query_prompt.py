from pathlib import Path


def test_query_prompt_preserves_user_query_language_contract():
    prompt = Path(__file__).with_name("prompts").joinpath("query.md").read_text(encoding="utf-8")

    assert "Chinese characters" not in prompt
    assert "must be Chinese" not in prompt
    assert "Use the user's dominant query language" in prompt
    assert "mixed-language" in prompt

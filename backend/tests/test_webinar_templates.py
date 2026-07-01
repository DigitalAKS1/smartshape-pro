"""test_webinar_templates.py — pure, DB-free tests for the 6 email-safe HTML
webinar-lifecycle templates + the render_stage() renderer.

No DB, no SMTP, no app import. Verifies: session-level tokens substituted,
{name}/{school_name} left intact for later per-recipient personalize()/
personalize_html(), bulletproof-CTA accent color present, no leftover
session-token braces.
"""
import re

from webinar_templates_html import STAGE_SUBJECT, STAGE_HTML, render_stage

STAGES = ("confirm", "remind_24h", "remind_1h", "live", "noshow", "attended")

_SESSION_TOKEN_KEYS = [
    "session_title", "session_date", "session_time", "platform",
    "join_url", "add_to_calendar_url", "host_name", "recording_url",
]


def _tokens(**overrides):
    base = {
        "session_title": "Die Workshop",
        "join_url": "https://zoom.us/j/1",
        "session_date": "2099-01-02",
        "session_time": "10:00",
        "add_to_calendar_url": "http://x/ics",
        "host_name": "Aman",
        "recording_url": "",
        "platform": "zoom",
        "school_name": "",
        "name": "",
    }
    base.update(overrides)
    return base


def test_stage_dicts_have_all_six_keys():
    for key in STAGES:
        assert key in STAGE_SUBJECT, f"missing subject for {key}"
        assert key in STAGE_HTML, f"missing html for {key}"


def test_render_confirm_has_title_and_join():
    tokens = _tokens()
    subject, html = render_stage("confirm", tokens)

    assert "Die Workshop" in subject
    assert "https://zoom.us/j/1" in html
    assert "#e94560" in html
    assert "{session_title}" not in html
    # {name} must remain unfilled for the caller's per-recipient personalize step
    assert "{name}" in html


def test_all_six_stages_render():
    tokens = _tokens()
    for key in STAGES:
        subject, html = render_stage(key, tokens)
        assert subject, f"{key}: empty subject"
        assert html, f"{key}: empty html"
        # no leftover session-level token braces
        for tok_key in _SESSION_TOKEN_KEYS:
            brace = "{" + tok_key + "}"
            assert brace not in subject, f"{key}: leftover {brace} in subject"
            assert brace not in html, f"{key}: leftover {brace} in html"
        # {name} is allowed to remain (filled later per-recipient)
        # bulletproof CTA accent should appear in at least the body html
        assert "#e94560" in html, f"{key}: missing accent color"


def test_render_stage_unknown_raises():
    import pytest
    with pytest.raises((KeyError, ValueError)):
        render_stage("not_a_stage", _tokens())

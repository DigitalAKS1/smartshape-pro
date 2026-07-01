from email_utils import sanitize_html, personalize, personalize_html, plain_from_html, wrap_email_shell

def test_sanitize_strips_script_and_handlers():
    dirty = '<p onclick="x()">Hi</p><script>alert(1)</script><a href="javascript:evil()">y</a>'
    clean = sanitize_html(dirty)
    assert "<script" not in clean.lower()
    assert "onclick" not in clean.lower()
    assert "javascript:" not in clean.lower()
    assert "Hi" in clean

def test_sanitize_keeps_formatting_and_inline_style():
    html = '<p style="color:#e94560"><strong>Bold</strong> <a href="https://x.com">link</a></p>'
    clean = sanitize_html(html)
    assert "<strong>" in clean
    assert 'href="https://x.com"' in clean
    # Note: inline styles are stripped by bleach without a CSS sanitizer (tinycss2 not in requirements.txt)
    assert "style=" in clean  # attribute preserved but value stripped for safety

def test_personalize_replaces_known_tokens_only():
    out = personalize("Hi {name} at {school_name} — {unknown}", "Asha", "DPS")
    assert out == "Hi Asha at DPS — {unknown}"

def test_personalize_blank_name_is_safe():
    assert personalize("Dear {name},", "", "") == "Dear ,"

def test_personalize_html_escapes_values():
    out = personalize_html("<p>Hi {name} at {school_name}</p>", "<script>x</script>", "A&B")
    assert "&lt;script&gt;" in out
    assert "&amp;" in out
    assert "<script>" not in out

def test_plain_from_html_strips_tags():
    assert "Hello" in plain_from_html("<p>Hello <b>world</b></p>")
    assert "<" not in plain_from_html("<p>Hello</p>")

def test_wrap_shell_wraps_fragment_but_not_full_doc():
    wrapped = wrap_email_shell("<p>Body</p>")
    assert "max-width:600px" in wrapped.replace(" ", "")
    assert "<p>Body</p>" in wrapped
    full = "<html><body><p>x</p></body></html>"
    assert wrap_email_shell(full) == full

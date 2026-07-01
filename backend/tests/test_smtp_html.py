import types
import scheduler

class _FakeSMTP:
    last = {}
    def __init__(self, *a, **k): pass
    def __enter__(self): return self
    def __exit__(self, *a): return False
    def login(self, *a): pass
    def sendmail(self, frm, to, raw): _FakeSMTP.last = {"frm": frm, "to": to, "raw": raw}

def _patch(monkeypatch):
    monkeypatch.setattr(scheduler.smtplib, "SMTP_SSL", _FakeSMTP)

def test_plain_only_when_no_html(monkeypatch):
    _patch(monkeypatch)
    scheduler._smtp_send("s@x.com", "pw", "SmartShape", "to@x.com", "Subj", "Hello plain")
    raw = _FakeSMTP.last["raw"]
    assert "Hello plain" in raw
    assert "text/html" not in raw

def test_html_part_and_unsubscribe_when_html(monkeypatch):
    _patch(monkeypatch)
    scheduler._smtp_send("s@x.com", "pw", "SmartShape", "to@x.com", "Subj",
                         "Hello plain", body_html="<p>Hello <b>rich</b></p>")
    raw = _FakeSMTP.last["raw"]
    assert "text/html" in raw
    assert "Hello <b>rich</b>".replace(" ", "") in raw.replace("=\n", "").replace(" ", "") or "rich" in raw
    assert "List-Unsubscribe" in raw

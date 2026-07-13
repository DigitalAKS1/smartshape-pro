"""Import cleaning: mojibake repair + multi-email collapse (GSLC re-import).
mongomock not needed — these are pure parser helpers. Run:
    python -m pytest tests/test_import_clean.py -q
"""
import import_engine as e


def test_clean_text_fixes_mojibake():
    assert e.clean_text("ST. XAVIERâS HIGH SCHOOL") == "ST. XAVIER'S HIGH SCHOOL"
    assert e.clean_text("Angelâs Public School") == "Angel's Public School"
    assert e.clean_text("â€™quoteâ€™") == "'quote'"


def test_clean_text_noop_on_clean():
    for s in ("Shri Ram Global School", "N.K.Bagrodia Public School, Rohini", "", None):
        assert e.clean_text(s) == s


def test_first_email_collapses_multi():
    assert e.first_email("a.b@x.com / c@y.com") == "a.b@x.com"
    assert e.first_email("p@lotus.com info@lotus.com") == "p@lotus.com"
    assert e.first_email("MixedCase@Domain.COM") == "mixedcase@domain.com"
    assert e.first_email("") == ""
    assert e.first_email("not an email") == ""


def test_split_values_collapses_email_field():
    out = e.split_values({"email": "a@x.com / b@y.com", "school_name": "X"})
    assert out["contact"]["email"] == "a@x.com"

"""Certificate PDF token-merge must preserve the template's TYPEFACE, not collapse
every field to Helvetica. Regression for the {Theme}=GreatVibes -> Helvetica bug."""
import os, sys, tempfile
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import fitz
import cert_engine as ce


def test_bundled_font_resolves_family_and_subset_prefix():
    open_sans = ce.bundled_font_for("OpenSans-Regular")
    great = ce.bundled_font_for("BAAAAA+GreatVibes-Regular")   # subset prefix stripped
    assert open_sans and open_sans.endswith("OpenSans-Regular.ttf")
    assert great and great.endswith("GreatVibes-Regular.ttf")
    # family-only fallback keeps the typeface even for an un-bundled weight
    assert ce.bundled_font_for("OpenSans-Bold").endswith("OpenSans-Regular.ttf")
    # nothing bundled -> None (caller falls back to base-14)
    assert ce.bundled_font_for("Times-Bold") is None
    assert ce.bundled_font_for("") is None


def _make_template(path):
    """A PDF whose {Theme} token is drawn in the bundled GreatVibes script font."""
    doc = fitz.open()
    page = doc.new_page(width=600, height=400)
    great = ce.font_path("Great Vibes")
    open_sans = ce.font_path("Open Sans")
    page.insert_text((60, 120), "{Name}", fontsize=26, fontfile=open_sans, fontname="os")
    page.insert_text((60, 200), "{Theme}", fontsize=27, fontfile=great, fontname="gv")
    doc.save(path); doc.close()


def test_merge_preserves_script_font_for_theme():
    with tempfile.TemporaryDirectory() as d:
        tpl = os.path.join(d, "tpl.pdf")
        out = os.path.join(d, "out.pdf")
        _make_template(tpl)
        ce.render_certificate_pdf_merge(
            tpl, out,
            {"name": "Ms Divya Thawani"},
            {"theme": "Create More Teach Better"},
        )
        doc = fitz.open(out)
        fonts = {}
        for blk in doc[0].get_text("dict")["blocks"]:
            for line in blk.get("lines", []):
                for span in line.get("spans", []):
                    fonts[span["text"].strip()] = span["font"]
        doc.close()
        # the theme value must NOT be Helvetica — it must keep the GreatVibes typeface.
        # (font subsetting may rename "GreatVibes-Regular" -> "Great Vibes Regular")
        norm = lambda s: s.replace(" ", "").replace("-", "").lower()
        theme_font = fonts.get("Create More Teach Better", "")
        assert "greatvibes" in norm(theme_font), f"theme rendered in {theme_font!r}, expected GreatVibes"
        assert "opensans" in norm(fonts.get("Ms Divya Thawani", ""))


if __name__ == "__main__":
    test_bundled_font_resolves_family_and_subset_prefix()
    test_merge_preserves_script_font_for_theme()
    print("OK — all cert font tests passed")

"""
PDF generators for the procurement module — Purchase Order and Vendor Return
(debit) note. Mirrors the ReportLab conventions used by quotation_routes:
Unicode (DejaVu) fonts for the rupee symbol, brand palette, image thumbnails.
"""
import os
import io
import logging

UPLOADS_DIR = os.environ.get("UPLOADS_DIR", "/app/uploads")


def _img_bytes(image_url: str):
    """Load image bytes from a local /api/files path or http(s) url."""
    if not image_url:
        return None
    try:
        if image_url.startswith("/api/files/"):
            rel = image_url.replace("/api/files/", "", 1)
            base = os.path.realpath(UPLOADS_DIR)
            local = os.path.realpath(os.path.join(base, rel))
            # contain within UPLOADS_DIR — reject path-traversal in stored urls
            if (local == base or local.startswith(base + os.sep)) and os.path.isfile(local):
                with open(local, "rb") as f:
                    return f.read()
        elif image_url.startswith(("http://", "https://")):
            import requests
            r = requests.get(image_url, timeout=12)
            if r.ok:
                return r.content
    except Exception as e:  # pragma: no cover - network/file edge
        logging.warning("procurement pdf image load failed: %s", e)
    return None


def _register_fonts():
    try:
        from reportlab.pdfbase import pdfmetrics
        from reportlab.pdfbase.ttfonts import TTFont
        paths = [
            ('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 'DejaVuSans'),
            ('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 'DejaVuSans-Bold'),
        ]
        for p, n in paths:
            if n not in pdfmetrics.getRegisteredFontNames() and os.path.isfile(p):
                pdfmetrics.registerFont(TTFont(n, p))
        if 'DejaVuSans' in pdfmetrics.getRegisteredFontNames():
            return 'DejaVuSans', 'DejaVuSans-Bold'
    except Exception:
        pass
    return 'Helvetica', 'Helvetica-Bold'


def _money(n):
    try:
        return f"₹{float(n or 0):,.2f}"
    except Exception:
        return f"₹0.00"


def generate_po_pdf(po: dict, vendor: dict, company: dict) -> bytes:
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.lib import colors
    from reportlab.platypus import (SimpleDocTemplate, Table, TableStyle, Paragraph,
                                    Spacer, Image as RLImage)
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.enums import TA_RIGHT, TA_CENTER, TA_LEFT
    from reportlab.lib.utils import ImageReader

    BRAND = colors.Color(0.914, 0.271, 0.376)
    NAVY = colors.Color(0.102, 0.102, 0.180)
    GRAY = colors.Color(0.42, 0.42, 0.50)
    LGRAY = colors.Color(0.953, 0.953, 0.968)
    BORDER = colors.Color(0.80, 0.80, 0.86)
    WHITE = colors.white

    FONT, FONTB = _register_fonts()
    S = getSampleStyleSheet()

    def ps(name, **kw):
        if name not in S:
            S.add(ParagraphStyle(name=name, **kw))

    ps('Co', fontSize=14, leading=17, fontName=FONTB, textColor=NAVY)
    ps('Sub', fontSize=7.5, leading=10, fontName=FONT, textColor=GRAY)
    ps('Title', fontSize=22, leading=24, fontName=FONTB, textColor=BRAND, alignment=TA_RIGHT)
    ps('Meta', fontSize=8.5, leading=11, fontName=FONT, textColor=NAVY, alignment=TA_RIGHT)
    ps('Lbl', fontSize=6.5, leading=8.5, fontName=FONTB, textColor=BRAND, spaceAfter=1)
    ps('Key', fontSize=8, leading=11, fontName=FONT, textColor=NAVY)
    ps('Bold', fontSize=8.5, leading=11, fontName=FONTB, textColor=NAVY)
    ps('Hc', fontSize=7.5, leading=9.5, fontName=FONTB, textColor=WHITE, alignment=TA_CENTER)
    ps('Hr', fontSize=7.5, leading=9.5, fontName=FONTB, textColor=WHITE, alignment=TA_RIGHT)
    ps('Hl', fontSize=7.5, leading=9.5, fontName=FONTB, textColor=WHITE)
    ps('Cl', fontSize=8, leading=10, fontName=FONT, textColor=NAVY)
    ps('Cc', fontSize=8, leading=10, fontName=FONT, textColor=NAVY, alignment=TA_CENTER)
    ps('Cr', fontSize=8, leading=10, fontName=FONT, textColor=NAVY, alignment=TA_RIGHT)

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=14 * mm, rightMargin=14 * mm,
                            topMargin=10 * mm, bottomMargin=12 * mm)
    el = []

    # ── Header: company (left) + PO title (right) ───────────────────────────
    logo_cell = ""
    logo_b = _img_bytes(company.get("logo_url", ""))
    if logo_b:
        try:
            ir = ImageReader(io.BytesIO(logo_b))
            iw, ih = ir.getSize()
            scale = min(46 * mm / iw, 18 * mm / ih) if iw and ih else 1
            logo_cell = RLImage(io.BytesIO(logo_b), width=iw * scale, height=ih * scale)
        except Exception:
            logo_cell = ""
    left = [logo_cell] if logo_cell else []
    left += [
        Paragraph(company.get("name", "SmartShape") or "SmartShape", S['Co']),
        Paragraph(company.get("address", "") or "", S['Sub']),
        Paragraph(("GSTIN: " + company.get("gstin", "")) if company.get("gstin") else "", S['Sub']),
    ]
    right = [
        Paragraph("PURCHASE ORDER", S['Title']),
        Paragraph(po.get("po_no", ""), S['Meta']),
        Paragraph("Date: " + (po.get("created_at", "") or "")[:10], S['Meta']),
        Paragraph("Status: " + (po.get("status", "") or "").upper(), S['Meta']),
    ]
    head = Table([[left, right]], colWidths=[100 * mm, 82 * mm])
    head.setStyle(TableStyle([('VALIGN', (0, 0), (-1, -1), 'TOP')]))
    el.append(head)
    el.append(Spacer(1, 6))

    # ── Vendor + ship-to block ───────────────────────────────────────────────
    vlines = [Paragraph("VENDOR", S['Lbl']), Paragraph(vendor.get("name", "") or "", S['Bold'])]
    for k in ("contact_person", "address", "city", "state"):
        if vendor.get(k):
            vlines.append(Paragraph(str(vendor[k]), S['Key']))
    if vendor.get("gstin"):
        vlines.append(Paragraph("GSTIN: " + vendor["gstin"], S['Key']))
    if vendor.get("phone"):
        vlines.append(Paragraph("Phone: " + vendor["phone"], S['Key']))

    meta = [Paragraph("ORDER DETAILS", S['Lbl'])]
    if po.get("expected_date"):
        meta.append(Paragraph("Expected: " + str(po["expected_date"])[:10], S['Key']))
    meta.append(Paragraph("Tax: " + ("Intra-state (CGST+SGST)" if po.get("tax_mode") == "intra"
                                      else "Inter-state (IGST)"), S['Key']))
    if po.get("terms"):
        meta.append(Paragraph("Terms: " + po["terms"], S['Key']))

    info = Table([[vlines, meta]], colWidths=[100 * mm, 82 * mm])
    info.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('BACKGROUND', (0, 0), (-1, -1), LGRAY),
        ('BOX', (0, 0), (-1, -1), 0.5, BORDER),
        ('INNERGRID', (0, 0), (-1, -1), 0.5, BORDER),
        ('LEFTPADDING', (0, 0), (-1, -1), 8), ('RIGHTPADDING', (0, 0), (-1, -1), 8),
        ('TOPPADDING', (0, 0), (-1, -1), 6), ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
    ]))
    el.append(info)
    el.append(Spacer(1, 8))

    # ── Line items table (with image thumbnails) ─────────────────────────────
    intra = po.get("tax_mode") == "intra"
    header = ["#", "Image", "Item", "HSN", "Qty", "Rate", "Taxable"]
    if intra:
        header += ["CGST", "SGST"]
    else:
        header += ["IGST"]
    header += ["Total"]
    rows = [[Paragraph(h, S['Hc'] if i not in (2,) else S['Hl']) for i, h in enumerate(header)]]

    for idx, l in enumerate(po.get("lines", []), 1):
        thumb = ""
        ib = _img_bytes(l.get("image_url", ""))
        if ib:
            try:
                thumb = RLImage(io.BytesIO(ib), width=11 * mm, height=11 * mm)
            except Exception:
                thumb = ""
        cells = [
            Paragraph(str(idx), S['Cc']),
            thumb,
            Paragraph(str(l.get("name", "")), S['Cl']),
            Paragraph(str(l.get("hsn", "") or "-"), S['Cc']),
            Paragraph(f"{l.get('qty', 0):g} {l.get('uom', '')}", S['Cc']),
            Paragraph(_money(l.get("rate")), S['Cr']),
            Paragraph(_money(l.get("taxable")), S['Cr']),
        ]
        if intra:
            cells += [Paragraph(_money(l.get("cgst")), S['Cr']), Paragraph(_money(l.get("sgst")), S['Cr'])]
        else:
            cells += [Paragraph(_money(l.get("igst")), S['Cr'])]
        cells += [Paragraph(_money(l.get("line_total")), S['Cr'])]
        rows.append(cells)

    if intra:
        widths = [7, 14, 47, 13, 16, 18, 20, 16, 16, 21]
    else:
        widths = [7, 14, 55, 14, 17, 20, 22, 18, 23]
    col_w = [w * mm for w in widths]
    tbl = Table(rows, colWidths=col_w, repeatRows=1)
    tbl.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), NAVY),
        ('GRID', (0, 0), (-1, -1), 0.4, BORDER),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('ALIGN', (1, 1), (1, -1), 'CENTER'),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [WHITE, colors.Color(0.975, 0.975, 0.99)]),
        ('TOPPADDING', (0, 0), (-1, -1), 4), ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
        ('LEFTPADDING', (0, 0), (-1, -1), 4), ('RIGHTPADDING', (0, 0), (-1, -1), 4),
    ]))
    el.append(tbl)
    el.append(Spacer(1, 8))

    # ── Totals box ───────────────────────────────────────────────────────────
    tax_label = "CGST + SGST" if intra else "IGST"
    totals = [
        ["Subtotal (Taxable)", _money(po.get("subtotal"))],
        [f"Tax ({tax_label})", _money(po.get("tax_total"))],
        ["Grand Total", _money(po.get("grand_total"))],
    ]
    trows = [[Paragraph(a, S['Bold'] if i == 2 else S['Key']),
              Paragraph(b, S['Bold'])] for i, (a, b) in enumerate(totals)]
    ttbl = Table(trows, colWidths=[40 * mm, 32 * mm], hAlign='RIGHT')
    ttbl.setStyle(TableStyle([
        ('ALIGN', (1, 0), (1, -1), 'RIGHT'),
        ('LINEABOVE', (0, 2), (-1, 2), 0.8, NAVY),
        ('BACKGROUND', (0, 2), (-1, 2), LGRAY),
        ('TOPPADDING', (0, 0), (-1, -1), 4), ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
    ]))
    el.append(ttbl)
    el.append(Spacer(1, 16))
    el.append(Paragraph("Authorised Signatory — " + (company.get("name", "") or ""), S['Key']))

    doc.build(el)
    return buf.getvalue()


def generate_return_pdf(ret: dict, vendor: dict, company: dict) -> bytes:
    """Vendor Return / Debit note — rejected items being returned."""
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.lib import colors
    from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.enums import TA_RIGHT, TA_CENTER

    BRAND = colors.Color(0.80, 0.20, 0.25)
    NAVY = colors.Color(0.102, 0.102, 0.180)
    GRAY = colors.Color(0.42, 0.42, 0.50)
    LGRAY = colors.Color(0.96, 0.95, 0.95)
    BORDER = colors.Color(0.80, 0.80, 0.86)
    WHITE = colors.white
    FONT, FONTB = _register_fonts()
    S = getSampleStyleSheet()

    def ps(name, **kw):
        if name not in S:
            S.add(ParagraphStyle(name=name, **kw))
    ps('Co', fontSize=14, leading=17, fontName=FONTB, textColor=NAVY)
    ps('Sub', fontSize=7.5, leading=10, fontName=FONT, textColor=GRAY)
    ps('Title', fontSize=20, leading=23, fontName=FONTB, textColor=BRAND, alignment=TA_RIGHT)
    ps('Meta', fontSize=8.5, leading=11, fontName=FONT, textColor=NAVY, alignment=TA_RIGHT)
    ps('Lbl', fontSize=6.5, leading=8.5, fontName=FONTB, textColor=BRAND, spaceAfter=1)
    ps('Key', fontSize=8, leading=11, fontName=FONT, textColor=NAVY)
    ps('Bold', fontSize=8.5, leading=11, fontName=FONTB, textColor=NAVY)
    ps('Hc', fontSize=7.5, leading=9.5, fontName=FONTB, textColor=WHITE, alignment=TA_CENTER)
    ps('Hl', fontSize=7.5, leading=9.5, fontName=FONTB, textColor=WHITE)
    ps('Cl', fontSize=8, leading=10, fontName=FONT, textColor=NAVY)
    ps('Cc', fontSize=8, leading=10, fontName=FONT, textColor=NAVY, alignment=TA_CENTER)
    ps('Cr', fontSize=8, leading=10, fontName=FONT, textColor=NAVY, alignment=TA_RIGHT)

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=14 * mm, rightMargin=14 * mm,
                            topMargin=10 * mm, bottomMargin=12 * mm)
    el = []
    left = [Paragraph(company.get("name", "SmartShape") or "SmartShape", S['Co']),
            Paragraph(company.get("address", "") or "", S['Sub'])]
    right = [Paragraph("DEBIT / RETURN NOTE", S['Title']),
             Paragraph(ret.get("return_no", ""), S['Meta']),
             Paragraph("Date: " + (ret.get("created_at", "") or "")[:10], S['Meta']),
             Paragraph("Ref GRN: " + (ret.get("grn_no", "") or ret.get("grn_id", "")), S['Meta'])]
    head = Table([[left, right]], colWidths=[100 * mm, 82 * mm])
    head.setStyle(TableStyle([('VALIGN', (0, 0), (-1, -1), 'TOP')]))
    el.append(head)
    el.append(Spacer(1, 6))

    vlines = [Paragraph("RETURN TO VENDOR", S['Lbl']), Paragraph(vendor.get("name", "") or "", S['Bold'])]
    if vendor.get("gstin"):
        vlines.append(Paragraph("GSTIN: " + vendor["gstin"], S['Key']))
    info = Table([[vlines]], colWidths=[182 * mm])
    info.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), LGRAY), ('BOX', (0, 0), (-1, -1), 0.5, BORDER),
        ('LEFTPADDING', (0, 0), (-1, -1), 8), ('TOPPADDING', (0, 0), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6)]))
    el.append(info)
    el.append(Spacer(1, 8))

    rows = [[Paragraph(h, S['Hc'] if h != "Item" else S['Hl']) for h in
             ["#", "Item", "Qty", "Rate", "Amount", "Reason"]]]
    for i, l in enumerate(ret.get("lines", []), 1):
        amt = float(l.get("qty") or 0) * float(l.get("rate") or 0)
        rows.append([
            Paragraph(str(i), S['Cc']),
            Paragraph(str(l.get("name", "")), S['Cl']),
            Paragraph(f"{l.get('qty', 0):g}", S['Cc']),
            Paragraph(_money(l.get("rate")), S['Cr']),
            Paragraph(_money(amt), S['Cr']),
            Paragraph(str(l.get("reason", "") or ""), S['Cl']),
        ])
    tbl = Table(rows, colWidths=[8 * mm, 64 * mm, 18 * mm, 24 * mm, 26 * mm, 42 * mm], repeatRows=1)
    tbl.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), BRAND),
        ('GRID', (0, 0), (-1, -1), 0.4, BORDER),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [WHITE, colors.Color(0.98, 0.97, 0.97)]),
        ('TOPPADDING', (0, 0), (-1, -1), 4), ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
    ]))
    el.append(tbl)
    el.append(Spacer(1, 8))
    grand = Table([[Paragraph("Total Returned", S['Bold']), Paragraph(_money(ret.get("grand_total")), S['Bold'])]],
                  colWidths=[40 * mm, 32 * mm], hAlign='RIGHT')
    grand.setStyle(TableStyle([('BACKGROUND', (0, 0), (-1, -1), LGRAY), ('ALIGN', (1, 0), (1, 0), 'RIGHT'),
                               ('TOPPADDING', (0, 0), (-1, -1), 5), ('BOTTOMPADDING', (0, 0), (-1, -1), 5)]))
    el.append(grand)
    doc.build(el)
    return buf.getvalue()

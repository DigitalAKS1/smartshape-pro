"""Export SmartShape Sales Orders as Tally-importable XML (Sales Order vouchers)
and as clean JSON.

The XML follows Tally's standard "Import Data / Vouchers" envelope. Each order
becomes one Sales Order voucher with the party ledger + stock-item inventory
entries (qty / rate / amount), balanced pre-tax. Tally computes GST when the
order is converted to a Sales invoice, so we deliberately do NOT hard-code tax
ledgers here (those would have to match the customer's Tally masters exactly).

NOTE for the operator: the party name (PARTYLEDGERNAME) and each STOCKITEMNAME
must exist in Tally, or Tally will auto-create them on import. The Sales ledger
is named "Sales" — rename in code if your Tally uses a different sales ledger.
"""
from xml.sax.saxutils import escape
from database import db

SALES_LEDGER = "Sales"
UNIT = "Nos"


def _esc(v):
    return escape(str(v if v is not None else ""))


def _fmt_date(iso):
    return (iso or "")[:10].replace("-", "")  # Tally wants YYYYMMDD


async def gather_so(order_id):
    """Fetch the order + its quotation (pricing) + school (party) + company."""
    order = await db.orders.find_one({"order_id": order_id}, {"_id": 0})
    if not order:
        return None
    quot = await db.quotations.find_one(
        {"quotation_id": order.get("quotation_id")}, {"_id": 0}) or {}
    school = await db.schools.find_one(
        {"school_id": order.get("school_id")}, {"_id": 0}) or {}
    company = await db.settings.find_one({"type": "company"}, {"_id": 0}) or {}
    items = await db.order_items.find(
        {"order_id": order_id}, {"_id": 0}).to_list(1000)
    return {"order": order, "quotation": quot, "school": school,
            "company": company, "order_items": items}


def _lines(data):
    """Normalized line items: name / qty / rate / amount / gst_pct.
    Prefer the priced quotation lines; fall back to bare order_items (rate 0)."""
    out = []
    for l in (data["quotation"].get("lines") or []):
        qty = l.get("qty", l.get("quantity", 1)) or 1
        rate = l.get("unit_price", 0) or 0
        amount = l.get("line_subtotal", qty * rate)
        name = l.get("description") or l.get("die_name") or l.get("die_code") or "Item"
        out.append({"name": name, "qty": qty, "rate": rate,
                    "amount": amount, "gst_pct": l.get("gst_pct", 18)})
    if not out:  # no priced quotation — export item names + qty so the SO isn't empty
        for it in data.get("order_items", []):
            qty = it.get("quantity", 1) or 1
            out.append({"name": it.get("die_name") or it.get("die_code") or "Item",
                        "qty": qty, "rate": 0, "amount": 0, "gst_pct": 18})
    return out


def build_json(data):
    o, q, s, c = data["order"], data["quotation"], data["school"], data["company"]
    return {
        "sales_order_number": o.get("order_number"),
        "order_id": o.get("order_id"),
        "order_date": (o.get("created_at") or "")[:10],
        "reference_quote": o.get("quote_number"),
        "status": o.get("order_status"),
        "company": {
            "name": c.get("company_name"), "gstin": c.get("gst_number"),
            "state": c.get("state"), "address": c.get("address"),
        },
        "party": {
            "name": o.get("school_name"),
            "gstin": s.get("gst_number") or s.get("gstin", ""),
            "state": s.get("state"), "city": s.get("city"),
            "address": s.get("address"), "pincode": s.get("pincode"),
            "phone": s.get("phone"), "email": s.get("email"),
        },
        "items": _lines(data),
        "subtotal": q.get("subtotal", q.get("items_total", 0)),
        "discount1_pct": q.get("discount1_pct", 0),
        "discount2_pct": q.get("discount2_pct", 0),
        "freight_amount": q.get("freight_amount", 0),
        "gst_amount": q.get("gst_amount", 0),
        "gst_breakup": q.get("gst_breakup", []),
        "grand_total": o.get("grand_total", q.get("grand_total", 0)),
        "notes": o.get("notes", ""),
    }


def build_voucher_xml(data):
    o, s = data["order"], data["school"]
    lines = _lines(data)
    party = _esc(o.get("school_name", ""))
    date = _fmt_date(o.get("created_at"))
    vchno = _esc(o.get("order_number", ""))
    ref = _esc(o.get("quote_number", ""))
    addr = _esc(s.get("address", ""))
    party_gstin = _esc(s.get("gst_number") or s.get("gstin", ""))
    taxable = sum(l["amount"] for l in lines)

    inv = []
    for l in lines:
        inv.append(
            "        <ALLINVENTORYENTRIES.LIST>\n"
            f"          <STOCKITEMNAME>{_esc(l['name'])}</STOCKITEMNAME>\n"
            "          <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>\n"
            f"          <RATE>{l['rate']:.2f}/{UNIT}</RATE>\n"
            f"          <ACTUALQTY>{l['qty']} {UNIT}</ACTUALQTY>\n"
            f"          <BILLEDQTY>{l['qty']} {UNIT}</BILLEDQTY>\n"
            f"          <AMOUNT>{l['amount']:.2f}</AMOUNT>\n"
            "          <ACCOUNTINGALLOCATIONS.LIST>\n"
            f"            <LEDGERNAME>{_esc(SALES_LEDGER)}</LEDGERNAME>\n"
            "            <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>\n"
            f"            <AMOUNT>{l['amount']:.2f}</AMOUNT>\n"
            "          </ACCOUNTINGALLOCATIONS.LIST>\n"
            "        </ALLINVENTORYENTRIES.LIST>"
        )
    inv_xml = "\n".join(inv)

    return (
        '    <TALLYMESSAGE xmlns:UDF="TallyUDF">\n'
        '      <VOUCHER VCHTYPE="Sales Order" ACTION="Create" OBJVIEW="Invoice Voucher View">\n'
        f"        <DATE>{date}</DATE>\n"
        f"        <EFFECTIVEDATE>{date}</EFFECTIVEDATE>\n"
        "        <VOUCHERTYPENAME>Sales Order</VOUCHERTYPENAME>\n"
        f"        <VOUCHERNUMBER>{vchno}</VOUCHERNUMBER>\n"
        f"        <REFERENCE>{ref}</REFERENCE>\n"
        f"        <PARTYLEDGERNAME>{party}</PARTYLEDGERNAME>\n"
        f"        <PARTYNAME>{party}</PARTYNAME>\n"
        f"        <BASICBASEPARTYNAME>{party}</BASICBASEPARTYNAME>\n"
        f"        <PARTYGSTIN>{party_gstin}</PARTYGSTIN>\n"
        f"        <BASICBUYERADDRESS.LIST><BASICBUYERADDRESS>{addr}</BASICBUYERADDRESS></BASICBUYERADDRESS.LIST>\n"
        "        <ALLLEDGERENTRIES.LIST>\n"
        f"          <LEDGERNAME>{party}</LEDGERNAME>\n"
        "          <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>\n"
        f"          <AMOUNT>-{taxable:.2f}</AMOUNT>\n"
        "        </ALLLEDGERENTRIES.LIST>\n"
        f"{inv_xml}\n"
        "      </VOUCHER>\n"
        "    </TALLYMESSAGE>"
    )


def build_envelope(vouchers, company_name):
    body = "\n".join(vouchers)
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        "<ENVELOPE>\n"
        "  <HEADER>\n"
        "    <TALLYREQUEST>Import Data</TALLYREQUEST>\n"
        "  </HEADER>\n"
        "  <BODY>\n"
        "    <IMPORTDATA>\n"
        "      <REQUESTDESC>\n"
        "        <REPORTNAME>Vouchers</REPORTNAME>\n"
        "        <STATICVARIABLES>\n"
        f"          <SVCURRENTCOMPANY>{_esc(company_name)}</SVCURRENTCOMPANY>\n"
        "        </STATICVARIABLES>\n"
        "      </REQUESTDESC>\n"
        "      <REQUESTDATA>\n"
        f"{body}\n"
        "      </REQUESTDATA>\n"
        "    </IMPORTDATA>\n"
        "  </BODY>\n"
        "</ENVELOPE>"
    )

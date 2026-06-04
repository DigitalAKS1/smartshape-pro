# Quotation — GST After Subtotal & Amount = Qty × Rate

**Date:** 2026-06-04
**Status:** Approved (design)

## Problem

In the quotation line-item table the **AMOUNT** column currently shows the
GST-inclusive line total (`qty × rate × (1 + gst/100)`), and each row has an
editable **GST %** column. The business rule is simpler: package GST is a flat
18%, line amounts should be the pre-tax value (`qty × rate`), and GST should be
shown **once, after the Sub Total** — not per item.

Example: `QTY 1 × RATE ₹100 → AMOUNT ₹100`, then `Sub Total ₹100`, `GST @ 18%
₹18`, `Total ₹118`.

## Requirements

1. Every line-item **AMOUNT** (form + view + PDF + email) = `qty × unit_price`
   (excl. GST).
2. Remove the per-item **GST %** column from the line grids and the canonical
   PDF / on-screen view.
3. GST is computed once, **after Sub Total**.
4. Mixed-rate handling (e.g. one item 18%, one 12%): group GST **by rate slab**
   in the summary — GST law forbids blending rates into one average. When all
   items are 18% (the normal case) this collapses to a single `GST @ 18%` line.
5. Apply to **both** the entry forms and the customer-facing PDF/view/email.
6. A GST % field stays in the **"Add Item"** form, pre-filled `18%`, so a rare
   non-18% item can still be quoted. Default everywhere is 18%.
7. Freight unchanged: base sits in Sub Total, its 18% GST folds into the 18%
   slab.
8. Grand totals are **unchanged** — only the *display* of line amount and GST
   changes. Existing quotations remain numerically correct.

## Design

### Totals (`_compute_totals`, backend)
Keep all existing fields. Add a `gst_breakup` list for display:

```
gst_breakup = [
  { "rate": 18, "taxable": <discounted base for 18% lines + freight base>, "amount": <gst> },
  { "rate": 12, "taxable": <discounted base for 12% lines>,                "amount": <gst> },
  ...
]
```

- Group lines by `gst_pct` (default 18).
- Per-slab taxable base = `sum(line_subtotal for slab) × discount_factor`.
- Freight base is added to the 18% slab's taxable; freight GST = `freight_base × 0.18`.
- `sum(amount) == gst_amount` (existing total) — invariant to preserve.

### Line tables (form, view, PDF, email)
Columns become: `SR · DESCRIPTION · QTY · RATE · AMOUNT`, where
`AMOUNT = line_subtotal = qty × unit_price`. The `GST %` and `GST (₹)` columns
are removed.

### Summary (view + PDF + email)
Replace the single `GST` line with one line per `gst_breakup` entry:
`GST @ {rate}%` → `{amount}`. Position: directly below Sub Total. Single line in
the all-18% case.

## Files

| Layer | File | Change |
|---|---|---|
| PDF | `backend/routes/quotation_routes.py` `_generate_pdf_bytes` | Drop GST % col; AMOUNT = qty×rate; slab GST rows |
| Totals | `backend/routes/quotation_routes.py` `_compute_totals` | Add `gst_breakup` |
| Email | `backend/routes/quotation_routes.py` HTML bodies | Item amount = qty×rate; GST line(s) |
| Create form | `frontend/src/components/quotations/QuotationStep3Pricing.js` | Remove GST % col; Total = qty×rate |
| Edit form | `frontend/src/pages/admin/EditQuotation.js` | Same |
| View | `frontend/src/components/quotations/QuotationLineItems.js`, `QuotationSummary.js` | Drop GST(₹) col; AMOUNT = qty×rate; slab GST |
| Hooks | `frontend/src/hooks/useCreateQuotation.js`, `useEditQuotation.js` | Add `gst_breakup` to `calcTotals` |

## Out of scope
- "Menu in Home Dashboard" (deferred per user).
- School Address / City / State / PIN fields — already present, no change.
- Freight behavior — unchanged.

## Testing
- Single-rate (all 18%): one GST line, amounts = qty×rate, grand total identical
  to before.
- Mixed-rate (18% + 12%): two GST lines summing to the same total GST.
- With discounts + freight: slab bases scale by discount factor; freight GST in
  18% slab; grand total matches `_compute_totals.grand_total`.
- Existing quotation renders without recompute drift.

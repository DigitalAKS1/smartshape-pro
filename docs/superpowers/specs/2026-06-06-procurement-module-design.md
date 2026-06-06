# Procurement Module — Design Spec

**Date:** 2026-06-06
**Status:** Approved (user instructed "start working")
**Owner team:** Store-led, Admin approves

## 1. Purpose

Add a complete **procurement pipeline** to SmartShape Pro: from raising a need, to
ordering from a vendor, to receiving and quality-checking goods, to landing stock in
inventory — with product images shown throughout and professional GST PDFs for the
Purchase Order and Vendor Return notes.

## 2. Decisions (locked via brainstorming)

| Question | Decision |
|---|---|
| What gets purchased | **Both/mixed** — finished products (`dies`) + a new `purchase_items` master (raw materials, packaging, supplies). A unified item picker spans both via an `item_ref = {source, id}`. |
| Scope | **Full pipeline, phased** (5 phases). |
| QC "Not OK" outcome | Block stock-in + record Hold/Return, **plus** generate a Return/Debit-note PDF for the vendor. |
| Roles | **Store-led, Admin approves.** Store: requisition, PO build, verification, QC, stock-in. Admin: approve requisition/PO, manage Vendor Master. Accounts: read cost. |
| Order paths | **Two entry paths.** (A) Requisition → Admin approves → PO. (B) Direct Order Planning → PO immediately (no requisition). Both end in a Purchase Order. |
| Vendor pricing | **Vendor-item price list** — each vendor supplies items at default rates; PO auto-fills rate on vendor+item pick. |
| Tax | **Full GST breakup** — HSN per item, taxable value, CGST/SGST (intra-state) or IGST (inter-state), grand total. Intra vs inter derived from vendor `state_code` vs company `state_code`. |
| Progress tracking | **Hybrid** — simple `status` fields + a `timeline[]` per doc now, PLUS a `procurement_stage_logs` entry on every transition so TAT/FMS analytics can be layered later with no rework. |

## 3. Architecture

Follows existing SmartShape conventions exactly:
- **Backend:** FastAPI + Motor (MongoDB), raw dicts, `{entity}_id = f"{prefix}_{uuid4().hex[:12]}"`, ISO-8601 UTC timestamps. New file `backend/routes/procurement_routes.py`, registered in `main.py` under `/api`. PDF via `backend/routes/procurement_pdf.py` reusing the ReportLab patterns from `quotation_routes._generate_pdf_bytes`.
- **Frontend:** React + Vite + Tailwind + Radix UI. New `frontend/src/components/procurement/` folder + admin pages. New `procurement` section in `frontend/src/lib/api.js`.
- **Auth/RBAC:** `get_current_user` + `require_teams(user, ...)` from `rbac.py`.
- **Images/files:** reuse `save_file()` + `/api/files/{path}` serving pattern (as in `inventory_routes.py`).
- **Numbers:** a `counters` collection issues human-readable sequential numbers (REQ-0001, PO-0001, GRN-0001, RET-0001) via atomic `$inc` findOneAndUpdate.

## 4. Data Model (new collections)

### Masters
- **`vendors`** — `vendor_id, name, gstin, pan, contact_person, phone, email, address, city, state, state_code, payment_terms, logo_url, is_active, created_at, updated_at`
- **`vendor_items`** (price list) — `vendor_item_id, vendor_id, item_ref{source:"die"|"purchase_item", id}, name(cache), default_rate, hsn, gst_pct, uom, lead_time_days, is_active`
- **`purchase_items`** — `purchase_item_id, name, category, uom, hsn, gst_pct, image_url, default_rate, stock_qty, min_level, is_active, created_at`
- **`qc_checklist_templates`** — `template_id, name, checks:[{label, type:"boolean"|"text"|"select", options?}], is_active`

### Transactional
- **`requisitions`** — `requisition_id, req_no, status(draft|submitted|approved|rejected), requested_by, notes, lines:[{item_ref, name, image_url, qty, uom, est_rate}], approval{by,at,remark}, timeline:[], created_at, updated_at`
- **`purchase_orders`** — `po_id, po_no, origin(requisition|direct), requisition_id?, vendor_id, status(draft|approved|sent|partially_received|received|closed|cancelled), tax_mode(intra|inter), lines:[{item_ref, name, image_url, hsn, qty, uom, rate, gst_pct, taxable, cgst, sgst, igst, line_total}], subtotal, tax_total, grand_total, terms, expected_date, approval{by,at}, timeline:[], created_at, updated_at`
- **`goods_receipts`** (GRN / Verification) — `grn_id, grn_no, po_id, vendor_id, status(pending_qc|qc_done), lines:[{po_line_index, item_ref, name, image_url, ordered_qty, received_qty, qc_status(pending|ok|hold|return), qc_template_id?, qc_results:[{label,value}], remark}], received_by, timeline:[], created_at`
- **`vendor_returns`** (Return/Debit note) — `return_id, return_no, grn_id, vendor_id, lines:[{item_ref, name, qty, rate, reason}], grand_total, created_at`

### Reuse / integrate
- **`stock_movements`** (existing) — on QC `ok`, write `{movement_type:"purchase_in", reference_id: grn_id, die_id?/purchase_item_id?, quantity}` and increment target `stock_qty`. (Extend the existing collection; movements for purchase_items use a `purchase_item_id` field.)
- **`procurement_stage_logs`** (new) — `log_id, doc_type(requisition|po|grn), doc_id, from_status, to_status, by, at, remark`

### Indexes (added to `database.py connect_db`)
- `vendors`: `name`; `vendor_items`: `[(vendor_id,1)]`, `[("item_ref.id",1)]`
- `purchase_items`: `name`
- `requisitions`: `[(status,1),(created_at,-1)]`; `purchase_orders`: `[(status,1),(created_at,-1)]`, `vendor_id`, `requisition_id`
- `goods_receipts`: `po_id`, `[(status,1),(created_at,-1)]`
- `procurement_stage_logs`: `[(doc_type,1),(doc_id,1),(at,1)]`
- `counters`: `_id` (counter key)

## 5. API Surface (`/api`, prefix shown relative)

**Masters**
- `GET/POST/PUT/DELETE /vendors[/{id}]` ; `POST /vendors/{id}/upload-logo`
- `GET/POST/PUT/DELETE /vendor-items[/{id}]` (filter by `vendor_id`, `item source`)
- `GET/POST/PUT/DELETE /purchase-items[/{id}]` ; `POST /purchase-items/{id}/upload-image`
- `GET /procurement/item-catalog` — unified list of dies + purchase_items for the picker (id, source, name, image_url, hsn, gst_pct, uom, default_rate)
- `GET/POST/PUT/DELETE /qc-templates[/{id}]`

**Requisition**
- `GET/POST/PUT /requisitions[/{id}]`
- `POST /requisitions/{id}/submit` · `POST /requisitions/{id}/approve` · `POST /requisitions/{id}/reject`
- `POST /requisitions/{id}/convert-to-po` (creates a draft PO from approved requisition)

**Purchase Order**
- `GET/POST/PUT /purchase-orders[/{id}]` (POST supports `origin=direct`)
- `POST /purchase-orders/{id}/approve` · `/send` · `/cancel`
- `GET /purchase-orders/{id}/pdf` → StreamingResponse PDF

**Goods Receipt + QC**
- `POST /purchase-orders/{id}/receive` → creates a GRN pre-filled from PO lines
- `GET/PUT /goods-receipts[/{id}]`
- `POST /goods-receipts/{id}/qc` (per-line qc_status + remarks) → on submit: OK→stock-in, hold/return recorded
- `POST /goods-receipts/{id}/create-return` → creates `vendor_returns` from return-flagged lines
- `GET /vendor-returns/{id}/pdf` → StreamingResponse PDF

**Stock**
- Stock-in handled inside `/qc`; movements visible via existing inventory movement views, extended to show product image + purchase_item source.

## 6. GST calculation rule
`tax_mode = "intra" if vendor.state_code == company.state_code else "inter"`.
Per line: `taxable = qty*rate`; intra → `cgst = sgst = taxable*gst_pct/200`, `igst = 0`; inter → `igst = taxable*gst_pct/100`, `cgst=sgst=0`. `line_total = taxable + cgst + sgst + igst`. Totals summed across lines. Rounded to 2 dp.

## 7. Frontend
- **`pages/admin/Procurement.js`** — tabbed shell: Dashboard | Requisitions | Planning/POs | Receiving & QC | Returns.
- **`pages/admin/ProcurementMasters.js`** — tabs: Vendors | Vendor Price List | Purchase Items | QC Templates (reuse `MasterEntityTable` where simple, dedicated dialogs where rich).
- **`components/procurement/`** — `VendorFormDialog`, `PurchaseItemFormDialog`, `ItemPicker` (image grid, spans both sources), `RequisitionFormDialog`, `PODetailPanel`, `GoodsReceiptForm`, `QCChecklistTable` (columns: item+image, ordered, received, **QC remark select dropdown**, **status select OK/Hold/Return**), `ReturnNotePreview`.
- **`lib/api.js`** — `procurement.*` group mirroring the API surface; file uploads via `multipart/form-data` like `dies.uploadImage`.
- Image display: item picker + QC table + inventory movement all render `image_url` thumbnails (fallback placeholder).

## 8. Phasing
1. **Masters + foundations:** vendors, vendor_items, purchase_items, qc_templates, counters, stage-log helper, indexes, route registration, RBAC; frontend masters pages + api.js.
2. **Requisition + Direct Order Planning** with the unified image item picker.
3. **Purchase Order** + GST calc + PO PDF with images.
4. **Goods Verification bulk table + QC checklist** (remarks dropdown, OK/Hold/Return).
5. **Stock-in movement** (with images) + **Return/Debit note PDF**.

## 9. Testing
- Backend: pytest unit tests against an **isolated test DB** (never prod — prod-hit risk noted in memory). Cover: counter atomicity, GST calc (intra/inter/rounding), item-catalog merge, requisition→PO conversion, QC stock-in + return creation.
- Frontend: manual verification of each tab; image rendering fallback.

## 10. Out of scope (YAGNI for now)
Multi-currency, partial-quantity price negotiation history, vendor portal, payment processing (Accounts already owns payments), PO email auto-send (manual download/send for now), TAT dashboards (stage logs captured, dashboards deferred).

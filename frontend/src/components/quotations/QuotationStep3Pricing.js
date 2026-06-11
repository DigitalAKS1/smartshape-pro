import React from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { FieldTooltip } from '../ui/Tooltip';
import { ArrowLeft, Check, Plus, X } from 'lucide-react';
import { formatCurrency } from '../../lib/utils';

const card     = 'bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl';
const inputCls = 'bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]';
const tPri     = 'text-[var(--text-primary)]';
const tSec     = 'text-[var(--text-secondary)]';
const tMut     = 'text-[var(--text-muted)]';

const CURRENCY_SYMBOLS = ['₹', '$', '€', '£', 'AED', '¥'];

export default function QuotationStep3Pricing({
  formData, setFormData,
  salesPersonsList,
  selectedPackage,
  company,
  // product lines
  showAddProduct, setShowAddProduct,
  newProduct, setNewProduct,
  updateLine, handleAddCustomProduct, handleRemoveLine,
  // totals
  calcTotals,
  // navigation / submit
  setStep, handleSubmit,
}) {
  const totals = calcTotals();

  return (
    <div className="px-4 sm:px-0 space-y-5">

      {/* Customer Details */}
      <div className={`${card} p-4`}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            {company.logo_url && (
              <img src={company.logo_url} alt="Logo" className="h-8 object-contain" />
            )}
            <div>
              <p className={`font-bold text-sm ${tPri}`}>{company.company_name || 'SmartShapes'}</p>
              {company.gst_number && <p className={`text-[10px] ${tMut}`}>GST: {company.gst_number}</p>}
            </div>
          </div>
          {selectedPackage && (
            <span className="text-[10px] px-2 py-1 rounded-lg bg-[#e94560]/10 text-[#e94560] font-medium">
              {selectedPackage.display_name}
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <Label className={`text-xs ${tMut} mb-1`}>Principal / Contact Name *</Label>
            <Input
              value={formData.principal_name}
              onChange={e => setFormData(p => ({ ...p, principal_name: e.target.value }))}
              className={`h-11 ${inputCls}`}
              data-testid="principal-name-input"
              placeholder="Full name"
            />
          </div>
          <div>
            <Label className={`text-xs ${tMut} mb-1`}>School / Organization *</Label>
            <Input
              value={formData.school_name}
              onChange={e => setFormData(p => ({ ...p, school_name: e.target.value }))}
              className={`h-11 ${inputCls}`}
              data-testid="school-name-input"
              placeholder="School or company name"
            />
          </div>
          <div className="sm:col-span-2">
            <Label className={`text-xs ${tMut} mb-1`}>Street Address</Label>
            <Input
              value={formData.address}
              onChange={e => setFormData(p => ({ ...p, address: e.target.value }))}
              className={`h-11 ${inputCls}`}
              placeholder="Street / locality"
            />
          </div>
          <div>
            <Label className={`text-xs ${tMut} mb-1`}>City</Label>
            <Input
              value={formData.city}
              onChange={e => setFormData(p => ({ ...p, city: e.target.value }))}
              className={`h-11 ${inputCls}`}
              placeholder="City"
            />
          </div>
          <div>
            <Label className={`text-xs ${tMut} mb-1`}>State</Label>
            <Input
              value={formData.state}
              onChange={e => setFormData(p => ({ ...p, state: e.target.value }))}
              className={`h-11 ${inputCls}`}
              placeholder="State"
            />
          </div>
          <div>
            <Label className={`text-xs ${tMut} mb-1`}>PIN Code</Label>
            <Input
              value={formData.pincode}
              onChange={e => setFormData(p => ({ ...p, pincode: e.target.value }))}
              className={`h-11 ${inputCls}`}
              placeholder="PIN Code"
              maxLength={6}
            />
          </div>
          <div>
            <Label className={`text-xs ${tMut} mb-1`}>Phone</Label>
            <Input
              value={formData.customer_phone}
              onChange={e => setFormData(p => ({ ...p, customer_phone: e.target.value }))}
              className={`h-11 ${inputCls}`}
              type="tel"
            />
          </div>
          <div>
            <Label className={`text-xs ${tMut} mb-1`}>Email</Label>
            <Input
              value={formData.customer_email}
              onChange={e => setFormData(p => ({ ...p, customer_email: e.target.value }))}
              className={`h-11 ${inputCls}`}
              type="email"
            />
          </div>
          <div>
            <Label className={`text-xs ${tMut} mb-1`}>
              GST Number (Optional)
              <FieldTooltip text="Customer's 15-digit GSTIN. Printed on the invoice for B2B transactions and required for GST input credit claims." />
            </Label>
            <Input
              value={formData.customer_gst}
              onChange={e => setFormData(p => ({ ...p, customer_gst: e.target.value }))}
              className={`h-11 ${inputCls}`}
            />
          </div>
          <div>
            <Label className={`text-xs ${tMut} mb-1`}>Assign Sales Person *</Label>
            <select
              value={formData.sales_person_id}
              onChange={e => setFormData(p => ({ ...p, sales_person_id: e.target.value }))}
              className={`w-full h-11 px-3 border rounded-md text-sm ${inputCls}`}
              data-testid="sales-person-select"
            >
              <option value="">Select sales person</option>
              {salesPersonsList.map(sp => (
                <option key={sp.sales_person_id} value={sp.sales_person_id}>{sp.name}</option>
              ))}
            </select>
          </div>
          <div>
            <Label className={`text-xs ${tMut} mb-1`}>Quotation Valid Until</Label>
            <Input
              value={formData.valid_until}
              onChange={e => setFormData(p => ({ ...p, valid_until: e.target.value }))}
              className={`h-11 ${inputCls}`}
              type="date"
            />
          </div>
        </div>

        {/* School portal login methods (per-quote override of the global defaults) */}
        <div className="mt-4 rounded-md border border-[var(--border-color)] p-3">
          <Label className={`text-xs ${tMut}`}>School portal login (for this customer)</Label>
          <div className="flex flex-wrap gap-4 mt-2">
            {[['email_link', 'Email link + password'], ['magic_link', 'Magic link'], ['google', 'Sign in with Google']].map(([k, label]) => (
              <label key={k} className={`flex items-center gap-2 text-sm ${tPri} cursor-pointer`}>
                <input
                  type="checkbox"
                  checked={!!(formData.portal_login_methods || {})[k]}
                  onChange={e => setFormData(p => ({
                    ...p,
                    portal_login_methods: { ...(p.portal_login_methods || {}), [k]: e.target.checked },
                  }))}
                  className="w-4 h-4 rounded border-[var(--border-color)] bg-[var(--bg-primary)]"
                />
                {label}
              </label>
            ))}
          </div>
        </div>
      </div>

      {/* Product Lines */}
      <div className={`${card} p-4`}>
        <div className="flex items-center justify-between mb-3">
          <h3 className={`font-semibold text-sm ${tPri}`}>Product Lines</h3>
          <Button
            onClick={() => setShowAddProduct(true)}
            variant="outline"
            size="sm"
            className="h-9 border-[#e94560] text-[#e94560] hover:bg-[#e94560]/10"
            data-testid="add-product-button"
          >
            <Plus className="mr-1 h-3.5 w-3.5" /> Add Item
          </Button>
        </div>

        {/* Add product form */}
        {showAddProduct && (
          <div className="bg-[var(--bg-primary)] border border-[#e94560]/30 rounded-xl p-4 space-y-3 mb-4">
            <p className={`text-xs font-semibold ${tSec} uppercase tracking-wide`}>New Item</p>
            <div>
              <Label className={`text-xs ${tMut} mb-1`}>Product Name *</Label>
              <Input
                value={newProduct.description}
                onChange={e => setNewProduct(p => ({ ...p, description: e.target.value }))}
                placeholder="e.g. SmartShape Basic Kit"
                className={`h-11 ${inputCls}`}
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label className={`text-xs ${tMut} mb-1`}>Qty</Label>
                <Input
                  type="number"
                  value={newProduct.qty}
                  onChange={e => setNewProduct(p => ({ ...p, qty: parseInt(e.target.value) || 1 }))}
                  className={`h-11 text-center ${inputCls}`}
                  min="1"
                />
              </div>
              <div>
                <Label className={`text-xs ${tMut} mb-1`}>Unit Price</Label>
                <Input
                  type="number"
                  value={newProduct.unit_price}
                  onChange={e => setNewProduct(p => ({ ...p, unit_price: parseFloat(e.target.value) || 0 }))}
                  className={`h-11 ${inputCls}`}
                />
              </div>
              <div>
                <Label className={`text-xs ${tMut} mb-1`}>GST %</Label>
                <Input
                  type="number"
                  value={newProduct.gst_pct}
                  onChange={e => setNewProduct(p => ({ ...p, gst_pct: parseFloat(e.target.value) || 0 }))}
                  className={`h-11 text-center ${inputCls}`}
                  min="0" max="28"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                onClick={handleAddCustomProduct}
                className="flex-1 h-11 bg-[#e94560] hover:bg-[#f05c75] text-white font-semibold"
              >
                Add Item
              </Button>
              <Button
                variant="outline"
                onClick={() => setShowAddProduct(false)}
                className={`border-[var(--border-color)] ${tSec} h-11`}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        {/* Mobile: stacked cards */}
        <div className="sm:hidden space-y-3">
          {formData.lines.map((line, idx) => (
            <div key={idx} className="bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-xl p-3">
              <div className="flex items-start gap-2 mb-3">
                <Input
                  value={line.description}
                  onChange={e => updateLine(idx, 'description', e.target.value)}
                  className={`flex-1 h-10 text-sm font-medium ${inputCls}`}
                  placeholder="Item description"
                />
                <button onClick={() => handleRemoveLine(idx)} className="text-red-400 mt-1 flex-shrink-0">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <p className={`text-[10px] ${tMut} mb-1`}>Qty</p>
                  <Input type="number" value={line.qty} onChange={e => updateLine(idx, 'qty', e.target.value)} className={`h-10 text-sm text-center ${inputCls}`} />
                </div>
                <div>
                  <p className={`text-[10px] ${tMut} mb-1`}>Rate</p>
                  <Input type="number" value={line.unit_price} onChange={e => updateLine(idx, 'unit_price', e.target.value)} className={`h-10 text-sm ${inputCls}`} />
                </div>
              </div>
              <div className="flex justify-between items-center mt-2.5 pt-2.5 border-t border-[var(--border-color)]">
                <span className={`text-xs ${tMut}`}>Amount (excl. GST)</span>
                <span className={`font-mono font-semibold text-sm ${tPri}`}>{formatCurrency(line.line_subtotal)}</span>
              </div>
            </div>
          ))}
          {formData.lines.length === 0 && (
            <div className={`${card} p-8 text-center`}>
              <p className={`text-sm ${tMut}`}>No items added — tap "Add Item" above</p>
            </div>
          )}
        </div>

        {/* Desktop: table */}
        <div className="hidden sm:block border border-[var(--border-color)] rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[#1a1a2e] text-white">
                <th className="text-left text-xs py-2.5 px-3 font-semibold uppercase tracking-wide">Item</th>
                <th className="text-center text-xs py-2.5 px-3 font-semibold uppercase tracking-wide w-16">Qty</th>
                <th className="text-right text-xs py-2.5 px-3 font-semibold uppercase tracking-wide w-28">Rate</th>
                <th className="text-right text-xs py-2.5 px-3 font-semibold uppercase tracking-wide w-28">Amount</th>
                <th className="w-8"></th>
              </tr>
            </thead>
            <tbody>
              {formData.lines.map((line, idx) => (
                <tr
                  key={idx}
                  className={`border-t border-[var(--border-color)] ${idx % 2 === 1 ? 'bg-[var(--bg-primary)]' : ''} hover:bg-[var(--bg-hover)]`}
                >
                  <td className="py-2 px-3">
                    <Input value={line.description} onChange={e => updateLine(idx, 'description', e.target.value)} className="bg-transparent border-none h-8 p-0 text-sm text-[var(--text-primary)]" />
                  </td>
                  <td className="py-2 px-3 text-center">
                    <Input type="number" value={line.qty} onChange={e => updateLine(idx, 'qty', e.target.value)} className="bg-transparent border-none h-8 p-0 text-sm text-center text-[var(--text-primary)] w-14 mx-auto" />
                  </td>
                  <td className="py-2 px-3 text-right">
                    <Input type="number" value={line.unit_price} onChange={e => updateLine(idx, 'unit_price', e.target.value)} className="bg-transparent border-none h-8 p-0 text-sm text-right text-[var(--text-primary)] w-24 ml-auto" />
                  </td>
                  <td className={`py-2 px-3 text-right font-mono text-sm font-semibold ${tPri}`}>{formatCurrency(line.line_subtotal)}</td>
                  <td className="py-2 px-1">
                    <button onClick={() => handleRemoveLine(idx)} className="text-red-400 hover:text-red-300">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
              {formData.lines.length === 0 && (
                <tr>
                  <td colSpan={5} className={`py-10 text-center text-sm ${tMut}`}>
                    No items added — click "Add Item" above
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Discounts & Freight */}
      <div className={`${card} p-4 space-y-3`}>
        <h3 className={`font-semibold text-sm ${tPri}`}>Discounts & Freight</h3>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className={`text-xs ${tMut} mb-1`}>Primary Discount (%)</Label>
            <Input
              type="number"
              value={formData.discount1_pct}
              onChange={e => setFormData(p => ({ ...p, discount1_pct: parseFloat(e.target.value) || 0 }))}
              className={`h-11 ${inputCls}`}
              data-testid="discount1-input"
              min="0" max="100"
            />
          </div>
          <div>
            <Label className={`text-xs ${tMut} mb-1`}>Additional Discount (%)</Label>
            <Input
              type="number"
              value={formData.discount2_pct}
              onChange={e => setFormData(p => ({ ...p, discount2_pct: parseFloat(e.target.value) || 0 }))}
              className={`h-11 ${inputCls}`}
              data-testid="discount2-input"
              min="0" max="100"
            />
          </div>
        </div>
        <div>
          <Label className={`text-xs ${tMut} mb-1`}>Freight & Packing (base amount, excl. GST)</Label>
          <Input
            type="number"
            value={formData.freight_amount}
            onChange={e => setFormData(p => ({ ...p, freight_amount: parseFloat(e.target.value) || 0 }))}
            className={`h-11 ${inputCls}`}
            data-testid="freight-input"
            min="0"
          />
          <p className={`text-[10px] ${tMut} mt-1`}>Freight added in Sub Total. GST @ 18% on freight calculated separately.</p>
        </div>
        <div>
          <Label className={`text-xs ${tMut} mb-1`}>Currency Symbol</Label>
          <div className="flex gap-2 flex-wrap">
            {CURRENCY_SYMBOLS.map(sym => (
              <button
                key={sym}
                type="button"
                onClick={() => setFormData(p => ({ ...p, currency_symbol: sym }))}
                className={`px-3 py-2 rounded-lg text-sm font-medium border transition-all ${
                  formData.currency_symbol === sym
                    ? 'bg-[#e94560] text-white border-[#e94560]'
                    : `bg-[var(--bg-primary)] border-[var(--border-color)] ${tSec} hover:border-[#e94560]/40`
                }`}
              >
                {sym}
              </button>
            ))}
            <Input
              value={CURRENCY_SYMBOLS.includes(formData.currency_symbol) ? '' : formData.currency_symbol}
              onChange={e => setFormData(p => ({ ...p, currency_symbol: e.target.value || '₹' }))}
              placeholder="Other"
              className={`h-10 w-20 text-sm text-center ${inputCls}`}
            />
          </div>
        </div>
      </div>

      {/* Price Summary */}
      <div className={`${card} p-4`} data-testid="price-summary">
        <h3 className={`font-semibold text-sm ${tPri} mb-4`}>Price Summary</h3>
        {(() => {
          const sym = formData.currency_symbol || '₹';
          const fmt = (n) => `${sym} ${(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
          return (
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className={`text-sm ${tSec}`}>Item Total</span>
                <span className={`font-mono text-sm font-semibold ${tPri}`}>{fmt(totals.items_total)}</span>
              </div>
              {formData.discount1_pct > 0 && (
                <div className="flex justify-between items-center">
                  <span className="text-sm text-green-400">Discount @ {formData.discount1_pct}%</span>
                  <span className="font-mono text-sm text-green-400">− {fmt(totals.disc1_amount)}</span>
                </div>
              )}
              {formData.discount2_pct > 0 && (
                <div className="flex justify-between items-center">
                  <span className="text-sm text-green-400">Additional Discount @ {formData.discount2_pct}%</span>
                  <span className="font-mono text-sm text-green-400">− {fmt(totals.disc2_amount)}</span>
                </div>
              )}
              {totals.freight_base > 0 && (
                <div className="flex justify-between items-center">
                  <span className={`text-sm ${tSec}`}>Freight</span>
                  <span className={`font-mono text-sm ${tSec}`}>+ {fmt(totals.freight_base)}</span>
                </div>
              )}
              <div className="flex justify-between items-center py-2 border-t border-b border-[var(--border-color)]">
                <span className={`text-sm font-semibold ${tPri}`}>Sub Total</span>
                <span className={`font-mono text-sm font-semibold ${tPri}`}>{fmt(totals.sub_total)}</span>
              </div>
              {(totals.gst_breakup && totals.gst_breakup.length > 0
                ? totals.gst_breakup
                : [{ rate: 18, amount: totals.total_gst }]
              ).map((slab, i) => (
                <div key={i} className="flex justify-between items-center">
                  <span className={`text-sm ${tSec}`}>GST @ {Number.isInteger(slab.rate) ? slab.rate : slab.rate}%</span>
                  <span className={`font-mono text-sm ${tSec}`}>{fmt(slab.amount)}</span>
                </div>
              ))}
              {Math.abs(Math.round(totals.grand_total) - totals.grand_total) >= 0.005 && (
                <div className="flex justify-between items-center">
                  <span className={`text-sm ${tSec}`}>Round Off</span>
                  <span className={`font-mono text-sm ${tSec}`}>
                    {Math.round(totals.grand_total) - totals.grand_total >= 0 ? '+ ' : '− '}
                    {fmt(Math.abs(Math.round(totals.grand_total) - totals.grand_total))}
                  </span>
                </div>
              )}
              <div className="flex justify-between items-center bg-[#1a1a2e] rounded-xl p-4 mt-2">
                <span className="text-white font-bold text-base">Total Payable</span>
                <span className="font-mono text-xl font-bold text-[#e94560]">{`${sym} ${Math.round(totals.grand_total).toLocaleString('en-IN')}`}</span>
              </div>
            </div>
          );
        })()}
      </div>

      {/* PDF Font Size */}
      <div className={`${card} p-4 flex items-center gap-3`}>
        <span className={`text-xs ${tSec} whitespace-nowrap`}>PDF Font Size</span>
        <div className="flex gap-1.5" data-testid="font-size-selector">
          {['small', 'medium', 'large'].map(f => (
            <button
              key={f}
              type="button"
              onClick={() => setFormData(p => ({ ...p, font_size_mode: f }))}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all capitalize ${
                formData.font_size_mode === f
                  ? 'bg-[#e94560] text-white'
                  : `bg-[var(--bg-primary)] border border-[var(--border-color)] ${tSec} hover:border-[#e94560]/40`
              }`}
              data-testid={`font-${f}`}
            >
              {f}
            </button>
          ))}
        </div>
        <span className={`text-[10px] ${tMut}`}>Affects PDF typography</span>
      </div>

      {/* Bank Details + T&C */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className={`${card} p-4 space-y-2`}>
          <div className="flex items-center justify-between">
            <h3 className={`text-sm font-semibold ${tPri}`}>Bank Details</h3>
            {company.bank_details && (
              <button
                type="button"
                onClick={() => setFormData(p => ({ ...p, bank_details_override: company.bank_details }))}
                className="text-[10px] text-[#e94560] hover:underline"
                data-testid="reset-bank-default-btn"
              >
                Reset to Default
              </button>
            )}
          </div>
          <textarea
            rows={4}
            value={formData.bank_details_override}
            onChange={e => setFormData(p => ({ ...p, bank_details_override: e.target.value }))}
            placeholder="Bank Name | A/c Name | A/c No | IFSC | Branch"
            className={`w-full px-3 py-2 border rounded-lg text-sm font-mono ${inputCls}`}
            data-testid="quotation-bank-details-input"
          />
          <p className={`text-[10px] ${tMut}`}>Pre-filled from Company Master. Override per-quote.</p>
        </div>
        <div className={`${card} p-4 space-y-2`}>
          <div className="flex items-center justify-between">
            <h3 className={`text-sm font-semibold ${tPri}`}>Terms & Conditions</h3>
            {company.terms_conditions && (
              <button
                type="button"
                onClick={() => setFormData(p => ({ ...p, terms_override: company.terms_conditions }))}
                className="text-[10px] text-[#e94560] hover:underline"
                data-testid="reset-terms-default-btn"
              >
                Reset to Default
              </button>
            )}
          </div>
          <textarea
            rows={6}
            value={formData.terms_override}
            onChange={e => setFormData(p => ({ ...p, terms_override: e.target.value }))}
            placeholder={'One per line:\nPrices are valid for 30 days...\nGST @18% applicable...'}
            className={`w-full px-3 py-2 border rounded-lg text-sm ${inputCls}`}
            data-testid="quotation-terms-input"
          />
          <p className={`text-[10px] ${tMut}`}>Each line becomes a numbered clause in the PDF.</p>
        </div>
      </div>

      {/* Navigation */}
      <div className="flex gap-3 pb-4">
        <Button
          onClick={() => setStep(2)}
          variant="outline"
          className={`border-[var(--border-color)] ${tSec} h-12`}
        >
          <ArrowLeft className="mr-2 h-4 w-4" /> Back
        </Button>
        <Button
          onClick={handleSubmit}
          disabled={!formData.principal_name || !formData.school_name}
          className="flex-1 h-12 bg-[#e94560] hover:bg-[#f05c75] text-white font-semibold text-base"
          data-testid="create-quotation-submit"
        >
          Create Quotation <Check className="ml-2 h-5 w-5" />
        </Button>
      </div>
    </div>
  );
}

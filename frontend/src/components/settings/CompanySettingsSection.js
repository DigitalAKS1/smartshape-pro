import React, { useRef } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { FieldTooltip } from '../ui/Tooltip';
import { Save, Image, X } from 'lucide-react';

const backendUrl = process.env.REACT_APP_BACKEND_URL;

export default function CompanySettingsSection({ company, setCompany, saving, logoUploading, saveCompany, handleLogoUpload, logoRef }) {
  const internalLogoRef = useRef(null);
  const ref = logoRef || internalLogoRef;

  const card      = 'bg-[var(--bg-card)] border-[var(--border-color)]';
  const inputCls  = 'bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]';
  const textSec   = 'text-[var(--text-secondary)]';
  const textMuted = 'text-[var(--text-muted)]';
  const textPri   = 'text-[var(--text-primary)]';

  return (
    <div className={`${card} border rounded-md p-5 space-y-6`} data-testid="company-settings">
      <h2 className={`text-xl font-semibold ${textPri}`}>Company Master</h2>

      {/* Logo Upload */}
      <div className="flex flex-col sm:flex-row items-start gap-6">
        <div className="flex flex-col items-center gap-2">
          <div
            className="w-32 h-32 rounded-lg border-2 border-dashed border-[var(--border-color)] flex items-center justify-center overflow-hidden cursor-pointer hover:border-[#e94560]/50 transition-colors bg-[var(--bg-primary)]"
            onClick={() => ref.current?.click()}
            data-testid="logo-upload-area"
          >
            {logoUploading ? (
              <div className="animate-spin rounded-full h-8 w-8 border-4 border-[#e94560] border-t-transparent" />
            ) : company.logo_url ? (
              <img src={`${backendUrl}${company.logo_url}`} alt="Logo" className="w-full h-full object-contain p-2" />
            ) : (
              <div className="text-center">
                <Image className={`h-8 w-8 mx-auto mb-1 ${textMuted}`} />
                <p className={`text-xs ${textMuted}`}>Upload Logo</p>
              </div>
            )}
          </div>
          <input
            ref={ref}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={e => { if (e.target.files?.[0]) handleLogoUpload(e.target.files[0]); e.target.value = ''; }}
          />
          {company.logo_url && (
            <Button variant="ghost" size="sm" onClick={() => setCompany({ ...company, logo_url: '' })} className="text-red-400 text-xs h-6">
              <X className="mr-1 h-3 w-3" /> Remove
            </Button>
          )}
        </div>
        <div className="flex-1 space-y-1">
          <h3 className={`text-sm font-medium ${textPri}`}>Company Logo</h3>
          <p className={`text-xs ${textMuted}`}>Upload your company logo. It will appear on quotations, dispatch slips, and PDF documents. Recommended: PNG or SVG, max 5MB.</p>
        </div>
      </div>

      {/* Company Details */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="sm:col-span-2">
          <Label className={`${textSec} text-xs`}>Company Name *</Label>
          <Input value={company.company_name} onChange={e => setCompany({...company, company_name: e.target.value})} className={inputCls} placeholder="SmartShape Pro Pvt Ltd" data-testid="company-name-input" />
        </div>
        <div>
          <Label className={`${textSec} text-xs`}>Email</Label>
          <Input type="email" value={company.email} onChange={e => setCompany({...company, email: e.target.value})} className={inputCls} placeholder="info@company.com" />
        </div>
        <div>
          <Label className={`${textSec} text-xs`}>Phone</Label>
          <Input value={company.phone} onChange={e => setCompany({...company, phone: e.target.value})} className={inputCls} placeholder="+91 98765 43210" />
        </div>
        <div>
          <Label className={`${textSec} text-xs`}>Website</Label>
          <Input value={company.website} onChange={e => setCompany({...company, website: e.target.value})} className={inputCls} placeholder="https://www.company.com" />
        </div>
        <div>
          <Label className={`${textSec} text-xs`}>Contact Person</Label>
          <Input value={company.contact_person} onChange={e => setCompany({...company, contact_person: e.target.value})} className={inputCls} placeholder="MD / Director name" />
        </div>
        <div>
          <Label className={`${textSec} text-xs`}>Industry</Label>
          <Input value={company.industry} onChange={e => setCompany({...company, industry: e.target.value})} className={inputCls} placeholder="Manufacturing / Education" />
        </div>
        <div>
          <Label className={`${textSec} text-xs`}>
            GST Number
            <FieldTooltip text="15-digit Goods & Services Tax Identification Number (GSTIN) issued by the government. Format: 2-digit state code + 10-digit PAN + 3 chars." />
          </Label>
          <Input value={company.gst_number} onChange={e => setCompany({...company, gst_number: e.target.value})} className={`${inputCls} font-mono`} placeholder="27AAAAA0000A1Z5" maxLength={15} />
        </div>
        <div>
          <Label className={`${textSec} text-xs`}>
            PAN
            <FieldTooltip text="Permanent Account Number — 10-character alphanumeric ID issued by the Income Tax Department. Required for GST registration." />
          </Label>
          <Input value={company.pan} onChange={e => setCompany({...company, pan: e.target.value})} className={`${inputCls} font-mono`} placeholder="AAAAA0000A" maxLength={10} />
        </div>
      </div>

      {/* Address */}
      <div>
        <Label className={`${textSec} text-xs`}>Address</Label>
        <Input value={company.address} onChange={e => setCompany({...company, address: e.target.value})} className={inputCls} placeholder="Full business address..." />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <Label className={`${textSec} text-xs`}>City</Label>
          <Input value={company.city} onChange={e => setCompany({...company, city: e.target.value})} className={inputCls} placeholder="Mumbai" />
        </div>
        <div>
          <Label className={`${textSec} text-xs`}>State</Label>
          <Input value={company.state} onChange={e => setCompany({...company, state: e.target.value})} className={inputCls} placeholder="Maharashtra" />
        </div>
        <div>
          <Label className={`${textSec} text-xs`}>
            Pincode
            <FieldTooltip text="6-digit India Post postal code identifying your business location. Used on invoices and for GST jurisdiction." />
          </Label>
          <Input value={company.pincode} onChange={e => setCompany({...company, pincode: e.target.value})} className={`${inputCls} font-mono`} placeholder="400001" maxLength={6} />
        </div>
      </div>

      {/* Bank Details */}
      <div className="space-y-1 pt-2 border-t border-[var(--border-color)]">
        <Label className={`${textSec} text-xs`}>Bank Details (appears on Quotation PDF)</Label>
        <textarea
          value={company.bank_details || ''}
          onChange={e => setCompany({ ...company, bank_details: e.target.value })}
          rows={3}
          className={`w-full px-3 py-2 rounded-md text-sm ${inputCls}`}
          placeholder={'Bank: HDFC Bank | A/c Name: SmartShape Pro Pvt Ltd\nA/c No: 50200012345678 | IFSC: HDFC0001234\nBranch: Faridabad'}
          data-testid="company-bank-details-input"
        />
      </div>

      {/* Terms & Conditions */}
      <div className="space-y-1">
        <Label className={`${textSec} text-xs`}>Default Terms &amp; Conditions (one per line, used in Quotation PDF)</Label>
        <textarea
          value={company.terms_conditions || ''}
          onChange={e => setCompany({ ...company, terms_conditions: e.target.value })}
          rows={6}
          className={`w-full px-3 py-2 rounded-md text-sm ${inputCls}`}
          placeholder={'Prices are valid for 30 days from the date of quotation.\nGST @18% applicable as per government norms.\nPayment: 50% advance, balance before dispatch.\nDelivery within 15-20 working days from order confirmation.'}
          data-testid="company-terms-input"
        />
        <p className={`text-[10px] ${textMuted}`}>Each line becomes a numbered clause on the PDF.</p>
      </div>

      <Button onClick={saveCompany} disabled={saving} className="bg-[#e94560] hover:bg-[#f05c75] text-white" data-testid="save-company-btn">
        <Save className="mr-1.5 h-4 w-4" /> {saving ? 'Saving...' : 'Save Company Profile'}
      </Button>
    </div>
  );
}

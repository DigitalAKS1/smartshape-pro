import React, { useState, useEffect } from 'react';
import AdminLayout from '../../components/layouts/AdminLayout';
import { packages, salesPersons, quotations, companySettings, contacts as contactsApi } from '../../lib/api';
import { formatCurrency } from '../../lib/utils';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { ArrowRight, ArrowLeft, Check, Plus, X, Search, UserPlus, CheckCircle2, User } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

const STEP_LABELS = ['Contact', 'Package', 'Pricing'];

// CSS shortcuts
const card   = 'bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl';
const inputCls = 'bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]';
const tPri  = 'text-[var(--text-primary)]';
const tSec  = 'text-[var(--text-secondary)]';
const tMut  = 'text-[var(--text-muted)]';

export default function CreateQuotation() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [packagesList, setPackagesList]   = useState([]);
  const [salesPersonsList, setSalesPersonsList] = useState([]);
  const [contactsList, setContactsList]   = useState([]);
  const [company, setCompany]             = useState({});

  // Step 1 — Contact
  const [contactQuery, setContactQuery]   = useState('');
  const [selectedContact, setSelectedContact] = useState(null);
  const [showNewContact, setShowNewContact] = useState(false);
  const [savingContact, setSavingContact] = useState(false);
  const [newContactData, setNewContactData] = useState({ name: '', phone: '', email: '', company: '', designation: '' });

  // Step 3 — Add product
  const [showAddProduct, setShowAddProduct] = useState(false);
  const [newProduct, setNewProduct] = useState({ description: '', product_type: 'custom', qty: 1, unit_price: 0, gst_pct: 18 });

  const [formData, setFormData] = useState({
    package_id: '', principal_name: '', school_name: '', address: '',
    customer_email: '', customer_phone: '', customer_gst: '',
    sales_person_id: '', discount1_pct: 0, discount2_pct: 0,
    freight_amount: 0, lines: [],
    bank_details_override: '', terms_override: '',
    font_size_mode: 'medium',
    currency_symbol: '₹',
  });
  const [selectedPackage, setSelectedPackage] = useState(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [pkgsRes, spRes, compRes, ctRes] = await Promise.all([
          packages.getAll(), salesPersons.getAll(), companySettings.get(), contactsApi.getAll(),
        ]);
        setPackagesList(pkgsRes.data || []);
        setSalesPersonsList(spRes.data || []);
        setContactsList(ctRes.data || []);
        const comp = compRes.data || {};
        setCompany(comp);
        setFormData(prev => ({
          ...prev,
          bank_details_override: prev.bank_details_override || comp.bank_details || '',
          terms_override: prev.terms_override || comp.terms_conditions || '',
        }));
      } catch {
        toast.error('Failed to load data');
      }
    };
    fetchData();
  }, []);

  // ── Contact helpers ──────────────────────────────────────────────────────────
  const filteredContacts = contactQuery.trim()
    ? contactsList.filter(c =>
        c.name?.toLowerCase().includes(contactQuery.toLowerCase()) ||
        c.phone?.includes(contactQuery) ||
        c.company?.toLowerCase().includes(contactQuery.toLowerCase()) ||
        c.email?.toLowerCase().includes(contactQuery.toLowerCase())
      )
    : contactsList.slice(0, 12);

  const selectContact = (contact) => {
    setSelectedContact(contact);
    setFormData(prev => ({
      ...prev,
      principal_name: contact.name || prev.principal_name,
      school_name:    contact.company || prev.school_name,
      customer_phone: contact.phone || prev.customer_phone,
      customer_email: contact.email || prev.customer_email,
    }));
    setShowNewContact(false);
  };

  const handleCreateContact = async () => {
    if (!newContactData.name || !newContactData.phone) {
      toast.error('Name and phone are required');
      return;
    }
    setSavingContact(true);
    try {
      const res = await contactsApi.create(newContactData);
      const created = res.data;
      setContactsList(prev => [created, ...prev]);
      selectContact(created);
      setNewContactData({ name: '', phone: '', email: '', company: '', designation: '' });
      setShowNewContact(false);
      toast.success('Contact created & selected');
    } catch {
      toast.error('Failed to create contact');
    } finally {
      setSavingContact(false);
    }
  };

  // ── Package helpers ──────────────────────────────────────────────────────────
  const handlePackageSelect = (pkg) => {
    setSelectedPackage(pkg);
    const items = pkg.items || [];
    const lines = items.map((item, idx) => ({
      description: `${item.name} (${item.qty} units)`,
      product_type: item.type,
      qty: item.qty,
      unit_price: item.unit_price,
      gst_pct: item.gst_pct || 18,
      line_subtotal: item.qty * item.unit_price,
      line_gst: item.qty * item.unit_price * (item.gst_pct || 18) / 100,
      line_total: item.qty * item.unit_price * (1 + (item.gst_pct || 18) / 100),
      sort_order: idx + 1,
    }));
    setFormData(prev => ({ ...prev, package_id: pkg.package_id, lines }));
  };

  // ── Line helpers ─────────────────────────────────────────────────────────────
  const recalcLine = (line) => {
    const sub = line.qty * line.unit_price;
    const gst = sub * (line.gst_pct / 100);
    return { ...line, line_subtotal: sub, line_gst: gst, line_total: sub + gst };
  };

  const updateLine = (idx, field, value) => {
    const lines = [...formData.lines];
    lines[idx] = { ...lines[idx], [field]: field === 'description' || field === 'product_type' ? value : parseFloat(value) || 0 };
    lines[idx] = recalcLine(lines[idx]);
    setFormData(prev => ({ ...prev, lines }));
  };

  const handleAddCustomProduct = () => {
    if (!newProduct.description) { toast.error('Product name required'); return; }
    const line = recalcLine({ ...newProduct, line_subtotal: 0, line_gst: 0, line_total: 0, sort_order: formData.lines.length + 1 });
    setFormData(prev => ({ ...prev, lines: [...prev.lines, line] }));
    setNewProduct({ description: '', product_type: 'custom', qty: 1, unit_price: 0, gst_pct: 18 });
    setShowAddProduct(false);
    toast.success('Item added');
  };

  const handleRemoveLine = (idx) => {
    setFormData(prev => ({ ...prev, lines: prev.lines.filter((_, i) => i !== idx) }));
  };

  // ── Totals (new formula: freight in sub-total, per-line GST, combined GST line) ─
  const calcTotals = () => {
    const lines        = formData.lines || [];
    const items_total  = lines.reduce((s, l) => s + (l.line_subtotal || 0), 0);
    const disc1_amount = items_total * ((formData.discount1_pct || 0) / 100);
    const after_d1     = items_total - disc1_amount;
    const disc2_amount = after_d1 * ((formData.discount2_pct || 0) / 100);
    const after_disc   = after_d1 - disc2_amount;
    const freight_base = Number(formData.freight_amount) || 0;
    const sub_total    = after_disc + freight_base;

    const discount_factor  = items_total > 0 ? after_disc / items_total : 1;
    const raw_items_gst    = lines.reduce((s, l) => s + (l.line_subtotal || 0) * ((l.gst_pct || 18) / 100), 0);
    const items_gst        = raw_items_gst * discount_factor;
    const freight_gst      = freight_base * 0.18;
    const total_gst        = items_gst + freight_gst;
    const grand_total      = sub_total + total_gst;

    return { items_total, disc1_amount, disc2_amount, after_disc, freight_base, sub_total, items_gst, freight_gst, total_gst, grand_total };
  };

  const handleSubmit = async () => {
    if (!formData.principal_name || !formData.school_name) {
      toast.error('Principal name and school name are required');
      return;
    }
    try {
      await quotations.create(formData);
      toast.success('Quotation created successfully!');
      navigate('/quotations');
    } catch {
      toast.error('Failed to create quotation');
    }
  };

  const totals = calcTotals();

  return (
    <AdminLayout>
      <div className="max-w-3xl mx-auto pb-8">

        {/* Header */}
        <div className="flex items-center gap-3 px-4 sm:px-0 py-4 sm:py-0 sm:mb-6">
          {company.logo_url && <img src={company.logo_url} alt="Logo" className="h-10 object-contain" />}
          <div>
            <h1 className={`text-2xl font-bold ${tPri}`} data-testid="create-quotation-title">Create Quotation</h1>
            <p className={`text-sm ${tSec}`}>Follow the steps to create a new quotation</p>
          </div>
        </div>

        {/* Step Progress */}
        <div className="flex items-center px-4 sm:px-0 mb-6">
          {STEP_LABELS.map((label, i) => (
            <React.Fragment key={i}>
              <div className="flex flex-col items-center">
                <div className={`w-9 h-9 rounded-full flex items-center justify-center font-semibold text-sm transition-all ${
                  step > i + 1 ? 'bg-[#10b981] text-white' :
                  step === i + 1 ? 'bg-[#e94560] text-white' :
                  'bg-[var(--bg-card)] border border-[var(--border-color)] ' + tMut
                }`}>
                  {step > i + 1 ? <Check className="h-4 w-4" /> : i + 1}
                </div>
                <span className={`text-[10px] mt-1 font-medium ${step === i + 1 ? tPri : tMut}`}>{label}</span>
              </div>
              {i < 2 && <div className={`flex-1 h-0.5 mx-1 mb-5 transition-all ${step > i + 1 ? 'bg-[#10b981]' : 'bg-[var(--border-color)]'}`} />}
            </React.Fragment>
          ))}
        </div>

        {/* ── Step 1: Contact ─────────────────────────────────────────────────── */}
        {step === 1 && (
          <div className="px-4 sm:px-0 space-y-4">
            <div>
              <h2 className={`text-lg font-semibold ${tPri} mb-0.5`}>Select Contact</h2>
              <p className={`text-sm ${tSec}`}>Choose an existing contact or create a new one</p>
            </div>

            {/* Search */}
            <div className="relative">
              <Search className={`absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 ${tMut}`} />
              <Input
                placeholder="Search by name, phone, or company..."
                value={contactQuery}
                onChange={e => setContactQuery(e.target.value)}
                className={`pl-10 h-12 text-base ${inputCls}`}
                autoFocus
              />
              {contactQuery && (
                <button onClick={() => setContactQuery('')} className={`absolute right-3 top-1/2 -translate-y-1/2 ${tMut}`}>
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            {/* Selected contact banner */}
            {selectedContact && (
              <div className="flex items-center gap-3 p-3 rounded-xl bg-[#10b981]/10 border border-[#10b981]/30">
                <CheckCircle2 className="h-5 w-5 text-[#10b981] flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className={`font-semibold text-sm ${tPri} truncate`}>{selectedContact.name}</p>
                  <p className={`text-xs ${tSec} truncate`}>
                    {[selectedContact.designation, selectedContact.company, selectedContact.phone].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <button onClick={() => setSelectedContact(null)} className={`${tMut} hover:text-red-400 flex-shrink-0`}>
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}

            {/* Contact list */}
            {!showNewContact && (
              <div className="space-y-2 max-h-[50vh] overflow-y-auto">
                {filteredContacts.map(contact => (
                  <button
                    key={contact.contact_id}
                    onClick={() => selectContact(contact)}
                    className={`w-full text-left p-3 rounded-xl border transition-all active:opacity-70 ${
                      selectedContact?.contact_id === contact.contact_id
                        ? 'border-[#10b981] bg-[#10b981]/5'
                        : `${card} hover:border-[#e94560]/40`
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-[#e94560]/15 flex items-center justify-center flex-shrink-0">
                        <User className="h-4 w-4 text-[#e94560]" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={`font-semibold text-sm ${tPri} truncate`}>{contact.name}</p>
                        <p className={`text-xs ${tMut} truncate`}>
                          {[contact.designation, contact.company].filter(Boolean).join(' · ')}
                        </p>
                        {contact.phone && <p className={`text-xs ${tSec} font-mono`}>{contact.phone}</p>}
                      </div>
                      {selectedContact?.contact_id === contact.contact_id && (
                        <CheckCircle2 className="h-5 w-5 text-[#10b981] flex-shrink-0" />
                      )}
                    </div>
                  </button>
                ))}
                {filteredContacts.length === 0 && contactQuery && (
                  <div className={`${card} p-6 text-center`}>
                    <User className={`h-10 w-10 ${tMut} mx-auto mb-2`} />
                    <p className={`text-sm ${tSec} mb-1`}>No contacts found for "{contactQuery}"</p>
                    <p className={`text-xs ${tMut}`}>Create a new contact below</p>
                  </div>
                )}
              </div>
            )}

            {/* New Contact */}
            {!showNewContact ? (
              <button
                onClick={() => setShowNewContact(true)}
                className={`w-full p-4 rounded-xl border-2 border-dashed border-[var(--border-color)] hover:border-[#e94560]/50 transition-colors flex items-center justify-center gap-2 ${tSec}`}
              >
                <UserPlus className="h-5 w-5" />
                <span className="font-medium">Create New Contact</span>
              </button>
            ) : (
              <div className={`${card} p-4 space-y-3`}>
                <div className="flex items-center justify-between">
                  <h3 className={`font-semibold text-sm ${tPri}`}>New Contact</h3>
                  <button onClick={() => setShowNewContact(false)} className={tMut}><X className="h-4 w-4" /></button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <Label className={`text-xs ${tSec} mb-1`}>Name *</Label>
                    <Input value={newContactData.name} onChange={e => setNewContactData(p => ({...p, name: e.target.value}))} placeholder="Full name" className={`h-11 ${inputCls}`} />
                  </div>
                  <div>
                    <Label className={`text-xs ${tSec} mb-1`}>Phone *</Label>
                    <Input value={newContactData.phone} onChange={e => setNewContactData(p => ({...p, phone: e.target.value}))} placeholder="Mobile number" className={`h-11 ${inputCls}`} type="tel" />
                  </div>
                  <div>
                    <Label className={`text-xs ${tSec} mb-1`}>Email</Label>
                    <Input value={newContactData.email} onChange={e => setNewContactData(p => ({...p, email: e.target.value}))} placeholder="Email address" className={`h-11 ${inputCls}`} type="email" />
                  </div>
                  <div>
                    <Label className={`text-xs ${tSec} mb-1`}>School / Company</Label>
                    <Input value={newContactData.company} onChange={e => setNewContactData(p => ({...p, company: e.target.value}))} placeholder="Organization name" className={`h-11 ${inputCls}`} />
                  </div>
                  <div className="sm:col-span-2">
                    <Label className={`text-xs ${tSec} mb-1`}>Designation</Label>
                    <Input value={newContactData.designation} onChange={e => setNewContactData(p => ({...p, designation: e.target.value}))} placeholder="e.g. Principal, Director" className={`h-11 ${inputCls}`} />
                  </div>
                </div>
                <div className="flex gap-2 pt-1">
                  <Button onClick={handleCreateContact} disabled={savingContact} className="flex-1 h-11 bg-[#e94560] hover:bg-[#f05c75] text-white font-semibold">
                    {savingContact ? 'Saving...' : 'Create & Use Contact'}
                  </Button>
                  <Button variant="outline" onClick={() => setShowNewContact(false)} className={`border-[var(--border-color)] ${tSec} h-11`}>Cancel</Button>
                </div>
              </div>
            )}

            {/* Next */}
            <div className="pt-2">
              <Button onClick={() => setStep(2)} className="w-full h-12 bg-[#e94560] hover:bg-[#f05c75] text-white font-semibold text-base" data-testid="step1-next-button">
                {selectedContact ? `Continue with ${selectedContact.name}` : 'Skip & Enter Manually'}
                <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
              {!selectedContact && (
                <p className={`text-center text-xs ${tMut} mt-2`}>You can enter customer details manually in the pricing step</p>
              )}
            </div>
          </div>
        )}

        {/* ── Step 2: Package ─────────────────────────────────────────────────── */}
        {step === 2 && (
          <div className="px-4 sm:px-0 space-y-4">
            <div>
              <h2 className={`text-lg font-semibold ${tPri} mb-0.5`}>Select Package</h2>
              {selectedContact
                ? <p className={`text-sm ${tSec}`}>For {selectedContact.name}{selectedContact.company ? ` · ${selectedContact.company}` : ''}</p>
                : <p className={`text-sm ${tSec}`}>Choose a package or skip to add items manually</p>
              }
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {packagesList.filter(p => p.is_active !== false).map((pkg) => {
                const items = pkg.items || [];
                const itemTotal = items.reduce((s, i) => s + i.qty * i.unit_price, 0);
                return (
                  <button key={pkg.package_id} onClick={() => handlePackageSelect(pkg)}
                    className={`text-left p-5 rounded-xl border transition-all active:opacity-70 ${
                      formData.package_id === pkg.package_id
                        ? 'border-[#e94560] ring-2 ring-[#e94560]/20 bg-[#e94560]/5'
                        : `${card} hover:border-[#e94560]/40 hover:-translate-y-0.5`
                    }`}
                    data-testid={`package-card-${pkg.name}`}>
                    <div className="flex items-start justify-between gap-2 mb-3">
                      <h3 className={`font-semibold ${tPri} leading-tight`}>{pkg.display_name}</h3>
                      {formData.package_id === pkg.package_id && <CheckCircle2 className="h-5 w-5 text-[#e94560] flex-shrink-0" />}
                    </div>
                    <p className="text-2xl font-bold text-[#e94560] mb-3">{formatCurrency(itemTotal)}</p>
                    <div className="space-y-1">
                      {items.map((item, idx) => (
                        <div key={idx} className={`flex justify-between text-xs ${tSec}`}>
                          <span className="truncate">{item.name}</span>
                          <span className={`${tPri} font-medium ml-2 flex-shrink-0`}>×{item.qty}</span>
                        </div>
                      ))}
                    </div>
                  </button>
                );
              })}
            </div>

            <p className={`text-xs ${tMut} text-center`}>You can add or modify items in the next step</p>

            <div className="flex gap-3 pt-2">
              <Button onClick={() => setStep(1)} variant="outline" className={`border-[var(--border-color)] ${tSec} h-12`}>
                <ArrowLeft className="mr-2 h-4 w-4" /> Back
              </Button>
              <Button onClick={() => setStep(3)} className="flex-1 h-12 bg-[#e94560] hover:bg-[#f05c75] text-white font-semibold" data-testid="step2-next-button">
                Continue <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
            </div>
          </div>
        )}

        {/* ── Step 3: Review & Pricing ─────────────────────────────────────────── */}
        {step === 3 && (
          <div className="px-4 sm:px-0 space-y-5">

            {/* Customer Details */}
            <div className={`${card} p-4`}>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  {company.logo_url && <img src={company.logo_url} alt="Logo" className="h-8 object-contain" />}
                  <div>
                    <p className={`font-bold text-sm ${tPri}`}>{company.company_name || 'SmartShapes'}</p>
                    {company.gst_number && <p className={`text-[10px] ${tMut}`}>GST: {company.gst_number}</p>}
                  </div>
                </div>
                {selectedPackage && (
                  <span className={`text-[10px] px-2 py-1 rounded-lg bg-[#e94560]/10 text-[#e94560] font-medium`}>{selectedPackage.display_name}</span>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label className={`text-xs ${tMut} mb-1`}>Principal / Contact Name *</Label>
                  <Input value={formData.principal_name} onChange={e => setFormData(p => ({...p, principal_name: e.target.value}))} className={`h-11 ${inputCls}`} data-testid="principal-name-input" placeholder="Full name" />
                </div>
                <div>
                  <Label className={`text-xs ${tMut} mb-1`}>School / Organization *</Label>
                  <Input value={formData.school_name} onChange={e => setFormData(p => ({...p, school_name: e.target.value}))} className={`h-11 ${inputCls}`} data-testid="school-name-input" placeholder="School or company name" />
                </div>
                <div className="sm:col-span-2">
                  <Label className={`text-xs ${tMut} mb-1`}>Address</Label>
                  <Input value={formData.address} onChange={e => setFormData(p => ({...p, address: e.target.value}))} className={`h-11 ${inputCls}`} placeholder="City, State" />
                </div>
                <div>
                  <Label className={`text-xs ${tMut} mb-1`}>Phone</Label>
                  <Input value={formData.customer_phone} onChange={e => setFormData(p => ({...p, customer_phone: e.target.value}))} className={`h-11 ${inputCls}`} type="tel" />
                </div>
                <div>
                  <Label className={`text-xs ${tMut} mb-1`}>Email</Label>
                  <Input value={formData.customer_email} onChange={e => setFormData(p => ({...p, customer_email: e.target.value}))} className={`h-11 ${inputCls}`} type="email" />
                </div>
                <div>
                  <Label className={`text-xs ${tMut} mb-1`}>GST Number (Optional)</Label>
                  <Input value={formData.customer_gst} onChange={e => setFormData(p => ({...p, customer_gst: e.target.value}))} className={`h-11 ${inputCls}`} />
                </div>
                <div>
                  <Label className={`text-xs ${tMut} mb-1`}>Assign Sales Person *</Label>
                  <select value={formData.sales_person_id} onChange={e => setFormData(p => ({...p, sales_person_id: e.target.value}))} className={`w-full h-11 px-3 border rounded-md text-sm ${inputCls}`} data-testid="sales-person-select">
                    <option value="">Select sales person</option>
                    {salesPersonsList.map(sp => (
                      <option key={sp.sales_person_id} value={sp.sales_person_id}>{sp.name}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* Product Lines */}
            <div className={`${card} p-4`}>
              <div className="flex items-center justify-between mb-3">
                <h3 className={`font-semibold text-sm ${tPri}`}>Product Lines</h3>
                <Button onClick={() => setShowAddProduct(true)} variant="outline" size="sm" className="h-9 border-[#e94560] text-[#e94560] hover:bg-[#e94560]/10" data-testid="add-product-button">
                  <Plus className="mr-1 h-3.5 w-3.5" /> Add Item
                </Button>
              </div>

              {/* Add product form */}
              {showAddProduct && (
                <div className="bg-[var(--bg-primary)] border border-[#e94560]/30 rounded-xl p-4 space-y-3 mb-4">
                  <p className={`text-xs font-semibold ${tSec} uppercase tracking-wide`}>New Item</p>
                  <div>
                    <Label className={`text-xs ${tMut} mb-1`}>Product Name *</Label>
                    <Input value={newProduct.description} onChange={e => setNewProduct(p => ({...p, description: e.target.value}))} placeholder="e.g. SmartShape Basic Kit" className={`h-11 ${inputCls}`} />
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <Label className={`text-xs ${tMut} mb-1`}>Qty</Label>
                      <Input type="number" value={newProduct.qty} onChange={e => setNewProduct(p => ({...p, qty: parseInt(e.target.value) || 1}))} className={`h-11 text-center ${inputCls}`} min="1" />
                    </div>
                    <div>
                      <Label className={`text-xs ${tMut} mb-1`}>Unit Price</Label>
                      <Input type="number" value={newProduct.unit_price} onChange={e => setNewProduct(p => ({...p, unit_price: parseFloat(e.target.value) || 0}))} className={`h-11 ${inputCls}`} />
                    </div>
                    <div>
                      <Label className={`text-xs ${tMut} mb-1`}>GST %</Label>
                      <Input type="number" value={newProduct.gst_pct} onChange={e => setNewProduct(p => ({...p, gst_pct: parseFloat(e.target.value) || 0}))} className={`h-11 text-center ${inputCls}`} min="0" max="28" />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button onClick={handleAddCustomProduct} className="flex-1 h-11 bg-[#e94560] hover:bg-[#f05c75] text-white font-semibold">Add Item</Button>
                    <Button variant="outline" onClick={() => setShowAddProduct(false)} className={`border-[var(--border-color)] ${tSec} h-11`}>Cancel</Button>
                  </div>
                </div>
              )}

              {/* Mobile: stacked cards */}
              <div className="sm:hidden space-y-3">
                {formData.lines.map((line, idx) => (
                  <div key={idx} className="bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-xl p-3">
                    <div className="flex items-start gap-2 mb-3">
                      <Input value={line.description} onChange={e => updateLine(idx, 'description', e.target.value)} className={`flex-1 h-10 text-sm font-medium ${inputCls}`} placeholder="Item description" />
                      <button onClick={() => handleRemoveLine(idx)} className="text-red-400 mt-1 flex-shrink-0"><X className="h-4 w-4" /></button>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <p className={`text-[10px] ${tMut} mb-1`}>Qty</p>
                        <Input type="number" value={line.qty} onChange={e => updateLine(idx, 'qty', e.target.value)} className={`h-10 text-sm text-center ${inputCls}`} />
                      </div>
                      <div>
                        <p className={`text-[10px] ${tMut} mb-1`}>Unit Price</p>
                        <Input type="number" value={line.unit_price} onChange={e => updateLine(idx, 'unit_price', e.target.value)} className={`h-10 text-sm ${inputCls}`} />
                      </div>
                      <div>
                        <p className={`text-[10px] ${tMut} mb-1`}>GST %</p>
                        <Input type="number" value={line.gst_pct} onChange={e => updateLine(idx, 'gst_pct', e.target.value)} className={`h-10 text-sm text-center ${inputCls}`} min="0" max="28" />
                      </div>
                    </div>
                    <div className="flex justify-between items-center mt-2.5 pt-2.5 border-t border-[var(--border-color)]">
                      <span className={`text-xs ${tMut}`}>Subtotal (excl. GST)</span>
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
                      <th className="text-right text-xs py-2.5 px-3 font-semibold uppercase tracking-wide w-28">Unit Price</th>
                      <th className="text-right text-xs py-2.5 px-3 font-semibold uppercase tracking-wide w-28">Subtotal</th>
                      <th className="text-center text-xs py-2.5 px-3 font-semibold uppercase tracking-wide w-20">GST %</th>
                      <th className="text-right text-xs py-2.5 px-3 font-semibold uppercase tracking-wide w-28">Total</th>
                      <th className="w-8"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {formData.lines.map((line, idx) => (
                      <tr key={idx} className={`border-t border-[var(--border-color)] ${idx % 2 === 1 ? 'bg-[var(--bg-primary)]' : ''} hover:bg-[var(--bg-hover)]`}>
                        <td className="py-2 px-3">
                          <Input value={line.description} onChange={e => updateLine(idx, 'description', e.target.value)} className="bg-transparent border-none h-8 p-0 text-sm text-[var(--text-primary)]" />
                        </td>
                        <td className="py-2 px-3 text-center">
                          <Input type="number" value={line.qty} onChange={e => updateLine(idx, 'qty', e.target.value)} className="bg-transparent border-none h-8 p-0 text-sm text-center text-[var(--text-primary)] w-14 mx-auto" />
                        </td>
                        <td className="py-2 px-3 text-right">
                          <Input type="number" value={line.unit_price} onChange={e => updateLine(idx, 'unit_price', e.target.value)} className="bg-transparent border-none h-8 p-0 text-sm text-right text-[var(--text-primary)] w-24 ml-auto" />
                        </td>
                        <td className={`py-2 px-3 text-right font-mono text-sm ${tPri}`}>{formatCurrency(line.line_subtotal)}</td>
                        <td className="py-2 px-3 text-center">
                          <Input type="number" value={line.gst_pct} onChange={e => updateLine(idx, 'gst_pct', e.target.value)} className="bg-transparent border-none h-8 p-0 text-sm text-center text-[var(--text-primary)] w-14 mx-auto" min="0" max="28" />
                        </td>
                        <td className={`py-2 px-3 text-right font-mono text-sm font-semibold ${tPri}`}>{formatCurrency(line.line_total)}</td>
                        <td className="py-2 px-1">
                          <button onClick={() => handleRemoveLine(idx)} className="text-red-400 hover:text-red-300"><X className="h-3.5 w-3.5" /></button>
                        </td>
                      </tr>
                    ))}
                    {formData.lines.length === 0 && (
                      <tr>
                        <td colSpan={7} className={`py-10 text-center text-sm ${tMut}`}>No items added — click "Add Item" above</td>
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
                  <Input type="number" value={formData.discount1_pct} onChange={e => setFormData(p => ({...p, discount1_pct: parseFloat(e.target.value) || 0}))} className={`h-11 ${inputCls}`} data-testid="discount1-input" min="0" max="100" />
                </div>
                <div>
                  <Label className={`text-xs ${tMut} mb-1`}>Additional Discount (%)</Label>
                  <Input type="number" value={formData.discount2_pct} onChange={e => setFormData(p => ({...p, discount2_pct: parseFloat(e.target.value) || 0}))} className={`h-11 ${inputCls}`} data-testid="discount2-input" min="0" max="100" />
                </div>
              </div>
              <div>
                <Label className={`text-xs ${tMut} mb-1`}>Freight & Packing (base amount, excl. GST)</Label>
                <Input type="number" value={formData.freight_amount} onChange={e => setFormData(p => ({...p, freight_amount: parseFloat(e.target.value) || 0}))} className={`h-11 ${inputCls}`} data-testid="freight-input" min="0" />
                <p className={`text-[10px] ${tMut} mt-1`}>Freight added in Sub Total. GST @ 18% on freight calculated separately.</p>
              </div>
              <div>
                <Label className={`text-xs ${tMut} mb-1`}>Currency Symbol</Label>
                <div className="flex gap-2 flex-wrap">
                  {['₹', '$', '€', '£', 'AED', '¥'].map(sym => (
                    <button key={sym} type="button"
                      onClick={() => setFormData(p => ({...p, currency_symbol: sym}))}
                      className={`px-3 py-2 rounded-lg text-sm font-medium border transition-all ${formData.currency_symbol === sym ? 'bg-[#e94560] text-white border-[#e94560]' : `bg-[var(--bg-primary)] border-[var(--border-color)] ${tSec} hover:border-[#e94560]/40`}`}>
                      {sym}
                    </button>
                  ))}
                  <Input
                    value={['₹','$','€','£','AED','¥'].includes(formData.currency_symbol) ? '' : formData.currency_symbol}
                    onChange={e => setFormData(p => ({...p, currency_symbol: e.target.value || '₹'}))}
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
                    <div className="flex justify-between items-center">
                      <span className={`text-sm ${tSec}`}>GST</span>
                      <span className={`font-mono text-sm ${tSec}`}>{fmt(totals.total_gst)}</span>
                    </div>
                    <div className="flex justify-between items-center bg-[#1a1a2e] rounded-xl p-4 mt-2">
                      <span className="text-white font-bold text-base">Total Payable</span>
                      <span className="font-mono text-xl font-bold text-[#e94560]">{fmt(totals.grand_total)}</span>
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
                  <button key={f} type="button" onClick={() => setFormData(p => ({...p, font_size_mode: f}))}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all capitalize ${formData.font_size_mode === f ? 'bg-[#e94560] text-white' : `bg-[var(--bg-primary)] border border-[var(--border-color)] ${tSec} hover:border-[#e94560]/40`}`}
                    data-testid={`font-${f}`}>
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
                    <button type="button" onClick={() => setFormData(p => ({...p, bank_details_override: company.bank_details}))} className="text-[10px] text-[#e94560] hover:underline" data-testid="reset-bank-default-btn">Reset to Default</button>
                  )}
                </div>
                <textarea rows={4} value={formData.bank_details_override} onChange={e => setFormData(p => ({...p, bank_details_override: e.target.value}))} placeholder="Bank Name | A/c Name | A/c No | IFSC | Branch" className={`w-full px-3 py-2 border rounded-lg text-sm font-mono ${inputCls}`} data-testid="quotation-bank-details-input" />
                <p className={`text-[10px] ${tMut}`}>Pre-filled from Company Master. Override per-quote.</p>
              </div>
              <div className={`${card} p-4 space-y-2`}>
                <div className="flex items-center justify-between">
                  <h3 className={`text-sm font-semibold ${tPri}`}>Terms & Conditions</h3>
                  {company.terms_conditions && (
                    <button type="button" onClick={() => setFormData(p => ({...p, terms_override: company.terms_conditions}))} className="text-[10px] text-[#e94560] hover:underline" data-testid="reset-terms-default-btn">Reset to Default</button>
                  )}
                </div>
                <textarea rows={6} value={formData.terms_override} onChange={e => setFormData(p => ({...p, terms_override: e.target.value}))} placeholder={'One per line:\nPrices are valid for 30 days...\nGST @18% applicable...'} className={`w-full px-3 py-2 border rounded-lg text-sm ${inputCls}`} data-testid="quotation-terms-input" />
                <p className={`text-[10px] ${tMut}`}>Each line becomes a numbered clause in the PDF.</p>
              </div>
            </div>

            {/* Navigation */}
            <div className="flex gap-3 pb-4">
              <Button onClick={() => setStep(2)} variant="outline" className={`border-[var(--border-color)] ${tSec} h-12`}>
                <ArrowLeft className="mr-2 h-4 w-4" /> Back
              </Button>
              <Button onClick={handleSubmit} disabled={!formData.principal_name || !formData.school_name} className="flex-1 h-12 bg-[#e94560] hover:bg-[#f05c75] text-white font-semibold text-base" data-testid="create-quotation-submit">
                Create Quotation <Check className="ml-2 h-5 w-5" />
              </Button>
            </div>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}

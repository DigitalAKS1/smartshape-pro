import React, { useState, useEffect } from 'react';
import AdminLayout from '../../components/layouts/AdminLayout';
import { packages, salesPersons, quotations, companySettings } from '../../lib/api';
import { formatCurrency } from '../../lib/utils';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { ArrowRight, ArrowLeft, Check, Plus, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

export default function CreateQuotation() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [packagesList, setPackagesList] = useState([]);
  const [salesPersonsList, setSalesPersonsList] = useState([]);
  const [company, setCompany] = useState({});
  const [formData, setFormData] = useState({
    package_id: '', principal_name: '', school_name: '', address: '',
    customer_email: '', customer_phone: '', customer_gst: '',
    sales_person_id: '', discount1_pct: 0, discount2_pct: 0,
    freight_amount: 0, lines: [],
    bank_details_override: '', terms_override: '',
    font_size_mode: 'medium',
  });
  const [selectedPackage, setSelectedPackage] = useState(null);
  const [showAddProduct, setShowAddProduct] = useState(false);
  const [newProduct, setNewProduct] = useState({ description: '', product_type: 'custom', qty: 1, unit_price: 0, gst_pct: 18 });

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [pkgsRes, spRes, compRes] = await Promise.all([
          packages.getAll(), salesPersons.getAll(), companySettings.get()
        ]);
        setPackagesList(pkgsRes.data);
        setSalesPersonsList(spRes.data);
        const comp = compRes.data || {};
        setCompany(comp);
        // Pre-fill bank/T&C from Company Master
        setFormData(prev => ({
          ...prev,
          bank_details_override: prev.bank_details_override || comp.bank_details || '',
          terms_override: prev.terms_override || comp.terms_conditions || '',
        }));
      } catch (error) {
        toast.error('Failed to load data');
      }
    };
    fetchData();
  }, []);

  const handlePackageSelect = (pkg) => {
    setSelectedPackage(pkg);
    // Build lines from package items
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
    setFormData({ ...formData, package_id: pkg.package_id, lines });
  };

  const recalcLine = (line) => {
    const sub = line.qty * line.unit_price;
    const gst = sub * (line.gst_pct / 100);
    return { ...line, line_subtotal: sub, line_gst: gst, line_total: sub + gst };
  };

  const updateLine = (idx, field, value) => {
    const lines = [...formData.lines];
    lines[idx] = { ...lines[idx], [field]: field === 'description' || field === 'product_type' ? value : parseFloat(value) || 0 };
    lines[idx] = recalcLine(lines[idx]);
    setFormData({ ...formData, lines });
  };

  const handleAddCustomProduct = () => {
    if (!newProduct.description) { toast.error('Product name required'); return; }
    const line = recalcLine({
      ...newProduct, line_subtotal: 0, line_gst: 0, line_total: 0, sort_order: formData.lines.length + 1,
    });
    setFormData({ ...formData, lines: [...formData.lines, line] });
    setNewProduct({ description: '', product_type: 'custom', qty: 1, unit_price: 0, gst_pct: 18 });
    setShowAddProduct(false);
    toast.success('Product added');
  };

  const handleRemoveLine = (idx) => {
    setFormData({ ...formData, lines: formData.lines.filter((_, i) => i !== idx) });
  };

  // PRICING (FMS: pre-GST discount model — matches backend)
  const calcTotals = () => {
    const items_total = formData.lines.reduce((s, l) => s + l.line_subtotal, 0);
    const disc1_amount = items_total * (formData.discount1_pct / 100);
    const disc2_amount = items_total * (formData.discount2_pct / 100);
    const freight_base = Number(formData.freight_amount) || 0;
    const sub_total_after = items_total - disc1_amount - disc2_amount + freight_base;
    const gst_amount = sub_total_after * 0.18;
    const grand_total = sub_total_after + gst_amount;
    return { items_total, disc1_amount, disc2_amount, freight_base, sub_total_after, gst_amount, grand_total };
  };

  const handleSubmit = async () => {
    try {
      await quotations.create(formData);
      toast.success('Quotation created successfully!');
      navigate('/quotations');
    } catch (error) {
      toast.error('Failed to create quotation');
    }
  };

  const totals = calcTotals();

  return (
    <AdminLayout>
      <div className="max-w-5xl mx-auto space-y-8">
        {/* Header with Logo */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            {company.logo_url && (
              <img src={company.logo_url} alt="Logo" className="h-12 object-contain" />
            )}
            <div>
              <h1 className="text-4xl font-semibold text-[var(--text-primary)] tracking-tight" data-testid="create-quotation-title">Create Quotation</h1>
              <p className="text-[var(--text-secondary)] mt-1">Follow the steps to create a new quotation</p>
            </div>
          </div>
        </div>

        {/* Steps */}
        <div className="flex items-center justify-center space-x-4">
          {['Package', 'Customer', 'Review & Price'].map((label, i) => (
            <div key={i} className="flex items-center">
              <div className="flex flex-col items-center">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center font-medium ${step > i + 1 ? 'bg-[#10b981] text-white' : step === i + 1 ? 'bg-[#e94560] text-white' : 'bg-[#2d2d44] text-[var(--text-muted)]'}`}>
                  {step > i + 1 ? <Check className="h-5 w-5" /> : i + 1}
                </div>
                <span className={`text-xs mt-1 ${step === i + 1 ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]'}`}>{label}</span>
              </div>
              {i < 2 && <div className={`w-16 h-0.5 mx-2 mb-5 ${step > i + 1 ? 'bg-[#10b981]' : 'bg-[#2d2d44]'}`} />}
            </div>
          ))}
        </div>

        {/* Step 1: Package Selection */}
        {step === 1 && (
          <div className="space-y-6">
            <h2 className="text-2xl font-medium text-[var(--text-primary)]">Select Package</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {packagesList.filter(p => p.is_active !== false).map((pkg) => {
                const items = pkg.items || [];
                const itemTotal = items.reduce((s, i) => s + i.qty * i.unit_price, 0);
                return (
                  <div key={pkg.package_id} onClick={() => handlePackageSelect(pkg)}
                    className={`bg-[var(--bg-card)] border rounded-md p-6 cursor-pointer transition-all hover:-translate-y-1 ${formData.package_id === pkg.package_id ? 'border-[#e94560] ring-1 ring-[#e94560]' : 'border-[var(--border-color)]'}`}
                    data-testid={`package-card-${pkg.name}`}>
                    <h3 className="text-xl font-medium text-[var(--text-primary)] mb-2">{pkg.display_name}</h3>
                    <p className="text-3xl font-bold text-[#e94560] mb-4">{formatCurrency(itemTotal)}</p>
                    <div className="space-y-1 text-sm">
                      {items.map((item, idx) => (
                        <div key={idx} className="flex justify-between text-[var(--text-secondary)]">
                          <span>{item.name}</span>
                          <span className="text-[var(--text-primary)] font-medium">x{item.qty}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
            <Button onClick={() => setStep(2)} disabled={!formData.package_id} className="bg-[#e94560] hover:bg-[#f05c75] text-white" data-testid="step1-next-button">
              Next <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        )}

        {/* Step 2: Customer Details */}
        {step === 2 && (
          <div className="space-y-6">
            <h2 className="text-2xl font-medium text-[var(--text-primary)]">Customer Details</h2>
            <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md p-6 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label className="text-[var(--text-secondary)]">Principal Name *</Label>
                  <Input value={formData.principal_name} onChange={(e) => setFormData({...formData, principal_name: e.target.value})} className="bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]" data-testid="principal-name-input" />
                </div>
                <div>
                  <Label className="text-[var(--text-secondary)]">School Name *</Label>
                  <Input value={formData.school_name} onChange={(e) => setFormData({...formData, school_name: e.target.value})} className="bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]" data-testid="school-name-input" />
                </div>
              </div>
              <div>
                <Label className="text-[var(--text-secondary)]">Address</Label>
                <Input value={formData.address} onChange={(e) => setFormData({...formData, address: e.target.value})} className="bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]" />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label className="text-[var(--text-secondary)]">Email</Label>
                  <Input type="email" value={formData.customer_email} onChange={(e) => setFormData({...formData, customer_email: e.target.value})} className="bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]" />
                </div>
                <div>
                  <Label className="text-[var(--text-secondary)]">Phone</Label>
                  <Input value={formData.customer_phone} onChange={(e) => setFormData({...formData, customer_phone: e.target.value})} className="bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]" />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label className="text-[var(--text-secondary)]">GST Number (Optional)</Label>
                  <Input value={formData.customer_gst} onChange={(e) => setFormData({...formData, customer_gst: e.target.value})} className="bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]" />
                </div>
                <div>
                  <Label className="text-[var(--text-secondary)]">Assign Sales Person *</Label>
                  <select value={formData.sales_person_id} onChange={(e) => setFormData({...formData, sales_person_id: e.target.value})} className="w-full h-10 px-3 bg-[var(--bg-primary)] border border-[var(--border-color)] text-[var(--text-primary)] rounded-md" data-testid="sales-person-select">
                    <option value="">Select sales person</option>
                    {salesPersonsList.map((sp) => (
                      <option key={sp.sales_person_id} value={sp.sales_person_id}>{sp.name}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
            <div className="flex space-x-4">
              <Button onClick={() => setStep(1)} variant="outline" className="border-[var(--border-color)] text-[var(--text-primary)]"><ArrowLeft className="mr-2 h-4 w-4" /> Back</Button>
              <Button onClick={() => setStep(3)} disabled={!formData.principal_name || !formData.school_name || !formData.sales_person_id} className="bg-[#e94560] hover:bg-[#f05c75] text-white">
                Next <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        {/* Step 3: Review & Pricing */}
        {step === 3 && (
          <div className="space-y-6">
            {/* Quotation Header with Logo */}
            <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md p-6">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-4">
                  {company.logo_url && <img src={company.logo_url} alt="Logo" className="h-10 object-contain" />}
                  <div>
                    <h2 className="text-xl font-bold text-[var(--text-primary)]">{company.company_name || 'SmartShapes'}</h2>
                    {company.gst_number && <p className="text-xs text-[var(--text-muted)]">GST: {company.gst_number}</p>}
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-[var(--text-primary)] font-medium">{formData.school_name}</p>
                  <p className="text-sm text-[var(--text-secondary)]">{formData.principal_name}</p>
                  <p className="text-xs text-[var(--text-muted)]">{selectedPackage?.display_name}</p>
                </div>
              </div>

              {/* Product Lines - Editable */}
              <div className="mb-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-medium text-[var(--text-primary)] uppercase tracking-wide">Product Lines</h3>
                  <Button onClick={() => setShowAddProduct(true)} variant="outline" size="sm" className="border-[#e94560] text-[#e94560] hover:bg-[#e94560]/10" data-testid="add-product-button">
                    <Plus className="mr-1 h-3 w-3" /> Add Item
                  </Button>
                </div>

                {showAddProduct && (
                  <div className="bg-[var(--bg-primary)] border border-[#e94560]/30 rounded-md p-4 space-y-3 mb-4">
                    <div className="grid grid-cols-12 gap-2 items-end">
                      <div className="col-span-4">
                        <Label className="text-[var(--text-muted)] text-xs">Name</Label>
                        <Input value={newProduct.description} onChange={(e) => setNewProduct({...newProduct, description: e.target.value})} className="bg-[var(--bg-card)] border-[var(--border-color)] text-[var(--text-primary)] h-9 text-sm" placeholder="Product name" />
                      </div>
                      <div className="col-span-2">
                        <Label className="text-[var(--text-muted)] text-xs">Type</Label>
                        <select value={newProduct.product_type} onChange={(e) => setNewProduct({...newProduct, product_type: e.target.value})} className="w-full h-9 px-2 bg-[var(--bg-card)] border border-[var(--border-color)] text-[var(--text-primary)] rounded text-sm">
                          <option value="standard_die">Standard Die</option>
                          <option value="large_die">Large Die</option>
                          <option value="machine">Machine</option>
                          <option value="die_set">Die Set</option>
                          <option value="custom">Custom</option>
                        </select>
                      </div>
                      <div className="col-span-2">
                        <Label className="text-[var(--text-muted)] text-xs">Qty</Label>
                        <Input type="number" value={newProduct.qty} onChange={(e) => setNewProduct({...newProduct, qty: parseInt(e.target.value) || 1})} className="bg-[var(--bg-card)] border-[var(--border-color)] text-[var(--text-primary)] h-9 text-sm" />
                      </div>
                      <div className="col-span-2">
                        <Label className="text-[var(--text-muted)] text-xs">Unit Price</Label>
                        <Input type="number" value={newProduct.unit_price} onChange={(e) => setNewProduct({...newProduct, unit_price: parseFloat(e.target.value) || 0})} className="bg-[var(--bg-card)] border-[var(--border-color)] text-[var(--text-primary)] h-9 text-sm" />
                      </div>
                      <div className="col-span-2 flex gap-1">
                        <Button size="sm" onClick={handleAddCustomProduct} className="bg-[#e94560] hover:bg-[#f05c75] h-9 text-xs">Add</Button>
                        <Button size="sm" variant="ghost" onClick={() => setShowAddProduct(false)} className="text-[var(--text-muted)] h-9 text-xs">Cancel</Button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Lines Table */}
                <div className="border border-[var(--border-color)] rounded-md overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-[var(--bg-primary)]">
                        <th className="text-left text-xs text-[var(--text-muted)] py-2 px-3 uppercase">Item</th>
                        <th className="text-center text-xs text-[var(--text-muted)] py-2 px-3 uppercase">Qty</th>
                        <th className="text-right text-xs text-[var(--text-muted)] py-2 px-3 uppercase">Unit Price</th>
                        <th className="text-right text-xs text-[var(--text-muted)] py-2 px-3 uppercase">Subtotal</th>
                        <th className="text-right text-xs text-[var(--text-muted)] py-2 px-3 uppercase">GST</th>
                        <th className="text-right text-xs text-[var(--text-muted)] py-2 px-3 uppercase">Total</th>
                        <th className="w-8"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {formData.lines.map((line, idx) => (
                        <tr key={idx} className="border-t border-[var(--border-color)] hover:bg-[var(--bg-hover)]">
                          <td className="py-2 px-3">
                            <Input value={line.description} onChange={(e) => updateLine(idx, 'description', e.target.value)} className="bg-transparent border-none text-[var(--text-primary)] h-7 p-0 text-sm" />
                          </td>
                          <td className="py-2 px-3 text-center">
                            <Input type="number" value={line.qty} onChange={(e) => updateLine(idx, 'qty', e.target.value)} className="bg-transparent border-none text-[var(--text-primary)] h-7 p-0 text-sm text-center w-16 mx-auto" />
                          </td>
                          <td className="py-2 px-3 text-right">
                            <Input type="number" value={line.unit_price} onChange={(e) => updateLine(idx, 'unit_price', e.target.value)} className="bg-transparent border-none text-[var(--text-primary)] h-7 p-0 text-sm text-right w-24 ml-auto" />
                          </td>
                          <td className="py-2 px-3 text-right font-mono text-[var(--text-primary)]">{formatCurrency(line.line_subtotal)}</td>
                          <td className="py-2 px-3 text-right font-mono text-[var(--text-secondary)]">{formatCurrency(line.line_gst)}</td>
                          <td className="py-2 px-3 text-right font-mono text-[var(--text-primary)] font-medium">{formatCurrency(line.line_total)}</td>
                          <td className="py-2 px-1">
                            <button onClick={() => handleRemoveLine(idx)} className="text-red-400 hover:text-red-300"><X className="h-3 w-3" /></button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Pricing Breakdown */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
                {/* Discount Inputs */}
                <div className="space-y-4">
                  <h3 className="text-sm font-medium text-[var(--text-primary)] uppercase tracking-wide">Discounts & Freight</h3>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-[var(--text-muted)] text-xs">Primary Discount (%)</Label>
                      <Input type="number" value={formData.discount1_pct} onChange={(e) => setFormData({...formData, discount1_pct: parseFloat(e.target.value) || 0})} className="bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]" data-testid="discount1-input" />
                    </div>
                    <div>
                      <Label className="text-[var(--text-muted)] text-xs">Additional Discount (%)</Label>
                      <Input type="number" value={formData.discount2_pct} onChange={(e) => setFormData({...formData, discount2_pct: parseFloat(e.target.value) || 0})} className="bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]" data-testid="discount2-input" />
                      <p className="text-[10px] text-[var(--text-muted)] mt-1">Applied after primary discount</p>
                    </div>
                  </div>
                  <div>
                    <Label className="text-[var(--text-muted)] text-xs">Freight &amp; Packing (pre-GST)</Label>
                    <Input type="number" value={formData.freight_amount} onChange={(e) => setFormData({...formData, freight_amount: parseFloat(e.target.value) || 0})} className="bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]" data-testid="freight-input" />
                  </div>
                </div>

                {/* Font Size Selector (FMS PDF typography) */}
                <div className="flex items-center gap-3 bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-md p-3">
                  <Label className="text-[var(--text-secondary)] text-xs whitespace-nowrap">PDF Font Size</Label>
                  <div className="flex gap-1" data-testid="font-size-selector">
                    {[
                      { id: 'small', label: 'Small' },
                      { id: 'medium', label: 'Medium' },
                      { id: 'large', label: 'Large' },
                    ].map(f => (
                      <button key={f.id} type="button" onClick={() => setFormData({ ...formData, font_size_mode: f.id })}
                        className={`px-3 py-1 rounded text-xs font-medium transition-all ${formData.font_size_mode === f.id ? 'bg-[#e94560] text-white' : 'bg-[var(--bg-card)] text-[var(--text-secondary)] border border-[var(--border-color)] hover:border-[#e94560]/40'}`}
                        data-testid={`font-${f.id}`}>
                        {f.label}
                      </button>
                    ))}
                  </div>
                  <span className="text-[10px] text-[var(--text-muted)]">Affects generated PDF typography.</span>
                </div>

                {/* Price Summary (FMS: matches PDF — pre-GST discount model) */}
                <div className="bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-md p-4 space-y-2" data-testid="price-summary">
                  <h3 className="text-sm font-medium text-[var(--text-primary)] uppercase tracking-wide mb-3">Price Summary</h3>
                  <div className="flex justify-between text-sm font-medium">
                    <span className="text-[var(--text-primary)]">Total</span>
                    <span className="font-mono text-[var(--text-primary)]">{formatCurrency(totals.items_total)}</span>
                  </div>
                  {formData.discount1_pct > 0 && (
                    <div className="flex justify-between text-sm text-green-400">
                      <span>Discount @ {formData.discount1_pct}%</span>
                      <span className="font-mono">-{formatCurrency(totals.disc1_amount)}</span>
                    </div>
                  )}
                  {formData.discount2_pct > 0 && (
                    <div className="flex justify-between text-sm text-green-400">
                      <span>Spl Additional Discount {formData.discount2_pct}%</span>
                      <span className="font-mono">-{formatCurrency(totals.disc2_amount)}</span>
                    </div>
                  )}
                  {formData.freight_amount > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-[var(--text-secondary)]">Freight &amp; Packing</span>
                      <span className="font-mono text-[var(--text-secondary)]">{formatCurrency(totals.freight_base)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-sm font-medium border-t border-[var(--border-color)] pt-2">
                    <span className="text-[var(--text-primary)]">Sub-total</span>
                    <span className="font-mono text-[var(--text-primary)]">{formatCurrency(totals.sub_total_after)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-[var(--text-secondary)]">GST @ 18%</span>
                    <span className="font-mono text-[var(--text-secondary)]">{formatCurrency(totals.gst_amount)}</span>
                  </div>
                  <div className="flex justify-between text-xl font-bold border-t-2 border-[#e94560] pt-3 mt-2">
                    <span className="text-[var(--text-primary)]">Total</span>
                    <span className="font-mono text-[#e94560]">{formatCurrency(totals.grand_total)}</span>
                  </div>
                </div>
              </div>

              {/* Bank Details + Terms (FMS Phase 1 - PDF alignment) */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6 pt-6 border-t border-[var(--border-color)]">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-medium text-[var(--text-primary)] uppercase tracking-wide">Bank Details</h3>
                    {company.bank_details && (
                      <button
                        type="button"
                        onClick={() => setFormData({ ...formData, bank_details_override: company.bank_details })}
                        className="text-[10px] text-[#e94560] hover:underline"
                        data-testid="reset-bank-default-btn"
                      >Reset to Default</button>
                    )}
                  </div>
                  <textarea
                    rows={4}
                    value={formData.bank_details_override}
                    onChange={(e) => setFormData({ ...formData, bank_details_override: e.target.value })}
                    placeholder="Bank Name | A/c Name | A/c No | IFSC | Branch"
                    className="w-full px-3 py-2 bg-[var(--bg-primary)] border border-[var(--border-color)] text-[var(--text-primary)] rounded-md text-sm font-mono"
                    data-testid="quotation-bank-details-input"
                  />
                  <p className="text-[10px] text-[var(--text-muted)]">Pre-filled from Company Master. You can override per-quote.</p>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-medium text-[var(--text-primary)] uppercase tracking-wide">Terms &amp; Conditions</h3>
                    {company.terms_conditions && (
                      <button
                        type="button"
                        onClick={() => setFormData({ ...formData, terms_override: company.terms_conditions })}
                        className="text-[10px] text-[#e94560] hover:underline"
                        data-testid="reset-terms-default-btn"
                      >Reset to Default</button>
                    )}
                  </div>
                  <textarea
                    rows={6}
                    value={formData.terms_override}
                    onChange={(e) => setFormData({ ...formData, terms_override: e.target.value })}
                    placeholder={'One per line:\nPrices are valid for 30 days...\nGST @18% applicable...\nPayment: 50% advance...'}
                    className="w-full px-3 py-2 bg-[var(--bg-primary)] border border-[var(--border-color)] text-[var(--text-primary)] rounded-md text-sm"
                    data-testid="quotation-terms-input"
                  />
                  <p className="text-[10px] text-[var(--text-muted)]">Each line will appear as a numbered clause in the PDF.</p>
                </div>
              </div>
            </div>

            <div className="flex space-x-4">
              <Button onClick={() => setStep(2)} variant="outline" className="border-[var(--border-color)] text-[var(--text-primary)]">
                <ArrowLeft className="mr-2 h-4 w-4" /> Back
              </Button>
              <Button onClick={handleSubmit} className="bg-[#e94560] hover:bg-[#f05c75] text-white" data-testid="create-quotation-submit">
                Create Quotation <Check className="ml-2 h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}

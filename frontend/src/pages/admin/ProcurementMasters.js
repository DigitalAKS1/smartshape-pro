import React, { useState, useEffect, useCallback } from 'react';
import AdminLayout from '../../components/layouts/AdminLayout';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../../components/ui/dialog';
import { Plus, Truck, Boxes, ListChecks, Tag, Edit2, Trash2, Upload, ImageOff } from 'lucide-react';
import { toast } from 'sonner';
import { procurement } from '../../lib/api';
import MasterEntityTable from '../../components/crm/MasterEntityTable';

const TABS = [
  { id: 'vendors',   label: 'Vendors',        icon: Truck,      desc: 'Suppliers you raise Purchase Orders to — GST, contact and address used on the PO PDF.' },
  { id: 'pricelist', label: 'Vendor Price List', icon: Tag,     desc: 'Which items each vendor supplies and their default rate / HSN / GST — auto-fills the PO.' },
  { id: 'items',     label: 'Purchase Items', icon: Boxes,      desc: 'Raw materials, packaging and supplies you buy (separate from finished products / dies).' },
  { id: 'qc',        label: 'QC Templates',   icon: ListChecks, desc: 'Reusable quality-check checklists applied when goods are received and verified.' },
];

const card      = 'bg-[var(--bg-card)] border-[var(--border-color)]';
const inputCls  = 'bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]';
const textPri   = 'text-[var(--text-primary)]';
const textSec   = 'text-[var(--text-secondary)]';
const textMuted = 'text-[var(--text-muted)]';
const dlgCls    = 'bg-[var(--bg-card)] border-[var(--border-color)] text-[var(--text-primary)]';
const BACKEND   = process.env.REACT_APP_BACKEND_URL || '';

const imgSrc = (url) => (url ? (url.startsWith('http') ? url : `${BACKEND}${url}`) : '');

function Thumb({ url, size = 40 }) {
  if (!url) return (
    <div className="flex items-center justify-center rounded bg-[var(--bg-primary)] border border-[var(--border-color)]"
      style={{ width: size, height: size }}><ImageOff className="h-4 w-4 text-[var(--text-muted)]" /></div>
  );
  return <img src={imgSrc(url)} alt="" className="rounded object-cover border border-[var(--border-color)]"
    style={{ width: size, height: size }} />;
}

const EMPTY_VENDOR = {
  name: '', gstin: '', pan: '', contact_person: '', phone: '', email: '',
  address: '', city: '', state: '', state_code: '', payment_terms: '', is_active: true,
};
const EMPTY_ITEM = {
  name: '', category: '', uom: 'pcs', hsn: '', gst_pct: 0, default_rate: 0, min_level: 0, stock_qty: 0, is_active: true,
};

export default function ProcurementMasters() {
  const [activeTab, setActiveTab] = useState('vendors');

  // ── Vendors ───────────────────────────────────────────────────────────────
  const [vendors, setVendors] = useState([]);
  const [vendorOpen, setVendorOpen] = useState(false);
  const [editVendor, setEditVendor] = useState(null);
  const [vendorForm, setVendorForm] = useState(EMPTY_VENDOR);
  const [logoFile, setLogoFile] = useState(null);

  const loadVendors = useCallback(() => {
    procurement.vendors.getAll(true).then(r => setVendors(Array.isArray(r.data) ? r.data : [])).catch(() => {});
  }, []);

  const openNewVendor = () => { setEditVendor(null); setVendorForm(EMPTY_VENDOR); setLogoFile(null); setVendorOpen(true); };
  const openEditVendor = (v) => { setEditVendor(v); setVendorForm({ ...EMPTY_VENDOR, ...v }); setLogoFile(null); setVendorOpen(true); };

  const saveVendor = async () => {
    if (!vendorForm.name.trim()) { toast.error('Vendor name is required'); return; }
    try {
      let saved;
      if (editVendor) saved = (await procurement.vendors.update(editVendor.vendor_id, vendorForm)).data;
      else saved = (await procurement.vendors.create(vendorForm)).data;
      if (logoFile && saved?.vendor_id) {
        try { await procurement.vendors.uploadLogo(saved.vendor_id, logoFile); }
        catch { toast.error('Vendor saved, but logo upload failed'); }
      }
      toast.success(editVendor ? 'Vendor updated' : 'Vendor created');
      setVendorOpen(false); loadVendors();
    } catch (e) { toast.error(e?.response?.data?.detail || 'Save failed'); }
  };
  const deleteVendor = async (v) => {
    if (!window.confirm(`Deactivate vendor "${v.name}"?`)) return;
    try { await procurement.vendors.delete(v.vendor_id); loadVendors(); }
    catch { toast.error('Delete failed'); }
  };

  // ── Purchase Items ──────────────────────────────────────────────────────────
  const [items, setItems] = useState([]);
  const [itemOpen, setItemOpen] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [itemForm, setItemForm] = useState(EMPTY_ITEM);
  const [itemImage, setItemImage] = useState(null);

  const loadItems = useCallback(() => {
    procurement.purchaseItems.getAll(true).then(r => setItems(Array.isArray(r.data) ? r.data : [])).catch(() => {});
  }, []);

  const openNewItem = () => { setEditItem(null); setItemForm(EMPTY_ITEM); setItemImage(null); setItemOpen(true); };
  const openEditItem = (it) => { setEditItem(it); setItemForm({ ...EMPTY_ITEM, ...it }); setItemImage(null); setItemOpen(true); };

  const saveItem = async () => {
    if (!itemForm.name.trim()) { toast.error('Item name is required'); return; }
    const payload = {
      ...itemForm,
      gst_pct: Number(itemForm.gst_pct) || 0,
      default_rate: Number(itemForm.default_rate) || 0,
      min_level: parseInt(itemForm.min_level) || 0,
      stock_qty: parseInt(itemForm.stock_qty) || 0,
    };
    try {
      let saved;
      if (editItem) saved = (await procurement.purchaseItems.update(editItem.purchase_item_id, payload)).data;
      else saved = (await procurement.purchaseItems.create(payload)).data;
      if (itemImage && saved?.purchase_item_id) {
        try { await procurement.purchaseItems.uploadImage(saved.purchase_item_id, itemImage); }
        catch { toast.error('Item saved, but image upload failed'); }
      }
      toast.success(editItem ? 'Item updated' : 'Item created');
      setItemOpen(false); loadItems();
    } catch (e) { toast.error(e?.response?.data?.detail || 'Save failed'); }
  };
  const deleteItem = async (it) => {
    if (!window.confirm(`Deactivate item "${it.name}"?`)) return;
    try { await procurement.purchaseItems.delete(it.purchase_item_id); loadItems(); }
    catch { toast.error('Delete failed'); }
  };

  // ── Vendor Price List ───────────────────────────────────────────────────────
  const [plVendorId, setPlVendorId] = useState('');
  const [priceRows, setPriceRows] = useState([]);
  const [catalog, setCatalog] = useState([]);
  const [plOpen, setPlOpen] = useState(false);
  const [plForm, setPlForm] = useState({ item_ref: null, name: '', default_rate: 0, hsn: '', gst_pct: 0, uom: 'pcs', lead_time_days: 0 });

  const loadPrice = useCallback((vid) => {
    if (!vid) { setPriceRows([]); return; }
    procurement.vendorItems.getAll({ vendor_id: vid }).then(r => setPriceRows(Array.isArray(r.data) ? r.data : [])).catch(() => {});
  }, []);
  useEffect(() => { if (activeTab === 'pricelist') procurement.itemCatalog().then(r => setCatalog(r.data || [])).catch(() => {}); }, [activeTab]);
  useEffect(() => { loadPrice(plVendorId); }, [plVendorId, loadPrice]);

  const openNewPrice = () => {
    if (!plVendorId) { toast.error('Pick a vendor first'); return; }
    setPlForm({ item_ref: null, name: '', default_rate: 0, hsn: '', gst_pct: 0, uom: 'pcs', lead_time_days: 0 });
    setPlOpen(true);
  };
  const onPickCatalogItem = (key) => {
    const row = catalog.find(c => `${c.source}:${c.id}` === key);
    if (!row) { setPlForm(f => ({ ...f, item_ref: null })); return; }
    setPlForm(f => ({
      ...f, item_ref: row.item_ref, name: row.name,
      hsn: row.hsn || '', gst_pct: row.gst_pct || 0, uom: row.uom || 'pcs',
      default_rate: row.default_rate || f.default_rate || 0,
    }));
  };
  const savePrice = async () => {
    if (!plForm.item_ref) { toast.error('Select an item'); return; }
    try {
      await procurement.vendorItems.create({
        vendor_id: plVendorId, item_ref: plForm.item_ref, name: plForm.name,
        default_rate: Number(plForm.default_rate) || 0, hsn: plForm.hsn,
        gst_pct: Number(plForm.gst_pct) || 0, uom: plForm.uom,
        lead_time_days: parseInt(plForm.lead_time_days) || 0,
      });
      toast.success('Price row saved'); setPlOpen(false); loadPrice(plVendorId);
    } catch (e) { toast.error(e?.response?.data?.detail || 'Save failed'); }
  };
  const deletePrice = async (row) => {
    try { await procurement.vendorItems.delete(row.vendor_item_id); loadPrice(plVendorId); }
    catch { toast.error('Delete failed'); }
  };

  // ── QC Templates ────────────────────────────────────────────────────────────
  const [qc, setQc] = useState([]);
  const [qcOpen, setQcOpen] = useState(false);
  const [editQc, setEditQc] = useState(null);
  const [qcForm, setQcForm] = useState({ name: '', checks: [] });

  const loadQc = useCallback(() => {
    procurement.qcTemplates.getAll().then(r => setQc(Array.isArray(r.data) ? r.data : [])).catch(() => {});
  }, []);
  const openNewQc = () => { setEditQc(null); setQcForm({ name: '', checks: [{ label: '', type: 'boolean' }] }); setQcOpen(true); };
  const openEditQc = (t) => { setEditQc(t); setQcForm({ name: t.name, checks: (t.checks || []).map(c => ({ ...c })) }); setQcOpen(true); };
  const setCheck = (i, patch) => setQcForm(f => ({ ...f, checks: f.checks.map((c, j) => j === i ? { ...c, ...patch } : c) }));
  const addCheck = () => setQcForm(f => ({ ...f, checks: [...f.checks, { label: '', type: 'boolean' }] }));
  const removeCheck = (i) => setQcForm(f => ({ ...f, checks: f.checks.filter((_, j) => j !== i) }));
  const saveQc = async () => {
    if (!qcForm.name.trim()) { toast.error('Template name is required'); return; }
    const checks = qcForm.checks.filter(c => (c.label || '').trim());
    try {
      if (editQc) await procurement.qcTemplates.update(editQc.template_id, { name: qcForm.name, checks });
      else await procurement.qcTemplates.create({ name: qcForm.name, checks });
      toast.success(editQc ? 'Template updated' : 'Template created'); setQcOpen(false); loadQc();
    } catch (e) { toast.error(e?.response?.data?.detail || 'Save failed'); }
  };
  const deleteQc = async (t) => {
    if (!window.confirm(`Delete QC template "${t.name}"?`)) return;
    try { await procurement.qcTemplates.delete(t.template_id); loadQc(); }
    catch { toast.error('Delete failed'); }
  };

  // ── Initial load ────────────────────────────────────────────────────────────
  useEffect(() => { loadVendors(); loadItems(); loadQc(); }, [loadVendors, loadItems, loadQc]);

  const tab = TABS.find(t => t.id === activeTab);

  const vendorColumns = [
    { key: 'name', label: 'Vendor', primary: true },
    { key: 'gstin', label: 'GSTIN', hidden: 'md', mono: true },
    { key: 'contact_person', label: 'Contact', hidden: 'sm' },
    { key: 'phone', label: 'Phone', hidden: 'sm', mono: true },
    { key: 'state', label: 'State', hidden: 'md' },
    { key: 'is_active', label: 'Status', render: (v) => (
      <span className={`text-[10px] px-2 py-0.5 rounded font-medium ${v.is_active !== false ? 'bg-green-500/15 text-green-400' : 'bg-gray-500/15 text-gray-400'}`}>
        {v.is_active !== false ? 'Active' : 'Inactive'}</span>
    ) },
  ];
  const itemColumns = [
    { key: 'image_url', label: '', render: (it) => <Thumb url={it.image_url} /> },
    { key: 'name', label: 'Item', primary: true },
    { key: 'category', label: 'Category', hidden: 'sm' },
    { key: 'uom', label: 'UOM', hidden: 'md' },
    { key: 'hsn', label: 'HSN', hidden: 'md', mono: true },
    { key: 'gst_pct', label: 'GST%', render: (it) => `${it.gst_pct || 0}%` },
    { key: 'stock_qty', label: 'Stock', hidden: 'sm' },
  ];

  return (
    <AdminLayout>
      <div className="max-w-6xl mx-auto space-y-5">
        <div>
          <h1 className={`text-3xl sm:text-4xl font-semibold ${textPri} tracking-tight`} data-testid="procurement-masters-title">Procurement Masters</h1>
          <p className={`${textSec} mt-1 text-sm`}>Vendors, what they supply, purchase items, and QC checklists used across the procurement flow.</p>
        </div>

        {/* Tabs */}
        <div className={`${card} border rounded-md p-1 flex gap-1 flex-wrap`}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setActiveTab(t.id)} data-testid={`tab-${t.id}`}
              className={`flex-1 flex items-center justify-center gap-1.5 px-4 py-2 rounded text-sm font-medium transition-all ${activeTab === t.id ? 'bg-[#e94560] text-white' : `${textSec} hover:bg-[var(--bg-hover)]`}`}>
              <t.icon className="h-4 w-4" /> {t.label}
            </button>
          ))}
        </div>
        <p className={`text-xs ${textMuted}`}>{tab?.desc}</p>

        {/* VENDORS */}
        {activeTab === 'vendors' && (
          <div className={`${card} border rounded-md p-5`}>
            <div className="flex items-center justify-between mb-4">
              <h2 className={`text-lg font-medium ${textPri}`}>Vendors ({vendors.length})</h2>
              <Button onClick={openNewVendor} size="sm" className="bg-[#e94560] hover:bg-[#f05c75] text-white" data-testid="add-vendor-btn">
                <Plus className="mr-1 h-3 w-3" /> Add Vendor
              </Button>
            </div>
            <MasterEntityTable columns={vendorColumns} data={vendors} rowKey="vendor_id"
              onEdit={openEditVendor} onDelete={deleteVendor} testIdPrefix="vendor"
              emptyMsg="No vendors yet — click Add Vendor to create your first supplier." />
          </div>
        )}

        {/* PURCHASE ITEMS */}
        {activeTab === 'items' && (
          <div className={`${card} border rounded-md p-5`}>
            <div className="flex items-center justify-between mb-4">
              <h2 className={`text-lg font-medium ${textPri}`}>Purchase Items ({items.length})</h2>
              <Button onClick={openNewItem} size="sm" className="bg-[#e94560] hover:bg-[#f05c75] text-white" data-testid="add-purchase-item-btn">
                <Plus className="mr-1 h-3 w-3" /> Add Item
              </Button>
            </div>
            <MasterEntityTable columns={itemColumns} data={items} rowKey="purchase_item_id"
              onEdit={openEditItem} onDelete={deleteItem} testIdPrefix="pitem"
              emptyMsg="No purchase items yet — add raw materials / packaging / supplies." />
          </div>
        )}

        {/* VENDOR PRICE LIST */}
        {activeTab === 'pricelist' && (
          <div className={`${card} border rounded-md p-5`}>
            <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
              <div>
                <Label className={`${textSec} text-xs`}>Vendor</Label>
                <select value={plVendorId} onChange={e => setPlVendorId(e.target.value)}
                  className={`mt-1 h-9 px-3 rounded text-sm ${inputCls} block w-64`} data-testid="pricelist-vendor-select">
                  <option value="">Select vendor…</option>
                  {vendors.filter(v => v.is_active !== false).map(v => <option key={v.vendor_id} value={v.vendor_id}>{v.name}</option>)}
                </select>
              </div>
              <Button onClick={openNewPrice} size="sm" disabled={!plVendorId} className="bg-[#e94560] hover:bg-[#f05c75] text-white">
                <Plus className="mr-1 h-3 w-3" /> Add Item to Price List
              </Button>
            </div>
            {!plVendorId ? (
              <p className={`text-sm ${textMuted} text-center py-10`}>Select a vendor to see and edit which items they supply.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="bg-[var(--bg-primary)]">
                    {['Item', 'UOM', 'HSN', 'GST%', 'Default Rate', 'Lead time', ''].map(h => (
                      <th key={h} className={`text-left text-xs uppercase py-2.5 px-3 ${textMuted}`}>{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {priceRows.map(r => (
                      <tr key={r.vendor_item_id} className="border-t border-[var(--border-color)] hover:bg-[var(--bg-hover)]">
                        <td className={`py-2.5 px-3 ${textPri} font-medium`}>{r.name || r.item_ref?.id}
                          <span className={`ml-2 text-[10px] px-1.5 py-0.5 rounded ${r.item_ref?.source === 'die' ? 'bg-indigo-500/15 text-indigo-300' : 'bg-amber-500/15 text-amber-300'}`}>
                            {r.item_ref?.source === 'die' ? 'Product' : 'Material'}</span></td>
                        <td className={`py-2.5 px-3 ${textSec}`}>{r.uom}</td>
                        <td className={`py-2.5 px-3 ${textMuted} font-mono text-xs`}>{r.hsn || '—'}</td>
                        <td className={`py-2.5 px-3 ${textSec}`}>{r.gst_pct || 0}%</td>
                        <td className={`py-2.5 px-3 ${textPri}`}>₹{Number(r.default_rate || 0).toLocaleString('en-IN')}</td>
                        <td className={`py-2.5 px-3 ${textSec}`}>{r.lead_time_days || 0} d</td>
                        <td className="py-2.5 px-3 text-right">
                          <Button size="sm" variant="ghost" onClick={() => deletePrice(r)} className="text-red-400 h-7 px-1.5"><Trash2 className="h-3 w-3" /></Button>
                        </td>
                      </tr>
                    ))}
                    {priceRows.length === 0 && <tr><td colSpan={7} className={`py-10 text-center ${textMuted}`}>No items mapped to this vendor yet.</td></tr>}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* QC TEMPLATES */}
        {activeTab === 'qc' && (
          <div className={`${card} border rounded-md p-5`}>
            <div className="flex items-center justify-between mb-4">
              <h2 className={`text-lg font-medium ${textPri}`}>QC Templates ({qc.length})</h2>
              <Button onClick={openNewQc} size="sm" className="bg-[#e94560] hover:bg-[#f05c75] text-white">
                <Plus className="mr-1 h-3 w-3" /> Add Template
              </Button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {qc.map(t => (
                <div key={t.template_id} className={`${card} border rounded-md p-4`}>
                  <div className="flex items-center justify-between">
                    <h3 className={`${textPri} font-medium`}>{t.name}</h3>
                    <div className="flex">
                      <Button size="sm" variant="ghost" onClick={() => openEditQc(t)} className={`${textSec} h-7 px-1.5`}><Edit2 className="h-3 w-3" /></Button>
                      <Button size="sm" variant="ghost" onClick={() => deleteQc(t)} className="text-red-400 h-7 px-1.5"><Trash2 className="h-3 w-3" /></Button>
                    </div>
                  </div>
                  <ul className={`mt-2 space-y-1 text-xs ${textSec}`}>
                    {(t.checks || []).map((c, i) => (
                      <li key={i} className="flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#e94560]" />
                        {c.label} <span className={textMuted}>({c.type})</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              {qc.length === 0 && <p className={`text-xs ${textMuted} col-span-full text-center py-6`}>No QC templates yet.</p>}
            </div>
          </div>
        )}

        {/* ── DIALOGS ─────────────────────────────────────────────────────────── */}

        {/* VENDOR DIALOG */}
        <Dialog open={vendorOpen} onOpenChange={setVendorOpen}>
          <DialogContent className={`${dlgCls} w-[calc(100vw-1rem)] sm:max-w-2xl max-h-[88dvh] overflow-y-auto`}>
            <DialogHeader><DialogTitle className={textPri}>{editVendor ? 'Edit Vendor' : 'Add Vendor'}</DialogTitle></DialogHeader>
            <div className="space-y-3 py-2">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div><Label className={`${textSec} text-xs`}>Vendor Name *</Label><Input value={vendorForm.name} onChange={e => setVendorForm({ ...vendorForm, name: e.target.value })} className={inputCls} placeholder="e.g. Shree Packaging Co." data-testid="vendor-name-input" /></div>
                <div><Label className={`${textSec} text-xs`}>Contact Person</Label><Input value={vendorForm.contact_person} onChange={e => setVendorForm({ ...vendorForm, contact_person: e.target.value })} className={inputCls} /></div>
                <div><Label className={`${textSec} text-xs`}>GSTIN</Label><Input value={vendorForm.gstin} onChange={e => setVendorForm({ ...vendorForm, gstin: e.target.value.toUpperCase() })} className={inputCls} placeholder="22AAAAA0000A1Z5" /></div>
                <div><Label className={`${textSec} text-xs`}>PAN</Label><Input value={vendorForm.pan} onChange={e => setVendorForm({ ...vendorForm, pan: e.target.value.toUpperCase() })} className={inputCls} /></div>
                <div><Label className={`${textSec} text-xs`}>Phone</Label><Input value={vendorForm.phone} onChange={e => setVendorForm({ ...vendorForm, phone: e.target.value })} className={inputCls} /></div>
                <div><Label className={`${textSec} text-xs`}>Email</Label><Input type="email" value={vendorForm.email} onChange={e => setVendorForm({ ...vendorForm, email: e.target.value })} className={inputCls} /></div>
              </div>
              <div><Label className={`${textSec} text-xs`}>Address</Label><Input value={vendorForm.address} onChange={e => setVendorForm({ ...vendorForm, address: e.target.value })} className={inputCls} /></div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div><Label className={`${textSec} text-xs`}>City</Label><Input value={vendorForm.city} onChange={e => setVendorForm({ ...vendorForm, city: e.target.value })} className={inputCls} /></div>
                <div><Label className={`${textSec} text-xs`}>State</Label><Input value={vendorForm.state} onChange={e => setVendorForm({ ...vendorForm, state: e.target.value })} className={inputCls} /></div>
                <div><Label className={`${textSec} text-xs`}>State Code</Label><Input value={vendorForm.state_code} onChange={e => setVendorForm({ ...vendorForm, state_code: e.target.value })} className={inputCls} placeholder="e.g. 22" /></div>
                <div><Label className={`${textSec} text-xs`}>Payment Terms</Label><Input value={vendorForm.payment_terms} onChange={e => setVendorForm({ ...vendorForm, payment_terms: e.target.value })} className={inputCls} placeholder="e.g. 30 days" /></div>
              </div>
              <p className={`text-[11px] ${textMuted}`}>State code decides CGST/SGST (same state) vs IGST (other state) on the PO.</p>
              <div className="flex items-center gap-3">
                {(logoFile || vendorForm.logo_url) && <Thumb url={logoFile ? URL.createObjectURL(logoFile) : vendorForm.logo_url} size={48} />}
                <label className={`inline-flex items-center gap-2 text-sm ${textSec} cursor-pointer px-3 py-2 rounded border border-[var(--border-color)] hover:bg-[var(--bg-hover)]`}>
                  <Upload className="h-3.5 w-3.5" /> {logoFile ? logoFile.name : 'Upload logo (optional)'}
                  <input type="file" accept="image/*" className="hidden" onChange={e => setLogoFile(e.target.files?.[0] || null)} />
                </label>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setVendorOpen(false)} className="border-[var(--border-color)] text-[var(--text-secondary)]">Cancel</Button>
              <Button onClick={saveVendor} className="bg-[#e94560] hover:bg-[#f05c75] text-white" data-testid="save-vendor-btn">{editVendor ? 'Update' : 'Create'}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* PURCHASE ITEM DIALOG */}
        <Dialog open={itemOpen} onOpenChange={setItemOpen}>
          <DialogContent className={`${dlgCls} w-[calc(100vw-1rem)] sm:max-w-xl max-h-[88dvh] overflow-y-auto`}>
            <DialogHeader><DialogTitle className={textPri}>{editItem ? 'Edit Purchase Item' : 'Add Purchase Item'}</DialogTitle></DialogHeader>
            <div className="space-y-3 py-2">
              <div className="flex items-center gap-3">
                {(itemImage || itemForm.image_url) && <Thumb url={itemImage ? URL.createObjectURL(itemImage) : itemForm.image_url} size={56} />}
                <label className={`inline-flex items-center gap-2 text-sm ${textSec} cursor-pointer px-3 py-2 rounded border border-[var(--border-color)] hover:bg-[var(--bg-hover)]`}>
                  <Upload className="h-3.5 w-3.5" /> {itemImage ? itemImage.name : 'Upload image'}
                  <input type="file" accept="image/*" className="hidden" onChange={e => setItemImage(e.target.files?.[0] || null)} />
                </label>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div><Label className={`${textSec} text-xs`}>Item Name *</Label><Input value={itemForm.name} onChange={e => setItemForm({ ...itemForm, name: e.target.value })} className={inputCls} placeholder="e.g. Corrugated Box 12x8" data-testid="pitem-name-input" /></div>
                <div><Label className={`${textSec} text-xs`}>Category</Label><Input value={itemForm.category} onChange={e => setItemForm({ ...itemForm, category: e.target.value })} className={inputCls} placeholder="Packaging / Raw material" /></div>
                <div><Label className={`${textSec} text-xs`}>UOM</Label><Input value={itemForm.uom} onChange={e => setItemForm({ ...itemForm, uom: e.target.value })} className={inputCls} placeholder="pcs / kg / box" /></div>
                <div><Label className={`${textSec} text-xs`}>HSN</Label><Input value={itemForm.hsn} onChange={e => setItemForm({ ...itemForm, hsn: e.target.value })} className={inputCls} /></div>
                <div><Label className={`${textSec} text-xs`}>GST %</Label><Input type="number" value={itemForm.gst_pct} onChange={e => setItemForm({ ...itemForm, gst_pct: e.target.value })} className={inputCls} /></div>
                <div><Label className={`${textSec} text-xs`}>Default Rate (₹)</Label><Input type="number" value={itemForm.default_rate} onChange={e => setItemForm({ ...itemForm, default_rate: e.target.value })} className={inputCls} /></div>
                <div><Label className={`${textSec} text-xs`}>Min Level</Label><Input type="number" value={itemForm.min_level} onChange={e => setItemForm({ ...itemForm, min_level: e.target.value })} className={inputCls} /></div>
                <div><Label className={`${textSec} text-xs`}>Opening Stock</Label><Input type="number" value={itemForm.stock_qty} onChange={e => setItemForm({ ...itemForm, stock_qty: e.target.value })} className={inputCls} disabled={!!editItem} /></div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setItemOpen(false)} className="border-[var(--border-color)] text-[var(--text-secondary)]">Cancel</Button>
              <Button onClick={saveItem} className="bg-[#e94560] hover:bg-[#f05c75] text-white" data-testid="save-pitem-btn">{editItem ? 'Update' : 'Create'}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* PRICE LIST DIALOG */}
        <Dialog open={plOpen} onOpenChange={setPlOpen}>
          <DialogContent className={`${dlgCls} max-w-lg`}>
            <DialogHeader><DialogTitle className={textPri}>Add Item to Price List</DialogTitle></DialogHeader>
            <div className="space-y-3 py-2">
              <div>
                <Label className={`${textSec} text-xs`}>Item *</Label>
                <select value={plForm.item_ref ? `${plForm.item_ref.source}:${plForm.item_ref.id}` : ''} onChange={e => onPickCatalogItem(e.target.value)}
                  className={`mt-1 h-9 px-3 rounded text-sm ${inputCls} block w-full`}>
                  <option value="">Select item…</option>
                  <optgroup label="Finished Products (dies)">
                    {catalog.filter(c => c.source === 'die').map(c => <option key={`die:${c.id}`} value={`die:${c.id}`}>{c.name}</option>)}
                  </optgroup>
                  <optgroup label="Purchase Items">
                    {catalog.filter(c => c.source === 'purchase_item').map(c => <option key={`purchase_item:${c.id}`} value={`purchase_item:${c.id}`}>{c.name}</option>)}
                  </optgroup>
                </select>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div><Label className={`${textSec} text-xs`}>Default Rate (₹)</Label><Input type="number" value={plForm.default_rate} onChange={e => setPlForm({ ...plForm, default_rate: e.target.value })} className={inputCls} /></div>
                <div><Label className={`${textSec} text-xs`}>HSN</Label><Input value={plForm.hsn} onChange={e => setPlForm({ ...plForm, hsn: e.target.value })} className={inputCls} /></div>
                <div><Label className={`${textSec} text-xs`}>GST %</Label><Input type="number" value={plForm.gst_pct} onChange={e => setPlForm({ ...plForm, gst_pct: e.target.value })} className={inputCls} /></div>
                <div><Label className={`${textSec} text-xs`}>UOM</Label><Input value={plForm.uom} onChange={e => setPlForm({ ...plForm, uom: e.target.value })} className={inputCls} /></div>
                <div><Label className={`${textSec} text-xs`}>Lead time (days)</Label><Input type="number" value={plForm.lead_time_days} onChange={e => setPlForm({ ...plForm, lead_time_days: e.target.value })} className={inputCls} /></div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setPlOpen(false)} className="border-[var(--border-color)] text-[var(--text-secondary)]">Cancel</Button>
              <Button onClick={savePrice} className="bg-[#e94560] hover:bg-[#f05c75] text-white">Save</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* QC TEMPLATE DIALOG */}
        <Dialog open={qcOpen} onOpenChange={setQcOpen}>
          <DialogContent className={`${dlgCls} w-[calc(100vw-1rem)] sm:max-w-lg max-h-[88dvh] overflow-y-auto`}>
            <DialogHeader><DialogTitle className={textPri}>{editQc ? 'Edit QC Template' : 'Add QC Template'}</DialogTitle></DialogHeader>
            <div className="space-y-3 py-2">
              <div><Label className={`${textSec} text-xs`}>Template Name *</Label><Input value={qcForm.name} onChange={e => setQcForm({ ...qcForm, name: e.target.value })} className={inputCls} placeholder="e.g. Inbound QC" /></div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <Label className={`${textSec} text-xs`}>Checks</Label>
                  <Button size="sm" variant="ghost" onClick={addCheck} className={`${textSec} h-7`}><Plus className="h-3 w-3 mr-1" /> Add check</Button>
                </div>
                <div className="space-y-2">
                  {qcForm.checks.map((c, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <Input value={c.label} onChange={e => setCheck(i, { label: e.target.value })} className={`${inputCls} flex-1`} placeholder="Check label" />
                      <select value={c.type} onChange={e => setCheck(i, { type: e.target.value })} className={`h-9 px-2 rounded text-sm ${inputCls}`}>
                        <option value="boolean">Yes/No</option>
                        <option value="text">Text</option>
                        <option value="select">Select</option>
                      </select>
                      <Button size="sm" variant="ghost" onClick={() => removeCheck(i)} className="text-red-400 h-8 px-1.5"><Trash2 className="h-3 w-3" /></Button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setQcOpen(false)} className="border-[var(--border-color)] text-[var(--text-secondary)]">Cancel</Button>
              <Button onClick={saveQc} className="bg-[#e94560] hover:bg-[#f05c75] text-white">{editQc ? 'Update' : 'Create'}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AdminLayout>
  );
}

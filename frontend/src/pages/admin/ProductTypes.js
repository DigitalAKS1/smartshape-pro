import React, { useState, useEffect, useCallback } from 'react';
import AdminLayout from '../../components/layouts/AdminLayout';
import { productTypes as ptApi, formatApiErrorDetail } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { Layers, Plus, Edit2, Trash2, Eye, EyeOff, X } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { toast } from 'sonner';

const BLANK = { name: '', code_prefix: '', visible_to_schools: true, uses_quota: false, sort_order: 100 };

export default function ProductTypes() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [types, setTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // null = closed; {} = new; {…} = edit
  const [form, setForm] = useState(BLANK);
  const [saving, setSaving] = useState(false);

  const card = 'bg-[var(--bg-card)] border-[var(--border-color)]';
  const inputCls = 'bg-[var(--bg-primary)] border border-[var(--border-color)] text-[var(--text-primary)] rounded-md px-2 h-9 text-sm w-full';
  const textPri = 'text-[var(--text-primary)]';
  const textMuted = 'text-[var(--text-muted)]';

  const fetchTypes = useCallback(async () => {
    try { const res = await ptApi.getAll(); setTypes(res.data); }
    catch { toast.error('Failed to load product types'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchTypes(); }, [fetchTypes]);

  const openNew = () => { setForm(BLANK); setEditing({}); };
  const openEdit = (t) => {
    setForm({ name: t.name, code_prefix: t.code_prefix || '', visible_to_schools: !!t.visible_to_schools,
      uses_quota: !!t.uses_quota, sort_order: t.sort_order ?? 100 });
    setEditing(t);
  };

  const save = async () => {
    if (!form.name.trim()) { toast.error('Name is required'); return; }
    setSaving(true);
    try {
      if (editing.product_type_id) await ptApi.update(editing.product_type_id, form);
      else await ptApi.create(form);
      toast.success(editing.product_type_id ? 'Product type updated' : 'Product type added');
      setEditing(null); fetchTypes();
    } catch (err) {
      toast.error(err.response?.data?.detail ? formatApiErrorDetail(err.response.data.detail) : 'Failed');
    } finally { setSaving(false); }
  };

  const toggleVisible = async (t) => {
    try { await ptApi.update(t.product_type_id, { visible_to_schools: !t.visible_to_schools }); fetchTypes(); }
    catch (err) { toast.error(err.response?.data?.detail ? formatApiErrorDetail(err.response.data.detail) : 'Failed'); }
  };

  const remove = async (t) => {
    if (!window.confirm(`Delete product type "${t.name}"? This cannot be undone.`)) return;
    try { await ptApi.remove(t.product_type_id); toast.success('Deleted'); fetchTypes(); }
    catch (err) { toast.error(err.response?.data?.detail ? formatApiErrorDetail(err.response.data.detail) : 'Failed'); }
  };

  if (!isAdmin) {
    return <AdminLayout><div className={`${textMuted} p-8 text-center`}>Admin access required.</div></AdminLayout>;
  }

  return (
    <AdminLayout>
      <div className="space-y-4 max-w-3xl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-[#e94560]/10"><Layers className="h-5 w-5 text-[#e94560]" /></div>
            <div>
              <h1 className={`text-2xl font-semibold ${textPri} tracking-tight`}>Product Types</h1>
              <p className={`${textMuted} text-xs mt-0.5`}>Master list of product categories (Dies, Machine, Stamps…)</p>
            </div>
          </div>
          <Button onClick={openNew} size="sm" className="bg-[#e94560] hover:bg-[#f05c75] text-white h-9">
            <Plus className="h-4 w-4 sm:mr-1" /><span className="hidden sm:inline">Add Type</span>
          </Button>
        </div>

        {loading ? (
          <div className="flex justify-center py-16"><div className="animate-spin rounded-full h-8 w-8 border-4 border-[#e94560] border-t-transparent" /></div>
        ) : (
          <div className={`${card} border rounded-xl divide-y divide-[var(--border-color)]`}>
            {types.length === 0 && <p className={`p-8 text-center text-sm ${textMuted}`}>No product types yet.</p>}
            {types.map(t => (
              <div key={t.product_type_id} className="flex items-center gap-3 p-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`font-medium ${textPri}`}>{t.name}</span>
                    {t.code_prefix && <span className={`text-xs font-mono px-1.5 py-0.5 rounded bg-[var(--bg-primary)] ${textMuted}`}>{t.code_prefix}</span>}
                    {t.uses_quota && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-500/15 text-blue-400">quota</span>}
                    {t.is_active === false && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-500/20 text-gray-400">archived</span>}
                  </div>
                </div>
                <button onClick={() => toggleVisible(t)} title={t.visible_to_schools ? 'Visible to schools' : 'Hidden from schools'}
                  className={`flex items-center gap-1 text-xs px-2 py-1 rounded-md ${t.visible_to_schools ? 'text-green-500 bg-green-500/10' : `${textMuted} bg-[var(--bg-primary)]`}`}>
                  {t.visible_to_schools ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                  <span className="hidden sm:inline">{t.visible_to_schools ? 'Schools' : 'Hidden'}</span>
                </button>
                <button onClick={() => openEdit(t)} className={`p-1.5 rounded-md hover:bg-[var(--bg-hover)] ${textMuted}`} title="Edit"><Edit2 className="h-4 w-4" /></button>
                <button onClick={() => remove(t)} className="p-1.5 rounded-md hover:bg-red-500/10 text-red-400" title="Delete"><Trash2 className="h-4 w-4" /></button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add / Edit panel */}
      {editing && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => setEditing(null)}>
          <div className={`${card} border rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md p-4 space-y-3`} onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className={`font-semibold ${textPri}`}>{editing.product_type_id ? 'Edit Product Type' : 'Add Product Type'}</h2>
              <button onClick={() => setEditing(null)} className={textMuted}><X className="h-5 w-5" /></button>
            </div>
            <div>
              <label className={`block text-xs font-medium mb-1 ${textMuted}`}>Name *</label>
              <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Machine" className={inputCls} />
            </div>
            <div>
              <label className={`block text-xs font-medium mb-1 ${textMuted}`}>Code prefix</label>
              <input value={form.code_prefix} onChange={e => setForm({ ...form, code_prefix: e.target.value })} placeholder="e.g. SSM" className={`${inputCls} font-mono uppercase`} />
              <p className={`text-[10px] ${textMuted} mt-1`}>Used to suggest product codes like SSM-001.</p>
            </div>
            <div>
              <label className={`block text-xs font-medium mb-1 ${textMuted}`}>Sort order</label>
              <input type="number" value={form.sort_order} onChange={e => setForm({ ...form, sort_order: Number(e.target.value) })} className={inputCls} />
            </div>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={form.visible_to_schools} onChange={e => setForm({ ...form, visible_to_schools: e.target.checked })} />
              <span className={textPri}>Visible to schools (shown in catalogue)</span>
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={form.uses_quota} onChange={e => setForm({ ...form, uses_quota: e.target.checked })} />
              <span className={textPri}>Counts toward package Standard/Large quota</span>
            </label>
            <div className="flex gap-2 pt-1">
              <Button onClick={save} disabled={saving} className="flex-1 bg-[#e94560] hover:bg-[#f05c75] text-white">{saving ? 'Saving…' : 'Save'}</Button>
              <Button onClick={() => setEditing(null)} variant="outline" className="flex-1">Cancel</Button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}

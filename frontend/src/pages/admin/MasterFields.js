import React, { useState, useEffect, useCallback } from 'react';
import AdminLayout from '../../components/layouts/AdminLayout';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../../components/ui/dialog';
import { Plus, SlidersHorizontal } from 'lucide-react';
import { toast } from 'sonner';
import { fields as fieldsApi } from '../../lib/api';
import { useDataSync } from '../../lib/dataSync';
import MasterEntityTable from '../../components/crm/MasterEntityTable';

const ENTITIES = ['school', 'contact', 'lead'];
const TYPES = ['text', 'number', 'date', 'email', 'phone', 'url', 'select', 'multiselect', 'boolean'];

const card      = 'bg-[var(--bg-card)] border-[var(--border-color)]';
const inputCls  = 'bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]';
const textPri   = 'text-[var(--text-primary)]';
const textSec   = 'text-[var(--text-secondary)]';
const textMuted = 'text-[var(--text-muted)]';
const dlgCls    = 'bg-[var(--bg-card)] border-[var(--border-color)] text-[var(--text-primary)]';

const EMPTY_FORM = { label: '', type: 'text', options_raw: '' };

const columns = [
  { key: 'label',   label: 'Field Label', primary: true },
  { key: 'type',    label: 'Type' },
  { key: 'is_core', label: 'Core', render: r => r.is_core ? (
    <span className="text-[10px] px-2 py-0.5 rounded font-medium bg-blue-500/15 text-blue-400">Core</span>
  ) : '' },
];

export default function MasterFields() {
  const [entity, setEntity] = useState('school');
  const [rows, setRows]     = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen]     = useState(false);
  const [form, setForm]     = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    fieldsApi.list(entity)
      .then(r => setRows(Array.isArray(r.data) ? r.data : []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [entity]);

  useEffect(() => { load(); }, [load]);
  useDataSync('settings', load);

  const openAdd = () => { setForm(EMPTY_FORM); setOpen(true); };

  const save = async () => {
    const label = form.label.trim();
    if (!label) { toast.error('Label is required'); return; }
    setSaving(true);
    try {
      const options = form.type === 'select' || form.type === 'multiselect'
        ? form.options_raw.split(',').map(s => s.trim()).filter(Boolean)
        : [];
      await fieldsApi.create({ label, type: form.type, entity, ...(options.length ? { options } : {}) });
      toast.success(`Field "${label}" added`);
      setOpen(false);
      setForm(EMPTY_FORM);
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Failed to create field');
    } finally { setSaving(false); }
  };

  const del = async (row) => {
    if (row.is_core) {
      toast.error('Core fields cannot be deleted');
      return;
    }
    if (!window.confirm(`Delete field "${row.label}"?`)) return;
    try {
      await fieldsApi.remove(row.field_id);
      toast.success(`Field "${row.label}" deleted`);
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Delete failed');
    }
  };

  // MasterEntityTable requires onEdit — provide a no-op since core fields are not editable here
  const onEdit = () => {};

  return (
    <AdminLayout>
      <div className="max-w-4xl mx-auto space-y-5">
        <div>
          <h1 className={`text-3xl sm:text-4xl font-semibold ${textPri} tracking-tight flex items-center gap-2`}>
            <SlidersHorizontal className="h-7 w-7 text-[#e94560]" />
            Master Fields
          </h1>
          <p className={`${textSec} mt-1 text-sm`}>
            Define custom fields for schools, contacts, and leads — these appear dynamically in forms throughout the app.
          </p>
        </div>

        {/* Entity tabs */}
        <div className={`${card} border rounded-md p-1 flex gap-1`}>
          {ENTITIES.map(e => (
            <button
              key={e}
              onClick={() => setEntity(e)}
              className={`flex-shrink-0 px-4 py-2 rounded text-sm font-medium capitalize whitespace-nowrap transition-all ${
                entity === e
                  ? 'bg-[#e94560] text-white shadow-sm'
                  : `${textSec} hover:bg-[var(--bg-hover)]`
              }`}
            >
              {e}
            </button>
          ))}
        </div>

        {/* Field table */}
        <div className={`${card} border rounded-md p-5`}>
          <div className="flex items-center justify-between mb-4">
            <h2 className={`text-lg font-medium ${textPri} capitalize`}>
              {entity} fields
              <span className="ml-2 inline-flex items-center justify-center min-w-[1.5rem] h-6 px-2 rounded-full text-xs font-semibold bg-[var(--accent-bg)] text-[#e94560]">
                {rows.length}
              </span>
            </h2>
            <Button
              onClick={openAdd}
              size="sm"
              className="bg-[#e94560] hover:bg-[#f05c75] text-white"
              data-testid="add-field-btn"
            >
              <Plus className="mr-1 h-3 w-3" /> Add Field
            </Button>
          </div>

          {loading ? (
            <div className="flex justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-2 border-gray-300 border-t-[#e94560]" />
            </div>
          ) : (
            <MasterEntityTable
              columns={columns}
              data={rows}
              rowKey="field_id"
              onEdit={onEdit}
              onDelete={del}
              emptyMsg={`No custom fields for ${entity} yet — click Add Field to create one.`}
              testIdPrefix="field"
            />
          )}
        </div>

        {/* Add Field Dialog */}
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className={`${dlgCls} max-w-sm`}>
            <DialogHeader>
              <DialogTitle className={textPri}>Add Field</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-2" translate="no">
              <div>
                <Label className={`${textSec} text-xs`}>Field Label *</Label>
                <Input
                  value={form.label}
                  onChange={e => setForm({ ...form, label: e.target.value })}
                  className={inputCls}
                  placeholder="e.g. GST Number"
                  data-testid="field-label-input"
                  autoFocus
                />
              </div>
              <div>
                <Label className={`${textSec} text-xs`}>Field Type</Label>
                <select
                  value={form.type}
                  onChange={e => setForm({ ...form, type: e.target.value })}
                  className={`mt-1 w-full border rounded p-2 text-sm ${inputCls}`}
                  data-testid="field-type-select"
                >
                  {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              {(form.type === 'select' || form.type === 'multiselect') && (
                <div>
                  <Label className={`${textSec} text-xs`}>
                    Options <span className={textMuted}>(comma-separated)</span>
                  </Label>
                  <Input
                    value={form.options_raw}
                    onChange={e => setForm({ ...form, options_raw: e.target.value })}
                    className={inputCls}
                    placeholder="Option A, Option B, Option C"
                    data-testid="field-options-input"
                  />
                </div>
              )}
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setOpen(false)}
                className="border-[var(--border-color)] text-[var(--text-secondary)]"
              >
                Cancel
              </Button>
              <Button
                onClick={save}
                disabled={saving || !form.label.trim()}
                className="bg-[#e94560] hover:bg-[#f05c75] text-white"
                data-testid="save-field-btn"
              >
                {saving ? 'Saving…' : 'Save Field'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AdminLayout>
  );
}

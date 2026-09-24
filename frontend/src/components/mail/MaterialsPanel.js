import React, { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { mailMaterials } from '../../lib/api';
import { Package, Plus, Archive, RotateCcw, Pencil, Check, X } from 'lucide-react';

// D3: the one place the Materials list is edited. Retiring a material never
// deletes it — drip steps that name it must keep firing and their history must
// keep reading back — so this panel asks for the retired rows too (`all: 1`)
// and can bring one back.
export default function MaterialsPanel() {
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState({ name: '', piece_type: 'other' });
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(null);   // { material_id, name }

  const load = useCallback(async () => {
    try {
      const r = await mailMaterials.list({ all: 1 });
      setRows(Array.isArray(r?.data) ? r.data : []);
    } catch { toast.error('Could not load materials'); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const add = async () => {
    const name = form.name.trim();
    if (!name) { toast.error('Give the material a name'); return; }
    setBusy(true);
    try {
      await mailMaterials.create({ name, piece_type: (form.piece_type || 'other').trim() });
      toast.success('Material added');
      setForm({ name: '', piece_type: 'other' });
      await load();
    } catch (e) {
      const detail = e?.response?.data?.detail || '';
      // The name belongs to a RETIRED material. A second row by the same name
      // is never what was wanted, so offer what was: bring the original back.
      const retired = e?.response?.status === 409 && detail.includes('(retired)')
        ? rows.find(r => r.active === false
            && (r.name || '').toLowerCase() === name.toLowerCase())
        : null;
      if (retired && window.confirm(
        `"${retired.name}" already exists but is retired.\n\nBring it back instead?`)) {
        try {
          await mailMaterials.update(retired.material_id, { active: true });
          toast.success('Material restored');
          setForm({ name: '', piece_type: 'other' });
          await load();
        } catch (e2) { toast.error(e2?.response?.data?.detail || 'Could not restore it'); }
      } else {
        toast.error(detail || 'Could not add it');
      }
    } finally { setBusy(false); }
  };

  const saveName = async () => {
    const name = (editing?.name || '').trim();
    if (!name) { toast.error('Give the material a name'); return; }
    try {
      await mailMaterials.update(editing.material_id, { name });
      setEditing(null);
      await load();
    } catch (e) { toast.error(e?.response?.data?.detail || 'Rename failed'); }
  };

  const setActive = async (m, active) => {
    if (!active && !window.confirm(
      `Retire "${m.name}"?\n\nSequences already using it keep working — it just stops being offered.`)) return;
    try {
      if (active) await mailMaterials.update(m.material_id, { active: true });
      else await mailMaterials.remove(m.material_id);
      await load();
    } catch { toast.error('Update failed'); }
  };

  const card = 'bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl';
  const inp = 'h-10 w-full rounded-lg px-3 text-sm bg-[var(--bg-primary)] border border-[var(--border-color)] text-[var(--text-primary)]';
  const btnP = 'inline-flex items-center gap-1.5 h-10 px-3.5 rounded-lg bg-[#e94560] hover:bg-[#f05c75] text-white text-sm font-semibold disabled:opacity-50';
  const iconBtn = 'h-8 w-8 flex items-center justify-center rounded-lg text-[var(--text-muted)]';

  return (
    <div className={`${card} p-5`} data-testid="materials-panel">
      <h2 className="text-lg font-medium text-[var(--text-primary)] flex items-center gap-2 mb-1">
        <Package className="h-4 w-4 text-[#e94560]" /> Materials
      </h2>
      <p className="text-xs text-[var(--text-muted)] mb-4">
        One list for everything you post. Drip steps and manual mail runs both pick from here,
        so a catalogue you can plan is a catalogue you can actually post.
      </p>

      <div className="mb-4 grid gap-3 sm:grid-cols-[1fr_180px_auto]">
        <input className={inp} placeholder="Material name (e.g. 2026 Die Catalogue)"
          value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
          data-testid="material-new-name" />
        <input className={inp} placeholder="Piece type (e.g. catalogue)"
          value={form.piece_type} onChange={e => setForm(p => ({ ...p, piece_type: e.target.value }))}
          data-testid="material-new-piece" />
        <button className={btnP} disabled={busy} onClick={add} data-testid="material-add">
          <Plus className="h-3.5 w-3.5" /> Add
        </button>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {rows.map(m => (
          <div key={m.material_id} data-testid={`material-row-${m.material_id}`}
            className="flex items-center justify-between gap-2 p-3 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-color)]">
            <div className="min-w-0 flex-1">
              {editing && editing.material_id === m.material_id ? (
                <input className={`${inp} h-8`} value={editing.name} autoFocus
                  onChange={e => setEditing(p => ({ ...p, name: e.target.value }))}
                  data-testid={`material-name-${m.material_id}`} />
              ) : (
                <p className="text-sm font-semibold text-[var(--text-primary)] truncate">
                  {m.name}
                  {m.active === false ? (
                    <span className="ml-1.5 text-[10px] font-normal text-[var(--text-muted)]">retired</span>
                  ) : null}
                </p>
              )}
              {/* The stored value. A drip step's `material_type` and a run's
                  `piece_type` are this, not the label above it. */}
              <p className="text-[11px] text-[var(--text-muted)] font-mono">{m.piece_type}</p>
            </div>
            <div className="flex items-center flex-shrink-0">
              {editing && editing.material_id === m.material_id ? (
                <>
                  <button title="Save" onClick={saveName}
                    data-testid={`material-save-${m.material_id}`}
                    className={`${iconBtn} hover:text-[#2E7D5B]`}><Check className="h-3.5 w-3.5" /></button>
                  <button title="Cancel" onClick={() => setEditing(null)}
                    data-testid={`material-cancel-${m.material_id}`}
                    className={iconBtn}><X className="h-3.5 w-3.5" /></button>
                </>
              ) : (
                <button title="Rename"
                  onClick={() => setEditing({ material_id: m.material_id, name: m.name })}
                  data-testid={`material-rename-${m.material_id}`}
                  className={`${iconBtn} hover:text-[#e94560]`}><Pencil className="h-3.5 w-3.5" /></button>
              )}
              {m.active === false ? (
                <button title="Bring back" onClick={() => setActive(m, true)}
                  data-testid={`material-restore-${m.material_id}`}
                  className={`${iconBtn} hover:text-[#e94560]`}><RotateCcw className="h-3.5 w-3.5" /></button>
              ) : (
                <button title="Retire" onClick={() => setActive(m, false)}
                  data-testid={`material-deactivate-${m.material_id}`}
                  className={`${iconBtn} hover:text-red-500`}><Archive className="h-3.5 w-3.5" /></button>
              )}
            </div>
          </div>
        ))}
        {rows.length === 0 && (
          <p className="text-sm text-[var(--text-muted)] py-6 text-center sm:col-span-2">
            No materials yet.
          </p>
        )}
      </div>
    </div>
  );
}

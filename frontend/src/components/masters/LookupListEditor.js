import React, { useState } from 'react';
import { Plus, Edit2, Trash2, Check, X, Eye, EyeOff } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { lookups as lookupsApi } from '../../lib/api';
import useLookup from '../../hooks/useLookup';

const card = 'bg-[var(--bg-card)] border-[var(--border-color)]';
const inputCls = 'bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]';
const textPri = 'text-[var(--text-primary)]';
const textMuted = 'text-[var(--text-muted)]';

/**
 * Editor for one lookup master list. Anyone signed in can add; rename,
 * hide/show and delete are admin-only (the server enforces it too).
 * A value in use can't be deleted — the server answers 409 and we suggest hiding it.
 */
export default function LookupListEditor({ listKey, title, placeholder = 'Add new…', canEdit }) {
  const { items, setItems, loaded } = useLookup(listKey);
  const [newName, setNewName] = useState('');
  const [editId, setEditId] = useState(null);
  const [editName, setEditName] = useState('');

  const replace = (row) => setItems(prev => prev.map(i => (i.lookup_id === row.lookup_id ? { ...i, ...row } : i)));

  const add = async () => {
    const name = newName.trim();
    if (!name) return;
    try {
      const r = await lookupsApi.create(listKey, { name });
      setNewName('');
      setItems(prev => (prev.some(i => i.lookup_id === r.data.lookup_id) ? prev : [...prev, { ...r.data, usage: 0 }]));
      toast.success(`Added "${r.data.name}"`);
    } catch (e) { toast.error(e?.response?.data?.detail || 'Could not add'); }
  };

  const saveRename = async (item) => {
    const name = editName.trim();
    if (!name || name === item.name) { setEditId(null); return; }
    try {
      const r = await lookupsApi.update(listKey, item.lookup_id, { name });
      replace(r.data);
      setEditId(null);
      toast.success(item.usage ? `Renamed — ${item.usage} record(s) updated` : 'Renamed');
    } catch (e) { toast.error(e?.response?.data?.detail || 'Rename failed'); }
  };

  const toggleActive = async (item) => {
    try {
      const r = await lookupsApi.update(listKey, item.lookup_id, { is_active: item.is_active === false });
      replace(r.data);
    } catch (e) { toast.error(e?.response?.data?.detail || 'Update failed'); }
  };

  const remove = async (item) => {
    if (!window.confirm(`Delete "${item.name}"?`)) return;
    try {
      await lookupsApi.remove(listKey, item.lookup_id);
      setItems(prev => prev.filter(i => i.lookup_id !== item.lookup_id));
    } catch (e) {
      if (e?.response?.status === 409) toast.error(`Used by ${item.usage || 'some'} record(s) — hide it instead`);
      else toast.error(e?.response?.data?.detail || 'Delete failed');
    }
  };

  return (
    <div className={`${card} border rounded-md p-5`} data-testid={`lookup-editor-${listKey}`}>
      <div className="flex flex-wrap items-center justify-between mb-4 gap-2">
        <h2 className={`text-lg font-medium ${textPri} flex items-center gap-2`}>
          {title}
          <span className="inline-flex items-center justify-center min-w-[1.5rem] h-6 px-2 rounded-full text-xs font-semibold bg-[var(--accent-bg)] text-[#e94560]">{items.length}</span>
        </h2>
        <div className="flex gap-2">
          <Input value={newName} onChange={e => setNewName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') add(); }}
            placeholder={placeholder} className={`${inputCls} h-9 text-sm w-48`} data-testid={`lookup-new-${listKey}`} />
          <Button onClick={add} size="sm" className="bg-[#e94560] hover:bg-[#f05c75] text-white" data-testid={`lookup-add-${listKey}`}>
            <Plus className="mr-1 h-3 w-3" /> Add
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
        {items.map(item => {
          const hidden = item.is_active === false;
          return (
            <div key={item.lookup_id || item.value}
              className={`flex items-center justify-between ${card} border rounded-md p-2.5 gap-2 ${hidden ? 'opacity-60' : ''}`}
              data-testid={`lookup-row-${listKey}-${item.value}`}>
              {editId === item.lookup_id ? (
                <>
                  <Input autoFocus value={editName} onChange={e => setEditName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') saveRename(item); if (e.key === 'Escape') setEditId(null); }}
                    className={`${inputCls} h-7 text-sm`} />
                  <div className="flex shrink-0">
                    <Button size="sm" variant="ghost" onClick={() => saveRename(item)} className="h-7 px-1.5 text-green-500"><Check className="h-3.5 w-3.5" /></Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditId(null)} className={`h-7 px-1.5 ${textMuted}`}><X className="h-3.5 w-3.5" /></Button>
                  </div>
                </>
              ) : (
                <>
                  <div className="min-w-0">
                    <p className={`${textPri} text-sm truncate`}>{item.name}{hidden && <span className={`ml-1.5 text-[10px] ${textMuted}`}>(hidden)</span>}</p>
                    {loaded && <p className={`text-[11px] ${textMuted}`}>{item.usage || 0} in use</p>}
                  </div>
                  {canEdit && item.lookup_id && (
                    <div className="flex shrink-0">
                      <Button size="sm" variant="ghost" title="Rename" onClick={() => { setEditId(item.lookup_id); setEditName(item.name); }} className="h-7 px-1.5 text-[var(--text-secondary)]"><Edit2 className="h-3 w-3" /></Button>
                      <Button size="sm" variant="ghost" title={hidden ? 'Show in pickers' : 'Hide from pickers'} onClick={() => toggleActive(item)} className="h-7 px-1.5 text-[var(--text-secondary)]">
                        {hidden ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
                      </Button>
                      <Button size="sm" variant="ghost" title="Delete" onClick={() => remove(item)} className="h-7 px-1.5 text-red-400"><Trash2 className="h-3 w-3" /></Button>
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

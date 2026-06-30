import React, { useEffect, useState } from 'react';
import { fields as fieldsApi } from '../../lib/api';
import { Input } from '../ui/input';
import { Label } from '../ui/label';

/**
 * DynamicEntityForm — renders typed inputs for an entity based on the field registry.
 *
 * Props:
 *   entity   — 'school' | 'contact' | 'lead' (default 'school')
 *   value    — controlled form state object
 *   onChange — (newValue) => void
 */
export default function DynamicEntityForm({ entity = 'school', value = {}, onChange }) {
  const [defs, setDefs] = useState([]);

  useEffect(() => {
    fieldsApi.list(entity).then(r => setDefs(Array.isArray(r.data) ? r.data : [])).catch(() => {});
  }, [entity]);

  const set = (k, v) => onChange({ ...value, [k]: v });

  if (defs.length === 0) return null;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3" translate="no">
      {defs.map(f => (
        <div key={f.field_id}>
          <Label className="text-xs text-[var(--text-secondary)]">
            {f.label}{f.required && ' *'}
          </Label>
          {f.type === 'select' ? (
            <select
              className="w-full border border-[var(--border-color)] rounded p-2 bg-[var(--bg-primary)] text-[var(--text-primary)] text-sm mt-1"
              value={value[f.key] || ''}
              onChange={e => set(f.key, e.target.value)}
            >
              <option value="">—</option>
              {(f.options || []).map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          ) : f.type === 'multiselect' ? (
            <div className="flex flex-wrap gap-2 mt-1">
              {(f.options || []).map(o => {
                const arr = Array.isArray(value[f.key]) ? value[f.key] : [];
                const on = arr.includes(o);
                return (
                  <label key={o} className="flex items-center gap-1 text-sm text-[var(--text-primary)]">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => set(f.key, on ? arr.filter(x => x !== o) : [...arr, o])}
                    />
                    {o}
                  </label>
                );
              })}
            </div>
          ) : f.type === 'boolean' ? (
            <input
              type="checkbox"
              className="mt-2 block"
              checked={!!value[f.key]}
              onChange={e => set(f.key, e.target.checked)}
            />
          ) : (
            <Input
              type={
                f.type === 'number' ? 'number' :
                f.type === 'date'   ? 'date'   :
                f.type === 'email'  ? 'email'  :
                f.type === 'url'    ? 'url'    :
                f.type === 'phone'  ? 'tel'    :
                'text'
              }
              value={value[f.key] || ''}
              onChange={e => set(f.key, e.target.value)}
              className="mt-1 bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]"
            />
          )}
        </div>
      ))}
    </div>
  );
}

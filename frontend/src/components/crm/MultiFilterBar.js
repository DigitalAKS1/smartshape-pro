import React, { useState } from 'react';
import { SlidersHorizontal, X } from 'lucide-react';
import { countActive } from '../../lib/crmFilter';

function ChipRow({ label, options, values, onToggle }) {
  const opts = (options || []).map(o => (typeof o === 'string' ? { id: o, label: o } : o));
  if (opts.length === 0) return null;
  return (
    <div className="space-y-1">
      <p className="text-[11px] font-medium text-[var(--text-secondary)]">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {opts.map(o => {
          const on = (values || []).includes(o.id);
          return (
            <button key={o.id} type="button" onClick={() => onToggle(o.id)}
              className={`text-xs px-2.5 py-1 rounded-full border transition-all ${
                on ? 'bg-[var(--accent)] border-[var(--accent)] text-white'
                   : 'border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'}`}>
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function MultiFilterBar({ options = {}, value, onChange, resultCount }) {
  const [open, setOpen] = useState(false);
  const filt = value || {};
  const active = countActive(filt);

  const toggle = (key, id) => {
    const cur = filt[key] || [];
    const next = cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id];
    onChange({ ...filt, [key]: next });
  };
  const setNum = (key, raw) => {
    const v = raw === '' ? undefined : parseInt(raw, 10);
    const next = { ...filt };
    if (v === undefined || Number.isNaN(v)) delete next[key]; else next[key] = v;
    onChange(next);
  };
  const clearAll = () => onChange({});
  const tagOpts = (options.tags || []).map(t => ({ id: t.id, label: t.name }));

  return (
    <div className="mb-3">
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => setOpen(o => !o)}
          className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors ${
            active ? 'border-[var(--accent)] text-[var(--accent)] bg-[var(--accent)]/5' : 'border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'}`}>
          <SlidersHorizontal className="h-3.5 w-3.5" /> Filters
          {active > 0 && <span className="text-[10px] font-bold px-1.5 rounded-full bg-[var(--accent)] text-white">{active}</span>}
        </button>
        {active > 0 && (
          <button type="button" onClick={clearAll}
            className="inline-flex items-center gap-1 text-[11px] text-[var(--text-muted)] hover:text-[var(--text-secondary)]">
            <X className="h-3 w-3" /> Clear
          </button>
        )}
        {typeof resultCount === 'number' && (
          <span className="text-[11px] text-[var(--text-muted)] ml-auto">{resultCount} shown</span>
        )}
      </div>

      {open && (
        <div className="mt-2 p-3 rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] space-y-3">
          <ChipRow label="Source" options={options.sources} values={filt.sources} onToggle={id => toggle('sources', id)} />
          <ChipRow label="Stage" options={options.stages} values={filt.lead_stages} onToggle={id => toggle('lead_stages', id)} />
          <ChipRow label="Designation / Role" options={options.roles} values={filt.roles} onToggle={id => toggle('roles', id)} />
          <div className="space-y-1">
            <p className="text-[11px] font-medium text-[var(--text-secondary)]">School Strength</p>
            <div className="flex items-center gap-2">
              <input type="number" min="0" placeholder="min" value={filt.min_strength ?? ''}
                onChange={e => setNum('min_strength', e.target.value)}
                className="w-24 text-xs px-2 py-1 rounded-md border border-[var(--border-color)] bg-[var(--bg-card)]" />
              <span className="text-[11px] text-[var(--text-muted)]">to</span>
              <input type="number" min="0" placeholder="max" value={filt.max_strength ?? ''}
                onChange={e => setNum('max_strength', e.target.value)}
                className="w-24 text-xs px-2 py-1 rounded-md border border-[var(--border-color)] bg-[var(--bg-card)]" />
            </div>
          </div>
          <ChipRow label="School Type" options={options.school_types} values={filt.school_types} onToggle={id => toggle('school_types', id)} />
          <ChipRow label="City" options={options.cities} values={filt.cities} onToggle={id => toggle('cities', id)} />
          <ChipRow label="Tags" options={tagOpts} values={filt.tags} onToggle={id => toggle('tags', id)} />
        </div>
      )}
    </div>
  );
}

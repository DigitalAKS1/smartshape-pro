import React, { useEffect, useState, useRef } from 'react';
import { email as emailApi } from '../../lib/api';

// Multi-select chip row: values is string[]; options is [{id,label}] or string[]
function ChipRow({ label, options, values, onToggle }) {
  const opts = (options || []).map(o => (typeof o === 'string' ? { id: o, label: o } : o));
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-[var(--text-secondary)]">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {opts.length === 0 && <span className="text-[11px] text-[var(--text-muted)] italic">none available</span>}
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

export default function AudienceFilterBuilder({ value, onChange }) {
  const [opts, setOpts] = useState({ sources: [], roles: [], school_types: [], cities: [], tags: [], stages: [] });
  const [count, setCount] = useState(null);
  const [counting, setCounting] = useState(false);
  const debounce = useRef(null);
  const filt = value || {};

  useEffect(() => {
    emailApi.getAudienceOptions().then(r => setOpts(r.data || {})).catch(() => {});
  }, []);

  // Live recipient count (debounced), reflecting exactly what launch will send
  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    setCounting(true);
    debounce.current = setTimeout(() => {
      emailApi.previewAudience(filt)
        .then(r => setCount(r.data?.count ?? null))
        .catch(() => setCount(null))
        .finally(() => setCounting(false));
    }, 400);
    return () => debounce.current && clearTimeout(debounce.current);
  }, [JSON.stringify(filt)]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const tagOpts = (opts.tags || []).map(t => ({ id: t.tag_id, label: t.name }));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-[var(--text-primary)]">Filters (all combined)</span>
        <div className="flex items-center gap-2">
          <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--accent)]/15 text-[var(--accent)] font-medium">
            {counting ? '…' : count == null ? '—' : `~${count}`} recipients
          </span>
          <button type="button" onClick={clearAll}
            className="text-[11px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] underline">Clear all</button>
        </div>
      </div>

      <ChipRow label="Source" options={opts.sources} values={filt.sources} onToggle={id => toggle('sources', id)} />
      <ChipRow label="Stage" options={opts.stages} values={filt.lead_stages} onToggle={id => toggle('lead_stages', id)} />
      <ChipRow label="Designation / Role" options={opts.roles} values={filt.roles} onToggle={id => toggle('roles', id)} />

      <div className="space-y-1.5">
        <p className="text-xs font-medium text-[var(--text-secondary)]">School Strength</p>
        <div className="flex items-center gap-2">
          <input type="number" min="0" placeholder="min (e.g. 600)" value={filt.min_strength ?? ''}
            onChange={e => setNum('min_strength', e.target.value)}
            className="w-32 text-xs px-2 py-1 rounded-md border border-[var(--border-color)] bg-[var(--bg-primary)]" />
          <span className="text-xs text-[var(--text-muted)]">to</span>
          <input type="number" min="0" placeholder="max (optional)" value={filt.max_strength ?? ''}
            onChange={e => setNum('max_strength', e.target.value)}
            className="w-32 text-xs px-2 py-1 rounded-md border border-[var(--border-color)] bg-[var(--bg-primary)]" />
        </div>
      </div>

      <ChipRow label="School Type" options={opts.school_types} values={filt.school_types} onToggle={id => toggle('school_types', id)} />
      <ChipRow label="City" options={opts.cities} values={filt.cities} onToggle={id => toggle('cities', id)} />
      <ChipRow label="Tags" options={tagOpts} values={filt.tags} onToggle={id => toggle('tags', id)} />
    </div>
  );
}

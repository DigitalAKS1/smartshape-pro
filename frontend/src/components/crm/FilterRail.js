import React, { useMemo, useState } from 'react';
import {
  SlidersHorizontal, X, ChevronDown, ChevronRight, ChevronLeft,
  Search, User, MapPin, Building2, Radio, GitBranch, Tag as TagIcon,
} from 'lucide-react';
import { UNASSIGNED, FACET_LABELS, countActive } from '../../lib/crmFilter';

// ── Zoho-Bigin-style left filter rail ───────────────────────────────────────
// Visually distinct from the top search bar on purpose (O10/O15): a bordered
// accent card with icon-led, checkbox-row facet groups + live counts, vs the
// flat pill-chip row MultiFilterBar uses for per-tab detail filters.

function FacetSection({ facetKey, label, Icon, opts, values, onToggle, countFor, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  if (!opts || opts.length === 0) return null;
  return (
    <div className="border-b border-[var(--border-color)] last:border-0">
      <button type="button" onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-[var(--bg-hover)] transition-colors"
        data-testid={`facet-toggle-${facetKey}`}>
        {Icon && <Icon className="h-3.5 w-3.5 text-[var(--accent)] flex-shrink-0" />}
        <span className="text-xs font-semibold text-[var(--text-primary)] flex-1">{label}</span>
        {values.length > 0 && (
          <span className="text-[10px] font-bold px-1.5 rounded-full bg-[var(--accent)] text-white">{values.length}</span>
        )}
        {open ? <ChevronDown className="h-3.5 w-3.5 text-[var(--text-muted)]" /> : <ChevronRight className="h-3.5 w-3.5 text-[var(--text-muted)]" />}
      </button>
      {open && (
        <div className="px-3 pb-2.5 space-y-0.5 max-h-56 overflow-y-auto">
          {opts.map((o) => {
            const on = values.includes(o.id);
            const count = countFor ? countFor(facetKey, o.id) : undefined;
            const zero = count === 0 && !on;
            return (
              <label key={o.id}
                className={`flex items-center gap-2 px-1.5 py-1 rounded-md cursor-pointer text-xs transition-colors ${
                  on ? 'bg-[var(--accent)]/10' : 'hover:bg-[var(--bg-hover)]'} ${zero ? 'opacity-40' : ''}`}>
                <input type="checkbox" checked={on} onChange={() => onToggle(facetKey, o.id)} className="accent-[var(--accent)] h-3.5 w-3.5 flex-shrink-0" />
                {o.color && <span className="h-2 w-2 rounded-full flex-shrink-0" style={{ backgroundColor: o.color }} />}
                <span className={`flex-1 truncate ${on ? 'text-[var(--text-primary)] font-medium' : 'text-[var(--text-secondary)]'}`}>{o.label}</span>
                {count !== undefined && <span className="text-[10px] text-[var(--text-muted)] font-mono">{count}</span>}
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Owner facet gets its own section: searchable (O11 — reps can be numerous),
// with a pinned "Unassigned" row using the UNASSIGNED sentinel.
function OwnerSection({ owners, values, onToggle, countFor, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  const [q, setQ] = useState('');
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? owners.filter((o) => o.name.toLowerCase().includes(s)) : owners;
  }, [owners, q]);
  const unassignedOn = values.includes(UNASSIGNED);
  const unassignedCount = countFor ? countFor('owners', UNASSIGNED) : undefined;

  return (
    <div className="border-b border-[var(--border-color)]">
      <button type="button" onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-[var(--bg-hover)] transition-colors"
        data-testid="facet-toggle-owners">
        <User className="h-3.5 w-3.5 text-[var(--accent)] flex-shrink-0" />
        <span className="text-xs font-semibold text-[var(--text-primary)] flex-1">Owner</span>
        {values.length > 0 && (
          <span className="text-[10px] font-bold px-1.5 rounded-full bg-[var(--accent)] text-white">{values.length}</span>
        )}
        {open ? <ChevronDown className="h-3.5 w-3.5 text-[var(--text-muted)]" /> : <ChevronRight className="h-3.5 w-3.5 text-[var(--text-muted)]" />}
      </button>
      {open && (
        <div className="px-3 pb-2.5 space-y-1.5">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-[var(--text-muted)]" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search reps..."
              data-testid="owner-search-input"
              className="w-full pl-6 pr-2 py-1.5 text-xs rounded-md border border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)]" />
          </div>
          <div className="max-h-48 overflow-y-auto space-y-0.5">
            <label className={`flex items-center gap-2 px-1.5 py-1 rounded-md cursor-pointer text-xs transition-colors ${unassignedOn ? 'bg-[var(--accent)]/10' : 'hover:bg-[var(--bg-hover)]'}`}>
              <input type="checkbox" checked={unassignedOn} onChange={() => onToggle('owners', UNASSIGNED)} className="accent-[var(--accent)] h-3.5 w-3.5" data-testid="owner-unassigned-checkbox" />
              <span className={`flex-1 italic ${unassignedOn ? 'text-[var(--text-primary)] font-medium' : 'text-[var(--text-secondary)]'}`}>Unassigned</span>
              {unassignedCount !== undefined && <span className="text-[10px] text-[var(--text-muted)] font-mono">{unassignedCount}</span>}
            </label>
            {filtered.map((o) => {
              const on = values.includes(o.id);
              const count = countFor ? countFor('owners', o.id) : undefined;
              const zero = count === 0 && !on;
              return (
                <label key={o.id} data-testid={`owner-row-${o.id}`}
                  className={`flex items-center gap-2 px-1.5 py-1 rounded-md cursor-pointer text-xs transition-colors ${
                    on ? 'bg-[var(--accent)]/10' : 'hover:bg-[var(--bg-hover)]'} ${zero ? 'opacity-40' : ''}`}>
                  <input type="checkbox" checked={on} onChange={() => onToggle('owners', o.id)} className="accent-[var(--accent)] h-3.5 w-3.5" />
                  <span className={`flex-1 truncate ${on ? 'text-[var(--text-primary)] font-medium' : 'text-[var(--text-secondary)]'}`}>{o.name}</span>
                  {count !== undefined && <span className="text-[10px] text-[var(--text-muted)] font-mono">{count}</span>}
                </label>
              );
            })}
            {filtered.length === 0 && <p className="text-[11px] text-[var(--text-muted)] px-1.5 py-2">No reps match &quot;{q}&quot;</p>}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Left filter rail — collapsible sidebar, Zoho-Bigin style (O15).
 * @param {object} options    deriveFilterOptions() output: {owners,cities,school_types,sources,stages,tags}
 * @param {object} value      the active master filter (crmFilter shape)
 * @param {function} onChange (nextFilter) => void
 * @param {number} resultCount current tab's filtered row count
 * @param {number} totalCount  current tab's unfiltered row count
 * @param {function} countFor (facet,id) => number — live "if added" count
 */
export default function FilterRail({ options = {}, value, onChange, resultCount, totalCount, countFor, className = '' }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const filt = value || {};
  const active = countActive(filt);

  const toggle = (facetKey, id) => {
    const cur = filt[facetKey] || [];
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
    onChange({ ...filt, [facetKey]: next });
  };
  const clearAll = () => onChange({});

  const chipLabel = (key, id) => {
    if (key === 'owners') return id === UNASSIGNED ? 'Unassigned' : (options.owners || []).find((o) => o.id === id)?.name || id;
    if (key === 'tags') return (options.tags || []).find((t) => t.id === id)?.name || id;
    if (key === 'lead_stages') return (options.stages || []).find((s) => s.id === id)?.label || id;
    return id;
  };
  const chips = [];
  Object.keys(FACET_LABELS).forEach((key) => {
    (filt[key] || []).forEach((id) => chips.push({ key, id, text: `${FACET_LABELS[key]}: ${chipLabel(key, id)}` }));
  });

  const header = (
    <div className="sticky top-0 z-10 bg-[var(--bg-card)] border-b border-[var(--border-color)] px-3 py-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <SlidersHorizontal className="h-4 w-4 text-[var(--accent)]" />
          <span className="text-xs font-bold tracking-wide uppercase text-[var(--text-primary)]">Filters</span>
        </div>
        <button type="button" className="lg:hidden" onClick={() => setMobileOpen(false)} aria-label="Close filters" data-testid="filter-rail-mobile-close">
          <X className="h-4 w-4 text-[var(--text-muted)]" />
        </button>
      </div>
      <div className="mt-1.5 flex items-center justify-between">
        <span className="text-[13px] font-semibold text-[var(--text-primary)]" data-testid="filter-rail-count">
          {typeof resultCount === 'number' && typeof totalCount === 'number' ? `${resultCount} of ${totalCount}` : ''}
        </span>
        {active > 0 && (
          <button type="button" onClick={clearAll} className="text-[11px] text-[var(--accent)] hover:underline font-medium" data-testid="filter-rail-clear-all">
            Clear all
          </button>
        )}
      </div>
      {chips.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {chips.map((c) => (
            <span key={`${c.key}:${c.id}`} className="inline-flex items-center gap-1 text-[10px] pl-2 pr-1 py-0.5 rounded-full bg-[var(--accent)]/15 text-[var(--accent)] font-medium">
              {c.text}
              <button type="button" onClick={() => toggle(c.key, c.id)} aria-label={`Remove ${c.text}`} className="hover:opacity-70">
                <X className="h-2.5 w-2.5" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );

  const body = (
    <div className="flex flex-col h-full">
      {header}
      <div className="flex-1 overflow-y-auto">
        <OwnerSection owners={options.owners || []} values={filt.owners || []} onToggle={toggle} countFor={countFor} />
        <FacetSection facetKey="cities" label="City" Icon={MapPin}
          opts={(options.cities || []).map((c) => ({ id: c, label: c }))} values={filt.cities || []} onToggle={toggle} countFor={countFor} />
        <FacetSection facetKey="school_types" label="Type" Icon={Building2}
          opts={(options.school_types || []).map((t) => ({ id: t, label: t }))} values={filt.school_types || []} onToggle={toggle} countFor={countFor} />
        <FacetSection facetKey="sources" label="Source" Icon={Radio}
          opts={(options.sources || []).map((s) => ({ id: s, label: s }))} values={filt.sources || []} onToggle={toggle} countFor={countFor} />
        <FacetSection facetKey="lead_stages" label="Stage" Icon={GitBranch}
          opts={(options.stages || []).map((s) => ({ id: s.id, label: s.label }))} values={filt.lead_stages || []} onToggle={toggle} countFor={countFor} />
        <FacetSection facetKey="tags" label="Tag" Icon={TagIcon}
          opts={(options.tags || []).map((t) => ({ id: t.id, label: t.name, color: t.color }))} values={filt.tags || []} onToggle={toggle} countFor={countFor} />
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop rail */}
      <div className={`hidden lg:flex flex-shrink-0 ${className}`}>
        {collapsed ? (
          <button type="button" onClick={() => setCollapsed(false)} data-testid="filter-rail-expand"
            className="w-12 h-fit sticky top-4 flex flex-col items-center gap-1.5 py-3 rounded-xl border-2 border-[var(--accent)]/30 bg-[var(--bg-card)] hover:border-[var(--accent)] transition-colors"
            aria-label="Expand filters" title="Expand filters">
            <SlidersHorizontal className="h-4 w-4 text-[var(--accent)]" />
            {active > 0 && <span className="text-[10px] font-bold px-1.5 rounded-full bg-[var(--accent)] text-white">{active}</span>}
          </button>
        ) : (
          <div className="w-72 sticky top-4 self-start rounded-xl border-2 border-[var(--accent)]/20 bg-[var(--bg-card)] shadow-sm max-h-[calc(100vh-6rem)] flex flex-col overflow-hidden" data-testid="filter-rail">
            <div className="flex justify-end px-1 pt-1 bg-[var(--bg-card)]">
              <button type="button" onClick={() => setCollapsed(true)} data-testid="filter-rail-collapse"
                className="p-1 text-[var(--text-muted)] hover:text-[var(--accent)]" aria-label="Collapse filters" title="Collapse filters">
                <ChevronLeft className="h-4 w-4" />
              </button>
            </div>
            {body}
          </div>
        )}
      </div>

      {/* Mobile trigger + slide-in drawer */}
      <div className="lg:hidden">
        <button type="button" onClick={() => setMobileOpen(true)} data-testid="filter-rail-mobile-trigger"
          className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg border-2 border-[var(--accent)]/30 bg-[var(--bg-card)] text-xs font-semibold text-[var(--text-primary)]">
          <span className="flex items-center gap-1.5">
            <SlidersHorizontal className="h-3.5 w-3.5 text-[var(--accent)]" /> Filters{active > 0 ? ` (${active})` : ''}
          </span>
          {typeof resultCount === 'number' && typeof totalCount === 'number' && (
            <span className="text-[var(--text-muted)]">{resultCount} of {totalCount}</span>
          )}
        </button>
        {mobileOpen && (
          <div className="fixed inset-0 z-50 flex" data-testid="filter-rail-mobile-drawer">
            <div className="flex-1 bg-black/50" onClick={() => setMobileOpen(false)} />
            <div className="w-[85vw] max-w-xs bg-[var(--bg-card)] h-full overflow-hidden flex flex-col border-l-2 border-[var(--accent)]/30">
              {body}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

import React from 'react';
import { X } from 'lucide-react';
import { FACET_LABELS, UNASSIGNED } from '../../lib/crmFilter';
import { describeQueryTokens, removeQueryToken } from '../../lib/crmMasterFilter';

/**
 * One honest answer to "why am I looking at these rows?".
 *
 * Filtering used to be spread across four surfaces that each showed a fragment
 * of the truth: the left rail (a bare count badge), the search box (operator
 * chips), and two dropdowns that showed nothing at all. A screen reading
 * "Schools 0 · Contacts 1 · Leads 0" gave no way to find out why, or out.
 *
 * So every active filter — wherever the user set it — appears here as one
 * removable chip, above the tab counts it explains. Chips are deliberately
 * uniform: which control a filter came from is our concern, not the user's.
 * Theirs is "what is on, and how do I turn it off".
 *
 * Props:
 *   masterFilter / setMasterFilter — the left rail's facet selections
 *   searchTerm / setSearchTerm     — raw search box, incl. owner:/city:/... tokens
 *   filterType / setFilterType     — the "Type" dropdown ('all' when off)
 *   filterTag / setFilterTag       — the "Tags" dropdown ('' when off)
 *   options                        — deriveFilterOptions(), to name ids
 *   result / total / noun          — honest "showing N of M leads"
 */
export default function ActiveFilterBar({
  masterFilter = {},
  setMasterFilter,
  searchTerm = '',
  setSearchTerm,
  filterType = 'all',
  setFilterType,
  filterTag = '',
  setFilterTag,
  options = {},
  result = 0,
  total = 0,
  noun = 'record',
}) {
  const nameFor = (facet, id) => {
    if (facet === 'owners') {
      return id === UNASSIGNED
        ? 'Unassigned'
        : (options.owners || []).find(o => o.id === id)?.name || id;
    }
    if (facet === 'tags') return (options.tags || []).find(t => t.id === id)?.name || id;
    if (facet === 'lead_stages') return (options.stages || []).find(s => s.id === id)?.label || id;
    return id;
  };

  const chips = [];

  // 1. Left rail — remove just the one value, leave the rest of the facet.
  Object.keys(FACET_LABELS).forEach(facet => {
    (masterFilter[facet] || []).forEach(id => {
      chips.push({
        key: `rail:${facet}:${id}`,
        label: `${FACET_LABELS[facet]}: ${nameFor(facet, id)}`,
        onRemove: () => setMasterFilter(f => ({
          ...f,
          [facet]: (f[facet] || []).filter(v => v !== id),
        })),
      });
    });
  });

  // Ranges and presence checks the rail can also set.
  (masterFilter.has || []).forEach(what => {
    chips.push({
      key: `rail:has:${what}`,
      label: `Has ${what}`,
      onRemove: () => setMasterFilter(f => ({ ...f, has: (f.has || []).filter(v => v !== what) })),
    });
  });
  if (masterFilter.min_strength != null || masterFilter.max_strength != null) {
    const lo = masterFilter.min_strength ?? '0';
    const hi = masterFilter.max_strength ?? 'any';
    chips.push({
      key: 'rail:strength',
      label: `Students ${lo}–${hi}`,
      onRemove: () => setMasterFilter(f => ({ ...f, min_strength: null, max_strength: null })),
    });
  }
  [['import_date', 'Imported'], ['assigned_date', 'Assigned']].forEach(([field, label]) => {
    const from = masterFilter[`${field}_from`];
    const to = masterFilter[`${field}_to`];
    if (from == null && to == null) return;
    chips.push({
      key: `rail:${field}`,
      label: `${label} ${from || '…'} to ${to || '…'}`,
      onRemove: () => setMasterFilter(f => ({ ...f, [`${field}_from`]: null, [`${field}_to`]: null })),
    });
  });

  // 2. Search box — one chip per typed operator token, showing what they typed.
  describeQueryTokens(searchTerm, options).forEach(t => {
    chips.push({
      key: `q:${t.token}`,
      label: t.label,
      onRemove: () => setSearchTerm(prev => removeQueryToken(prev, t.token)),
    });
  });

  // 3. The two dropdowns, which previously gave no sign they were on at all.
  if (filterType !== 'all') {
    const isTemp = ['hot', 'warm', 'cold'].includes(filterType);
    chips.push({
      key: 'dd:type',
      label: isTemp ? `${filterType[0].toUpperCase()}${filterType.slice(1)} leads` : `Type: ${filterType}`,
      onRemove: () => setFilterType('all'),
    });
  }
  if (filterTag) {
    chips.push({
      key: 'dd:tag',
      label: `Tag: ${nameFor('tags', filterTag)}`,
      onRemove: () => setFilterTag(''),
    });
  }

  const freeText = String(searchTerm || '')
    .replace(/([a-zA-Z]+):"[^"]*"|([a-zA-Z]+):\S+/g, '')
    .trim();
  if (freeText) {
    chips.push({
      key: 'q:text',
      label: `“${freeText}”`,
      onRemove: () => setSearchTerm(prev => {
        const tokens = describeQueryTokens(prev, options).map(t => t.token);
        return tokens.join(' ');
      }),
    });
  }

  if (chips.length === 0) return null;

  const clearAll = () => {
    setMasterFilter({});
    setSearchTerm('');
    setFilterType('all');
    setFilterTag('');
  };

  return (
    <div
      className="flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-md border border-[var(--border-color)] bg-[var(--bg-card)] px-3 py-2"
      data-testid="active-filter-bar"
    >
      <span className="text-xs text-[var(--text-secondary)]">
        Showing <strong className="text-[var(--text-primary)]">{result.toLocaleString()}</strong>
        {' of '}{total.toLocaleString()} {noun}{total === 1 ? '' : 's'}
      </span>

      <span className="h-3.5 w-px bg-[var(--border-color)]" aria-hidden="true" />

      {chips.map(c => (
        <button
          key={c.key}
          type="button"
          onClick={c.onRemove}
          title={`Remove ${c.label}`}
          data-testid={`filter-chip-${c.key}`}
          className="group inline-flex items-center gap-1 rounded-full bg-[#e94560] py-0.5 pl-2 pr-1 text-[11px] font-medium text-white
                     focus:outline-none focus-visible:ring-2 focus-visible:ring-[#e94560] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--bg-card)]"
        >
          {c.label}
          <X className="h-3 w-3 opacity-70 group-hover:opacity-100" aria-hidden="true" />
        </button>
      ))}

      <button
        type="button"
        onClick={clearAll}
        data-testid="clear-all-filters"
        className="ml-auto rounded-full border border-[var(--border-color)] px-2.5 py-0.5 text-[11px] text-[var(--text-secondary)]
                   hover:border-[#e94560] hover:text-[#e94560]
                   focus:outline-none focus-visible:ring-2 focus-visible:ring-[#e94560]"
      >
        Clear all
      </button>
    </div>
  );
}

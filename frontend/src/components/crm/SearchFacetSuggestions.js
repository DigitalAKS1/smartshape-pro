import React from 'react';
import { suggestFacets, FACET_LABELS } from '../../lib/crmFilter';

/**
 * Dropdown under the top search box: "Add filter: City: Rohini · 1" (O3).
 * Pure presentational — `suggestFacets` (already-shipped engine) does the
 * ranking/counting; free-text search still works untouched if this is ignored.
 */
export default function SearchFacetSuggestions({ term, options, countFor, applied, onAdd }) {
  const suggestions = suggestFacets(term, options, { countFor, applied });
  if (suggestions.length === 0) return null;
  return (
    <div className="absolute left-0 right-0 top-full mt-1.5 z-30 rounded-lg border-2 border-[var(--accent)]/20 bg-[var(--bg-card)] shadow-lg overflow-hidden" data-testid="search-suggestions">
      <p className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wide font-semibold text-[var(--text-muted)]">Add filter</p>
      {suggestions.map((s) => (
        <button key={`${s.facet}:${s.id}`} type="button" onClick={() => onAdd(s)}
          data-testid={`suggestion-${s.facet}-${s.id}`}
          className="w-full flex items-center justify-between gap-2 px-3 py-2 text-xs text-left hover:bg-[var(--bg-hover)] transition-colors">
          <span className="text-[var(--text-primary)] truncate">
            <span className="text-[var(--text-muted)]">{FACET_LABELS[s.facet] || s.facet}:</span> {s.label}
          </span>
          {s.count != null && <span className="text-[10px] text-[var(--accent)] font-mono font-bold flex-shrink-0">{s.count}</span>}
        </button>
      ))}
    </div>
  );
}

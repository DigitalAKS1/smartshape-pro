import React, { useMemo, useState } from 'react';
import { Search, Users, Check } from 'lucide-react';

/**
 * RecipientPicker — controlled component for selecting email recipients from CRM contacts.
 *
 * Props:
 *   contacts:    array of contact objects { contact_id, name, email, company, tag_ids[], contact_role_id, designation, city, board }
 *   allTags:     array of { tag_id, name, color? }
 *   roles:       array of { role_id, name }
 *   selectedIds: array of selected contact_id (controlled)
 *   onChange:    (idsArray) => void — called with the new selectedIds array
 *
 * Mirrors the filtering approach used by `eFilteredContactsForPicker` in
 * components/marketing/EmailHubTab.js (search + tag filter over `contacts`),
 * extended with role/city/board filters. Only contacts with an email are listed,
 * since this picker is for email sends specifically.
 */
export default function RecipientPicker({ contacts = [], allTags = [], roles = [], selectedIds = [], onChange }) {
  const [search, setSearch] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [cityFilter, setCityFilter] = useState('');
  const [boardFilter, setBoardFilter] = useState('');

  const cityOptions = useMemo(() => {
    const set = new Set();
    (contacts || []).forEach(c => { if (c.city) set.add(c.city); });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [contacts]);

  const boardOptions = useMemo(() => {
    const set = new Set();
    (contacts || []).forEach(c => { if (c.board) set.add(c.board); });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [contacts]);

  const filtered = useMemo(() => {
    let result = (contacts || []).filter(c => !!c.email);

    if (tagFilter) result = result.filter(c => (c.tag_ids || []).includes(tagFilter));

    if (roleFilter) {
      const rName = (roles.find(r => r.role_id === roleFilter)?.name || '').toLowerCase();
      result = result.filter(c =>
        c.contact_role_id === roleFilter ||
        (rName && (c.designation || '').toLowerCase() === rName)
      );
    }

    if (cityFilter) result = result.filter(c => c.city === cityFilter);
    if (boardFilter) result = result.filter(c => c.board === boardFilter);

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter(c =>
        (c.name || '').toLowerCase().includes(q) ||
        (c.email || '').toLowerCase().includes(q) ||
        (c.company || '').toLowerCase().includes(q)
      );
    }

    return result;
  }, [contacts, tagFilter, roleFilter, cityFilter, boardFilter, search, roles]);

  const selectAllMatching = () => {
    onChange([...new Set([...(selectedIds || []), ...filtered.map(c => c.contact_id)])]);
  };

  const clearAll = () => onChange([]);

  const toggleContact = (contactId) => {
    const sel = (selectedIds || []).includes(contactId);
    onChange(sel ? selectedIds.filter(id => id !== contactId) : [...selectedIds, contactId]);
  };

  const selectClass = 'h-9 px-2 rounded-md border border-[var(--border-color)] bg-[var(--bg-primary)] text-xs text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[#e94560]';

  return (
    <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl p-3 space-y-3">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Users className="h-4 w-4 text-[var(--text-muted)]" />
        <span className="text-sm font-semibold text-[var(--text-primary)]">Recipients</span>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--text-muted)]" />
        <input
          type="text"
          placeholder="Search by name, email, or company…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full pl-8 pr-3 h-9 rounded-md border border-[var(--border-color)] bg-[var(--bg-primary)] text-xs text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[#e94560]"
        />
      </div>

      {/* Filters */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <select value={tagFilter} onChange={e => setTagFilter(e.target.value)} className={selectClass}>
          <option value="">All tags</option>
          {(allTags || []).map(tag => (
            <option key={tag.tag_id} value={tag.tag_id}>{tag.name}</option>
          ))}
        </select>

        <select value={roleFilter} onChange={e => setRoleFilter(e.target.value)} className={selectClass}>
          <option value="">All roles</option>
          {(roles || []).map(r => (
            <option key={r.role_id} value={r.role_id}>{r.name}</option>
          ))}
        </select>

        <select value={cityFilter} onChange={e => setCityFilter(e.target.value)} className={selectClass}>
          <option value="">All cities</option>
          {cityOptions.map(city => (
            <option key={city} value={city}>{city}</option>
          ))}
        </select>

        <select value={boardFilter} onChange={e => setBoardFilter(e.target.value)} className={selectClass}>
          <option value="">All boards</option>
          {boardOptions.map(board => (
            <option key={board} value={board}>{board}</option>
          ))}
        </select>
      </div>

      {/* Select all / clear */}
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold text-[var(--text-muted)]">{filtered.length} matching</span>
        <div className="flex gap-3">
          <button type="button" onClick={selectAllMatching} className="text-[11px] font-semibold text-[#e94560]">
            Select all {filtered.length} matching
          </button>
          <button type="button" onClick={clearAll} className="text-[11px] font-semibold text-[var(--text-muted)]">
            Clear
          </button>
        </div>
      </div>

      {/* Checkbox list */}
      <div className="max-h-64 overflow-y-auto border border-[var(--border-color)] rounded-lg divide-y divide-[var(--border-color)]">
        {filtered.map(c => {
          const sel = (selectedIds || []).includes(c.contact_id);
          const roleLabel = c.company || c.designation || '';
          return (
            <button
              key={c.contact_id}
              type="button"
              onClick={() => toggleContact(c.contact_id)}
              className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-colors ${sel ? 'bg-[#e94560]/8' : 'hover:bg-[var(--bg-hover)]'}`}
            >
              <div className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 transition-all ${sel ? 'bg-[#e94560] border-[#e94560]' : 'border-[var(--border-color)]'}`}>
                {sel && <Check className="h-2.5 w-2.5 text-white" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-[var(--text-primary)] truncate">{c.name}</p>
                <p className="text-[10px] text-[var(--text-muted)] truncate">
                  {c.email}{roleLabel ? ` · ${roleLabel}` : ''}
                </p>
              </div>
            </button>
          );
        })}
        {filtered.length === 0 && (
          <p className="text-xs text-[var(--text-muted)] text-center py-5">No contacts match your search/filters</p>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between text-[11px]">
        <span className="font-semibold text-[#e94560]">{(selectedIds || []).length} selected</span>
        <span className="text-[var(--text-muted)]">{filtered.length} matching</span>
      </div>
    </div>
  );
}

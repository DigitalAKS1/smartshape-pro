import React from 'react';
import { Tag, Plus, Search, X } from 'lucide-react';
import { toast } from 'sonner';
import { useTheme } from '../../contexts/ThemeContext';
import { tags as tagsApi } from '../../lib/api';

// Colour a tag gets when it is created from the picker — the same default the
// lead form's inline "add tag" uses, so the two paths look alike.
const NEW_TAG_COLOR = '#6366f1';

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// Coarse pointer = a phone/tablet, where focusing an input opens the keyboard.
const IS_TOUCH = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
  && window.matchMedia('(pointer: coarse)').matches;

/**
 * The success line every bulk bar shows after tagging, in one place so the
 * three tabs read the same:
 *   "Added “Hot Lead” to 40 contacts"
 *   "Added 2 tags to 40 contacts (3 skipped)"
 *   "Removed 2 tags from 12 schools, 48 contacts, 9 leads"
 *
 * @param {object} p
 * @param {'add'|'remove'} p.action
 * @param {string[]} p.tagIds    the tags applied
 * @param {object[]} p.tags      the tag list, to name a single tag
 * @param {Array<[number,string]>} p.targets  e.g. [[12,'school'],[48,'contact']]
 * @param {number} [p.skipped]
 */
export function formatTagResult({ action, tagIds = [], tags = [], targets = [], skipped = 0 }) {
  const one = tagIds.length === 1 ? tags.find(t => t.tag_id === tagIds[0]) : null;
  const what = one ? `“${one.name}”` : plural(tagIds.length, 'tag');
  const where = targets.map(([n, word]) => plural(n || 0, word)).join(', ');
  const verb = action === 'remove' ? 'Removed' : 'Added';
  const prep = action === 'remove' ? 'from' : 'to';
  return `${verb} ${what} ${prep} ${where}${skipped ? ` (${skipped} skipped)` : ''}`;
}

/**
 * "Tags…" button + popover for applying SEVERAL tags to a bulk selection in
 * one step — shared by the Schools, Contacts and Leads bulk bars.
 *
 * Tick any number of tags (search narrows the list), or type a new name and
 * create it on the spot — it is added to the list and ticked. Then "Add N
 * tags" or "Remove N tags" hands the ticked ids to `onApply`.
 *
 * Props:
 *   tags          [{tag_id, name, color}] — the full tag list
 *   disabled      disables the trigger and the apply buttons
 *   onApply       ({tagIds, action}) => Promise|any. Resolve to `false` (or
 *                 throw) to signal failure: the popover then stays open with
 *                 the ticks intact for a retry. Anything else closes it and
 *                 resets the ticks.
 *   onTagCreated  (tag) => void — lets the parent add the new tag to its list
 *   extra         optional node rendered above the apply buttons (Schools'
 *                 "Also tag their contacts and leads" box)
 *   testIdPrefix  prefix for every data-testid (default "bulk-tag-picker")
 *   label         trigger text (default "Tags…")
 */
export default function BulkTagPicker({
  tags = [], disabled = false, onApply, onTagCreated, extra = null,
  testIdPrefix = 'bulk-tag-picker', label = 'Tags…',
}) {
  const { isDark } = useTheme();
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [picked, setPicked] = React.useState([]);
  // Tags created here, kept until the parent's list catches up with them —
  // so a new tag shows (ticked) even if the parent never refreshes.
  const [created, setCreated] = React.useState([]);
  const [busy, setBusy] = React.useState(false);
  const [creating, setCreating] = React.useState(false);
  const rootRef = React.useRef(null);

  const card = isDark ? 'bg-[var(--bg-card)] border-[var(--border-color)]' : 'bg-white border-[var(--border-color)]';
  const inputCls = 'bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]';
  const textPri = 'text-[var(--text-primary)]';
  const textSec = 'text-[var(--text-secondary)]';
  const textMuted = 'text-[var(--text-muted)]';
  const tid = (s) => `${testIdPrefix}-${s}`;

  const allTags = React.useMemo(() => {
    const have = new Set(tags.map(t => t.tag_id));
    return [...tags, ...created.filter(t => !have.has(t.tag_id))];
  }, [tags, created]);

  const q = query.trim().toLowerCase();
  const shown = q ? allTags.filter(t => (t.name || '').toLowerCase().includes(q)) : allTags;
  const exactMatch = !!q && allTags.some(t => (t.name || '').trim().toLowerCase() === q);
  const canCreate = !!q && !exactMatch;

  const close = React.useCallback(() => { setOpen(false); setQuery(''); }, []);

  // Outside click / tap and Escape close it — the ticks are kept, so closing
  // by accident costs nothing.
  React.useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) close(); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);

  const togglePick = (id) => setPicked(p => (p.includes(id) ? p.filter(x => x !== id) : [...p, id]));

  const createTag = async () => {
    const name = query.trim();
    if (!name || creating) return;
    setCreating(true);
    try {
      const res = await tagsApi.create({ name, color: NEW_TAG_COLOR });
      const tag = res?.data;
      if (!tag || !tag.tag_id) throw new Error('no tag returned');
      setCreated(c => [...c, tag]);
      setPicked(p => (p.includes(tag.tag_id) ? p : [...p, tag.tag_id]));
      setQuery('');
      if (onTagCreated) onTagCreated(tag);
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Could not create the tag');
    } finally {
      setCreating(false);
    }
  };

  const apply = async (action) => {
    if (picked.length === 0 || busy || disabled || !onApply) return;
    setBusy(true);
    let ok = false;
    try {
      ok = (await onApply({ tagIds: picked, action })) !== false;
    } catch {
      ok = false;
    } finally {
      setBusy(false);
    }
    if (ok) { setPicked([]); close(); }
  };

  const onSearchKey = (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (canCreate) createTag();
    else if (shown.length === 1) togglePick(shown[0].tag_id);
  };

  const n = picked.length;
  const applyDisabled = n === 0 || busy || disabled;
  const countLabel = n === 0 ? 'tags' : plural(n, 'tag');

  return (
    <div ref={rootRef} className="relative inline-block" data-testid={tid('root')}>
      <button type="button" disabled={disabled}
        onClick={() => (open ? close() : setOpen(true))}
        aria-haspopup="dialog" aria-expanded={open}
        className={`h-8 px-2.5 rounded border text-xs inline-flex items-center gap-1.5 ${inputCls} cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed`}
        data-testid={tid('button')}>
        <Tag className="h-3 w-3" />
        {label}
        {n > 0 && (
          <span className="text-[10px] font-bold px-1.5 rounded-full bg-[#e94560] text-white" data-testid={tid('count')}>{n}</span>
        )}
      </button>

      {open && (
        <div role="dialog" aria-label="Apply tags"
          // Phone: a sheet pinned to the viewport edges, so it can never run off
          // screen wherever the button wrapped to. sm+: a normal dropdown.
          className={`${card} border rounded-md shadow-xl z-50 flex flex-col
            fixed left-4 right-4 bottom-4 max-h-[75vh]
            sm:absolute sm:left-0 sm:right-auto sm:bottom-auto sm:top-full sm:mt-1 sm:w-80 sm:max-h-[28rem]`}
          data-testid={tid('popover')}>
          <div className="p-2 border-b border-[var(--border-color)] flex items-center gap-2">
            <div className="relative flex-1">
              <Search className={`h-3.5 w-3.5 absolute left-2 top-1/2 -translate-y-1/2 ${textMuted}`} />
              {/* No autofocus on touch screens: it pops the phone keyboard up
                  over the bottom-pinned Add/Remove buttons. */}
              <input type="text" value={query} autoFocus={!IS_TOUCH}
                onChange={e => setQuery(e.target.value)} onKeyDown={onSearchKey}
                placeholder="Search or create a tag"
                className={`w-full h-8 pl-7 pr-2 rounded border text-xs ${inputCls} outline-none focus:border-[#e94560]`}
                data-testid={tid('search')} />
            </div>
            <button type="button" onClick={close} aria-label="Close"
              className={`h-8 w-8 inline-flex items-center justify-center rounded ${textSec} hover:bg-[var(--bg-hover)]`}
              data-testid={tid('close')}>
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="overflow-y-auto flex-1 min-h-0 py-1 sm:max-h-56" data-testid={tid('list')}>
            {shown.map(t => (
              <label key={t.tag_id}
                className={`flex items-center gap-2 px-3 py-2 sm:py-1.5 text-xs cursor-pointer hover:bg-[var(--bg-hover)] ${textPri}`}
                data-testid={tid(`option-${t.tag_id}`)}>
                <input type="checkbox" className="accent-[#e94560]"
                  checked={picked.includes(t.tag_id)} onChange={() => togglePick(t.tag_id)}
                  data-testid={tid(`check-${t.tag_id}`)} />
                <span className="h-2.5 w-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: t.color || NEW_TAG_COLOR }} />
                <span className="truncate">{t.name}</span>
              </label>
            ))}
            {shown.length === 0 && !canCreate && (
              <p className={`px-3 py-3 text-xs ${textMuted}`} data-testid={tid('empty')}>No tags yet — type a name to create one.</p>
            )}
            {canCreate && (
              <button type="button" onClick={createTag} disabled={creating}
                className="w-full text-left flex items-center gap-2 px-3 py-2 sm:py-1.5 text-xs text-[#e94560] font-medium hover:bg-[var(--bg-hover)] disabled:opacity-50"
                data-testid={tid('create')}>
                <Plus className="h-3 w-3 flex-shrink-0" />
                <span className="truncate">{creating ? 'Creating…' : `Create tag “${query.trim()}”`}</span>
              </button>
            )}
          </div>

          {extra && (
            <div className="px-3 py-2 border-t border-[var(--border-color)]" data-testid={tid('extra')}>{extra}</div>
          )}

          <div className="p-2 border-t border-[var(--border-color)] flex items-center gap-2">
            <button type="button" disabled={applyDisabled} onClick={() => apply('add')}
              className="flex-1 h-8 rounded text-xs font-medium bg-[#e94560] hover:bg-[#f05c75] text-white disabled:opacity-50 disabled:cursor-not-allowed"
              data-testid={tid('add')}>
              {busy ? 'Working…' : `Add ${countLabel}`}
            </button>
            <button type="button" disabled={applyDisabled} onClick={() => apply('remove')}
              className={`flex-1 h-8 rounded border text-xs font-medium border-[var(--border-color)] ${textSec} hover:bg-[var(--bg-hover)] disabled:opacity-50 disabled:cursor-not-allowed`}
              data-testid={tid('remove')}>
              {`Remove ${countLabel}`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

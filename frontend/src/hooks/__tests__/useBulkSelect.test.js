// useBulkSelect — generic row-selection helper.
//
// Task 3 added hiddenCount / visibleIds and made toggleAll additive (never
// silently drops a selection a filter change has hidden).
//
// Fix round 1 adds a 3rd `allItems` argument (the full universe of rows
// before filtering) so a row that's genuinely GONE (deleted, or dropped by a
// refetch) gets pruned from the selection automatically, distinct from a row
// that's merely hidden by the current filter (still in `allItems`, just not
// in `items`). `allItems` defaults to `items`, which restores the original
// full-prune behaviour for the three legacy callers (ReceivingQC.js,
// Procurement.js, StockManagement.js) that only ever pass 2 arguments.
// It also adds shift-click range selection via `toggle(id, { shift: true })`.
//
// Rendered through a probe component via react-dom/client (no
// @testing-library/react in this repo — same pattern as
// useLeadsFilter.test.js / ContactsTab.test.js).
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import useBulkSelect from '../useBulkSelect';

global.IS_REACT_ACT_ENVIRONMENT = true;

let api = null;
function Probe({ items, getId, allItems }) {
  api = useBulkSelect(items, getId, allItems);
  return null;
}

const getId = (r) => r.id;

async function mount(items, allItems) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(<Probe items={items} getId={getId} allItems={allItems} />); });
  const rerender = async (nextItems, nextAllItems) => {
    await act(async () => { root.render(<Probe items={nextItems} getId={getId} allItems={nextAllItems} />); });
  };
  return { rerender, unmount: () => act(() => root.unmount()) };
}

const set = async (fn) => { await act(async () => { fn(); }); };

let view;
afterEach(() => { view && view.unmount(); api = null; });

const ROWS = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
const ROWS5 = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' }];

// ── Hidden-by-filter (allItems still contains the row) ──────────────────────

test('selecting rows then hiding some via a filter change reports hiddenCount and visibleIds', async () => {
  // allItems = the full ROWS set throughout — only `items` (the filtered
  // view) shrinks, so the rows that fall out are HIDDEN, not gone.
  view = await mount(ROWS, ROWS);

  await set(() => api.toggle('a'));
  await set(() => api.toggle('b'));
  await set(() => api.toggle('c'));
  expect(api.count).toBe(3);

  await view.rerender([{ id: 'a' }], ROWS);

  expect(api.count).toBe(3);
  expect(api.hiddenCount).toBe(2);
  expect(api.visibleIds).toEqual(['a']);
});

test('toggleAll with some rows hidden selects all current items without discarding hidden selections', async () => {
  view = await mount(ROWS, ROWS);

  await set(() => api.toggle('c'));
  await view.rerender([{ id: 'a' }, { id: 'b' }], ROWS);
  expect(api.hiddenCount).toBe(1);

  await set(() => api.toggleAll());
  expect(api.count).toBe(3);
  expect(new Set(api.visibleIds)).toEqual(new Set(['a', 'b']));
  expect(api.hiddenCount).toBe(1);
  expect(api.allSelected).toBe(true);

  await set(() => api.toggleAll());
  expect(api.count).toBe(1);
  expect(api.visibleIds).toEqual([]);
  expect(api.hiddenCount).toBe(1);
  expect(api.allSelected).toBe(false);
});

test('clear empties everything, hidden included', async () => {
  view = await mount(ROWS, ROWS);

  await set(() => api.toggle('a'));
  await set(() => api.toggle('c'));
  await view.rerender([{ id: 'a' }], ROWS);
  expect(api.hiddenCount).toBe(1);

  await set(() => api.clear());
  expect(api.count).toBe(0);
  expect(api.hiddenCount).toBe(0);
  expect(api.visibleIds).toEqual([]);
  expect(api.selectedIds.size).toBe(0);
});

// ── Gone entirely (not in allItems either) — pruned, not "hidden" ───────────

test('a row that no longer exists anywhere (dropped from allItems too) is pruned, not counted as hidden', async () => {
  view = await mount(ROWS, ROWS);

  await set(() => api.toggle('a'));
  await set(() => api.toggle('b'));
  await set(() => api.toggle('c'));
  expect(api.count).toBe(3);

  // 'c' is gone from BOTH items and allItems — e.g. deleted, or dropped by a
  // refetch — so it should disappear from the selection entirely, not show
  // up as "hidden by filter".
  await view.rerender([{ id: 'a' }, { id: 'b' }], [{ id: 'a' }, { id: 'b' }]);

  expect(api.count).toBe(2);
  expect(api.hiddenCount).toBe(0);
  expect(new Set(api.visibleIds)).toEqual(new Set(['a', 'b']));
});

test('pruning fires even with no further user action — a refetch alone drops a deleted row from the selection', async () => {
  view = await mount(ROWS, ROWS);
  await set(() => api.toggle('a'));
  await set(() => api.toggle('b'));

  // Nothing else changes about `items`; only the full universe shrinks
  // (simulating a refetch after a delete).
  await view.rerender(ROWS, [{ id: 'a' }, { id: 'c' }]);

  expect(api.count).toBe(1);
  expect(api.isSelected('a')).toBe(true);
  expect(api.isSelected('b')).toBe(false);
});

// ── Legacy callers (2-arg: allItems defaults to items) ───────────────────────

test('legacy 2-arg callers (ReceivingQC/Procurement/StockManagement-style) get the old full-prune behaviour back: nothing can ever be "hidden"', async () => {
  view = await mount(ROWS); // no allItems -> defaults to items

  await set(() => api.toggle('a'));
  await set(() => api.toggle('b'));
  await set(() => api.toggle('c'));
  expect(api.count).toBe(3);

  // A 2-arg caller never passes allItems on rerender either — items shrinking
  // must prune immediately, exactly like before hidden-row tracking existed.
  await view.rerender([{ id: 'a' }]);

  expect(api.count).toBe(1);
  expect(api.hiddenCount).toBe(0);
  expect(api.visibleIds).toEqual(['a']);
});

test('legacy 2-arg callers: unticking the header (toggleAll deselect) clears everything, including ids that are now gone', async () => {
  view = await mount(ROWS);
  await set(() => api.toggleAll()); // select all 3
  expect(api.count).toBe(3);

  // Item list shrinks (e.g. a row deleted) — the stale id is pruned by the
  // effect on its own, and toggleAll deselect on what remains finishes the job.
  await view.rerender([{ id: 'a' }, { id: 'b' }]);
  await set(() => api.toggleAll());
  expect(api.count).toBe(0);
});

test('existing API — toggle, isSelected, allSelected — behaves exactly as before', async () => {
  view = await mount(ROWS);

  expect(api.allSelected).toBe(false);
  expect(api.isSelected('a')).toBe(false);

  await set(() => api.toggle('a'));
  expect(api.isSelected('a')).toBe(true);
  expect(api.count).toBe(1);
  expect(api.allSelected).toBe(false);

  await set(() => api.toggle('b'));
  await set(() => api.toggle('c'));
  expect(api.allSelected).toBe(true);

  await set(() => api.toggle('a')); // untoggle one
  expect(api.isSelected('a')).toBe(false);
  expect(api.allSelected).toBe(false);
  expect(api.count).toBe(2);
});

test('toggleAll with nothing hidden still behaves like a plain select-all / deselect-all', async () => {
  view = await mount(ROWS);

  await set(() => api.toggleAll());
  expect(api.count).toBe(3);
  expect(api.allSelected).toBe(true);
  expect(api.hiddenCount).toBe(0);

  await set(() => api.toggleAll());
  expect(api.count).toBe(0);
  expect(api.allSelected).toBe(false);
});

// ── Shift-click range selection ──────────────────────────────────────────────

test('shift-click selects every id between the last-toggled anchor and the clicked id, in items order', async () => {
  view = await mount(ROWS5, ROWS5);

  await set(() => api.toggle('b')); // anchor
  await set(() => api.toggle('e', { shift: true }));

  expect(new Set(api.visibleIds)).toEqual(new Set(['b', 'c', 'd', 'e']));
  expect(api.count).toBe(4);
});

test('shift-click range works regardless of click direction (clicked id before the anchor)', async () => {
  view = await mount(ROWS5, ROWS5);

  await set(() => api.toggle('d')); // anchor
  await set(() => api.toggle('a', { shift: true }));

  expect(new Set(api.visibleIds)).toEqual(new Set(['a', 'b', 'c', 'd']));
});

test('shift-click with no prior anchor falls back to a plain toggle of just the clicked id', async () => {
  view = await mount(ROWS5, ROWS5);

  await set(() => api.toggle('c', { shift: true }));

  expect(api.visibleIds).toEqual(['c']);
});

test('shift-click whose anchor has fallen out of the current items falls back to a plain toggle', async () => {
  view = await mount(ROWS5, ROWS5);

  await set(() => api.toggle('a')); // anchor = 'a'
  // 'a' is filtered out of the visible items (still in allItems -> hidden,
  // not pruned), so it's no longer a usable anchor for a range.
  await view.rerender([{ id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' }], ROWS5);
  await set(() => api.toggle('d', { shift: true }));

  // Falls back to a plain toggle of 'd' — 'a' stays selected (still hidden),
  // and only 'd' is newly added, not the whole b..d range.
  expect(api.isSelected('a')).toBe(true);
  expect(api.isSelected('d')).toBe(true);
  expect(api.isSelected('b')).toBe(false);
  expect(api.isSelected('c')).toBe(false);
});

test('plain toggle(id) without options is unaffected by shift-click support', async () => {
  view = await mount(ROWS5, ROWS5);
  await set(() => api.toggle('a'));
  await set(() => api.toggle('c'));
  expect(new Set(api.visibleIds)).toEqual(new Set(['a', 'c']));
});

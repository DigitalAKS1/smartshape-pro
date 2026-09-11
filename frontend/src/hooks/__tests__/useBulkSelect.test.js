// useBulkSelect — generic row-selection helper. Task 3 adds hiddenCount /
// visibleIds and makes toggleAll additive (never silently drops a selection
// that a filter change has hidden). Rendered through a probe component via
// react-dom/client (no @testing-library/react in this repo — same pattern as
// useLeadsFilter.test.js / ContactsTab.test.js).
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import useBulkSelect from '../useBulkSelect';

global.IS_REACT_ACT_ENVIRONMENT = true;

let api = null;
function Probe({ items, getId }) {
  api = useBulkSelect(items, getId);
  return null;
}

const getId = (r) => r.id;

async function mount(items) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  let rerender;
  await act(async () => { root.render(<Probe items={items} getId={getId} />); });
  rerender = async (nextItems) => {
    await act(async () => { root.render(<Probe items={nextItems} getId={getId} />); });
  };
  return { rerender, unmount: () => act(() => root.unmount()) };
}

const set = async (fn) => { await act(async () => { fn(); }); };

let view;
afterEach(() => { view && view.unmount(); api = null; });

const ROWS = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

test('selecting rows then hiding some via a filter change reports hiddenCount and visibleIds', async () => {
  view = await mount(ROWS);

  await set(() => api.toggle('a'));
  await set(() => api.toggle('b'));
  await set(() => api.toggle('c'));
  expect(api.count).toBe(3);

  // filter now hides b and c — only 'a' remains in items
  await view.rerender([{ id: 'a' }]);

  expect(api.count).toBe(3);
  expect(api.hiddenCount).toBe(2);
  expect(api.visibleIds).toEqual(['a']);
});

test('toggleAll with some rows hidden selects all current items without discarding hidden selections', async () => {
  view = await mount(ROWS);

  // Select 'c', which will fall outside the next render's items (hidden).
  await set(() => api.toggle('c'));
  await view.rerender([{ id: 'a' }, { id: 'b' }]);
  expect(api.hiddenCount).toBe(1);

  // Select-all over the now-current items must not wipe out the hidden 'c'.
  await set(() => api.toggleAll());
  expect(api.count).toBe(3);
  expect(new Set(api.visibleIds)).toEqual(new Set(['a', 'b']));
  expect(api.hiddenCount).toBe(1);
  expect(api.allSelected).toBe(true);

  // Deselect-all must remove only the currently-visible items, leaving the
  // hidden selection alone.
  await set(() => api.toggleAll());
  expect(api.count).toBe(1);
  expect(api.visibleIds).toEqual([]);
  expect(api.hiddenCount).toBe(1);
  expect(api.allSelected).toBe(false);
});

test('clear empties everything, hidden included', async () => {
  view = await mount(ROWS);

  await set(() => api.toggle('a'));
  await set(() => api.toggle('c'));
  await view.rerender([{ id: 'a' }]); // 'c' now hidden
  expect(api.hiddenCount).toBe(1);

  await set(() => api.clear());
  expect(api.count).toBe(0);
  expect(api.hiddenCount).toBe(0);
  expect(api.visibleIds).toEqual([]);
  expect(api.selectedIds.size).toBe(0);
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

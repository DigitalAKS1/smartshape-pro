// useLeadsFilter — filter UI state extracted from useLeadsCRM (stage, owner,
// tag, search). Purely local state, no data/API dependency, so it is rendered
// through a probe component via react-dom/client (no @testing-library/react
// in this repo — same pattern as useLeadsCRM.test.js / FilterRail.test.js).
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { useLeadsFilter } from '../useLeadsFilter';

global.IS_REACT_ACT_ENVIRONMENT = true;

let api = null;
function Probe({ initialFilters }) {
  api = useLeadsFilter(initialFilters);
  return null;
}

async function mount(initialFilters) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(<Probe initialFilters={initialFilters} />); });
  return { unmount: () => act(() => root.unmount()) };
}

const set = async (fn) => { await act(async () => { fn(); }); };

let view;
afterEach(() => { view && view.unmount(); api = null; });

test('initializes with default values', async () => {
  view = await mount();

  expect(api.filters).toEqual({
    stage: null,
    owner: null,
    tag: null,
    search: '',
  });
});

test('initializes with overrides merged over defaults', async () => {
  view = await mount({ stage: 'new', search: 'abc' });

  expect(api.filters).toEqual({
    stage: 'new',
    owner: null,
    tag: null,
    search: 'abc',
  });
});

test('updates individual filters without disturbing the others', async () => {
  view = await mount();

  await set(() => api.updateFilter('stage', 'negotiation'));
  await set(() => api.updateFilter('tag', 'care'));

  expect(api.filters.stage).toBe('negotiation');
  expect(api.filters.tag).toBe('care');
  expect(api.filters.owner).toBeNull();
  expect(api.filters.search).toBe('');
});

test('updates search independently of the other filters', async () => {
  view = await mount();

  await set(() => api.updateFilter('owner', 'rep@smartshape.in'));
  await set(() => api.updateFilter('search', 'delhi public school'));

  expect(api.filters).toEqual({
    stage: null,
    owner: 'rep@smartshape.in',
    tag: null,
    search: 'delhi public school',
  });
});

test('clears all filters back to defaults, not back to initialFilters', async () => {
  view = await mount({ stage: 'new' });

  await set(() => api.updateFilter('tag', 'care'));
  expect(api.filters.stage).toBe('new');
  expect(api.filters.tag).toBe('care');

  await set(() => api.clearFilters());

  expect(api.filters).toEqual({
    stage: null,
    owner: null,
    tag: null,
    search: '',
  });
});

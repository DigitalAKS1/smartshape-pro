// useLeadSelection holds the lead-row selection shared by the Leads list tab,
// the Pipeline tab's Kanban and ReassignLeadDialog. It is useLeadsCRM's
// `selectedLeadIds` / `toggleLeadSelect` / `clearLeadSelection`.
//
// Rendered through a probe component via react-dom/client (no
// @testing-library/react here; same pattern as useBulkSelect.test.js).
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import useLeadSelection from '../useLeadSelection';

global.IS_REACT_ACT_ENVIRONMENT = true;

let api = null;
function Probe({ leadsList, activeTab }) {
  api = useLeadSelection(leadsList, activeTab);
  return null;
}

const LEADS = ['a', 'b', 'c', 'd', 'e'].map(id => ({ lead_id: id }));
const ORDER = LEADS.map(l => l.lead_id);

async function mount(leadsList = LEADS, activeTab = 'list') {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const props = { leadsList, activeTab };
  await act(async () => { root.render(<Probe {...props} />); });
  return {
    rerender: async (more) => {
      Object.assign(props, more);
      await act(async () => { root.render(<Probe {...props} />); });
    },
    unmount: () => act(() => root.unmount()),
  };
}

const ids = () => Array.from(api.selectedLeadIds).sort();

test('plain toggle flips a row, as the Kanban calls it', async () => {
  const v = await mount();
  await act(async () => { api.toggleLeadSelect('b'); });
  expect(ids()).toEqual(['b']);
  await act(async () => { api.toggleLeadSelect('b'); });
  expect(ids()).toEqual([]);
  v.unmount();
});

test('shift-click selects the range from the last-clicked row', async () => {
  const v = await mount();
  await act(async () => { api.toggleLeadSelect('b', { orderedIds: ORDER }); });
  await act(async () => { api.toggleLeadSelect('d', { shift: true, orderedIds: ORDER }); });
  expect(ids()).toEqual(['b', 'c', 'd']);
  v.unmount();
});

test('clearLeadSelection empties the set and forgets the shift anchor', async () => {
  const v = await mount();
  await act(async () => { api.toggleLeadSelect('b', { orderedIds: ORDER }); });
  await act(async () => { api.clearLeadSelection(); });
  expect(ids()).toEqual([]);
  // No anchor any more, so a shift-click is a plain single toggle.
  await act(async () => { api.toggleLeadSelect('d', { shift: true, orderedIds: ORDER }); });
  expect(ids()).toEqual(['d']);
  v.unmount();
});

test('changing tab clears the selection, so nothing leaks between tabs', async () => {
  const v = await mount(LEADS, 'list');
  await act(async () => { api.toggleLeadSelect('a'); api.toggleLeadSelect('c'); });
  expect(ids()).toEqual(['a', 'c']);
  await v.rerender({ activeTab: 'contacts' });
  expect(ids()).toEqual([]);
  v.unmount();
});

test('re-rendering on the same tab keeps the selection', async () => {
  const v = await mount(LEADS, 'list');
  await act(async () => { api.toggleLeadSelect('a'); });
  await v.rerender({ activeTab: 'list', leadsList: [...LEADS] });
  expect(ids()).toEqual(['a']);
  v.unmount();
});

test('a lead that disappears from the list (deleted / refetched away) is pruned', async () => {
  const v = await mount();
  await act(async () => { api.toggleLeadSelect('a'); api.toggleLeadSelect('c'); });
  await v.rerender({ leadsList: LEADS.filter(l => l.lead_id !== 'c') });
  expect(ids()).toEqual(['a']);
  v.unmount();
});

test('setSelectedLeadIds keeps its old contract (updater or value)', async () => {
  const v = await mount();
  await act(async () => { api.setSelectedLeadIds(new Set(['a', 'b'])); });
  expect(ids()).toEqual(['a', 'b']);
  await act(async () => { api.setSelectedLeadIds(prev => new Set([...prev, 'e'])); });
  expect(ids()).toEqual(['a', 'b', 'e']);
  v.unmount();
});

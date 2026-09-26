// useSessionState — drop-in useState replacement backed by sessionStorage.
//
// Added alongside useGoBack to fix the "Back forgets my filter" complaint:
// CRM filters lived in plain useState inside a page that unmounts whenever
// the user navigates to a school profile or quotation, so retracing that
// journey with Back always landed back on an empty, unfiltered list.
//
// Rendered through a probe component via react-dom/client (no
// @testing-library/react in this repo — same pattern as
// useBulkSelect.test.js / ContactsTab.test.js).
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import useSessionState from '../useSessionState';

global.IS_REACT_ACT_ENVIRONMENT = true;

let api = null;
function Probe({ storageKey, initialValue }) {
  const [value, setValue] = useSessionState(storageKey, initialValue);
  api = { value, setValue };
  return null;
}

async function mount(storageKey, initialValue) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(<Probe storageKey={storageKey} initialValue={initialValue} />); });
  return { unmount: () => act(() => root.unmount()) };
}

const set = async (fn) => { await act(async () => { fn(); }); };

let view;
afterEach(() => {
  view && view.unmount();
  api = null;
  window.sessionStorage.clear();
});

test('starts from initialValue when sessionStorage has nothing for the key', async () => {
  view = await mount('test.empty', { role: '' });
  expect(api.value).toEqual({ role: '' });
});

test('setting the value writes it to sessionStorage under the given key', async () => {
  view = await mount('test.role', '');
  await set(() => api.setValue('Teacher'));
  expect(api.value).toBe('Teacher');
  expect(window.sessionStorage.getItem('test.role')).toBe(JSON.stringify('Teacher'));
});

test('a functional update sees the latest previous value, like useState', async () => {
  view = await mount('test.count', 0);
  await set(() => api.setValue(v => v + 1));
  await set(() => api.setValue(v => v + 1));
  expect(api.value).toBe(2);
});

// This is the actual bug scenario: navigating from Contacts to a school
// profile unmounts the CRM page (and its filter state) entirely; navigating
// "back" remounts it from scratch. A real useState would come back empty —
// useSessionState must come back exactly as it was left.
test('survives an unmount + remount at the same key — the Back-button scenario', async () => {
  view = await mount('crm.filterRole', '');
  await set(() => api.setValue('Principal'));
  expect(api.value).toBe('Principal');

  await view.unmount();
  api = null;

  view = await mount('crm.filterRole', '');
  expect(api.value).toBe('Principal');
});

test('two different keys do not clobber each other', async () => {
  const a = await mount('test.a', 'first');
  await set(() => api.setValue('changed'));
  await a.unmount();

  const b = await mount('test.b', 'untouched');
  expect(api.value).toBe('untouched');
  await b.unmount();
  view = null;
});

test('corrupted JSON already sitting in sessionStorage falls back to initialValue instead of throwing', async () => {
  window.sessionStorage.setItem('test.corrupt', '{not valid json');
  view = await mount('test.corrupt', 'safe-default');
  expect(api.value).toBe('safe-default');
});

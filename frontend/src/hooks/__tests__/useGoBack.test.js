// useGoBack — replaces a "Back" button's hardcoded navigate('/some-list')
// with real journey-aware history navigation.
//
// The bug this fixes: filtering Contacts, opening a school, then opening a
// quotation, then pressing "Back" landed back on the quotations LIST — not
// on the school the user actually came from. That's because several "Back"
// buttons across the app called navigate() to one fixed route instead of
// retracing the browser history the user actually built by clicking through.
//
// react-router-dom v7 is ESM-only and this project's Jest resolver can't
// walk its exports map (see useLeadsCRM.test.js), so — same convention —
// react-router-dom is stubbed with a virtual mock exposing just the two
// hooks useGoBack calls, with a controllable mock location/navigate.
//
// Rendered through a probe component via react-dom/client (no
// @testing-library/react in this repo — same pattern as ContactsTab.test.js).
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

const mockNavigate = jest.fn();
let mockLocation = { key: 'default' };
jest.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  useLocation: () => mockLocation,
}), { virtual: true });

// eslint-disable-next-line import/first
import useGoBack from '../useGoBack';

global.IS_REACT_ACT_ENVIRONMENT = true;

let api = null;
function Probe({ fallbackPath }) {
  const goBack = useGoBack(fallbackPath);
  api = { goBack };
  return null;
}

async function mount(fallbackPath) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(<Probe fallbackPath={fallbackPath} />); });
  return { unmount: () => act(() => root.unmount()) };
}

const click = async (fn) => { await act(async () => { fn(); }); };

let view;
afterEach(() => {
  view && view.unmount();
  api = null;
  mockNavigate.mockClear();
  mockLocation = { key: 'default' };
});

test('a page opened directly (no history) falls back to fallbackPath instead of leaving the app', async () => {
  mockLocation = { key: 'default' };
  view = await mount('/quotations');

  await click(() => api.goBack());

  expect(mockNavigate).toHaveBeenCalledWith('/quotations');
});

test('a page reached by clicking through the app retraces that journey (real history back)', async () => {
  // Any key other than 'default' means this location was pushed by an
  // in-app navigation, so there is somewhere real to go back to.
  mockLocation = { key: 'abc123' };
  view = await mount('/quotations');

  await click(() => api.goBack());

  expect(mockNavigate).toHaveBeenCalledWith(-1);
  expect(mockNavigate).not.toHaveBeenCalledWith('/quotations');
});

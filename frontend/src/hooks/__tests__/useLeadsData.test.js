// Rendered through a probe component via react-dom/client (no
// @testing-library/react in this repo's node_modules — same pattern as
// FilterRail.test.js / useLeadsCRM.test.js).
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { useLeadsData } from '../useLeadsData';

global.IS_REACT_ACT_ENVIRONMENT = true;

const ok = (data) => Promise.resolve({ data });

const mockList = jest.fn();
jest.mock('../../lib/api', () => ({
  leads: { list: (...args) => mockList(...args) },
}));

// ── Probe ───────────────────────────────────────────────────────────────────
let hookResult = null;
function Probe({ page, limit, filters }) {
  hookResult = useLeadsData(page, limit, filters);
  return null;
}

let container;
let root;

function mount(props) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  return act(async () => {
    root.render(<Probe {...props} />);
  });
}

function rerender(props) {
  return act(async () => {
    root.render(<Probe {...props} />);
  });
}

afterEach(() => {
  act(() => { root.unmount(); });
  container.remove();
  mockList.mockReset();
  hookResult = null;
});

test('useLeadsData fetches paginated leads and exposes total/facets', async () => {
  mockList.mockReturnValue(ok({
    leads: [{ lead_id: '1', school_name: 'Test' }],
    total: 100,
    page: 1,
    pages: 2,
    limit: 50,
    facets: { stages: { new: 100 } },
  }));

  await mount({ page: 1, limit: 50, filters: {} });

  expect(hookResult.loading).toBe(false);
  expect(hookResult.leads).toHaveLength(1);
  expect(hookResult.leads[0].lead_id).toBe('1');
  expect(hookResult.total).toBe(100);
  expect(hookResult.facets).toEqual({ stages: { new: 100 } });
  expect(hookResult.error).toBeNull();
  expect(mockList).toHaveBeenCalledWith({ page: 1, limit: 50 });
});

test('useLeadsData refetches when page changes', async () => {
  mockList.mockReturnValue(ok({ leads: [], total: 0, facets: {} }));

  await mount({ page: 1, limit: 50, filters: {} });
  expect(mockList).toHaveBeenCalledTimes(1);

  await rerender({ page: 2, limit: 50, filters: {} });
  expect(mockList).toHaveBeenCalledTimes(2);
  expect(mockList).toHaveBeenLastCalledWith({ page: 2, limit: 50 });
});

test('useLeadsData does NOT refetch when an equivalent filters object is passed', async () => {
  mockList.mockReturnValue(ok({ leads: [], total: 0, facets: {} }));

  await mount({ page: 1, limit: 50, filters: { stage: 'new' } });
  expect(mockList).toHaveBeenCalledTimes(1);

  // A fresh object literal with the same values must NOT re-trigger the fetch
  // — this is exactly the infinite-loop trap the brief calls out.
  await rerender({ page: 1, limit: 50, filters: { stage: 'new' } });
  expect(mockList).toHaveBeenCalledTimes(1);
});

test('useLeadsData refetches when filter values actually change', async () => {
  mockList.mockReturnValue(ok({ leads: [], total: 0, facets: {} }));

  await mount({ page: 1, limit: 50, filters: { stage: 'new' } });
  expect(mockList).toHaveBeenCalledTimes(1);

  await rerender({ page: 1, limit: 50, filters: { stage: 'won' } });
  expect(mockList).toHaveBeenCalledTimes(2);
  expect(mockList).toHaveBeenLastCalledWith({ stage: 'won', page: 1, limit: 50 });
});

test('useLeadsData surfaces an error and empties leads on API failure', async () => {
  mockList.mockReturnValue(Promise.reject(new Error('Network down')));

  await mount({ page: 1, limit: 50, filters: {} });

  expect(hookResult.loading).toBe(false);
  expect(hookResult.error).toBe('Network down');
  expect(hookResult.leads).toEqual([]);
  expect(hookResult.total).toBe(0);
});

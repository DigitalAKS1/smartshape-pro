// Rendered into jsdom via react-dom/client (no @testing-library/react here).
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import SegmentPerformance from '../SegmentPerformance';
import { crmReports } from '../../../lib/api';

global.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('../../../lib/api', () => ({ crmReports: { segmentPerformance: jest.fn() } }));

const ROWS = {
  attribute: 'board',
  min_sample: 8,
  attributes: ['board', 'school_type', 'strength_band', 'city'],
  rows: [
    { attribute: 'board', value: 'CBSE', total: 40, customers: 18,
      conversion_rate: 45.0, avg_customer_value: 62000, reliable: true },
    { attribute: 'board', value: 'IB', total: 2, customers: 1,
      conversion_rate: 50.0, avg_customer_value: 90000, reliable: false },
    { attribute: 'board', value: 'State Board', total: 120, customers: 2,
      conversion_rate: 1.7, avg_customer_value: 8000, reliable: true },
  ],
};

async function mount(payload = ROWS) {
  crmReports.segmentPerformance.mockResolvedValue({ data: payload });
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(<SegmentPerformance />); });
  return {
    container,
    text: () => container.textContent,
    q: (id) => container.querySelector(`[data-testid="${id}"]`),
    click: async (id) => { await act(async () => { container.querySelector(`[data-testid="${id}"]`).click(); }); },
    unmount: () => act(() => root.unmount()),
  };
}

beforeEach(() => jest.clearAllMocks());

test('shows conversion per segment with the sample it rests on', async () => {
  const v = await mount();
  expect(v.text()).toContain('CBSE');
  expect(v.text()).toContain('40');
  expect(v.text()).toContain('18');
  expect(v.text()).toContain('45%');
  v.unmount();
});

test('a thin segment is shown but labelled, never silently dropped', async () => {
  // A 50% rate off two schools would otherwise look like the best group here.
  const v = await mount();
  expect(v.q('segment-row-IB')).toBeTruthy();
  expect(v.q('segment-row-IB').textContent).toContain('too few to tell');
  v.unmount();
});

test('the headline names a group with real evidence behind it, not the top rate', async () => {
  const v = await mount();
  expect(v.text()).toContain('Best group so far');
  expect(v.text()).toMatch(/Best group so far:\s*CBSE/);
  v.unmount();
});

test('switching attribute asks the server for that one', async () => {
  const v = await mount();
  await v.click('segment-by-strength_band');
  expect(crmReports.segmentPerformance).toHaveBeenLastCalledWith('strength_band');
  v.unmount();
});

test('it explains why thin rows do not count', async () => {
  const v = await mount();
  expect(v.text()).toContain('fewer than 8 schools');
  v.unmount();
});

test('no data yet says so rather than showing an empty table', async () => {
  const v = await mount({ ...ROWS, rows: [] });
  expect(v.text()).toMatch(/nothing to compare/i);
  v.unmount();
});

test('a failure reports the reason', async () => {
  crmReports.segmentPerformance.mockRejectedValue(
    { response: { data: { detail: 'attribute must be one of board, school_type' } } });
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(<SegmentPerformance />); });
  expect(container.textContent).toContain('attribute must be one of');
  await act(() => root.unmount());
});

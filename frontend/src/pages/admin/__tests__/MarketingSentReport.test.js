// D6: one report, three roll-ups. The toggle changes ONE parameter, and export
// asks the server for exactly the rows on screen. Rendered via react-dom/client.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import MarketingSentReport from '../MarketingSentReport';
import { reports } from '../../../lib/api';

global.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('../../../components/layouts/AdminLayout', () => ({ children }) => <div>{children}</div>);
jest.mock('../../../lib/api', () => ({
  reports: { marketingSent: jest.fn(), marketingSentCsv: jest.fn() },
}));
jest.mock('sonner', () => ({ toast: Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn() }) }));

const PAYLOAD = {
  group_by: 'school',
  rows: [
    { key: 's1', name: 'DPS', owner: 'parul@smartshape.in', sequences: ['Principal Pitch'],
      sent_by_channel: { whatsapp: 1, email: 0, call: 0, post: 1 },
      post: { verified_sent: 1, pending: 0, not_sent: 0, needs_address: 0 },
      last_sent_at: '2026-09-13', responses: { qr_scans: 1, interest: 1 } },
    { key: 's2', name: 'Lotus', owner: 'bde@smartshape.in', sequences: ['Quiz Engage'],
      sent_by_channel: { whatsapp: 0, email: 0, call: 0, post: 0 },
      post: { verified_sent: 0, pending: 1, not_sent: 0, needs_address: 0 },
      last_sent_at: '', responses: { qr_scans: 0, interest: 0 } },
  ],
  totals: { rows: 2, shown: 2, capped: false, scan_capped: false, post_envelopes: 1,
            sent_by_channel: { whatsapp: 1, email: 0, call: 0, post: 1 },
            post: { verified_sent: 1, pending: 1, not_sent: 0, needs_address: 0 },
            responses: { qr_scans: 1, interest: 1 } },
  from: '', to: '',
};

beforeEach(() => {
  jest.clearAllMocks();
  reports.marketingSent.mockImplementation(() => Promise.resolve({ data: PAYLOAD }));
  reports.marketingSentCsv.mockImplementation(() =>
    Promise.resolve({ data: new Blob(['key,name\n']) }));
});

async function render() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<MarketingSentReport />);
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
  return {
    container,
    q: (id) => container.querySelector(`[data-testid="${id}"]`),
    rowKeys: () => Array.from(container.querySelectorAll('[data-testid^="ms-row-"]'))
      .map(el => el.getAttribute('data-testid').replace('ms-row-', '')),
    unmount: () => act(() => root.unmount()),
  };
}

test('loads the school roll-up by default', async () => {
  const v = await render();
  expect(reports.marketingSent.mock.calls[0][0].group_by).toBe('school');
  expect(v.rowKeys()).toEqual(['s1', 's2']);
  expect(v.q('ms-row-s1').textContent).toContain('DPS');
  v.unmount();
});

test('a school reached only by post shows pending, not sent', async () => {
  const v = await render();
  const row = v.q('ms-row-s2').textContent;
  expect(row).toContain('Lotus');
  expect(row).toContain('1 pending');
  v.unmount();
});

test('the totals strip reports what actually went out', async () => {
  const v = await render();
  const totals = v.q('ms-totals').textContent;
  expect(totals).toContain('still to post');
  expect(totals).toContain('1');
  v.unmount();
});

test('switching the toggle refetches with the new group_by', async () => {
  const v = await render();
  await act(async () => {
    v.q('ms-tab-contact').click();
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
  const last = reports.marketingSent.mock.calls.pop()[0];
  expect(last.group_by).toBe('contact');
  v.unmount();
});

test('export asks for the same rows as CSV', async () => {
  global.URL.createObjectURL = jest.fn(() => 'blob:x');
  global.URL.revokeObjectURL = jest.fn();
  const v = await render();
  await act(async () => {
    v.q('ms-export').click();
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
  expect(reports.marketingSentCsv).toHaveBeenCalledWith(
    expect.objectContaining({ group_by: 'school' }));
  v.unmount();
});

test('contact mode explains that one envelope reached several people', async () => {
  reports.marketingSent.mockImplementation((params) => Promise.resolve({ data: {
    ...PAYLOAD,
    group_by: params.group_by,
    totals: { ...PAYLOAD.totals, post_envelopes: 1,
              sent_by_channel: { whatsapp: 1, email: 0, call: 0, post: 2 } },
  } }));
  const v = await render();
  expect(v.q('ms-envelope-note')).toBeNull();
  await act(async () => {
    v.q('ms-tab-contact').click();
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
  const note = v.q('ms-envelope-note').textContent;
  expect(note).toContain('1 envelope');
  expect(note).toContain('2 people');
  v.unmount();
});

test('a capped page says the export is NOT capped', async () => {
  reports.marketingSent.mockImplementation(() => Promise.resolve({ data: {
    ...PAYLOAD,
    totals: { ...PAYLOAD.totals, rows: 9000, shown: 2000, capped: true },
  } }));
  const v = await render();
  const note = v.q('ms-cap-note').textContent;
  expect(note).toContain('first 2000 of 9000');
  expect(note).toContain('Export gives you every row');
  expect(v.q('ms-scan-cap-note')).toBeNull();
  v.unmount();
});

test('a capped scan warns that the numbers are a floor', async () => {
  reports.marketingSent.mockImplementation(() => Promise.resolve({ data: {
    ...PAYLOAD, totals: { ...PAYLOAD.totals, scan_capped: true },
  } }));
  const v = await render();
  const note = v.q('ms-scan-cap-note').textContent;
  expect(note).toContain('a floor, not a total');
  expect(note).toContain('one sequence');
  v.unmount();
});

test('contact mode labels what is owed as people, with the envelope count', async () => {
  reports.marketingSent.mockImplementation((params) => Promise.resolve({ data: {
    ...PAYLOAD,
    group_by: params.group_by,
    totals: { ...PAYLOAD.totals, pending_envelopes: 1,
              post: { verified_sent: 1, pending: 3, not_sent: 0, needs_address: 0,
                      closed_unposted: 0 } },
  } }));
  const v = await render();
  expect(v.q('ms-owed').textContent).toContain('still to post');
  await act(async () => {
    v.q('ms-tab-contact').click();
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
  const owed = v.q('ms-owed').textContent;
  expect(owed).toContain('people awaiting post');
  expect(owed).toContain('3');
  expect(owed).toContain('(1 envelope)');
  v.unmount();
});

test('closed-but-never-posted pieces are shown, not hidden', async () => {
  reports.marketingSent.mockImplementation(() => Promise.resolve({ data: {
    ...PAYLOAD,
    totals: { ...PAYLOAD.totals,
              post: { ...PAYLOAD.totals.post, closed_unposted: 2 } },
  } }));
  const v = await render();
  expect(v.q('ms-closed-unposted').textContent).toContain('2');
  v.unmount();
});

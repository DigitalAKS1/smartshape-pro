// The cross-run To-post queue: one tick per envelope, and ONE call that the
// server groups by run (D5). Rendered into jsdom via react-dom/client (no
// @testing-library here).
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import ToPostQueue from '../ToPostQueue';
import { mailRuns } from '../../../lib/api';
import { toast } from 'sonner';

global.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('../../../lib/api', () => ({
  mailRuns: {
    toPost: jest.fn(),
    verifyTouches: jest.fn(),
    undoTouches: jest.fn(),
    queueStickers: jest.fn(),
  },
}));
jest.mock('sonner', () => ({ toast: Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn() }) }));
jest.mock('../../../lib/dataSync', () => ({ useDataSync: () => {} }));
jest.mock('../../../contexts/ThemeContext', () => ({ useTheme: () => ({ isDark: true }) }));

const ROWS = [
  { touch_id: 't1', run_id: 'r1', run_name: 'Pitch', sequence_id: 'seq1',
    sequence_name: 'Principal Pitch', school_id: 's1', school_name: 'DPS',
    address_ok: true, contact_ids: ['c1'], recipient_names: ['R Sharma'],
    item_name: '2026 Catalogue', piece_type: 'brochure', planned_date: '2026-09-01',
    overdue_days: 21, verify_status: 'pending', posted_at: null, reason: '',
    owner: 'parul@smartshape.in' },
  { touch_id: 't2', run_id: 'r2', run_name: 'Manual list', sequence_id: '',
    sequence_name: '', school_id: 's2', school_name: 'Lotus', address_ok: false,
    contact_ids: [], recipient_names: [], item_name: 'Sample kit',
    piece_type: 'sample', planned_date: '2026-12-31', overdue_days: 0,
    verify_status: 'pending', posted_at: null, reason: '', owner: 'bde@smartshape.in' },
  { touch_id: 't3', run_id: 'r1', run_name: 'Pitch', sequence_id: 'seq1',
    sequence_name: 'Principal Pitch', school_id: '', school_name: '', address_ok: false,
    contact_ids: ['c9'], recipient_names: ['No School'], item_name: 'Quiz flyer',
    piece_type: 'brochure', planned_date: '2026-09-02', overdue_days: 20,
    verify_status: 'needs_address', posted_at: null, reason: '',
    owner: 'bde@smartshape.in' },
];
const TOTALS = { pending: 2, needs_address: 1, sent: 0, not_sent: 0, skipped: 0,
                 overdue: 2, shown: 3, capped: false };

// "Mark posted" asks before it writes; every test that gets that far answers
// yes unless it is the test about saying no.
let confirmAnswer = true;

beforeEach(() => {
  jest.clearAllMocks();
  confirmAnswer = true;
  window.confirm = jest.fn(() => confirmAnswer);
  mailRuns.toPost.mockImplementation(() =>
    Promise.resolve({ data: { rows: ROWS, totals: TOTALS, totals_all: TOTALS,
                              as_of: '2026-09-22' } }));
  mailRuns.verifyTouches.mockImplementation((rows) =>
    Promise.resolve({ data: { updated: rows.length, not_found: [], not_visible: [] } }));
  mailRuns.undoTouches.mockImplementation((ids) =>
    Promise.resolve({ data: { updated: ids.length, not_found: [], not_visible: [] } }));
  mailRuns.queueStickers.mockImplementation(() => Promise.resolve({ data: new Blob(['x']) }));
});

// The reason box gates "Not posted", so every not-posted path fills it first.
const typeReason = (v, text) => act(() => { setInputValue(v.q('to-post-reason'), text); });

async function render(props = {}) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<ToPostQueue onOpenSchool={jest.fn()} {...props} />);
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
  return {
    container,
    q: (id) => container.querySelector(`[data-testid="${id}"]`),
    all: (sel) => Array.from(container.querySelectorAll(sel)),
    rowIds: () => Array.from(container.querySelectorAll('[data-testid^="to-post-row-"]'))
      .map(el => el.getAttribute('data-testid').replace('to-post-row-', '')),
    unmount: () => act(() => root.unmount()),
  };
}

// The table and the mobile card list both render a row per touch; the tests
// care about the touch ids, so de-duplicate what the two layouts share.
const uniq = (a) => Array.from(new Set(a));

// React tracks a controlled input's value on the node, so a bare `el.value =`
// leaves the tracker in step and onChange never fires. Go through the native
// setter, exactly as the CRM tests do (see FilterRail.test.js).
function setInputValue(input, value) {
  const proto = input.tagName === 'SELECT' ? window.HTMLSelectElement.prototype
    : window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(input, value);
  input.dispatchEvent(new Event(input.tagName === 'SELECT' ? 'change' : 'input',
    { bubbles: true }));
}

test('lists every pending and flagged piece across runs', async () => {
  const v = await render();
  expect(uniq(v.rowIds())).toEqual(['t1', 't2', 't3']);
  v.unmount();
});

test('a needs_address row carries its badge', async () => {
  const v = await render();
  expect(v.q('to-post-needs-address-t3')).not.toBeNull();
  expect(v.q('to-post-needs-address-t1')).toBeNull();
  v.unmount();
});

test('the needs-address badge opens the school or the contact', async () => {
  const onOpenSchool = jest.fn();
  const v = await render({ onOpenSchool });
  act(() => { v.q('to-post-needs-address-t3').click(); });
  expect(onOpenSchool).toHaveBeenCalledWith('', ['c9']);
  v.unmount();
});

test('the recipient names show on the envelope, not the school alone', async () => {
  const v = await render();
  expect(v.q('to-post-row-t1').textContent).toContain('R Sharma');
  v.unmount();
});

test('marking selected posted sends ONE call carrying every run', async () => {
  const v = await render();
  act(() => { v.q('to-post-check-t1').click(); });
  act(() => { v.q('to-post-check-t3').click(); });
  act(() => { v.q('to-post-check-t2').click(); });
  await act(async () => {
    v.q('to-post-mark-posted').click();
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
  expect(mailRuns.verifyTouches).toHaveBeenCalledTimes(1);
  const [rows, postedDate] = mailRuns.verifyTouches.mock.calls[0];
  expect(rows.map(r => r.touch_id).sort()).toEqual(['t1', 't2', 't3']);
  expect(rows.every(r => r.verify_status === 'sent')).toBe(true);
  expect(postedDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  v.unmount();
});

test('the posted date defaults to today and is sent as picked', async () => {
  const v = await render();
  act(() => { v.q('to-post-check-t1').click(); });
  expect(v.q('to-post-posted-date').value).toBe(new Date().toISOString().slice(0, 10));
  act(() => { setInputValue(v.q('to-post-posted-date'), '2026-09-20'); });
  await act(async () => {
    v.q('to-post-mark-posted').click();
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
  expect(mailRuns.verifyTouches.mock.calls[0][1]).toBe('2026-09-20');
  v.unmount();
});

test('not posted sends the reason with the rows', async () => {
  const v = await render();
  act(() => { v.q('to-post-check-t1').click(); });
  typeReason(v, 'no envelopes left');
  await act(async () => {
    v.q('to-post-not-posted').click();
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
  const [rows] = mailRuns.verifyTouches.mock.calls[0];
  expect(rows[0].verify_status).toBe('not_sent');
  expect(rows[0].reason).toBe('no envelopes left');
  v.unmount();
});

test('marking posted asks first, with the count and the date', async () => {
  const v = await render();
  act(() => { v.q('to-post-check-t1').click(); });
  act(() => { v.q('to-post-check-t2').click(); });
  await act(async () => {
    v.q('to-post-mark-posted').click();
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
  expect(window.confirm).toHaveBeenCalledTimes(1);
  const asked = window.confirm.mock.calls[0][0];
  expect(asked).toContain('2 pieces');
  expect(asked).toContain(new Date().toISOString().slice(0, 10));
});

test('saying no to the confirm writes nothing and keeps the selection', async () => {
  confirmAnswer = false;
  const v = await render();
  act(() => { v.q('to-post-check-t1').click(); });
  await act(async () => {
    v.q('to-post-mark-posted').click();
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
  expect(mailRuns.verifyTouches).not.toHaveBeenCalled();
  expect(v.q('to-post-bar').textContent).toContain('1 selected');
  v.unmount();
});

test('"Not posted" is disabled until a reason is typed', async () => {
  const v = await render();
  act(() => { v.q('to-post-check-t1').click(); });
  expect(v.q('to-post-not-posted').disabled).toBe(true);
  await act(async () => {
    v.q('to-post-not-posted').click();
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
  expect(mailRuns.verifyTouches).not.toHaveBeenCalled();
  typeReason(v, 'no envelopes left');
  expect(v.q('to-post-not-posted').disabled).toBe(false);
  v.unmount();
});

test('the toast reports what the SERVER did, not what was asked', async () => {
  mailRuns.verifyTouches.mockImplementation(() =>
    Promise.resolve({ data: { updated: 1, not_found: ['t2'], not_visible: ['t3'] } }));
  const v = await render();
  act(() => { v.q('to-post-check-all').click(); });
  await act(async () => {
    v.q('to-post-mark-posted').click();
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
  const msg = toast.success.mock.calls.concat(toast.error.mock.calls).map(c => c[0]).join(' | ');
  expect(msg).toContain('1 piece marked posted');
  expect(msg).toContain('2 skipped');
  v.unmount();
});

test('a selection survives a filter change and is counted as hidden', async () => {
  jest.useFakeTimers();
  const v = await render();
  act(() => { v.q('to-post-check-t1').click(); });
  act(() => { v.q('to-post-check-t2').click(); });
  expect(v.q('to-post-bar').textContent).toContain('2 selected');

  // The server narrows to one row; the other stays ticked, just hidden.
  mailRuns.toPost.mockImplementation(() => Promise.resolve({
    data: { rows: [ROWS[0]], totals: TOTALS, totals_all: TOTALS, as_of: '2026-09-22' } }));
  await act(async () => {
    setInputValue(v.q('to-post-search'), 'sharma');
    jest.advanceTimersByTime(400);
    for (let i = 0; i < 40; i++) await Promise.resolve();
  });
  expect(v.rowIds()).toEqual(['t1']);
  expect(v.q('to-post-bar').textContent).toContain('2 selected');
  expect(v.q('to-post-bar').textContent).toContain('1 hidden by filter');

  // Clearing the search brings it back, still ticked.
  mailRuns.toPost.mockImplementation(() => Promise.resolve({
    data: { rows: ROWS, totals: TOTALS, totals_all: TOTALS, as_of: '2026-09-22' } }));
  await act(async () => {
    setInputValue(v.q('to-post-search'), '');
    jest.advanceTimersByTime(400);
    for (let i = 0; i < 40; i++) await Promise.resolve();
  });
  expect(v.q('to-post-check-t1').checked).toBe(true);
  expect(v.q('to-post-check-t2').checked).toBe(true);
  expect(v.q('to-post-bar').textContent).toContain('2 selected');
  expect(v.q('to-post-bar').textContent).not.toContain('hidden by filter');
  v.unmount();
  jest.useRealTimers();
});

test('only the visible part of a selection is ever acted on', async () => {
  jest.useFakeTimers();
  const v = await render();
  act(() => { v.q('to-post-check-all').click(); });
  mailRuns.toPost.mockImplementation(() => Promise.resolve({
    data: { rows: [ROWS[0]], totals: TOTALS, totals_all: TOTALS, as_of: '2026-09-22' } }));
  await act(async () => {
    setInputValue(v.q('to-post-search'), 'sharma');
    jest.advanceTimersByTime(400);
    for (let i = 0; i < 40; i++) await Promise.resolve();
  });
  await act(async () => {
    v.q('to-post-mark-posted').click();
    for (let i = 0; i < 40; i++) await Promise.resolve();
  });
  expect(mailRuns.verifyTouches.mock.calls[0][0].map(r => r.touch_id)).toEqual(['t1']);
  v.unmount();
  jest.useRealTimers();
});

test('the chips read the status-independent totals', async () => {
  mailRuns.toPost.mockImplementation(() => Promise.resolve({
    data: { rows: [ROWS[2]], totals: { needs_address: 1, shown: 1 },
            totals_all: { pending: 2, needs_address: 1, sent: 4, not_sent: 0,
                          skipped: 0, overdue: 2 }, as_of: '2026-09-22' } }));
  const v = await render();
  expect(v.q('to-post-chip-pending').textContent).toContain('2');
  expect(v.q('to-post-chip-sent').textContent).toContain('4');
  v.unmount();
});

test('undo is one call with every selected touch', async () => {
  const v = await render();
  act(() => { v.q('to-post-check-t1').click(); });
  act(() => { v.q('to-post-check-t2').click(); });
  await act(async () => {
    v.q('to-post-undo').click();
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
  expect(mailRuns.undoTouches).toHaveBeenCalledTimes(1);
  expect(mailRuns.undoTouches.mock.calls[0][0].sort()).toEqual(['t1', 't2']);
  v.unmount();
});

test('nothing is sent when nothing is ticked', async () => {
  const v = await render();
  expect(v.q('to-post-bar')).toBeNull();
  expect(mailRuns.verifyTouches).not.toHaveBeenCalled();
  v.unmount();
});

test('print stickers asks for exactly the ticked envelopes', async () => {
  const v = await render();
  act(() => { v.q('to-post-check-t1').click(); });
  await act(async () => {
    v.q('to-post-print-stickers').click();
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
  expect(mailRuns.queueStickers).toHaveBeenCalledTimes(1);
  expect(mailRuns.queueStickers.mock.calls[0][0].touch_ids).toBe('t1');
  v.unmount();
});

test('the header checkbox ticks every visible row', async () => {
  const v = await render();
  act(() => { v.q('to-post-check-all').click(); });
  expect(v.q('to-post-bar').textContent).toContain('3 selected');
  v.unmount();
});

test('a status chip refetches with that status', async () => {
  const v = await render();
  await act(async () => {
    v.q('to-post-chip-needs_address').click();
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
  const last = mailRuns.toPost.mock.calls[mailRuns.toPost.mock.calls.length - 1][0];
  expect(last.status).toBe('needs_address');
  v.unmount();
});

test('search and sequence filters are sent to the server', async () => {
  jest.useFakeTimers();
  const v = await render();
  await act(async () => {
    setInputValue(v.q('to-post-search'), 'sharma');
    jest.advanceTimersByTime(400);
    for (let i = 0; i < 40; i++) await Promise.resolve();
  });
  expect(mailRuns.toPost.mock.calls[mailRuns.toPost.mock.calls.length - 1][0].q).toBe('sharma');
  await act(async () => {
    setInputValue(v.q('to-post-filter-sequence'), 'seq1');
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
  expect(mailRuns.toPost.mock.calls[mailRuns.toPost.mock.calls.length - 1][0].sequence_id).toBe('seq1');
  v.unmount();
  jest.useRealTimers();
});

test('the owner and date filters are sent too', async () => {
  const v = await render();
  await act(async () => {
    setInputValue(v.q('to-post-filter-owner'), 'bde@smartshape.in');
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
  expect(mailRuns.toPost.mock.calls.slice(-1)[0][0].owner).toBe('bde@smartshape.in');
  await act(async () => {
    setInputValue(v.q('to-post-from'), '2026-09-01');
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
  expect(mailRuns.toPost.mock.calls.slice(-1)[0][0].from).toBe('2026-09-01');
  v.unmount();
});

test('an empty queue says so instead of showing a bare table', async () => {
  mailRuns.toPost.mockImplementation(() => Promise.resolve({
    data: { rows: [], totals: { shown: 0 }, as_of: '2026-09-22' } }));
  const v = await render();
  expect(v.rowIds()).toEqual([]);
  expect(v.q('to-post-empty')).not.toBeNull();
  v.unmount();
});

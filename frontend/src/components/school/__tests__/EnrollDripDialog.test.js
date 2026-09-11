// The school profile's "Enroll in Drip" dialog lists the school's leads AND its
// contacts (contact drip, D5) and sends whichever id was picked — a contact is
// enrolled directly, no lead is made for it.
//
// Rendered into jsdom via react-dom/client (no @testing-library/react here).
// The radix Dialog is swapped for plain elements: the portal isn't the point.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import EnrollDripDialog from '../EnrollDripDialog';
import { dripSequences } from '../../../lib/api';

global.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('../../ui/dialog', () => {
  const Pass = ({ children }) => <div>{children}</div>;
  return {
    Dialog: ({ open, children }) => (open ? <div data-testid="dialog">{children}</div> : null),
    DialogContent: Pass, DialogHeader: Pass, DialogFooter: Pass,
    DialogTitle: ({ children }) => <h2 data-testid="dialog-title">{children}</h2>,
  };
});
jest.mock('../../../lib/api', () => ({
  dripSequences: { getAll: jest.fn(), enroll: jest.fn() },
}));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

const LEADS = [
  { lead_id: 'L1', contact_name: 'Anil Kapoor', stage: 'demo' },
  { lead_id: 'L_del', contact_name: 'Deleted Lead', stage: 'new', is_deleted: true },
];
const CONTACTS = [
  { contact_id: 'c1', name: 'Ritu Sharma', designation: 'Principal' },
  { contact_id: 'c2', name: 'K Verma', designation: '' },
  { contact_id: 'c_del', name: 'Gone Person', designation: 'Teacher', is_deleted: true },
];

beforeEach(() => {
  dripSequences.getAll.mockImplementation(() => Promise.resolve({ data: [
    { sequence_id: 'seq1', name: 'GSLC follow-up', is_active: true, steps: [{}, {}] },
    { sequence_id: 'seq_off', name: 'Off', is_active: false, steps: [{}] },
  ] }));
  dripSequences.enroll.mockImplementation(() => Promise.resolve({ data: {} }));
});
afterEach(() => { document.body.innerHTML = ''; });

const flush = () => act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); });

function setSelect(el, value) {
  Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set.call(el, value);
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

async function mount(props = {}) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const all = { open: true, onOpenChange: jest.fn(), leads: LEADS, contacts: CONTACTS, onDone: jest.fn(), ...props };
  act(() => { root.render(<EnrollDripDialog {...all} />); });
  await flush();
  return {
    props: all,
    q: (id) => container.querySelector(`[data-testid="${id}"]`),
    unmount: () => act(() => root.unmount()),
  };
}

test('it is titled "Enroll in Drip", not "Enroll Lead in Drip"', async () => {
  const v = await mount();
  expect(v.q('dialog-title').textContent).toBe('Enroll in Drip');
  v.unmount();
});

test('it lists leads and contacts together, labelled by kind, without deleted ones', async () => {
  const v = await mount();
  const groups = Array.from(v.q('enroll-lead').querySelectorAll('optgroup')).map(g => g.getAttribute('label'));
  expect(groups).toEqual(['Leads', 'Contacts']);
  const opts = Array.from(v.q('enroll-lead').querySelectorAll('option')).filter(o => o.value);
  expect(opts.map(o => [o.value, o.textContent])).toEqual([
    ['lead:L1', 'Anil Kapoor — Lead · demo'],
    ['contact:c1', 'Ritu Sharma — Contact · Principal'],
    ['contact:c2', 'K Verma — Contact · no designation'],
  ]);
  v.unmount();
});

test('picking a contact enrols it with contact_id', async () => {
  const v = await mount();
  act(() => { setSelect(v.q('enroll-lead'), 'contact:c1'); });
  act(() => { setSelect(v.q('enroll-seq'), 'seq1'); });
  await act(async () => { v.q('enroll-submit').click(); await Promise.resolve(); await Promise.resolve(); });
  expect(dripSequences.enroll).toHaveBeenCalledWith({ contact_id: 'c1', sequence_id: 'seq1' });
  expect(v.props.onDone).toHaveBeenCalled();
  v.unmount();
});

test('picking a lead still enrols it with lead_id', async () => {
  const v = await mount();
  act(() => { setSelect(v.q('enroll-lead'), 'lead:L1'); });
  act(() => { setSelect(v.q('enroll-seq'), 'seq1'); });
  await act(async () => { v.q('enroll-submit').click(); await Promise.resolve(); await Promise.resolve(); });
  expect(dripSequences.enroll).toHaveBeenCalledWith({ lead_id: 'L1', sequence_id: 'seq1' });
  v.unmount();
});

test('a school with only contacts can still enrol someone', async () => {
  const v = await mount({ leads: [] });
  const groups = Array.from(v.q('enroll-lead').querySelectorAll('optgroup')).map(g => g.getAttribute('label'));
  expect(groups).toEqual(['Contacts']);
  v.unmount();
});

test('the server refusal (e.g. already running it) is shown and the dialog stays open', async () => {
  const { toast } = jest.requireMock('sonner');
  dripSequences.enroll.mockImplementation(() => Promise.reject({ response: { data: {
    detail: "This contact's lead is already running this sequence — the same person would get every message twice." } } }));
  const v = await mount();
  act(() => { setSelect(v.q('enroll-lead'), 'contact:c1'); });
  act(() => { setSelect(v.q('enroll-seq'), 'seq1'); });
  await act(async () => { v.q('enroll-submit').click(); await Promise.resolve(); await Promise.resolve(); });
  expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('same person'));
  expect(v.props.onOpenChange).not.toHaveBeenCalledWith(false);
  v.unmount();
});

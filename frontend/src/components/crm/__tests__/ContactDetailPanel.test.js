// The contact panel's Drip section (contact drip, D5): lists the sequences the
// contact is enrolled in directly, with Cancel — and, like the lead panel, no
// Resume for an enrolment stopped with a cancel_reason.
//
// Rendered into jsdom via react-dom/client (no @testing-library/react here).
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import ContactDetailPanel, { ContactDripSection } from '../ContactDetailPanel';
import { dripSequences } from '../../../lib/api';

global.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('../../../lib/api', () => ({
  dealTypes: { getAll: jest.fn() },
  dripSequences: {
    getAll: jest.fn(), enrollments: jest.fn(),
    cancelEnrollment: jest.fn(), resumeEnrollment: jest.fn(),
  },
}));
jest.mock('../../../lib/callBus', () => ({ startCall: jest.fn() }));
jest.mock('../ShareBrochureDialog', () => () => null);
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

const ROWS = [
  { enrollment_id: 'e_active', sequence_id: 'seq1', contact_id: 'c1', status: 'active', current_step: 1 },
  { enrollment_id: 'e_paused', sequence_id: 'seq1', contact_id: 'c1', status: 'paused', current_step: 0,
    paused_reason: 'no WhatsApp provider' },
  { enrollment_id: 'e_bulk', sequence_id: 'seq2', contact_id: 'c1', status: 'cancelled', current_step: 0,
    cancel_reason: 'Cancelled in bulk so no stale message goes out' },
  { enrollment_id: 'e_gone', sequence_id: 'seq2', contact_id: 'c1', status: 'cancelled', current_step: 0,
    cancel_reason: 'The contact was deleted, so the sequence was stopped.' },
];

beforeEach(() => {
  const { dealTypes } = jest.requireMock('../../../lib/api');
  dealTypes.getAll.mockImplementation(() => Promise.resolve({ data: [] }));
  dripSequences.getAll.mockImplementation(() => Promise.resolve({ data: [
    { sequence_id: 'seq1', name: 'GSLC follow-up', steps: [{}, {}, {}] },
    { sequence_id: 'seq2', name: 'Old nurture', steps: [{}] },
  ] }));
  dripSequences.enrollments.mockImplementation(() => Promise.resolve({ data: ROWS }));
  dripSequences.cancelEnrollment.mockImplementation(() => Promise.resolve({ data: { ok: true } }));
  dripSequences.resumeEnrollment.mockImplementation(() => Promise.resolve({ data: {} }));
});
afterEach(() => { document.body.innerHTML = ''; });

const flush = () => act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); });

async function mount(ui) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => { root.render(ui); });
  await flush();
  return {
    container,
    q: (id) => container.querySelector(`[data-testid="${id}"]`),
    unmount: () => act(() => root.unmount()),
  };
}

test('it loads the contact\'s own enrolments by contact_id and lists sequence, step and status', async () => {
  const v = await mount(<ContactDripSection contactId="c1" />);
  expect(dripSequences.enrollments).toHaveBeenCalledWith({ contact_id: 'c1' });
  const row = v.q('contact-drip-e_active');
  expect(row.textContent).toContain('GSLC follow-up');
  expect(row.textContent).toContain('Step 2 of 3');
  expect(row.textContent).toContain('active');
  expect(v.q('contact-drips').textContent).toContain('Drip sequences (4)');
  expect(v.q('contact-drip-e_paused').textContent).toContain('no WhatsApp provider');
  v.unmount();
});

test('Cancel stops an active enrolment and the row shows it at once', async () => {
  const v = await mount(<ContactDripSection contactId="c1" />);
  await act(async () => { v.q('cancel-contact-drip-e_active').click(); await Promise.resolve(); });
  expect(dripSequences.cancelEnrollment).toHaveBeenCalledWith('e_active');
  expect(v.q('contact-drip-e_active').textContent).toContain('cancelled');
  expect(v.q('cancel-contact-drip-e_active')).toBeNull();
  v.unmount();
});

test('a paused enrolment offers Resume', async () => {
  const v = await mount(<ContactDripSection contactId="c1" />);
  await act(async () => { v.q('resume-contact-drip-e_paused').click(); await Promise.resolve(); });
  expect(dripSequences.resumeEnrollment).toHaveBeenCalledWith('e_paused');
  v.unmount();
});

test('an enrolment stopped with a cancel_reason offers no Resume, only re-enrol', async () => {
  const v = await mount(<ContactDripSection contactId="c1" />);
  expect(v.q('resume-contact-drip-e_bulk')).toBeNull();
  expect(v.q('resume-contact-drip-e_gone')).toBeNull();
  expect(v.q('contact-drip-e_bulk').textContent).toContain('Cancelled in bulk — re-enrol to continue');
  expect(v.q('contact-drip-e_gone').textContent).toContain('Stopped — re-enrol to continue');
  v.unmount();
});

test('no enrolments reads as such', async () => {
  dripSequences.enrollments.mockImplementation(() => Promise.resolve({ data: [] }));
  const v = await mount(<ContactDripSection contactId="c9" />);
  expect(v.q('contact-drips').textContent).toContain('Not enrolled in any sequence');
  v.unmount();
});

test('the panel shows the Drip section on its Overview tab', async () => {
  const contact = { contact_id: 'c1', name: 'Ritu Sharma', company: 'DPS', phone: '98' };
  const v = await mount(
    <ContactDetailPanel detailContact={contact} setDetailContact={jest.fn()}
      logContactCall={jest.fn()} addContactFollowup={jest.fn()} completeContactFollowup={jest.fn()} />);
  const overview = Array.from(v.container.querySelectorAll('button')).find(b => b.textContent === 'Overview');
  act(() => { overview.click(); });
  await flush();
  expect(v.q('contact-drips')).toBeTruthy();
  expect(v.q('contact-drip-e_active')).toBeTruthy();
  v.unmount();
});

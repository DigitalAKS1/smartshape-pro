// A2 — editing a sequence must not wipe its post steps' material.
//
// The loss was silent and one-way: mapSeq() dropped material_type/material_name,
// startEdit() then re-read them as "brochure"/"" and save() posted that back. So
// the round trip is asserted through the REAL component, not a copy of its logic:
//
//   API document -> mapSeq -> DripsTab list -> Edit -> Save -> PUT payload
//
// Rendered into jsdom via react-dom/client (no @testing-library/react here).
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

import { mapSeq } from '../../../lib/marketingUtils';
import DripsTab from '../DripsTab';
import { dripSequences as dripApi, whatsApp as waApi, mailRuns } from '../../../lib/api';

global.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('react-router-dom', () => ({ useNavigate: () => jest.fn() }), { virtual: true });
jest.mock('../../../lib/api', () => ({
  dripSequences: {
    update: jest.fn(), create: jest.fn(), delete: jest.fn(), deliveries: jest.fn(),
  },
  whatsApp: { listAttachments: jest.fn() },
  mailRuns: { getAll: jest.fn() },
}));
jest.mock('sonner', () => ({
  toast: Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn() }),
}));
// react-quill-new does not run in jsdom, and the editor is hidden for post steps.
jest.mock('../../RichMessageEditor', () => ({ __esModule: true, default: () => null }));

const tk = { t1: '', t2: '', tm: '', card: '', bdr: '', inp: '', hov: '' };

const API_SEQ = {
  sequence_id: 'seq1',
  name: 'Principal Pitch',
  description: 'Catalogue drop',
  trigger: 'manual',
  is_active: true,
  filter_designation: null,
  steps: [
    {
      step_number: 1,
      delay_days: 0,
      message_type: 'physical_material',
      material_type: 'catalogue',
      material_name: '2026 Die Catalogue + Sample Kit',
      message_template: '',
      message_plain: '',
    },
    {
      step_number: 2,
      delay_days: 3,
      message_type: 'whatsapp',
      message_template: '<p>Hi {name}</p>',
      message_plain: 'Hi {name}',
      material_type: '',
      material_name: '',
    },
  ],
};

let container;
let root;

// CRA's Jest config sets `resetMocks: true`, which wipes implementations set at
// jest.mock() factory time — so they are installed freshly before every test.
beforeEach(() => {
  mailRuns.getAll.mockResolvedValue({ data: [] });
  waApi.listAttachments.mockResolvedValue({ data: [] });
  dripApi.deliveries.mockResolvedValue({ data: { rows: [], totals: {} } });
  dripApi.update.mockResolvedValue({ data: API_SEQ });
  dripApi.create.mockResolvedValue({ data: API_SEQ });
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => { if (root) root.unmount(); });
  container.remove();
  root = null;
});

async function render(drips, setDrips = jest.fn()) {
  await act(async () => {
    root = createRoot(container);
    root.render(<DripsTab tk={tk} drips={drips} setDrips={setDrips} />);
  });
}

const byTitle = (title) => document.querySelector(`[title="${title}"]`);
const byText = (sel, text) => Array.from(document.querySelectorAll(sel))
  .find((n) => (n.textContent || '').trim() === text);

function click(node) {
  act(() => { node.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
}

test('mapSeq carries material_type, material_name and attachment_id through unchanged', () => {
  const mapped = mapSeq({
    ...API_SEQ,
    steps: [{ ...API_SEQ.steps[0], attachment_id: 'att_1' }],
  });
  expect(mapped.steps[0].material_type).toBe('catalogue');
  expect(mapped.steps[0].material_name).toBe('2026 Die Catalogue + Sample Kit');
  expect(mapped.steps[0].attachment_id).toBe('att_1');
});

test('opening Edit and saving sends the post step back with its material intact', async () => {
  await render([mapSeq(API_SEQ)]);

  click(byTitle('Edit sequence'));

  // What startEdit read out of the mapped row is what the dialog now shows.
  const materialSelect = document.querySelector('[data-testid="step-material-0"]');
  const materialName = document.querySelector('[data-testid="step-material-name-0"]');
  expect(materialSelect).toBeTruthy();
  expect(materialSelect.value).toBe('catalogue');
  expect(materialName.value).toBe('2026 Die Catalogue + Sample Kit');

  await act(async () => {
    byText('button', 'Save Changes').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });

  expect(dripApi.update).toHaveBeenCalledTimes(1);
  const [sequenceId, payload] = dripApi.update.mock.calls[0];
  expect(sequenceId).toBe('seq1');
  expect(payload.steps[0].material_type).toBe('catalogue');
  expect(payload.steps[0].material_name).toBe('2026 Die Catalogue + Sample Kit');
  // The non-post step is untouched by all this.
  expect(payload.steps[1].message_type).toBe('whatsapp');
  expect(payload.steps[1].material_type).toBeUndefined();
});

test('the saved sequence goes back into the list still carrying its material', async () => {
  const setDrips = jest.fn();
  await render([mapSeq(API_SEQ)], setDrips);

  click(byTitle('Edit sequence'));
  await act(async () => {
    byText('button', 'Save Changes').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });

  // setDrips is called with an updater; run it over the current list to see what
  // the next Edit would read — the second round trip is where the loss compounded.
  const updater = setDrips.mock.calls[0][0];
  const next = updater([mapSeq(API_SEQ)]);
  expect(next[0].steps[0].material_type).toBe('catalogue');
  expect(next[0].steps[0].material_name).toBe('2026 Die Catalogue + Sample Kit');
});

test('a second save is not sent while the first is still in flight (A1 guard)', async () => {
  let release;
  dripApi.update.mockImplementation(
    () => new Promise((res) => { release = () => res({ data: API_SEQ }); }));

  await render([mapSeq(API_SEQ)]);
  click(byTitle('Edit sequence'));

  // Both clicks land in the same tick, before React re-renders with saving=true —
  // which is exactly how the duplicate sequences were created.
  const save = byText('button', 'Save Changes');
  act(() => {
    save.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    save.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });

  expect(dripApi.update).toHaveBeenCalledTimes(1);
  await act(async () => { release(); });
});

test('Enter in the name box goes through the same guarded save', async () => {
  let release;
  dripApi.update.mockImplementation(
    () => new Promise((res) => { release = () => res({ data: API_SEQ }); }));

  await render([mapSeq(API_SEQ)]);
  click(byTitle('Edit sequence'));

  const name = document.querySelector('[data-testid="seq-name"]');
  act(() => {
    name.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    name.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });

  expect(dripApi.update).toHaveBeenCalledTimes(1);
  await act(async () => { release(); });
});

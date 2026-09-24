// C2/D3: "Post something" in the enrol dialog picks from the shared Materials
// catalogue, the same list the drip step editor and the mail-run builder read.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

import SequenceEnrollDialog from '../SequenceEnrollDialog';
import { dripSequences, mailMaterials } from '../../../lib/api';

global.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('../../../lib/api', () => ({
  dripSequences: { getAll: jest.fn(), create: jest.fn(), enroll: jest.fn() },
  mailMaterials: { list: jest.fn(), create: jest.fn(), update: jest.fn(), remove: jest.fn() },
}));
jest.mock('sonner', () => ({
  toast: Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn() }),
}));

const MATERIALS = [
  { material_id: 'mm1', name: 'Brochure', piece_type: 'brochure', active: true },
  { material_id: 'mm3', name: 'Catalogue', piece_type: 'catalogue', active: true },
  { material_id: 'mm4', name: 'Kit', piece_type: 'kit', active: true },
];

let container;
let root;

beforeEach(() => {
  dripSequences.getAll.mockResolvedValue({ data: [] });
  mailMaterials.list.mockResolvedValue({ data: MATERIALS });
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => { if (root) root.unmount(); });
  container.remove();
  root = null;
});

const q = (id) => document.querySelector(`[data-testid="${id}"]`);

async function render() {
  await act(async () => {
    root = createRoot(container);
    root.render(<SequenceEnrollDialog open onClose={jest.fn()} schoolIds={['s1']} onDone={jest.fn()} />);
    for (let i = 0; i < 6; i++) await Promise.resolve();
  });
}

async function buildAPostStep() {
  // Switch to the "build a new plan" mode, then make step 1 a post step.
  await act(async () => {
    q('seq-mode-new').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
  await act(async () => {
    const ch = q('seq-step-channel-0');
    ch.value = 'physical_material';
    ch.dispatchEvent(new Event('change', { bubbles: true }));
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
}

test('the post-step material picker reads the shared catalogue', async () => {
  await render();
  await buildAPostStep();
  const sel = q('seq-step-material-0');
  expect(sel).not.toBeNull();
  const opts = Array.from(sel.querySelectorAll('option')).map(o => o.value);
  expect(opts).toEqual(['brochure', 'catalogue', 'kit']);
  expect(mailMaterials.list).toHaveBeenCalled();
});

test('the item name stays free text beside it', async () => {
  await render();
  await buildAPostStep();
  expect(q('seq-step-material-name-0')).not.toBeNull();
});

test('a post step says where the mailer will appear', async () => {
  await render();
  await buildAPostStep();
  const note = q('seq-step-mailer-note-0');
  expect(note.textContent).toContain('Offline Mail');
  expect(note.textContent).toContain('To post');
});

// C2/D3: the drip step editor's material picker reads the shared catalogue,
// keeps a legacy free-text value working, and says where the mailer will land.
//
// Before this, the step editor offered brochure|sample|catalogue|kit|gift and
// the mail-run builder offered brochure|sample|newsletter|other — two lists
// that disagreed, so a newsletter could not be dripped and a kit could not be
// posted by hand. Both now read `mail_materials`.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

import { mapSeq } from '../../../lib/marketingUtils';
import DripsTab from '../DripsTab';
import {
  dripSequences as dripApi, whatsApp as waApi, mailRuns, mailMaterials,
} from '../../../lib/api';

global.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('react-router-dom', () => ({ useNavigate: () => jest.fn() }), { virtual: true });
jest.mock('../../../lib/api', () => ({
  dripSequences: { update: jest.fn(), create: jest.fn(), delete: jest.fn(), deliveries: jest.fn() },
  whatsApp: { listAttachments: jest.fn() },
  mailRuns: { getAll: jest.fn() },
  mailMaterials: { list: jest.fn(), create: jest.fn(), update: jest.fn(), remove: jest.fn() },
}));
jest.mock('sonner', () => ({
  toast: Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn() }),
}));
jest.mock('../../RichMessageEditor', () => ({ __esModule: true, default: () => null }));

const tk = { t1: '', t2: '', tm: '', card: '', bdr: '', inp: '', hov: '' };

// `newsletter` is the proof the two lists were merged: it existed only on the
// mail-run side and could never be chosen for a drip step.
const MATERIALS = [
  { material_id: 'mm1', name: 'Brochure', piece_type: 'brochure', active: true },
  { material_id: 'mm2', name: 'Newsletter', piece_type: 'newsletter', active: true },
  { material_id: 'mm3', name: 'Catalogue', piece_type: 'catalogue', active: true },
];

const POST_SEQ = {
  sequence_id: 'seq1', name: 'Principal Pitch', description: '', trigger: 'manual',
  is_active: true, filter_designation: null,
  steps: [{
    step_number: 1, delay_days: 4, message_type: 'physical_material',
    material_type: 'catalogue', material_name: '2026 Die Catalogue',
    message_template: '', message_plain: '',
  }],
};

const LEGACY_SEQ = {
  ...POST_SEQ, sequence_id: 'seqL', name: 'Legacy',
  steps: [{ ...POST_SEQ.steps[0], material_type: 'poster', material_name: 'Old poster' }],
};

let container;
let root;

beforeEach(() => {
  mailRuns.getAll.mockResolvedValue({ data: [] });
  waApi.listAttachments.mockResolvedValue({ data: [] });
  dripApi.deliveries.mockResolvedValue({ data: { rows: [], totals: {} } });
  dripApi.update.mockResolvedValue({ data: POST_SEQ });
  dripApi.create.mockResolvedValue({ data: POST_SEQ });
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
const byTitle = (title) => document.querySelector(`[title="${title}"]`);
const byText = (sel, text) => Array.from(document.querySelectorAll(sel))
  .find((n) => (n.textContent || '').trim() === text);

async function render(drips, setDrips = jest.fn()) {
  await act(async () => {
    root = createRoot(container);
    root.render(<DripsTab tk={tk} drips={drips} setDrips={setDrips} />);
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
}

async function openEdit(title = 'Edit sequence') {
  await act(async () => {
    byTitle(title).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
}

test('the material dropdown lists the shared catalogue, newsletter included', async () => {
  await render([mapSeq(POST_SEQ)]);
  await openEdit();
  const opts = Array.from(q('step-material-0').querySelectorAll('option')).map(o => o.value);
  expect(opts).toEqual(expect.arrayContaining(['brochure', 'newsletter', 'catalogue']));
  expect(opts).toContain('__other__');
});

test('a legacy value not in the catalogue stays selected and is flagged', async () => {
  await render([mapSeq(LEGACY_SEQ)]);
  await openEdit();
  expect(q('step-material-0').value).toBe('poster');
  expect(q('step-material-legacy-0')).not.toBeNull();
});

test('a legacy value survives the round trip instead of being rewritten', async () => {
  await render([mapSeq(LEGACY_SEQ)]);
  await openEdit();
  await act(async () => {
    byText('button', 'Save Changes').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
  const [, payload] = dripApi.update.mock.calls[0];
  expect(payload.steps[0].material_type).toBe('poster');
});

test('a catalogue material in the list is not flagged', async () => {
  await render([mapSeq(POST_SEQ)]);
  await openEdit();
  expect(q('step-material-0').value).toBe('catalogue');
  expect(q('step-material-legacy-0')).toBeNull();
});

test('picking Other clears the value so a free-text piece type can be typed', async () => {
  await render([mapSeq(POST_SEQ)]);
  await openEdit();
  await act(async () => {
    const sel = q('step-material-0');
    sel.value = '__other__';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
  expect(q('step-material-other-0')).not.toBeNull();
});

test('a post step says where the mailer will appear, and on which day', async () => {
  await render([mapSeq(POST_SEQ)]);
  await openEdit();
  const note = q('step-mailer-note-0');
  expect(note.textContent).toContain('Offline Mail');
  expect(note.textContent).toContain('To post');
  expect(note.textContent).toContain('day 4');
});

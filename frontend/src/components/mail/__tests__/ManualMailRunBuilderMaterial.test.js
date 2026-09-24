// C2/D3: the hand-picked mail run's piece type comes from the shared Materials
// catalogue. It used to be a hard-coded brochure|sample|newsletter|other list
// that disagreed with the drip step editor's, so a kit could not be posted by
// hand at all.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

import ManualMailRunBuilder from '../ManualMailRunBuilder';
import { schools as schoolsApi, mailRuns, mailMaterials } from '../../../lib/api';

global.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('../../../lib/api', () => ({
  schools: { getAll: jest.fn() },
  mailRuns: { create: jest.fn() },
  mailMaterials: { list: jest.fn(), create: jest.fn(), update: jest.fn(), remove: jest.fn() },
}));
jest.mock('sonner', () => ({
  toast: Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn() }),
}));

// Deliberately NOT led by "Brochure": the default must follow the catalogue,
// not a hard-coded guess about what the first material is called.
const MATERIALS = [
  { material_id: 'mm3', name: 'Catalogue', piece_type: 'catalogue', active: true },
  { material_id: 'mm4', name: 'Kit', piece_type: 'kit', active: true },
];

let container;
let root;

beforeEach(() => {
  schoolsApi.getAll.mockResolvedValue({
    data: [{ school_id: 's1', school_name: 'DPS', city: 'Indore' }] });
  mailRuns.create.mockResolvedValue({ data: { run_id: 'run1' } });
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
    root.render(<ManualMailRunBuilder onClose={jest.fn()} onCreated={jest.fn()} />);
    for (let i = 0; i < 6; i++) await Promise.resolve();
  });
}

test('the piece picker lists the catalogue, kit included', async () => {
  await render();
  const opts = Array.from(q('manual-run-piece').querySelectorAll('option')).map(o => o.value);
  expect(opts).toEqual(['catalogue', 'kit']);
});

test('it starts on the first ACTIVE material, not a hard-coded brochure', async () => {
  await render();
  expect(q('manual-run-piece').value).toBe('catalogue');
});

test('the catalogue read failing still leaves a usable picker', async () => {
  mailMaterials.list.mockRejectedValue(new Error('offline'));
  await render();
  const opts = Array.from(q('manual-run-piece').querySelectorAll('option')).map(o => o.value);
  expect(opts).toContain('brochure');
  expect(q('manual-run-piece').value).toBe('brochure');
});

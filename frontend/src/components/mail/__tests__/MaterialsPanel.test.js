// C2/D3: the one place the shared Materials list is edited, under
// Offline Mail -> Materials. Retiring never deletes: a drip step that names a
// material must keep firing and its history must keep reading back, so the
// panel asks for the retired rows too and can bring one back.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

import MaterialsPanel from '../MaterialsPanel';
import { mailMaterials } from '../../../lib/api';

global.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('../../../lib/api', () => ({
  mailMaterials: { list: jest.fn(), create: jest.fn(), update: jest.fn(), remove: jest.fn() },
}));
jest.mock('sonner', () => ({
  toast: Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn() }),
}));

const ROWS = [
  { material_id: 'mm1', name: 'Brochure', piece_type: 'brochure', active: true },
  { material_id: 'mm2', name: 'Retired thing', piece_type: 'other', active: false },
];

let container;
let root;

// CRA's Jest config sets `resetMocks: true`, so implementations go in beforeEach.
beforeEach(() => {
  mailMaterials.list.mockResolvedValue({ data: ROWS });
  mailMaterials.create.mockResolvedValue({
    data: { material_id: 'mm3', name: 'Kit', piece_type: 'kit', active: true } });
  mailMaterials.update.mockResolvedValue({ data: {} });
  mailMaterials.remove.mockResolvedValue({ data: {} });
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => { if (root) root.unmount(); });
  container.remove();
  root = null;
});

const q = (id) => container.querySelector(`[data-testid="${id}"]`);

async function render() {
  await act(async () => {
    root = createRoot(container);
    root.render(<MaterialsPanel />);
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
}

async function click(node) {
  await act(async () => {
    node.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
}

function type(node, value) {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, 'value').set;
    setter.call(node, value);
    node.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

test('it asks for the retired materials too and marks them', async () => {
  await render();
  expect(mailMaterials.list).toHaveBeenCalledWith({ all: 1 });
  expect(q('material-row-mm1')).not.toBeNull();
  expect(q('material-row-mm2').textContent).toContain('retired');
});

test('adding a material posts its name and piece type', async () => {
  await render();
  type(q('material-new-name'), 'Kit');
  type(q('material-new-piece'), 'kit');
  await click(q('material-add'));
  expect(mailMaterials.create).toHaveBeenCalledWith({ name: 'Kit', piece_type: 'kit' });
});

test('a blank name is refused without calling the API', async () => {
  await render();
  type(q('material-new-name'), '   ');
  await click(q('material-add'));
  expect(mailMaterials.create).not.toHaveBeenCalled();
});

test('renaming a material sends only the new name', async () => {
  await render();
  await click(q('material-rename-mm1'));
  type(q('material-name-mm1'), 'School Brochure 2026');
  await click(q('material-save-mm1'));
  expect(mailMaterials.update).toHaveBeenCalledWith('mm1', { name: 'School Brochure 2026' });
});

test('retiring asks first and calls the soft delete, never a hard one', async () => {
  window.confirm = jest.fn(() => true);
  await render();
  await click(q('material-deactivate-mm1'));
  expect(window.confirm).toHaveBeenCalled();
  expect(mailMaterials.remove).toHaveBeenCalledWith('mm1');
});

test('declining the confirm retires nothing', async () => {
  window.confirm = jest.fn(() => false);
  await render();
  await click(q('material-deactivate-mm1'));
  expect(mailMaterials.remove).not.toHaveBeenCalled();
});

test('a retired material can be brought back', async () => {
  await render();
  await click(q('material-restore-mm2'));
  expect(mailMaterials.update).toHaveBeenCalledWith('mm2', { active: true });
});

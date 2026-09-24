// C2/D3: the one shared Materials catalogue, read by every authoring surface.
//
// The hook is the single place the catalogue is fetched, so it is also the
// single place where a slow or failed read could silently empty a picker and
// make a post step unauthorable. It must fall back to the seeded union instead.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

import useMailMaterials from '../useMailMaterials';
import { mailMaterials } from '../../lib/api';

global.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('../../lib/api', () => ({
  mailMaterials: { list: jest.fn(), create: jest.fn(), update: jest.fn(), remove: jest.fn() },
}));

let container;
let root;
let seen;

function Probe() {
  seen = useMailMaterials();
  return null;
}

beforeEach(() => {
  seen = null;
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => { if (root) root.unmount(); });
  container.remove();
  root = null;
});

async function mount() {
  await act(async () => {
    root = createRoot(container);
    root.render(<Probe />);
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
}

test('it reads the catalogue and keeps only the active materials', async () => {
  mailMaterials.list.mockResolvedValue({
    data: [
      { material_id: 'mm1', name: 'Brochure', piece_type: 'brochure', active: true },
      { material_id: 'mm2', name: 'Retired thing', piece_type: 'poster', active: false },
    ],
  });
  await mount();
  expect(seen.materials.map(m => m.piece_type)).toEqual(['brochure']);
  expect(seen.loading).toBe(false);
});

test('a failed read falls back to the seeded union, never an empty picker', async () => {
  mailMaterials.list.mockRejectedValue(new Error('offline'));
  await mount();
  expect(seen.materials.map(m => m.piece_type)).toEqual(
    ['brochure', 'sample', 'catalogue', 'kit', 'newsletter', 'gift', 'other']);
});

test('an empty catalogue also falls back rather than offering nothing', async () => {
  mailMaterials.list.mockResolvedValue({ data: [] });
  await mount();
  expect(seen.materials.length).toBe(7);
});

test('reload re-reads the catalogue', async () => {
  mailMaterials.list.mockResolvedValue({
    data: [{ material_id: 'mm1', name: 'Brochure', piece_type: 'brochure', active: true }],
  });
  await mount();
  expect(mailMaterials.list).toHaveBeenCalledTimes(1);
  mailMaterials.list.mockResolvedValue({
    data: [{ material_id: 'mm9', name: 'Kit', piece_type: 'kit', active: true }],
  });
  await act(async () => {
    await seen.reload();
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
  expect(seen.materials.map(m => m.piece_type)).toEqual(['kit']);
});

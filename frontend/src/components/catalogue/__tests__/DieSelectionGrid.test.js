// frontend/src/components/catalogue/__tests__/DieSelectionGrid.test.js
// Extracted from CataloguePage.js so the School Portal picker (Task 8) can
// reuse the exact same selection/qty UI without the catalogue page's
// quotation-specific chrome (package limits, hero). react-dom/client + act().
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import DieSelectionGrid from '../DieSelectionGrid';

global.IS_REACT_ACT_ENVIRONMENT = true;

const DIES = [
  { die_id: 'd1', name: 'Star', code: 'D-1', type: 'standard', category: 'shapes', images: [] },
  { die_id: 'd2', name: 'Heart', code: 'D-2', type: 'large', category: 'shapes', images: [] },
];

let root, container, onToggle, onQtyChange;

async function mount(qtyByDie = {}) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  onToggle = jest.fn();
  onQtyChange = jest.fn();
  await act(async () => {
    root.render(
      <DieSelectionGrid dies={DIES} qtyByDie={qtyByDie} onToggle={onToggle} onQtyChange={onQtyChange} backendUrl="" />
    );
  });
}

const click = async (el) => { await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); };

afterEach(() => { act(() => root.unmount()); document.body.removeChild(container); });

test('renders one card per die', async () => {
  await mount();
  expect(container.querySelector('[data-testid="die-card-D-1"]')).toBeTruthy();
  expect(container.querySelector('[data-testid="die-card-D-2"]')).toBeTruthy();
});

test('clicking an unselected card toggles it on', async () => {
  await mount();
  await click(container.querySelector('[data-testid="die-card-D-1"]'));
  expect(onToggle).toHaveBeenCalledWith('d1');
});

test('a selected die shows the quantity stepper', async () => {
  await mount({ d1: 3 });
  expect(container.querySelector('[data-testid="die-qty-D-1"]')).toBeTruthy();
  expect(container.querySelector('[data-testid="die-qty-D-1"]').value).toBe('3');
});

test('an unselected die shows no quantity stepper', async () => {
  await mount({ d1: 3 });
  expect(container.querySelector('[data-testid="die-qty-D-2"]')).toBeFalsy();
});

test('the increase button calls onQtyChange with qty + 1', async () => {
  await mount({ d1: 3 });
  await click(container.querySelector('[aria-label="Increase quantity"]'));
  expect(onQtyChange).toHaveBeenCalledWith('d1', 4);
});

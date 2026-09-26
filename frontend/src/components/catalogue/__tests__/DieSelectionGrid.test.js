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

async function mount(qtyByDie = {}, extraProps = {}) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  onToggle = jest.fn();
  onQtyChange = jest.fn();
  await act(async () => {
    root.render(
      <DieSelectionGrid dies={DIES} qtyByDie={qtyByDie} onToggle={onToggle} onQtyChange={onQtyChange} backendUrl="" {...extraProps} />
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

// The default (dark=true) rendering must be byte-for-byte what CataloguePage
// already relies on — it is always on a dark page, so this must not change.
test('by default (no dark prop) it uses the original hard-coded dark styling', async () => {
  await mount();
  const heading = container.querySelector('h2');
  expect(heading.className).toContain('text-white');
  const card = container.querySelector('[data-testid="die-card-D-1"]');
  expect(card.className).toContain('bg-[#1a1a2e]');
});

// The School Portal mounts this inside a themed light/dark card (ThemeContext
// defaults to light) — dark=false must not render white-on-white text or
// hard-coded dark tiles inside that light card.
test('dark=false uses theme tokens instead of the hard-coded dark palette', async () => {
  await mount({}, { dark: false });
  const heading = container.querySelector('h2');
  expect(heading.className).not.toContain('text-white');
  expect(heading.className).toContain('var(--text-primary)');
  const card = container.querySelector('[data-testid="die-card-D-1"]');
  expect(card.className).not.toContain('bg-[#1a1a2e]');
  expect(card.className).toContain('var(--bg-card)');
});

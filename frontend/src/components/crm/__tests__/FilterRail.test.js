// Smoke tests for FilterRail rendered directly into jsdom via react-dom/client
// (no @testing-library/react in this repo's node_modules — see package.json).
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import FilterRail from '../FilterRail';
import { UNASSIGNED } from '../../../lib/crmFilter';

// React 19 wants this flag set explicitly outside of @testing-library/react.
global.IS_REACT_ACT_ENVIRONMENT = true;

function setInputValue(input, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function mount(ui) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => { root.render(ui); });
  return { container, unmount: () => act(() => root.unmount()) };
}

const options = {
  owners: [{ id: 'a@ss.in', name: 'Aman' }, { id: 'r@ss.in', name: 'Rohit' }],
  cities: ['Rohini', 'Dwarka'],
  school_types: ['CBSE'],
  sources: ['Referral'],
  stages: [{ id: 'demo', label: 'Demo' }],
  tags: [{ id: 't1', name: 'Hot', color: '#f00' }],
};

test('renders the sticky N-of-M honest count and the Owner facet', () => {
  const { container, unmount } = mount(
    <FilterRail options={options} value={{}} onChange={jest.fn()} resultCount={5} totalCount={20} countFor={() => 3} />
  );
  expect(container.querySelector('[data-testid="filter-rail-count"]').textContent).toBe('5 of 20');
  expect(container.querySelector('[data-testid="owner-row-a@ss.in"]').textContent).toContain('Aman');
  expect(container.querySelector('[data-testid="owner-row-r@ss.in"]').textContent).toContain('Rohit');
  expect(container.querySelector('[data-testid="owner-unassigned-checkbox"]')).toBeTruthy();
  unmount();
});

test('owner picker is searchable — typing narrows the rep list (O11)', () => {
  const { container, unmount } = mount(
    <FilterRail options={options} value={{}} onChange={jest.fn()} countFor={() => 1} />
  );
  const input = container.querySelector('[data-testid="owner-search-input"]');
  act(() => setInputValue(input, 'Rohit'));
  expect(container.querySelector('[data-testid="owner-row-r@ss.in"]')).toBeTruthy();
  expect(container.querySelector('[data-testid="owner-row-a@ss.in"]')).toBeFalsy();
  unmount();
});

test('checking Unassigned calls onChange with the UNASSIGNED sentinel', () => {
  const onChange = jest.fn();
  const { container, unmount } = mount(
    <FilterRail options={options} value={{}} onChange={onChange} countFor={() => 1} />
  );
  const cb = container.querySelector('[data-testid="owner-unassigned-checkbox"]');
  act(() => cb.click());
  expect(onChange).toHaveBeenCalledWith({ owners: [UNASSIGNED] });
  unmount();
});

test('a City facet option shows its live count and toggling adds it to the filter', () => {
  const onChange = jest.fn();
  const countFor = (facet, id) => (facet === 'cities' && id === 'Rohini' ? 7 : 0);
  const { container, unmount } = mount(
    <FilterRail options={options} value={{}} onChange={onChange} countFor={countFor} />
  );
  const rohiniRow = Array.from(container.querySelectorAll('label')).find((l) => l.textContent.includes('Rohini'));
  expect(rohiniRow.textContent).toContain('7');
  const checkbox = rohiniRow.querySelector('input[type="checkbox"]');
  act(() => checkbox.click());
  expect(onChange).toHaveBeenCalledWith({ cities: ['Rohini'] });
  unmount();
});

test('Clear all only appears once a filter is active, and resets it', () => {
  const onChange = jest.fn();
  const first = mount(<FilterRail options={options} value={{}} onChange={jest.fn()} countFor={() => 1} />);
  expect(first.container.querySelector('[data-testid="filter-rail-clear-all"]')).toBeFalsy();
  first.unmount();

  const { container, unmount } = mount(
    <FilterRail options={options} value={{ cities: ['Rohini'] }} onChange={onChange} countFor={() => 1} />
  );
  const clearBtn = container.querySelector('[data-testid="filter-rail-clear-all"]');
  expect(clearBtn).toBeTruthy();
  act(() => clearBtn.click());
  expect(onChange).toHaveBeenCalledWith({});
  unmount();
});

// ── Phase 3: Dates section (Import Date / Assigned Date range) ─────────────────

test('Dates section renders native date inputs and picking a from-date sets import_date_from', () => {
  const onChange = jest.fn();
  const { container, unmount } = mount(
    <FilterRail options={options} value={{}} onChange={onChange} countFor={() => 1} />
  );
  act(() => container.querySelector('[data-testid="facet-toggle-dates"]').click());
  const fromInput = container.querySelector('[data-testid="date-import-from"]');
  expect(fromInput.getAttribute('type')).toBe('date');
  act(() => setInputValue(fromInput, '2026-07-01'));
  expect(onChange).toHaveBeenCalledWith({ import_date_from: '2026-07-01' });
  unmount();
});

test('Assigned Date range writes assigned_date_from/to independently of import_date', () => {
  const onChange = jest.fn();
  const { container, unmount } = mount(
    <FilterRail options={options} value={{ import_date_from: '2026-07-01' }} onChange={onChange} countFor={() => 1} />
  );
  act(() => container.querySelector('[data-testid="facet-toggle-dates"]').click());
  const toInput = container.querySelector('[data-testid="date-assigned-to"]');
  act(() => setInputValue(toInput, '2026-07-31'));
  expect(onChange).toHaveBeenCalledWith({ import_date_from: '2026-07-01', assigned_date_to: '2026-07-31' });
  unmount();
});

test('an active date range shows a removable header chip and counts toward Clear all', () => {
  const onChange = jest.fn();
  const { container, unmount } = mount(
    <FilterRail options={options} value={{ import_date_from: '2026-07-01', import_date_to: '2026-07-10' }} onChange={onChange} countFor={() => 1} />
  );
  const chip = Array.from(container.querySelectorAll('span')).find((s) => s.textContent.includes('Import Date: 2026-07-01 → 2026-07-10'));
  expect(chip).toBeTruthy();
  expect(container.querySelector('[data-testid="filter-rail-clear-all"]')).toBeTruthy();
  const removeBtn = chip.querySelector('button');
  act(() => removeBtn.click());
  expect(onChange).toHaveBeenCalledWith({});
  unmount();
});

// Rendered directly into jsdom via react-dom/client (no @testing-library/react
// in this repo's node_modules — same pattern as FilterRail.test.js).
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import ActiveFilterBar from '../ActiveFilterBar';

global.IS_REACT_ACT_ENVIRONMENT = true;

function mount(ui) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => { root.render(ui); });
  return {
    container,
    q: (id) => container.querySelector(`[data-testid="${id}"]`),
    click: (id) => act(() => { container.querySelector(`[data-testid="${id}"]`).click(); }),
    unmount: () => act(() => root.unmount()),
  };
}

const options = {
  owners: [{ id: 'parul@ss.in', name: 'Parul Kanchan' }],
  cities: ['Rohini', 'New Delhi'],
  tags: [{ id: 't_hot', name: 'Hot Lead' }],
  stages: [{ id: 'demo', label: 'Demo' }],
  sources: [], school_types: [], roles: [], deal_types: [],
};

const spies = () => ({
  setMasterFilter: jest.fn(),
  setSearchTerm: jest.fn(),
  setFilterType: jest.fn(),
  setFilterTag: jest.fn(),
});

const setup = (props = {}, s = spies()) => ({
  s,
  ...mount(<ActiveFilterBar options={options} result={3} total={90} noun="lead" {...s} {...props} />),
});

test('stays out of the way when nothing is filtering', () => {
  const { q, unmount } = setup();
  expect(q('active-filter-bar')).toBeNull();
  unmount();
});

test('reports honestly how much of the data is showing', () => {
  const { q, unmount } = setup({ masterFilter: { cities: ['Rohini'] } });
  expect(q('active-filter-bar').textContent).toContain('Showing 3 of 90 leads');
  unmount();
});

test('a rail filter becomes a chip that removes just that one value', () => {
  const { s, click, unmount } = setup({ masterFilter: { cities: ['Rohini', 'New Delhi'] } });
  click('filter-chip-rail:cities:Rohini');
  const updater = s.setMasterFilter.mock.calls[0][0];
  expect(updater({ cities: ['Rohini', 'New Delhi'] })).toEqual({ cities: ['New Delhi'] });
  unmount();
});

test('owners and tags read as their names, never as raw ids', () => {
  const { q, unmount } = setup({ masterFilter: { owners: ['parul@ss.in'], tags: ['t_hot'] } });
  expect(q('active-filter-bar').textContent).toContain('Owner: Parul Kanchan');
  expect(q('active-filter-bar').textContent).toContain('Tag: Hot Lead');
  unmount();
});

test('an unassigned filter says Unassigned, not the sentinel', () => {
  const { q, unmount } = setup({ masterFilter: { owners: ['__unassigned__'] } });
  expect(q('active-filter-bar').textContent).toContain('Owner: Unassigned');
  unmount();
});

test('shows what was typed into the search box and can take it back out', () => {
  const { s, q, click, unmount } = setup({ searchTerm: 'owner:parul city:rohin hot' });
  expect(q('active-filter-bar').textContent).toContain('Owner: parul');
  click('filter-chip-q:owner:parul');
  expect(s.setSearchTerm.mock.calls[0][0]('owner:parul city:rohin hot')).toBe('city:rohin hot');
  unmount();
});

test('the two dropdowns finally admit they are on', () => {
  const { s, q, click, unmount } = setup({ filterType: 'hot', filterTag: 't_hot' });
  expect(q('active-filter-bar').textContent).toContain('Hot leads');
  click('filter-chip-dd:type');
  expect(s.setFilterType).toHaveBeenCalledWith('all');
  click('filter-chip-dd:tag');
  expect(s.setFilterTag).toHaveBeenCalledWith('');
  unmount();
});

test('free-text search shows as its own chip', () => {
  const { q, unmount } = setup({ searchTerm: 'ryan international' });
  expect(q('active-filter-bar').textContent).toContain('ryan international');
  unmount();
});

test('Clear all resets every control at once', () => {
  const { s, click, unmount } = setup({
    masterFilter: { cities: ['Rohini'] }, searchTerm: 'owner:parul', filterType: 'hot', filterTag: 't_hot',
  });
  click('clear-all-filters');
  expect(s.setMasterFilter).toHaveBeenCalledWith({});
  expect(s.setSearchTerm).toHaveBeenCalledWith('');
  expect(s.setFilterType).toHaveBeenCalledWith('all');
  expect(s.setFilterTag).toHaveBeenCalledWith('');
  unmount();
});

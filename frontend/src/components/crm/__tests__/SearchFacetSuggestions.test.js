import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import SearchFacetSuggestions from '../SearchFacetSuggestions';

// React 19 wants this flag set explicitly outside of @testing-library/react.
global.IS_REACT_ACT_ENVIRONMENT = true;

function mount(ui) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => { root.render(ui); });
  return { container, unmount: () => act(() => root.unmount()) };
}

const options = {
  cities: ['Rohini', 'Dwarka'],
  sources: ['Referral'],
  stages: [{ id: 'demo', label: 'Demo' }],
  tags: [{ id: 't_roh', name: 'Rohini Zone' }],
  owners: [{ id: 'r@ss.in', name: 'Rohit' }],
};

test('renders nothing for a term under 2 chars', () => {
  const { container, unmount } = mount(<SearchFacetSuggestions term="r" options={options} onAdd={jest.fn()} />);
  expect(container.querySelector('[data-testid="search-suggestions"]')).toBeFalsy();
  unmount();
});

test('renders ranked "Add filter" suggestions with counts (O3)', () => {
  const countFor = (facet, id) => (facet === 'cities' && id === 'Rohini' ? 4 : 1);
  const { container, unmount } = mount(
    <SearchFacetSuggestions term="roh" options={options} countFor={countFor} onAdd={jest.fn()} />
  );
  expect(container.querySelector('[data-testid="search-suggestions"]')).toBeTruthy();
  const row = container.querySelector('[data-testid="suggestion-cities-Rohini"]');
  expect(row.textContent).toContain('City');
  expect(row.textContent).toContain('Rohini');
  expect(row.textContent).toContain('4');
  unmount();
});

test('clicking a suggestion calls onAdd with {facet,id,label}', () => {
  const onAdd = jest.fn();
  const { container, unmount } = mount(<SearchFacetSuggestions term="roh" options={options} onAdd={onAdd} />);
  const btn = container.querySelector('[data-testid="suggestion-cities-Rohini"]');
  act(() => btn.click());
  expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ facet: 'cities', id: 'Rohini' }));
  unmount();
});

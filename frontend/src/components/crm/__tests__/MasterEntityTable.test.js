// Rendered into jsdom via react-dom/client (no @testing-library/react here).
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import MasterEntityTable from '../MasterEntityTable';

global.IS_REACT_ACT_ENVIRONMENT = true;

function mount(ui) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => { root.render(ui); });
  return {
    container,
    q: (sel) => container.querySelector(sel),
    all: (sel) => Array.from(container.querySelectorAll(sel)),
    unmount: () => act(() => root.unmount()),
  };
}

const columns = [
  { key: 'name', label: 'Name', primary: true },
  { key: 'department', label: 'Department' },
];
const data = [
  { designation_id: 'd1', name: 'Principal', department: 'Academics' },
  { designation_id: 'd2', name: 'Trustee' },
];
const base = { columns, data, rowKey: 'designation_id', testIdPrefix: 'des' };

test('renders a row per record with its columns', () => {
  const v = mount(<MasterEntityTable {...base} onEdit={jest.fn()} onDelete={jest.fn()} />);
  expect(v.container.textContent).toContain('Principal');
  expect(v.container.textContent).toContain('Academics');
  expect(v.all('tbody tr')).toHaveLength(2);
  v.unmount();
});

test('a missing value shows a dash rather than a blank cell', () => {
  const v = mount(<MasterEntityTable {...base} onEdit={jest.fn()} onDelete={jest.fn()} />);
  expect(v.container.textContent).toContain('—');
  v.unmount();
});

test('both actions appear when both handlers are given', () => {
  const v = mount(<MasterEntityTable {...base} onEdit={jest.fn()} onDelete={jest.fn()} />);
  expect(v.q('[data-testid="edit-des-d1"]')).toBeTruthy();
  expect(v.q('[data-testid="delete-des-d1"]')).toBeTruthy();
  v.unmount();
});

// Master data is admin-only to rename or delete. Callers express that by simply
// not passing a handler, so the button is absent rather than shown and refused.
test('omitting onEdit hides the Edit button', () => {
  const v = mount(<MasterEntityTable {...base} onDelete={jest.fn()} />);
  expect(v.q('[data-testid="edit-des-d1"]')).toBeNull();
  expect(v.q('[data-testid="delete-des-d1"]')).toBeTruthy();
  v.unmount();
});

test('omitting onDelete hides the Delete button', () => {
  const v = mount(<MasterEntityTable {...base} onEdit={jest.fn()} />);
  expect(v.q('[data-testid="edit-des-d1"]')).toBeTruthy();
  expect(v.q('[data-testid="delete-des-d1"]')).toBeNull();
  v.unmount();
});

test('a read-only viewer gets rows and no actions at all', () => {
  const v = mount(<MasterEntityTable {...base} />);
  expect(v.all('tbody tr')).toHaveLength(2);
  expect(v.q('[data-testid="edit-des-d1"]')).toBeNull();
  expect(v.q('[data-testid="delete-des-d1"]')).toBeNull();
  v.unmount();
});

test('the handlers receive the row they belong to', () => {
  const onEdit = jest.fn();
  const onDelete = jest.fn();
  const v = mount(<MasterEntityTable {...base} onEdit={onEdit} onDelete={onDelete} />);
  act(() => { v.q('[data-testid="edit-des-d2"]').click(); });
  expect(onEdit).toHaveBeenCalledWith(data[1]);
  act(() => { v.q('[data-testid="delete-des-d1"]').click(); });
  expect(onDelete).toHaveBeenCalledWith(data[0]);
  v.unmount();
});

test('an empty list explains itself instead of showing a bare table', () => {
  const v = mount(
    <MasterEntityTable {...base} data={[]} emptyMsg="No designations yet." onEdit={jest.fn()} />
  );
  expect(v.container.textContent).toContain('No designations yet.');
  v.unmount();
});

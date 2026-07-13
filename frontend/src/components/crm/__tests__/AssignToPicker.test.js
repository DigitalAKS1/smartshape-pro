// Smoke tests for the searchable "Assign To" picker. Rendered directly into
// jsdom via react-dom/client (no @testing-library/react in this repo's
// node_modules — see package.json).
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import AssignToPicker from '../AssignToPicker';

global.IS_REACT_ACT_ENVIRONMENT = true;

const users = [
  { email: 'parul@ss.in', name: 'Parul Kanchan' },
  { email: 'amit@ss.in', name: 'Amit Sharma' },
  { email: 'rohit@ss.in', name: 'Rohit Verma' },
];

function setInputValue(input, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}
function keydown(el, key) {
  el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
}

function mount(ui) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => { root.render(ui); });
  return { container, unmount: () => act(() => root.unmount()) };
}

afterEach(() => { document.body.innerHTML = ''; });

test('shows the current assignee name when not editing', () => {
  const { container, unmount } = mount(
    <AssignToPicker value="parul@ss.in" valueName="Parul Kanchan" users={users} onChange={jest.fn()} />
  );
  const input = container.querySelector('[data-testid="assign-to-input"]');
  expect(input.value).toBe('Parul Kanchan');
  unmount();
});

test('typing filters the list by name OR email, case-insensitive', () => {
  const { container, unmount } = mount(
    <AssignToPicker value="" valueName="" users={users} onChange={jest.fn()} />
  );
  const input = container.querySelector('[data-testid="assign-to-input"]');
  act(() => input.focus());
  act(() => setInputValue(input, 'ROHIT'));
  expect(container.querySelector('[data-testid="assign-to-option-rohit@ss.in"]')).toBeTruthy();
  expect(container.querySelector('[data-testid="assign-to-option-parul@ss.in"]')).toBeFalsy();

  act(() => setInputValue(input, 'amit@ss.in'));
  expect(container.querySelector('[data-testid="assign-to-option-amit@ss.in"]')).toBeTruthy();
  expect(container.querySelector('[data-testid="assign-to-option-rohit@ss.in"]')).toBeFalsy();
  unmount();
});

test('selecting a match calls onChange with (email, name) and closes the dropdown', () => {
  const onChange = jest.fn();
  const { container, unmount } = mount(
    <AssignToPicker value="" valueName="" users={users} onChange={onChange} />
  );
  const input = container.querySelector('[data-testid="assign-to-input"]');
  act(() => input.focus());
  act(() => setInputValue(input, 'rohit'));
  act(() => container.querySelector('[data-testid="assign-to-option-rohit@ss.in"]').click());
  expect(onChange).toHaveBeenCalledWith('rohit@ss.in', 'Rohit Verma');
  expect(container.querySelector('[data-testid="assign-to-dropdown"]')).toBeFalsy();
  unmount();
});

test('arrow-down + Enter selects the highlighted match', () => {
  const onChange = jest.fn();
  const { container, unmount } = mount(
    <AssignToPicker value="" valueName="" users={users} onChange={onChange} />
  );
  const input = container.querySelector('[data-testid="assign-to-input"]');
  act(() => input.focus());
  act(() => setInputValue(input, 'a')); // matches Parul, Amit (both contain "a")
  act(() => keydown(input, 'ArrowDown'));
  act(() => keydown(input, 'Enter'));
  expect(onChange).toHaveBeenCalledTimes(1);
  const [email, name] = onChange.mock.calls[0];
  expect(users.some((u) => u.email === email && u.name === name)).toBe(true);
  unmount();
});

test('a free-typed exact email not in the list is accepted on Enter (onChange with blank name)', () => {
  const onChange = jest.fn();
  const { container, unmount } = mount(
    <AssignToPicker value="" valueName="" users={users} onChange={onChange} />
  );
  const input = container.querySelector('[data-testid="assign-to-input"]');
  act(() => input.focus());
  act(() => setInputValue(input, 'newrep@smartshape.in'));
  act(() => keydown(input, 'Enter'));
  expect(onChange).toHaveBeenCalledWith('newrep@smartshape.in', '');
  unmount();
});

test('typing garbage with no matches and no @ does not call onChange (discarded, not saved)', () => {
  const onChange = jest.fn();
  const { container, unmount } = mount(
    <AssignToPicker value="" valueName="" users={users} onChange={onChange} />
  );
  const input = container.querySelector('[data-testid="assign-to-input"]');
  act(() => input.focus());
  act(() => setInputValue(input, 'zzz not a real person'));
  act(() => keydown(input, 'Enter'));
  expect(onChange).not.toHaveBeenCalled();
  unmount();
});

test('the × clear button calls onChange with empty email/name', () => {
  const onChange = jest.fn();
  const { container, unmount } = mount(
    <AssignToPicker value="parul@ss.in" valueName="Parul Kanchan" users={users} onChange={onChange} />
  );
  act(() => container.querySelector('[data-testid="assign-to-clear"]').click());
  expect(onChange).toHaveBeenCalledWith('', '');
  unmount();
});

test('an existing value not present in `users` still shows its name (never blank for a real assignee)', () => {
  const { container, unmount } = mount(
    <AssignToPicker value="ghost@ss.in" valueName="Ghost Rep" users={users} onChange={jest.fn()} />
  );
  const input = container.querySelector('[data-testid="assign-to-input"]');
  expect(input.value).toBe('Ghost Rep');
  act(() => input.focus());
  expect(container.querySelector('[data-testid="assign-to-option-ghost@ss.in"]')).toBeTruthy();
  unmount();
});

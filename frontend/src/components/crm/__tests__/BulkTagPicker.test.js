// BulkTagPicker: the "Tags…" popover every CRM bulk bar (Schools, Contacts,
// Leads) uses to apply SEVERAL tags in one step — the owner's ask was "select
// and add tag once in all". Pinned here: multi-select, search, create-on-the-
// spot (added + ticked + reported to the parent), add/remove callbacks, the
// disabled states, the `extra` slot, and closing on Escape / outside click /
// after a successful apply.
//
// Rendered into jsdom via react-dom/client (no @testing-library/react here).
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { toast } from 'sonner';
import BulkTagPicker, { formatTagResult } from '../BulkTagPicker';
import { tags as tagsApi } from '../../../lib/api';

global.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('../../../contexts/ThemeContext', () => ({ useTheme: () => ({ isDark: false }) }));
jest.mock('../../../lib/api', () => ({ tags: { create: jest.fn() } }));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

const TAGS = [
  { tag_id: 't_hot', name: 'Hot Lead', color: '#ff0000' },
  { tag_id: 't_cbse', name: 'CBSE', color: '#00ff00' },
  { tag_id: 't_expo', name: 'Delhi Expo', color: '#0000ff' },
];
const P = 'btp';

// CRA's Jest config sets `resetMocks: true`, so implementations are
// reinstalled before every test.
beforeEach(() => {
  tagsApi.create.mockImplementation(({ name, color }) =>
    Promise.resolve({ data: { tag_id: 't_new', name, color } }));
});

const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

function render(overrides = {}) {
  const props = {
    tags: TAGS,
    disabled: false,
    onApply: jest.fn(() => Promise.resolve(true)),
    onTagCreated: jest.fn(),
    testIdPrefix: P,
    ...overrides,
  };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => { root.render(<BulkTagPicker {...props} />); });
  const q = (id) => container.querySelector(`[data-testid="${P}-${id}"]`);
  return {
    props,
    container,
    q,
    open: () => act(() => { q('button').click(); }),
    tick: (tagId) => act(() => { q(`check-${tagId}`).click(); }),
    type: (value) => act(() => {
      const input = q('search');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }),
    click: async (id) => { await act(async () => { q(id).click(); await flush(); }); },
    optionIds: () => Array.from(container.querySelectorAll(`[data-testid^="${P}-option-"]`))
      .map(el => el.getAttribute('data-testid').replace(`${P}-option-`, '')),
    rerender: (more) => {
      Object.assign(props, more);
      act(() => { root.render(<BulkTagPicker {...props} />); });
    },
    unmount: () => act(() => { root.unmount(); container.remove(); }),
  };
}

// ── Opening + listing ───────────────────────────────────────────────────────

test('is closed until the button is clicked, then lists every tag with its colour dot', () => {
  const v = render();
  expect(v.q('popover')).toBeNull();
  expect(v.q('button').textContent).toContain('Tags…');
  v.open();
  expect(v.q('popover')).toBeTruthy();
  expect(v.optionIds()).toEqual(['t_hot', 't_cbse', 't_expo']);
  const dot = v.q('option-t_hot').querySelector('span.rounded-full');
  expect(dot.style.backgroundColor).toBe('rgb(255, 0, 0)');
  v.unmount();
});

// ── Disabled states ─────────────────────────────────────────────────────────

test('Add and Remove are disabled until at least one tag is ticked', () => {
  const v = render();
  v.open();
  expect(v.q('add').disabled).toBe(true);
  expect(v.q('remove').disabled).toBe(true);
  v.tick('t_hot');
  expect(v.q('add').disabled).toBe(false);
  expect(v.q('remove').disabled).toBe(false);
  expect(v.q('add').textContent).toBe('Add 1 tag');
  v.tick('t_cbse');
  expect(v.q('add').textContent).toBe('Add 2 tags');
  expect(v.q('remove').textContent).toBe('Remove 2 tags');
  expect(v.q('count').textContent).toBe('2');
  v.tick('t_hot'); // unticking works too
  expect(v.q('add').textContent).toBe('Add 1 tag');
  v.unmount();
});

test('the disabled prop disables the trigger, and the apply buttons of an open picker', () => {
  const v = render({ disabled: true });
  expect(v.q('button').disabled).toBe(true);
  v.unmount();

  const w = render();
  w.open();
  w.tick('t_hot');
  w.rerender({ disabled: true });
  expect(w.q('add').disabled).toBe(true);
  expect(w.q('remove').disabled).toBe(true);
  w.unmount();
});

// ── Applying ────────────────────────────────────────────────────────────────

test('Add hands every ticked tag to onApply in one call, then closes and resets', async () => {
  const v = render();
  v.open();
  v.tick('t_cbse');
  v.tick('t_hot');
  await v.click('add');
  expect(v.props.onApply).toHaveBeenCalledTimes(1);
  expect(v.props.onApply).toHaveBeenCalledWith({ tagIds: ['t_cbse', 't_hot'], action: 'add' });
  expect(v.q('popover')).toBeNull();
  v.open();
  expect(v.q('check-t_cbse').checked).toBe(false);
  expect(v.q('check-t_hot').checked).toBe(false);
  v.unmount();
});

test('Remove calls onApply with action "remove"', async () => {
  const v = render();
  v.open();
  v.tick('t_expo');
  await v.click('remove');
  expect(v.props.onApply).toHaveBeenCalledWith({ tagIds: ['t_expo'], action: 'remove' });
  v.unmount();
});

test('when onApply reports failure the picker stays open with the ticks kept for a retry', async () => {
  const v = render({ onApply: jest.fn(() => Promise.resolve(false)) });
  v.open();
  v.tick('t_hot');
  await v.click('add');
  expect(v.q('popover')).toBeTruthy();
  expect(v.q('check-t_hot').checked).toBe(true);
  v.unmount();
});

test('a throwing onApply is treated as a failure too, not an unhandled crash', async () => {
  const v = render({ onApply: jest.fn(() => Promise.reject(new Error('boom'))) });
  v.open();
  v.tick('t_hot');
  await v.click('add');
  expect(v.q('popover')).toBeTruthy();
  expect(v.q('check-t_hot').checked).toBe(true);
  v.unmount();
});

// ── Search + create ─────────────────────────────────────────────────────────

test('search narrows the list, case-insensitively, and keeps ticks on hidden tags', () => {
  const v = render();
  v.open();
  v.tick('t_hot');
  v.type('dEl');
  expect(v.optionIds()).toEqual(['t_expo']);
  v.type('');
  expect(v.optionIds()).toEqual(['t_hot', 't_cbse', 't_expo']);
  expect(v.q('check-t_hot').checked).toBe(true);
  v.unmount();
});

test('"Create tag" is offered only when no tag matches the typed name exactly', () => {
  const v = render();
  v.open();
  expect(v.q('create')).toBeNull();
  v.type('cbse');            // exact (case-insensitive) match exists
  expect(v.q('create')).toBeNull();
  v.type('cbs');             // partial match only — still creatable
  expect(v.q('create').textContent).toContain('Create tag “cbs”');
  v.type('Diwali 2026');
  expect(v.optionIds()).toEqual([]);
  expect(v.q('create').textContent).toContain('Create tag “Diwali 2026”');
  v.unmount();
});

test('creating a tag uses the tags API, adds it to the list ticked, and tells the parent', async () => {
  const v = render();
  v.open();
  v.tick('t_hot');
  v.type('  Diwali 2026 ');
  await v.click('create');
  expect(tagsApi.create).toHaveBeenCalledWith({ name: 'Diwali 2026', color: '#6366f1' });
  expect(v.props.onTagCreated).toHaveBeenCalledWith({ tag_id: 't_new', name: 'Diwali 2026', color: '#6366f1' });
  expect(v.q('search').value).toBe('');
  expect(v.optionIds()).toEqual(['t_hot', 't_cbse', 't_expo', 't_new']);
  expect(v.q('check-t_new').checked).toBe(true);
  await v.click('add');
  expect(v.props.onApply).toHaveBeenCalledWith({ tagIds: ['t_hot', 't_new'], action: 'add' });
  v.unmount();
});

test('once the parent list includes the created tag it is not shown twice', async () => {
  const v = render();
  v.open();
  v.type('Diwali');
  await v.click('create');
  v.rerender({ tags: [...TAGS, { tag_id: 't_new', name: 'Diwali', color: '#6366f1' }] });
  expect(v.optionIds()).toEqual(['t_hot', 't_cbse', 't_expo', 't_new']);
  v.unmount();
});

test('Enter in the search box creates the typed tag', async () => {
  const v = render();
  v.open();
  v.type('Board meet');
  await act(async () => {
    v.q('search').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await flush();
  });
  expect(tagsApi.create).toHaveBeenCalledWith({ name: 'Board meet', color: '#6366f1' });
  expect(v.q('check-t_new').checked).toBe(true);
  v.unmount();
});

test('a failed create shows the server message and ticks nothing', async () => {
  tagsApi.create.mockImplementation(() => Promise.reject({ response: { data: { detail: 'Tag name is required' } } }));
  const v = render();
  v.open();
  v.type('x');
  await v.click('create');
  expect(toast.error).toHaveBeenCalledWith('Tag name is required');
  expect(v.props.onTagCreated).not.toHaveBeenCalled();
  expect(v.q('add').disabled).toBe(true);
  v.unmount();
});

// ── Extra slot ──────────────────────────────────────────────────────────────

test('the extra slot renders inside the popover, above the apply buttons', () => {
  const extra = <label data-testid="my-extra"><input type="checkbox" /> Also tag their people</label>;
  const v = render({ extra });
  expect(v.container.querySelector('[data-testid="my-extra"]')).toBeNull(); // closed
  v.open();
  const slot = v.q('extra');
  expect(slot).toBeTruthy();
  expect(slot.querySelector('[data-testid="my-extra"]')).toBeTruthy();
  // it sits before the Add button in document order
  expect(slot.compareDocumentPosition(v.q('add')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  v.unmount();
});

test('no extra slot is rendered when none is given', () => {
  const v = render();
  v.open();
  expect(v.q('extra')).toBeNull();
  v.unmount();
});

// ── Closing ─────────────────────────────────────────────────────────────────

test('Escape closes it, keeping the ticks', () => {
  const v = render();
  v.open();
  v.tick('t_cbse');
  act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
  expect(v.q('popover')).toBeNull();
  v.open();
  expect(v.q('check-t_cbse').checked).toBe(true);
  v.unmount();
});

test('a click outside closes it; a click inside does not', () => {
  const v = render();
  v.open();
  act(() => { v.q('search').dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); });
  expect(v.q('popover')).toBeTruthy();
  act(() => { document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); });
  expect(v.q('popover')).toBeNull();
  v.unmount();
});

test('the close button and a second click on the trigger both close it', () => {
  const v = render();
  v.open();
  act(() => { v.q('close').click(); });
  expect(v.q('popover')).toBeNull();
  v.open();
  v.open();
  expect(v.q('popover')).toBeNull();
  v.unmount();
});

// ── formatTagResult ─────────────────────────────────────────────────────────

test('formatTagResult names a single tag and counts several', () => {
  expect(formatTagResult({ action: 'add', tagIds: ['t_hot'], tags: TAGS, targets: [[1, 'contact']] }))
    .toBe('Added “Hot Lead” to 1 contact');
  expect(formatTagResult({ action: 'add', tagIds: ['t_hot', 't_cbse'], tags: TAGS, targets: [[40, 'contact']], skipped: 3 }))
    .toBe('Added 2 tags to 40 contacts (3 skipped)');
  expect(formatTagResult({ action: 'remove', tagIds: ['t_hot', 't_cbse'], tags: TAGS,
    targets: [[12, 'school'], [48, 'contact'], [9, 'lead']] }))
    .toBe('Removed 2 tags from 12 schools, 48 contacts, 9 leads');
});

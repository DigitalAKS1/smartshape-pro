// Rendered into jsdom via react-dom/client (no @testing-library/react here).
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import SchoolPicker from '../SchoolPicker';
import { schools as schoolsApi } from '../../../lib/api';

global.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('../../../lib/api', () => ({ schools: { lookup: jest.fn() } }));

const MINE = [
  { school_id: 's_lotus', school_name: 'Lotus Valley', city: 'Noida' },
  { school_id: 's_ryan', school_name: 'Ryan International', city: 'Gurgaon' },
];
const THEIRS = [
  { school_id: 's_dps', school_name: 'Delhi Public School', city: 'Rohini',
    assigned_to: 'amit@ss.in', assigned_name: 'Amit Rao', is_mine: false },
];

function mount(props = {}) {
  const onChange = jest.fn();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<SchoolPicker value="" onChange={onChange} schoolsList={MINE} {...props} />);
  });
  return {
    onChange,
    container,
    text: () => container.textContent,
    q: (id) => container.querySelector(`[data-testid="${id}"]`),
    type: async (v) => {
      const input = container.querySelector('[data-testid="school-picker-input"]');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      await act(async () => {
        setter.call(input, v);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await act(async () => { jest.advanceTimersByTime(300); });
      await act(async () => {});
    },
    click: async (id) => { await act(async () => { container.querySelector(`[data-testid="${id}"]`).click(); }); },
    unmount: () => act(() => root.unmount()),
  };
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  schoolsApi.lookup.mockResolvedValue({ data: THEIRS });
});
afterEach(() => jest.useRealTimers());

test('typing finds the schools the rep already owns', async () => {
  const v = mount();
  await v.type('lotus');
  expect(v.q('school-picker-mine-s_lotus')).toBeTruthy();
  v.unmount();
});

test('a school owned by another rep is offered, under its own heading', async () => {
  const v = mount();
  await v.type('delhi');
  expect(v.q('school-picker-divider').textContent).toMatch(/Other reps/);
  expect(v.q('school-picker-theirs-s_dps')).toBeTruthy();
  v.unmount();
});

test("another rep's row names the owner, so she knows who to talk to", async () => {
  const v = mount();
  await v.type('delhi');
  expect(v.q('school-picker-theirs-s_dps').textContent).toContain('Amit Rao');
  v.unmount();
});

test('one letter does not reach the server', async () => {
  const v = mount();
  await v.type('d');
  expect(schoolsApi.lookup).not.toHaveBeenCalled();
  v.unmount();
});

test('typing sends one request per pause, not one per keystroke', async () => {
  const v = mount();
  await v.type('de');
  await v.type('del');
  await v.type('delh');
  expect(schoolsApi.lookup).toHaveBeenCalledTimes(3);   // one per settled pause
  v.unmount();
});

test('choosing a school reports it back with whose it is', async () => {
  const v = mount();
  await v.type('delhi');
  await v.click('school-picker-theirs-s_dps');
  expect(v.onChange).toHaveBeenCalledWith('s_dps', expect.objectContaining({
    school_id: 's_dps', is_mine: false, assigned_name: 'Amit Rao',
  }));
  v.unmount();
});

test("picking another rep's school warns before saving, not after", () => {
  const v = mount({ value: 's_dps', schoolsList: [...MINE, { ...THEIRS[0] }] });
  expect(v.q('school-picker-owner-notice').textContent).toContain('Amit Rao');
  expect(v.q('school-picker-owner-notice').textContent).toMatch(/notified/);
  v.unmount();
});

test('choosing your own school warns about nothing', () => {
  const v = mount({ value: 's_lotus' });
  expect(v.q('school-picker-owner-notice')).toBeNull();
  v.unmount();
});

test('a chosen school can be cleared to pick again', async () => {
  const v = mount({ value: 's_lotus' });
  await v.click('school-picker-clear');
  expect(v.onChange).toHaveBeenCalledWith('', null);
  v.unmount();
});

test('a failed lookup still leaves her own schools usable', async () => {
  schoolsApi.lookup.mockRejectedValue(new Error('offline'));
  const v = mount();
  await v.type('lotus');
  expect(v.q('school-picker-mine-s_lotus')).toBeTruthy();
  v.unmount();
});

test('no match at all points at adding a new school', async () => {
  schoolsApi.lookup.mockResolvedValue({ data: [] });
  const v = mount();
  await v.type('zzzz');
  expect(v.text()).toMatch(/No school matches/);
  v.unmount();
});

test('a school already in her own list is not repeated as someone else\'s', async () => {
  schoolsApi.lookup.mockResolvedValue({
    data: [{ school_id: 's_lotus', school_name: 'Lotus Valley', city: 'Noida', is_mine: true }],
  });
  const v = mount();
  await v.type('lotus');
  expect(v.q('school-picker-mine-s_lotus')).toBeTruthy();
  expect(v.q('school-picker-theirs-s_lotus')).toBeNull();
  v.unmount();
});

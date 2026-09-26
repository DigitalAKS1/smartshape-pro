// My WhatsApp: the notice must be accepted before linking; the QR refreshes every 20 s; a linked
// number shows who it is and how far through warm-up it is; a paused number waits for an admin.
// Rendered via react-dom/client (no @testing-library/react here).
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import MyWhatsApp from '../MyWhatsApp';
import { waNumbers } from '../../lib/api';
import { toast } from 'sonner';

global.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('../../components/layouts/AppShell', () => ({ children }) => <div>{children}</div>);
jest.mock('../../contexts/ThemeContext', () => ({ useTheme: () => ({ isDark: false }) }));
jest.mock('../../lib/api', () => ({
  waNumbers: { me: jest.fn(), link: jest.fn(), relink: jest.fn(), unlink: jest.fn() },
}));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

const NOTICE = 'Every message this number sends or receives is visible to managers in the app. '
  + 'Link a company number, not your personal one.';

const flush = () => act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); });

async function render() {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  await act(async () => { root.render(<MyWhatsApp />); });
  await flush();
  const q = (id) => el.querySelector(`[data-testid="${id}"]`);
  return { el, q, root };
}

const connected = (extra = {}) => ({
  data: { linked: true, state: 'connected', phone_e164: '919811111111', notice: NOTICE, looks_personal: false,
    warmup_day: 4, sent_today: 40, cap_today: 60, warmup: { day: 4, of: 14, today_sent: 40, today_cap: 60 },
    needs_admin_resume: false, paused_reason: '', ...extra },
});

let mounted = [];
beforeEach(() => {
  jest.clearAllMocks();
  document.body.innerHTML = '';
  mounted = [];
});
afterEach(() => {
  mounted.forEach((r) => act(() => r.unmount()));
  jest.useRealTimers();
});
const track = (v) => { mounted.push(v.root); return v; };

test('linking needs the notice ticked, then asks the server to link and reloads', async () => {
  waNumbers.me.mockResolvedValue({ data: { linked: false, state: 'unlinked', notice: NOTICE, slots_full: false } });
  waNumbers.link.mockResolvedValue({ data: { state: 'qr', qr_base64: 'data:QR' } });
  const v = track(await render());
  expect(v.q('wa-notice').textContent).toBe(NOTICE);
  expect(v.q('wa-state').textContent).toBe('Not linked');
  expect(v.q('wa-link').disabled).toBe(true);
  act(() => { v.q('wa-accept').click(); });
  expect(v.q('wa-link').disabled).toBe(false);
  await act(async () => { v.q('wa-link').click(); });
  await flush();
  expect(waNumbers.link).toHaveBeenCalledWith({ accept_notice: true, label: undefined });
  expect(waNumbers.me).toHaveBeenCalledTimes(2);          // reloads after linking
  expect(toast.success).toHaveBeenCalledWith('Now scan the QR code with the company phone');
});

test('the notice falls back to the fixed text when the server sends none', async () => {
  waNumbers.me.mockResolvedValue({ data: { linked: false, state: 'unlinked' } });
  const v = track(await render());
  expect(v.q('wa-notice').textContent).toBe(NOTICE);
});

test('a second link reports the number already linked', async () => {
  waNumbers.me.mockResolvedValue({ data: { linked: false, state: 'unlinked', notice: NOTICE } });
  waNumbers.link.mockResolvedValue({ data: { state: 'connected', already_linked: true } });
  const v = track(await render());
  act(() => { v.q('wa-accept').click(); });
  await act(async () => { v.q('wa-link').click(); });
  await flush();
  expect(toast.success).toHaveBeenCalledWith('You already have a number linked');
});

test('a server refusal shows its detail', async () => {
  waNumbers.me.mockResolvedValue({ data: { linked: false, state: 'unlinked', notice: NOTICE } });
  waNumbers.link.mockRejectedValue({ response: { data: { detail: 'All 3 WhatsApp slots on this server are in use.' } } });
  const v = track(await render());
  act(() => { v.q('wa-accept').click(); });
  await act(async () => { v.q('wa-link').click(); });
  await flush();
  expect(toast.error).toHaveBeenCalledWith('All 3 WhatsApp slots on this server are in use.');
  expect(v.q('wa-link').disabled).toBe(false);            // busy clears
});

test('when every slot is taken the button says so and stays off', async () => {
  waNumbers.me.mockResolvedValue({ data: { linked: false, state: 'unlinked', notice: NOTICE, slots_full: true } });
  const v = track(await render());
  act(() => { v.q('wa-accept').click(); });
  expect(v.q('wa-slots-full')).not.toBeNull();
  expect(v.q('wa-link').disabled).toBe(true);
});

test('the QR is shown and re-fetched every 20 seconds while waiting for the scan; polling stops on unmount', async () => {
  jest.useFakeTimers();
  waNumbers.me.mockResolvedValue({ data: { linked: true, state: 'qr', qr_base64: 'data:image/png;base64,QR',
    notice: NOTICE, warmup_day: 1, sent_today: 0, cap_today: 20 } });
  const v = await render();
  expect(v.q('wa-state').textContent).toBe('Waiting for scan');
  expect(v.q('wa-qr').getAttribute('src')).toBe('data:image/png;base64,QR');
  expect(waNumbers.me).toHaveBeenCalledTimes(1);
  await act(async () => { jest.advanceTimersByTime(19999); });
  expect(waNumbers.me).toHaveBeenCalledTimes(1);
  await act(async () => { jest.advanceTimersByTime(1); });
  await flush();
  expect(waNumbers.me).toHaveBeenCalledTimes(2);
  act(() => v.root.unmount());
  await act(async () => { jest.advanceTimersByTime(60000); });
  expect(waNumbers.me).toHaveBeenCalledTimes(2);
});

test('a bare base64 QR gets the data-URL prefix', async () => {
  waNumbers.me.mockResolvedValue({ data: { linked: true, state: 'qr', qr_base64: 'iVBORw0KGgo', notice: NOTICE } });
  const v = track(await render());
  expect(v.q('wa-qr').getAttribute('src')).toBe('data:image/png;base64,iVBORw0KGgo');
});

test('a connected number is re-read every 60 seconds, not every 20', async () => {
  jest.useFakeTimers();
  waNumbers.me.mockResolvedValue(connected());
  const v = track(await render());
  await act(async () => { jest.advanceTimersByTime(20000); });
  expect(waNumbers.me).toHaveBeenCalledTimes(1);
  await act(async () => { jest.advanceTimersByTime(40000); });
  await flush();
  expect(waNumbers.me).toHaveBeenCalledTimes(2);
  expect(v.q('wa-state').textContent).toBe('Connected');
});

test('an unlinked number is not polled', async () => {
  jest.useFakeTimers();
  waNumbers.me.mockResolvedValue({ data: { linked: false, state: 'unlinked', notice: NOTICE } });
  track(await render());
  await act(async () => { jest.advanceTimersByTime(180000); });
  expect(waNumbers.me).toHaveBeenCalledTimes(1);
});

test('a connected number shows who it is and its warm-up', async () => {
  waNumbers.me.mockResolvedValue(connected());
  const v = track(await render());
  expect(v.q('wa-state').textContent).toBe('Connected');
  expect(v.q('wa-connected-as').textContent).toBe('Connected as +91 98111 11111');
  expect(v.q('wa-warmup').textContent).toBe('Day 4 of 14 — today 40 of 60');
  expect(v.q('wa-personal-warning')).toBeNull();
  expect(v.q('wa-paused')).toBeNull();
  expect(v.q('wa-relink').disabled).toBe(false);
  expect(v.q('wa-link')).toBeNull();
});

test('a personal-looking number is warned about, not blocked; past day 14 it is warmed up', async () => {
  waNumbers.me.mockResolvedValue(connected({ looks_personal: true, warmup_day: 20, sent_today: 3, cap_today: 200,
    warmup: { day: 20, of: 14, today_sent: 3, today_cap: 200 } }));
  const v = track(await render());
  expect(v.q('wa-personal-warning').textContent).toMatch(/personal number/);
  expect(v.q('wa-warmup').textContent).toBe('Warmed up — today 3 of 200');
  expect(v.q('wa-relink').disabled).toBe(false);
});

test('a paused number shows the reason, asks for an admin, and cannot be relinked', async () => {
  waNumbers.me.mockResolvedValue(connected({ state: 'paused', paused_reason: 'WhatsApp logged this number out (401)',
    needs_admin_resume: true }));
  const v = track(await render());
  expect(v.q('wa-state').textContent).toBe('Paused');
  expect(v.q('wa-paused-reason').textContent).toBe('WhatsApp logged this number out (401)');
  expect(v.q('wa-paused').textContent).toMatch(/Ask an admin to resume this number/);
  expect(v.q('wa-relink').disabled).toBe(true);
  expect(v.q('wa-connected-as').textContent).toBe('Linked number +91 98111 11111');
});

test('a disconnected number says to relink', async () => {
  window.confirm = jest.fn(() => true);
  waNumbers.me.mockResolvedValue(connected({ state: 'disconnected' }));
  waNumbers.relink.mockResolvedValue({ data: { state: 'qr', qr_base64: 'data:QR' } });
  const v = track(await render());
  expect(v.q('wa-disconnected-hint')).not.toBeNull();
  await act(async () => { v.q('wa-relink').click(); });
  await flush();
  expect(window.confirm).not.toHaveBeenCalled();           // nothing to log out: no question
  expect(waNumbers.relink).toHaveBeenCalledTimes(1);
  expect(toast.success).toHaveBeenCalledWith('Scan the new QR code');
});

test('relinking a connected number asks first', async () => {
  window.confirm = jest.fn(() => false);
  waNumbers.me.mockResolvedValue(connected());
  const v = track(await render());
  await act(async () => { v.q('wa-relink').click(); });
  expect(window.confirm).toHaveBeenCalled();
  expect(waNumbers.relink).not.toHaveBeenCalled();
});

test('unlink asks first', async () => {
  window.confirm = jest.fn(() => false);
  waNumbers.me.mockResolvedValue(connected());
  const v = track(await render());
  await act(async () => { v.q('wa-unlink').click(); });
  expect(window.confirm).toHaveBeenCalled();
  expect(waNumbers.unlink).not.toHaveBeenCalled();
});

test('unlink, once confirmed, unlinks and reloads', async () => {
  window.confirm = jest.fn(() => true);
  waNumbers.me.mockResolvedValue(connected());
  waNumbers.unlink.mockResolvedValue({ data: { state: 'unlinked' } });
  const v = track(await render());
  await act(async () => { v.q('wa-unlink').click(); });
  await flush();
  expect(waNumbers.unlink).toHaveBeenCalledTimes(1);
  expect(waNumbers.me).toHaveBeenCalledTimes(2);
  expect(toast.success).toHaveBeenCalledWith('Number unlinked');
});

test('a load failure shows the server detail', async () => {
  waNumbers.me.mockRejectedValue({ response: { data: { detail: 'Not authenticated' } } });
  const v = track(await render());
  expect(v.q('wa-error').textContent).toBe('Not authenticated');
  expect(v.q('wa-loading')).toBeNull();
});

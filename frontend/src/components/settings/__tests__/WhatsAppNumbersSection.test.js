// Settings → WhatsApp: every number, its state and cap, RAM headroom, and the wa.* settings.
//
// Rendered into jsdom via react-dom/client (no @testing-library/react here).
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import WhatsAppNumbersSection from '../WhatsAppNumbersSection';
import { waNumbers } from '../../../lib/api';
import { toast } from 'sonner';

global.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('../../../lib/api', () => ({
  waNumbers: {
    instances: jest.fn(), getDefaultProxy: jest.fn(), linkCompany: jest.fn(), pause: jest.fn(), resume: jest.fn(),
    unlinkInstance: jest.fn(), updateInstance: jest.fn(), setProxy: jest.fn(), saveSettings: jest.fn(),
    saveDefaultProxy: jest.fn(),
  },
}));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

const SETTINGS = {
  warmup_start_cap: 20, warmup_double_every_days: 3, warmup_days: 14, daily_cap: 200, hourly_cap: 30,
  gap_min_s: 8, gap_max_s: 25, business_start: '09:00', business_end: '19:00', per_contact_per_day: 1,
  failure_pause_after: 5, number_check_ttl_days: 30, opt_out_keywords: ['STOP', 'UNSUBSCRIBE'],
  fallback_provider: 'none', max_instances: 4, drip_wa_enabled: false, greetings_enabled: false,
};
const HEALTH_AT = '2026-09-24T05:07:00+00:00';
const hhmm = (iso) => {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
const PROXY_MASKED = { host: 'gate.decodo.com', port: 10001, protocol: 'socks5', username: 'u1', has_password: true };
const makeList = (over = {}) => ({
  instances: [
    { instance_name: 'smartshape', kind: 'company', label: 'Company', owner_name: 'Owner', phone_e164: '919000000001',
      state: 'connected', paused_reason: '', paused_by: '',
      warmup: { day: 30, of: 14, today_sent: 12, today_cap: 200 }, warmup_day: 30, sent_today: 12, cap_today: 200,
      proxy: { host: '', port: '', protocol: 'socks5', username: '', has_password: false },
      last_seen_at: '2026-09-24T05:00:00+00:00' },
    { instance_name: 'rep_parul', kind: 'rep', label: 'Parul', owner_name: 'Parul', phone_e164: '919000000111',
      state: 'paused', paused_reason: 'Paused by Owner', paused_by: 'owner@x.in',
      warmup: { day: 4, of: 14, today_sent: 12, today_cap: 40 }, warmup_day: 4, sent_today: 12, cap_today: 40,
      proxy: PROXY_MASKED, last_seen_at: null },
    { instance_name: 'rep_amit', kind: 'rep', label: 'Amit', owner_name: 'Amit', phone_e164: '919000000222',
      state: 'paused', paused_reason: '5 sends in a row failed.', paused_by: '',
      warmup: { day: 2, of: 14, today_sent: 0, today_cap: 20 }, warmup_day: 2, sent_today: 0, cap_today: 20,
      proxy: { host: '' }, last_seen_at: null },
  ],
  max_instances: 4, used: 3, company_instance: 'smartshape',
  health: { mem_available_mb: 420, mem_total_mb: 3900, evolution_mem_mb: 1100, at: HEALTH_AT,
    headroom_ok: false, fresh: true, min_headroom_mb: 500 },
  settings: SETTINGS,
  ...over,
});

let root;
async function render() {
  const el = document.createElement('div');
  document.body.appendChild(el);
  root = createRoot(el);
  await act(async () => { root.render(<WhatsAppNumbersSection />); });
  await act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); });
  return { el, q: (id) => el.querySelector(`[data-testid="${id}"]`) };
}
const flush = () => act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); });
const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
function type(input, value) {
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
const click = async (node) => { await act(async () => { node.click(); }); await flush(); };

beforeEach(() => {
  jest.clearAllMocks();
  document.body.innerHTML = '';
  waNumbers.instances.mockResolvedValue({ data: makeList() });
  waNumbers.getDefaultProxy.mockResolvedValue({ data: { enabled: false, host: '', port: '', protocol: 'socks5',
    username: '', has_password: false } });
  waNumbers.saveSettings.mockImplementation((b) => Promise.resolve({ data: b }));
  waNumbers.pause.mockResolvedValue({ data: {} });
  waNumbers.resume.mockResolvedValue({ data: {} });
  waNumbers.unlinkInstance.mockResolvedValue({ data: {} });
  waNumbers.setProxy.mockResolvedValue({ data: {} });
  waNumbers.saveDefaultProxy.mockImplementation((b) => Promise.resolve({ data: { ...b, has_password: true, password: undefined } }));
  window.confirm = jest.fn(() => true);
  window.prompt = jest.fn(() => 'Complaint from a school');
});
afterEach(() => { if (root) act(() => root.unmount()); root = null; });

test('each number shows who, state, warm-up day and today against its cap', async () => {
  const v = await render();
  expect(v.q('wa-admin-row-rep_parul').textContent).toMatch(/Parul/);
  expect(v.q('wa-admin-state-rep_parul').textContent).toBe('Paused');
  expect(v.q('wa-admin-today-rep_parul').textContent).toBe('12 / 40');
  expect(v.q('wa-admin-today-smartshape').textContent).toBe('12 / 200');
  expect(v.q('wa-admin-warmup-rep_parul').textContent).toBe('Day 4 of 14');
  expect(v.q('wa-admin-warmup-smartshape').textContent).toBe('Warmed up');
  expect(v.q('wa-admin-proxy-rep_parul').textContent).toBe('gate.decodo.com');
  expect(v.q('wa-admin-slots').textContent).toBe('3 of 4 WhatsApp slots in use');
});

test('low server memory: "Free RAM: N MB (as of HH:MM)" in red, with the warning', async () => {
  const v = await render();
  expect(v.q('wa-admin-ram').textContent).toBe(`Free RAM: 420 MB (as of ${hhmm(HEALTH_AT)})`);
  expect(v.q('wa-admin-ram').className).toMatch(/text-red-500/);
  expect(v.q('wa-admin-ram-warning')).not.toBeNull();
  expect(v.q('wa-admin-evolution-down')).toBeNull();
});

test('enough memory is not red; no reading says so; Evolution down shows a banner', async () => {
  waNumbers.instances.mockResolvedValueOnce({ data: makeList({
    health: { mem_available_mb: 1800, at: HEALTH_AT, headroom_ok: true, min_headroom_mb: 500 } }) });
  let v = await render();
  expect(v.q('wa-admin-ram').className).not.toMatch(/text-red-500/);
  expect(v.q('wa-admin-ram-warning')).toBeNull();
  act(() => root.unmount()); root = null; document.body.innerHTML = '';

  waNumbers.instances.mockResolvedValueOnce({ data: makeList({
    health: { headroom_ok: true, min_headroom_mb: 500, evolution_down: true } }) });
  v = await render();
  expect(v.q('wa-admin-ram').textContent).toMatch(/not reported yet/);
  expect(v.q('wa-admin-evolution-down').textContent).toMatch(/Evolution unreachable/);
});

test('pause confirms first, then asks a reason; cancelling the confirm sends nothing', async () => {
  const v = await render();
  window.confirm = jest.fn(() => false);
  await click(v.q('wa-admin-pause-smartshape'));
  expect(waNumbers.pause).not.toHaveBeenCalled();
  window.confirm = jest.fn(() => true);
  await click(v.q('wa-admin-pause-smartshape'));
  expect(window.confirm).toHaveBeenCalled();
  expect(waNumbers.pause).toHaveBeenCalledWith('smartshape', 'Complaint from a school');
});

test('resuming an admin pause needs no confirm; resuming a system pause does', async () => {
  const v = await render();
  window.confirm = jest.fn(() => false);
  await click(v.q('wa-admin-resume-rep_parul'));
  expect(window.confirm).not.toHaveBeenCalled();
  expect(waNumbers.resume).toHaveBeenCalledWith('rep_parul');

  await click(v.q('wa-admin-resume-rep_amit'));
  expect(window.confirm).toHaveBeenCalledTimes(1);
  expect(window.confirm.mock.calls[0][0]).toMatch(/5 sends in a row failed/);
  expect(waNumbers.resume).toHaveBeenCalledTimes(1);
  window.confirm = jest.fn(() => true);
  await click(v.q('wa-admin-resume-rep_amit'));
  expect(waNumbers.resume).toHaveBeenLastCalledWith('rep_amit');
});

test('unlink confirms and shows the server detail when it fails', async () => {
  waNumbers.unlinkInstance.mockRejectedValue({ response: { data: { detail: 'The WhatsApp server is not answering' } } });
  const v = await render();
  await click(v.q('wa-admin-unlink-rep_parul'));
  expect(window.confirm).toHaveBeenCalled();
  expect(waNumbers.unlinkInstance).toHaveBeenCalledWith('rep_parul');
  expect(toast.error).toHaveBeenCalledWith('The WhatsApp server is not answering');
});

test('saving settings sends numbers as numbers and keywords as a list', async () => {
  const v = await render();
  type(v.q('wa-admin-set-hourly_cap'), '20');
  type(v.q('wa-admin-set-keywords'), 'STOP, बंद , ');
  await click(v.q('wa-admin-save-settings'));
  const body = waNumbers.saveSettings.mock.calls[0][0];
  expect(body.hourly_cap).toBe(20);
  expect(body.gap_min_s).toBe(8);
  expect(body.opt_out_keywords).toEqual(['STOP', 'बंद']);
  expect(body.drip_wa_enabled).toBe(false);
  expect(body.fallback_provider).toBe('none');
});

test('out-of-range or inconsistent settings disable Save with the reason', async () => {
  const v = await render();
  type(v.q('wa-admin-set-hourly_cap'), '0');
  expect(v.q('wa-admin-save-settings').disabled).toBe(true);
  expect(v.q('wa-admin-settings-error').textContent).toMatch(/between 1 and 500/);
  type(v.q('wa-admin-set-hourly_cap'), '30');
  expect(v.q('wa-admin-save-settings').disabled).toBe(false);
  type(v.q('wa-admin-set-gap_min_s'), '40');
  expect(v.q('wa-admin-save-settings').disabled).toBe(true);
  type(v.q('wa-admin-set-gap_min_s'), '8');
  type(v.q('wa-admin-set-keywords'), ' , ');
  expect(v.q('wa-admin-save-settings').disabled).toBe(true);
  type(v.q('wa-admin-set-keywords'), 'STOP');
  type(v.q('wa-admin-set-business_end'), '08:00');
  expect(v.q('wa-admin-save-settings').disabled).toBe(true);
  expect(v.q('wa-admin-settings-error').textContent).toMatch(/before/);
});

test('a save error from the server is shown', async () => {
  waNumbers.saveSettings.mockRejectedValue({ response: { status: 400, data: { detail: 'gap_min_s cannot be more than gap_max_s' } } });
  const v = await render();
  await click(v.q('wa-admin-save-settings'));
  expect(toast.error).toHaveBeenCalledWith('gap_min_s cannot be more than gap_max_s');
});

test('unsaved settings edits survive the list reload after a row action', async () => {
  const v = await render();
  type(v.q('wa-admin-set-hourly_cap'), '12');
  await click(v.q('wa-admin-resume-rep_parul'));
  expect(waNumbers.instances).toHaveBeenCalledTimes(2);
  expect(v.q('wa-admin-set-hourly_cap').value).toBe('12');
});

test('linking the company number needs the notice and then shows its QR', async () => {
  waNumbers.linkCompany.mockResolvedValue({ data: { instance_name: 'smartshape', state: 'qr', qr_base64: 'data:QR' } });
  const v = await render();
  expect(v.q('wa-admin-link-company').disabled).toBe(true);
  act(() => { v.q('wa-admin-accept').click(); });
  await click(v.q('wa-admin-link-company'));
  expect(waNumbers.linkCompany).toHaveBeenCalledWith({ notice_accepted: true });
  expect(v.q('wa-admin-company-qr').getAttribute('src')).toBe('data:QR');
});

test('the per-number proxy editor never pre-fills the password and saves without the name', async () => {
  const v = await render();
  act(() => { v.q('wa-admin-edit-proxy-rep_parul').click(); });
  expect(v.q('wa-admin-iproxy-host').value).toBe('gate.decodo.com');
  expect(v.q('wa-admin-iproxy-password').value).toBe('');
  expect(v.q('wa-admin-iproxy-password').placeholder).toMatch(/saved/);
  await click(v.q('wa-admin-iproxy-save'));
  expect(waNumbers.setProxy).toHaveBeenCalledWith('rep_parul',
    { host: 'gate.decodo.com', port: '10001', protocol: 'socks5', username: 'u1', password: '' });
  expect(v.q('wa-admin-proxy-editor')).toBeNull();
});

test('the default proxy shows as configured from host/has_password and keeps the password write-only', async () => {
  waNumbers.getDefaultProxy.mockResolvedValue({ data: { enabled: true, host: 'gate.decodo.com', port: 10001,
    protocol: 'socks5', username: 'u1', has_password: true } });
  const v = await render();
  expect(v.q('wa-admin-dproxy-status').textContent).toMatch(/gate\.decodo\.com:10001/);
  expect(v.q('wa-admin-dproxy-password').value).toBe('');
  expect(v.q('wa-admin-dproxy-enabled').checked).toBe(true);
  type(v.q('wa-admin-dproxy-password'), 'newpw');
  await click(v.q('wa-admin-dproxy-save'));
  expect(waNumbers.saveDefaultProxy).toHaveBeenCalledWith({ enabled: true, host: 'gate.decodo.com', port: '10001',
    protocol: 'socks5', username: 'u1', password: 'newpw' });
  expect(v.q('wa-admin-dproxy-password').value).toBe('');
});

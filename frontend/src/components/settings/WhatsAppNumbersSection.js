import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { waNumbers } from '../../lib/api';
import { formatPhone, qrSrc } from '../../hooks/useMyWhatsApp';

/**
 * Settings → WhatsApp (admin, spec 2026-09-24 W1): every linked number (company + one per rep),
 * the company-number link, server capacity and free memory (D7), the wa.* sending rules, and the
 * default proxy for newly linked numbers. Replaces the old Evolution connection panel and the Marketing
 * Setup provider form.
 */

const NOTICE = 'Every message this number sends or receives is visible to managers in the app. '
  + 'Link a company number, not your personal one.';
const STATE_LABEL = { unlinked: 'Unlinked', qr: 'Waiting for scan', connected: 'Connected',
  disconnected: 'Disconnected', paused: 'Paused' };
const STATE_TONE = { connected: 'text-green-600', paused: 'text-red-500', disconnected: 'text-amber-600',
  qr: 'text-blue-500', unlinked: 'text-[var(--text-muted)]' };
const QR_POLL_MS = 20000;
const RAM_MIN_MB = 500;                         // wa_config.RAM_HEADROOM_MIN_MB

// The same ranges wa_config.validate_wa_settings enforces (_INT_RANGES).
const INT_RANGES = {
  warmup_start_cap: [1, 1000], warmup_double_every_days: [1, 30], warmup_days: [0, 60],
  daily_cap: [1, 2000], hourly_cap: [1, 500], gap_min_s: [0, 600], gap_max_s: [0, 600],
  per_contact_per_day: [1, 10], failure_pause_after: [1, 50], number_check_ttl_days: [1, 365],
  max_instances: [1, 20],
};
const FIELDS = [
  ['hourly_cap', 'Messages per hour, per number'],
  ['daily_cap', 'Messages per day, per number (after warm-up)'],
  ['warmup_start_cap', 'Warm-up: first-day limit'],
  ['warmup_double_every_days', 'Warm-up: double every N days'],
  ['warmup_days', 'Warm-up length (days) — no campaigns before this'],
  ['gap_min_s', 'Shortest gap between automated sends (seconds)'],
  ['gap_max_s', 'Longest gap between automated sends (seconds)'],
  ['per_contact_per_day', 'Marketing messages per person per day'],
  ['failure_pause_after', 'Pause a number after this many failures in a row'],
  ['number_check_ttl_days', 'Re-check "is this number on WhatsApp" after (days)'],
  ['max_instances', 'Most numbers this server may hold'],
];
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const PROTOCOLS = ['socks5', 'socks4', 'http', 'https'];

const CARD = 'rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-4';
const BTN = 'px-2.5 py-1.5 rounded-lg text-xs font-medium border border-[var(--border-color)] '
  + 'text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-50 disabled:cursor-not-allowed';
const BTN_PRIMARY = 'px-3 py-1.5 rounded-lg text-xs font-medium bg-[var(--accent)] text-white '
  + 'hover:bg-[var(--accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed';
const INPUT = 'w-full px-2 py-1.5 rounded-lg text-sm bg-[var(--bg-primary)] border border-[var(--border-color)] '
  + 'text-[var(--text-primary)]';
const TITLE = 'text-sm font-semibold text-[var(--text-primary)]';
const MUTED = 'text-xs text-[var(--text-muted)]';

const pad = (n) => String(n).padStart(2, '0');
const hhmm = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
/** "HH:MM" for a reading taken today (local), else "24 Sep, HH:MM". */
const asOf = (iso, now = new Date()) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  if (d.toDateString() === now.toDateString()) return hhmm(iso);
  return `${d.getDate()} ${d.toLocaleString('en-GB', { month: 'short' })}, ${hhmm(iso)}`;
};
const validPort = (v) => isInt(v) && Number(v) >= 1 && Number(v) <= 65535;
/** wa_send.pause_instance writes paused_by "system" (failure streak, WhatsApp logout/ban); an
 *  admin's pause carries the admin's email. Older rows may have it empty. */
export const isSystemPause = (i) => !i.paused_by || i.paused_by === 'system';
export const SYSTEM_RESUME_WARNING = 'This number was paused automatically after send failures / a WhatsApp logout '
  + '— check the phone first. Resume?';
const fmtWhen = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' });
};
const errText = (e, fallback) => {
  const d = e?.response?.data?.detail;
  return typeof d === 'string' && d ? d : fallback;
};
const isInt = (v) => /^-?\d+$/.test(String(v ?? '').trim());
const parseKeywords = (s) => String(s || '').split(',').map((w) => w.trim()).filter(Boolean);

/** Mirrors wa_config.validate_wa_settings. Returns the first problem, or ''. */
export function settingsError(form, keywords) {
  if (!form) return '';
  for (const [k, label] of FIELDS) {
    const [lo, hi] = INT_RANGES[k];
    if (!isInt(form[k])) return `${label}: enter a whole number`;
    const n = Number(form[k]);
    if (n < lo || n > hi) return `${label}: must be between ${lo} and ${hi}`;
  }
  if (!HHMM.test(form.business_start || '') || !HHMM.test(form.business_end || '')) {
    return 'Automation hours must be HH:MM (24-hour, IST)';
  }
  const words = parseKeywords(keywords);
  if (words.length < 1 || words.length > 30 || words.some((w) => w.length > 30)) {
    return 'Opt-out words: 1 to 30 words, each up to 30 characters';
  }
  if (!['none', 'autosender'].includes(form.fallback_provider)) return 'Choose what happens when no number can send';
  if (Number(form.gap_min_s) > Number(form.gap_max_s)) return 'The shortest gap cannot be more than the longest gap';
  if (form.business_start >= form.business_end) return 'Automations must start before they stop';
  if (Number(form.warmup_start_cap) > Number(form.daily_cap)) {
    return 'The warm-up first-day limit cannot be more than the daily limit';
  }
  return '';
}

function warmupLabel(i) {
  const day = i.warmup_day ?? i.warmup?.day;
  const of = i.warmup?.of;
  if (day == null) return '—';
  if (of != null && day > of) return 'Warmed up';
  return of != null ? `Day ${day} of ${of}` : `Day ${day}`;
}

const blankProxy = { enabled: false, host: '', port: '', protocol: 'socks5', username: '', password: '', has_password: false };

/** The form state for a /whatsapp/proxy-config response. The response has no `configured` field and
 *  never the password: "configured" = a saved host; the password box always starts empty. With
 *  nothing saved yet, "use it" starts ticked so typing a host and saving turns it on. */
function proxyState(d) {
  const p = d || {};
  return { ...blankProxy, ...p, enabled: p.host ? !!p.enabled : true,
    port: p.port ? String(p.port) : '', password: '' };
}

export default function WhatsAppNumbersSection() {
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [form, setForm] = useState(null);
  const [keywords, setKeywords] = useState('');
  const [dproxy, setDproxy] = useState(blankProxy);           // default proxy (password is write-only)
  const [accepted, setAccepted] = useState(false);
  const [companyQr, setCompanyQr] = useState('');
  const [editProxy, setEditProxy] = useState(null);           // {name, host, port, protocol, username, password, has_password}
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  // The number list + health. The settings form is filled only once (and after a save), so a
  // reload after a row action never wipes unsaved edits.
  const loadList = useCallback(async () => {
    const r = await waNumbers.instances();
    if (!mounted.current) return r.data;
    setData(r.data);
    return r.data;
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const [list, dp] = await Promise.all([waNumbers.instances(), waNumbers.getDefaultProxy()]);
        if (!mounted.current) return;
        setData(list.data);
        const s = list.data?.settings || {};
        setForm({ ...s });
        setKeywords((s.opt_out_keywords || []).join(', '));
        setDproxy(proxyState(dp.data));
      } catch (e) {
        if (mounted.current) setLoadError(errText(e, 'Could not load WhatsApp numbers'));
      }
    })();
  }, []);

  useEffect(() => {                                   // while the company QR is up, watch for the scan
    if (!companyQr) return undefined;
    const iv = setInterval(async () => {
      try {
        const d = await loadList();
        const c = (d?.instances || []).find((i) => i.kind === 'company');
        if (!mounted.current || !c) return;
        if (c.state === 'connected' || c.state === 'paused') {
          setCompanyQr('');
          toast.success('Company number connected');
        } else if (c.state === 'qr') {
          // A WhatsApp QR expires in about 20-40 s: fetch a fresh one (the route returns the
          // cached QR while it is under 20 s old, else asks Evolution for a new one).
          const r = await waNumbers.linkCompany({ notice_accepted: true });
          if (mounted.current && r?.data?.qr_base64) setCompanyQr(qrSrc(r.data.qr_base64));
        }
      } catch { /* the next tick tries again */ }
    }, QR_POLL_MS);
    return () => clearInterval(iv);
  }, [companyQr, loadList]);

  const run = async (fn, okText) => {
    setBusy(true);
    try {
      const r = await fn();
      if (okText) toast.success(okText);
      try { await loadList(); } catch { /* the action worked; the list refreshes next time */ }
      return r;
    } catch (e) {
      toast.error(errText(e, 'Something went wrong'));
      return null;
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  const linkCompany = async () => {
    const r = await run(() => waNumbers.linkCompany({ notice_accepted: true }));
    if (r?.data?.qr_base64) setCompanyQr(qrSrc(r.data.qr_base64));
    else if (r?.data?.state === 'connected') toast.success('Company number connected');
    else if (r?.data?.state === 'paused') toast.success('Company number linked — it is paused until you resume it');
  };

  const who = (i) => (i.kind === 'company' ? 'Company' : (i.owner_name || i.label || i.owner_email || i.instance_name));

  const pause = (i) => {
    if (!window.confirm(`Pause ${who(i)}'s number (${formatPhone(i.phone_e164) || i.instance_name})? `
      + 'It stops sending until an admin resumes it.')) return;
    const reason = window.prompt('Why pause this number? (shown to its owner)', '');
    if (reason === null) return;
    run(() => waNumbers.pause(i.instance_name, reason.trim()), 'Number paused');
  };
  const resume = (i) => {
    if (isSystemPause(i) && !window.confirm(SYSTEM_RESUME_WARNING
      + (i.paused_reason ? `\n\nReason: ${i.paused_reason}` : ''))) return;
    run(() => waNumbers.resume(i.instance_name), 'Number resumed');
  };
  const unlink = (i) => {
    if (!window.confirm(`Unlink ${who(i)}'s number (${formatPhone(i.phone_e164) || i.instance_name})? `
      + 'It stops sending and frees its slot; it must be scanned again to come back.')) return;
    run(() => waNumbers.unlinkInstance(i.instance_name), 'Number unlinked');
  };
  const setCap = (i) => {
    const v = window.prompt('Daily limit for this number, 1-2000 (empty = follow the warm-up ramp)',
      i.daily_cap_override ?? '');
    if (v === null) return;
    const t = v.trim();
    if (t !== '' && (!isInt(t) || Number(t) < 1 || Number(t) > 2000)) {
      toast.error('The daily limit must be a whole number from 1 to 2000, or empty');
      return;
    }
    run(() => waNumbers.updateInstance(i.instance_name, { daily_cap_override: t === '' ? null : Number(t) }), 'Limit saved');
  };
  const openProxyEditor = (i) => setEditProxy({
    name: i.instance_name, had_host: i.proxy?.host || '', host: i.proxy?.host || '', port: i.proxy?.port ? String(i.proxy.port) : '',
    protocol: i.proxy?.protocol || 'socks5', username: i.proxy?.username || '', password: '',
    has_password: !!i.proxy?.has_password,
  });
  const saveInstanceProxy = async () => {
    const { name, has_password: _hp, had_host: hadHost, ...body } = editProxy;
    if (body.host.trim() && !validPort(body.port)) return;
    if (!body.host.trim() && hadHost
      && !window.confirm('Removing the proxy exposes the server IP to WhatsApp — remove?')) return;
    const r = await run(() => waNumbers.setProxy(name, body), body.host ? 'Proxy saved' : 'Proxy removed');
    if (r && mounted.current) setEditProxy(null);
  };

  const invalid = useMemo(() => settingsError(form, keywords), [form, keywords]);
  const saveSettings = async () => {
    if (invalid) return;
    const body = { ...form };
    Object.keys(INT_RANGES).forEach((k) => { body[k] = Number(body[k]); });
    body.opt_out_keywords = parseKeywords(keywords);
    body.drip_wa_enabled = !!body.drip_wa_enabled;
    body.greetings_enabled = !!body.greetings_enabled;
    const r = await run(() => waNumbers.saveSettings(body), 'WhatsApp settings saved');
    if (r?.data && mounted.current) {
      setForm({ ...r.data });
      setKeywords((r.data.opt_out_keywords || []).join(', '));
    }
  };

  const dproxyError = dproxy.host.trim() && !validPort(dproxy.port) ? 'Port must be a number from 1 to 65535' : '';
  const iproxyError = editProxy && editProxy.host.trim() && !validPort(editProxy.port)
    ? 'Port must be a number from 1 to 65535' : '';
  const saveDefaultProxy = async () => {
    const body = { enabled: !!dproxy.enabled && !!dproxy.host.trim(), host: dproxy.host.trim(), port: String(dproxy.port || ''),
      protocol: dproxy.protocol || 'socks5', username: dproxy.username || '', password: dproxy.password || '' };
    const r = await run(() => waNumbers.saveDefaultProxy(body), body.host ? 'Default proxy saved' : 'Default proxy removed');
    if (r?.data && mounted.current) {
      setDproxy(proxyState(r.data));
    }
  };

  if (loadError) return <p className="text-sm text-red-500" data-testid="wa-admin-load-error">{loadError}</p>;
  if (!data || !form) return <p className={MUTED} data-testid="wa-admin-loading">Loading WhatsApp numbers…</p>;

  const h = data.health || {};
  const minMb = h.min_headroom_mb || RAM_MIN_MB;
  const hasRam = h.mem_available_mb != null;
  const stale = h.fresh === false;               // an old host reading is shown, but never alarms
  const ramLow = hasRam && !stale && Number(h.mem_available_mb) < minMb;
  const instances = data.instances || [];
  const company = instances.find((i) => i.kind === 'company');
  const dproxyConfigured = !!dproxy.host;

  return (
    <div className="space-y-5" data-testid="wa-admin">
      {h.evolution_down && (
        <div data-testid="wa-admin-evolution-down" className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-500">
          Evolution unreachable — the last health check could not reach the WhatsApp server for any number.
          States below may be stale and nothing is sending.
        </div>
      )}

      {/* Capacity and memory (D7) */}
      <div className={`${CARD} space-y-1`}>
        <p data-testid="wa-admin-slots" className={TITLE}>
          {data.used} of {data.max_instances} WhatsApp slots in use
        </p>
        <p data-testid="wa-admin-ram" className={`text-xs ${ramLow ? 'text-red-500 font-semibold' : 'text-[var(--text-muted)]'}`}>
          {hasRam
            ? `Free RAM: ${h.mem_available_mb} MB${h.at ? ` (as of ${asOf(h.at)})` : ''}${stale ? ' (stale)' : ''}`
            : 'Free RAM: not reported yet (the hourly host check has not run)'}
        </p>
        {hasRam && (h.mem_total_mb != null || h.evolution_mem_mb != null) && (
          <p data-testid="wa-admin-ram-detail" className={MUTED}>
            {h.mem_total_mb != null ? `Server total ${h.mem_total_mb} MB` : ''}
            {h.mem_total_mb != null && h.evolution_mem_mb != null ? ' · ' : ''}
            {h.evolution_mem_mb != null ? `WhatsApp server uses ${h.evolution_mem_mb} MB` : ''}
          </p>
        )}
        {ramLow && (
          <p data-testid="wa-admin-ram-warning" className="text-xs text-red-500">
            Less than {minMb} MB free — do not link another number until the server is upgraded.
          </p>
        )}
      </div>

      {/* Every number */}
      <div className={`${CARD} !p-0 overflow-x-auto`}>
        <table className="w-full text-sm" data-testid="wa-admin-table">
          <thead>
            <tr className="text-left text-xs text-[var(--text-muted)]">
              <th className="p-2">Who</th><th className="p-2">Number</th><th className="p-2">State</th>
              <th className="p-2">Today / limit</th><th className="p-2">Warm-up</th><th className="p-2">Last seen</th>
              <th className="p-2">Proxy</th><th className="p-2" />
            </tr>
          </thead>
          <tbody className="text-[var(--text-primary)]">
            {instances.length === 0 && (
              <tr><td colSpan={8} className={`p-3 ${MUTED}`} data-testid="wa-admin-empty">No numbers linked yet.</td></tr>
            )}
            {instances.map((i) => {
              const n = i.instance_name;
              return (
                <tr key={n} data-testid={`wa-admin-row-${n}`} className="border-t border-[var(--border-color)] align-top">
                  <td className="p-2">
                    {who(i)}
                    {i.kind !== 'company' && i.owner_email && <div className={MUTED}>{i.owner_email}</div>}
                  </td>
                  <td className="p-2 whitespace-nowrap">{formatPhone(i.phone_e164) || '—'}</td>
                  <td className="p-2">
                    <span data-testid={`wa-admin-state-${n}`} className={`font-medium ${STATE_TONE[i.state] || ''}`}>
                      {STATE_LABEL[i.state] || i.state}
                    </span>
                    {i.state === 'paused' && i.paused_reason && (
                      <div className={MUTED} data-testid={`wa-admin-paused-reason-${n}`}>
                        {i.paused_reason}{isSystemPause(i) ? ' (automatic)' : ''}
                      </div>
                    )}
                    {i.unlinked_detail && i.state === 'unlinked' && <div className={MUTED}>{i.unlinked_detail}</div>}
                  </td>
                  <td className="p-2 whitespace-nowrap" data-testid={`wa-admin-today-${n}`}>
                    {i.sent_today ?? i.warmup?.today_sent ?? 0} / {i.cap_today ?? i.warmup?.today_cap ?? '—'}
                  </td>
                  <td className="p-2 whitespace-nowrap" data-testid={`wa-admin-warmup-${n}`}>{warmupLabel(i)}</td>
                  <td className="p-2 whitespace-nowrap">{fmtWhen(i.last_seen_at)}</td>
                  <td className="p-2" data-testid={`wa-admin-proxy-${n}`}>{(i.proxy && i.proxy.host) || '—'}</td>
                  <td className="p-2 whitespace-nowrap space-x-1">
                    {i.state === 'paused'
                      ? <button type="button" className={BTN} disabled={busy} data-testid={`wa-admin-resume-${n}`}
                          onClick={() => resume(i)}>Resume</button>
                      : <button type="button" className={BTN} disabled={busy || i.state === 'unlinked'}
                          data-testid={`wa-admin-pause-${n}`} onClick={() => pause(i)}>Pause</button>}
                    <button type="button" className={BTN} disabled={busy} data-testid={`wa-admin-cap-${n}`}
                      onClick={() => setCap(i)}>Limit</button>
                    <button type="button" className={BTN} disabled={busy} data-testid={`wa-admin-edit-proxy-${n}`}
                      onClick={() => openProxyEditor(i)}>Proxy</button>
                    <button type="button" className={`${BTN} !text-red-500`} disabled={busy || i.state === 'unlinked'}
                      data-testid={`wa-admin-unlink-${n}`} onClick={() => unlink(i)}>Unlink</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {editProxy && (
        <div className={`${CARD} grid grid-cols-1 sm:grid-cols-2 gap-2`} data-testid="wa-admin-proxy-editor">
          <p className={`sm:col-span-2 ${TITLE}`}>Proxy for {editProxy.name} (leave the host empty to turn it off)</p>
          {['host', 'port', 'username', 'password'].map((k) => (
            <input key={k} className={INPUT} data-testid={`wa-admin-iproxy-${k}`} autoComplete="off"
              placeholder={k === 'password' ? (editProxy.has_password ? 'password (saved — empty keeps it)' : 'password') : k}
              type={k === 'password' ? 'password' : 'text'} value={editProxy[k]}
              onChange={(e) => setEditProxy({ ...editProxy, [k]: e.target.value })} />
          ))}
          {iproxyError && <p className="sm:col-span-2 text-xs text-red-500" data-testid="wa-admin-iproxy-error">{iproxyError}</p>}
          <select className={INPUT} data-testid="wa-admin-iproxy-protocol" value={editProxy.protocol}
            onChange={(e) => setEditProxy({ ...editProxy, protocol: e.target.value })}>
            {PROTOCOLS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <div className="flex gap-2">
            <button type="button" className={BTN_PRIMARY} disabled={busy || !!iproxyError} data-testid="wa-admin-iproxy-save"
              onClick={saveInstanceProxy}>Save</button>
            <button type="button" className={BTN} data-testid="wa-admin-iproxy-cancel" onClick={() => setEditProxy(null)}>Cancel</button>
          </div>
        </div>
      )}

      {/* Company number */}
      <div className={`${CARD} space-y-2`}>
        <p className={TITLE}>Company number</p>
        <p className={MUTED} data-testid="wa-admin-company-status">
          {company && company.state !== 'unlinked'
            ? `${formatPhone(company.phone_e164) || company.instance_name} — ${STATE_LABEL[company.state] || company.state}.`
            : 'Not linked yet.'}
          {' '}It sends for every record whose owner has no connected number. If the number that was linked before
          this upgrade is still connected, linking adopts it without a new QR.
        </p>
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-[var(--text-primary)]">{NOTICE}</div>
        <label className="flex items-center gap-2 text-xs text-[var(--text-primary)]">
          <input type="checkbox" data-testid="wa-admin-accept" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
          I understand.
        </label>
        <button type="button" className={BTN_PRIMARY} data-testid="wa-admin-link-company" disabled={!accepted || busy} onClick={linkCompany}>
          {company && company.state !== 'unlinked' ? 'Link / show QR for the company number' : 'Link company number'}
        </button>
        {companyQr && (
          <div className="text-center space-y-1">
            <img data-testid="wa-admin-company-qr" src={companyQr} alt="Company WhatsApp QR code" className="mx-auto w-56 h-56 bg-white p-2 rounded-xl" />
            <p className={MUTED}>Scan with the company phone: WhatsApp → Linked devices → Link a device. This page checks every 20 seconds.</p>
            <button type="button" className={BTN} data-testid="wa-admin-company-qr-close" onClick={() => setCompanyQr('')}>Hide QR</button>
          </div>
        )}
      </div>

      {/* Limits, business hours, keywords, fallback, rollout switches */}
      <div className={`${CARD} space-y-3`}>
        <p className={TITLE}>Sending rules (every number)</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {FIELDS.map(([k, label]) => (
            <label key={k} className={`${MUTED} space-y-1`}>
              <span>{label} <span className="opacity-70">({INT_RANGES[k][0]}–{INT_RANGES[k][1]})</span></span>
              <input className={INPUT} data-testid={`wa-admin-set-${k}`} type="number" min={INT_RANGES[k][0]} max={INT_RANGES[k][1]}
                value={form[k] ?? ''} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
            </label>
          ))}
          {[['business_start', 'Automations start (IST)'], ['business_end', 'Automations stop (IST)']].map(([k, label]) => (
            <label key={k} className={`${MUTED} space-y-1`}>
              <span>{label}</span>
              <input className={INPUT} data-testid={`wa-admin-set-${k}`} type="time" value={form[k] ?? ''}
                onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
            </label>
          ))}
        </div>
        <label className={`block ${MUTED} space-y-1`}>
          <span>Opt-out words (comma separated) — a reply with one of these stops automated messages</span>
          <input className={INPUT} data-testid="wa-admin-set-keywords" value={keywords} onChange={(e) => setKeywords(e.target.value)} />
        </label>
        <label className={`block ${MUTED} space-y-1`}>
          <span>If no WhatsApp number can send</span>
          <select className={INPUT} data-testid="wa-admin-set-fallback" value={form.fallback_provider}
            onChange={(e) => setForm({ ...form, fallback_provider: e.target.value })}>
            <option value="none">Do not send (recommended)</option>
            <option value="autosender">Use MessageAutoSender (emergency — needs its login below)</option>
          </select>
        </label>
        {[['drip_wa_enabled', 'Send WhatsApp drip steps (off = held, not skipped)'],
          ['greetings_enabled', 'Send greeting WhatsApps (festival / birthday)']].map(([k, label]) => (
          <label key={k} className="flex items-center gap-2 text-xs text-[var(--text-primary)]">
            <input type="checkbox" data-testid={`wa-admin-set-${k}`} checked={!!form[k]}
              onChange={(e) => setForm({ ...form, [k]: e.target.checked })} />
            {label}
          </label>
        ))}
        {invalid && <p className="text-xs text-red-500" data-testid="wa-admin-settings-error">{invalid}</p>}
        <button type="button" className={BTN_PRIMARY} data-testid="wa-admin-save-settings" disabled={busy || !!invalid}
          onClick={saveSettings}>Save sending rules</button>
      </div>

      {/* Default proxy for newly linked numbers */}
      <div className={`${CARD} grid grid-cols-1 sm:grid-cols-2 gap-2`}>
        <p className={`sm:col-span-2 ${TITLE}`}>Default proxy for newly linked numbers</p>
        <p className={`sm:col-span-2 ${MUTED}`} data-testid="wa-admin-dproxy-status">
          {dproxyConfigured
            ? `Saved: ${dproxy.protocol || 'socks5'}://${dproxy.host}${dproxy.port ? `:${dproxy.port}` : ''}`
              + `${dproxy.has_password ? ' (password saved)' : ''} — ${dproxy.enabled ? 'on' : 'off'}. `
              + 'Numbers already linked keep their own proxy (Proxy button above).'
            : 'No default proxy — new numbers connect straight from the server.'}
        </p>
        {['host', 'port', 'username', 'password'].map((k) => (
          <input key={k} className={INPUT} data-testid={`wa-admin-dproxy-${k}`} autoComplete="off"
            placeholder={k === 'password' ? (dproxy.has_password ? 'password (saved — empty keeps it)' : 'password') : k}
            type={k === 'password' ? 'password' : 'text'} value={dproxy[k] ?? ''}
            onChange={(e) => setDproxy({ ...dproxy, [k]: e.target.value })} />
        ))}
        <select className={INPUT} data-testid="wa-admin-dproxy-protocol" value={dproxy.protocol || 'socks5'}
          onChange={(e) => setDproxy({ ...dproxy, protocol: e.target.value })}>
          {PROTOCOLS.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <label className="flex items-center gap-2 text-xs text-[var(--text-primary)]">
          <input type="checkbox" data-testid="wa-admin-dproxy-enabled" checked={!!dproxy.enabled}
            onChange={(e) => setDproxy({ ...dproxy, enabled: e.target.checked })} />
          Use it for newly linked numbers
        </label>
        {dproxyError && <p className="sm:col-span-2 text-xs text-red-500" data-testid="wa-admin-dproxy-error">{dproxyError}</p>}
        <div className="sm:col-span-2">
          <button type="button" className={BTN_PRIMARY} data-testid="wa-admin-dproxy-save" disabled={busy || !!dproxyError}
            onClick={saveDefaultProxy}>Save default proxy</button>
        </div>
      </div>
    </div>
  );
}

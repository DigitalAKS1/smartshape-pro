import React, { useState, useEffect } from 'react';
import {
  CheckCircle2, Loader2, Lock, Unlock, RefreshCw, Trash2,
  Database, UserX, AlertTriangle, Clock, Bell, Shield, Globe,
} from 'lucide-react';
import { toast } from 'sonner';
import { adminApi } from '../../lib/api';

const CACHE_CATS = [
  { key: 'expired_lockouts',     icon: Lock,      label: 'Expired login lockouts',    desc: 'Login attempt records whose 15-min lockout window has already passed' },
  { key: 'old_greeting_logs',    icon: Bell,      label: 'Old greeting logs',          desc: 'Greeting send records older than 90 days' },
  { key: 'old_drip_enrollments', icon: RefreshCw, label: 'Old drip enrollments',       desc: 'Completed or cancelled drip records older than 60 days' },
  { key: 'old_geofence_alerts',  icon: Shield,    label: 'Old geofence alerts',        desc: 'Location alert logs older than 30 days' },
  { key: 'old_field_journeys',   icon: Globe,     label: 'Old field journey records',  desc: 'Completed field journeys older than 60 days' },
];

/**
 * Security tab — login lockout manager + system cache cleanup.
 * Self-contained with its own state.
 */
export default function SecurityTab() {
  const [lockouts,        setLockouts]        = useState([]);
  const [loadingLockouts, setLoadingLockouts] = useState(false);
  const [revokingEmail,   setRevokingEmail]   = useState(null);
  const [clearing,        setClearing]        = useState(false);
  const [clearResult,     setClearResult]     = useState(null);
  const [selectedCats,    setSelectedCats]    = useState(new Set());

  async function fetchLockouts() {
    setLoadingLockouts(true);
    try {
      const res = await adminApi.getLockouts();
      setLockouts(res.data || []);
    } catch { toast.error('Failed to load lockouts'); }
    finally { setLoadingLockouts(false); }
  }

  async function revoke(email) {
    setRevokingEmail(email);
    try {
      await adminApi.revokeLockout(email);
      setLockouts(prev => prev.filter(l => l.email !== email));
      toast.success(`Unlocked — ${email} can log in immediately`);
    } catch { toast.error('Failed to unlock account'); }
    finally { setRevokingEmail(null); }
  }

  async function revokeAll() {
    setLoadingLockouts(true);
    try {
      await Promise.all(lockouts.map(l => adminApi.revokeLockout(l.email)));
      setLockouts([]);
      toast.success('All accounts unlocked');
    } catch { toast.error('Some accounts could not be unlocked'); }
    finally { setLoadingLockouts(false); }
  }

  function toggleCat(key) {
    setSelectedCats(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  async function runCacheClear() {
    if (selectedCats.size === 0) { toast.error('Select at least one category to clean'); return; }
    setClearing(true);
    setClearResult(null);
    try {
      const res = await adminApi.clearCache([...selectedCats]);
      const c   = res.data?.cleared || {};
      setClearResult(c);
      const total = Object.values(c).reduce((s, v) => s + v, 0);
      toast.success(`Done — ${total} record${total !== 1 ? 's' : ''} removed`);
      setSelectedCats(new Set());
    } catch { toast.error('Cache clear failed'); }
    finally { setClearing(false); }
  }

  useEffect(() => { fetchLockouts(); }, []);

  return (
    <div className="space-y-6">
      {/* Lockout Manager */}
      <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-[var(--border-color)] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-red-500/10 flex items-center justify-center">
              <Lock className="h-4 w-4 text-red-500" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">Login Lockouts</h2>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">Accounts locked after 5 failed attempts · 15-minute auto-release</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {lockouts.length > 1 && (
              <button onClick={revokeAll} disabled={loadingLockouts}
                className="h-8 px-3 rounded-lg text-xs font-medium bg-red-500/10 text-red-500 hover:bg-red-500/20 transition-colors flex items-center gap-1.5">
                <Unlock className="h-3.5 w-3.5" /> Unlock All
              </button>
            )}
            <button onClick={fetchLockouts} disabled={loadingLockouts}
              className="h-8 w-8 rounded-lg border border-[var(--border-color)] hover:bg-[var(--bg-hover)] flex items-center justify-center transition-colors">
              <RefreshCw className={`h-3.5 w-3.5 text-[var(--text-muted)] ${loadingLockouts ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
        <div className="px-6 py-4">
          {loadingLockouts ? (
            <div className="flex items-center gap-2 py-4 text-sm text-[var(--text-muted)]">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : lockouts.length === 0 ? (
            <div className="flex items-center gap-3 py-5 text-sm text-[var(--text-secondary)]">
              <CheckCircle2 className="h-5 w-5 text-green-500 flex-shrink-0" />
              No accounts currently locked — all users can log in freely
            </div>
          ) : (
            <div className="space-y-2">
              {lockouts.map(l => (
                <div key={l.identifier} className="flex items-center gap-4 p-3.5 rounded-xl border border-red-500/20 bg-red-500/5">
                  <div className="w-9 h-9 rounded-full bg-red-500/15 flex items-center justify-center flex-shrink-0">
                    <UserX className="h-4 w-4 text-red-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-[var(--text-primary)] truncate">{l.email}</p>
                    <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                      <span className="text-xs text-[var(--text-muted)] flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3 text-red-400" />
                        {l.attempts} failed attempt{l.attempts !== 1 ? 's' : ''}
                      </span>
                      <span className="text-xs text-[var(--text-muted)] flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        Unlocks in {l.mins_left} min{l.mins_left !== 1 ? 's' : ''}
                      </span>
                      <span className="text-[10px] text-[var(--text-muted)] font-mono">{l.ip}</span>
                    </div>
                  </div>
                  <button onClick={() => revoke(l.email)} disabled={revokingEmail === l.email}
                    className="h-8 px-4 rounded-lg text-xs font-semibold bg-[var(--accent)] hover:bg-[var(--accent)]/90 text-white transition-colors flex items-center gap-1.5 flex-shrink-0 disabled:opacity-60">
                    {revokingEmail === l.email ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Unlock className="h-3.5 w-3.5" />}
                    {revokingEmail === l.email ? 'Unlocking…' : 'Unlock Now'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Cache Cleanup */}
      <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-[var(--border-color)] flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-blue-500/10 flex items-center justify-center">
            <Database className="h-4 w-4 text-blue-500" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">System Cache Cleanup</h2>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">Remove stale records to keep the database lean and fast</p>
          </div>
        </div>
        <div className="px-6 py-5 space-y-4">
          <p className="text-xs text-[var(--text-muted)]">Select what you want to remove, then click Clean Selected.</p>
          <div className="space-y-2">
            {CACHE_CATS.map(({ key, icon: Icon, label, desc }) => {
              const selected = selectedCats.has(key);
              const result   = clearResult?.[key];
              return (
                <button key={key} type="button" onClick={() => toggleCat(key)}
                  className={`w-full flex items-center gap-3 p-3.5 rounded-xl border-2 text-left transition-all ${
                    selected
                      ? 'border-[var(--accent)] bg-[var(--accent)]/5'
                      : 'border-[var(--border-color)] hover:border-[var(--accent)]/40 bg-[var(--bg-primary)]'
                  }`}>
                  <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                    selected ? 'border-[var(--accent)] bg-[var(--accent)]' : 'border-[var(--text-muted)]'
                  }`}>
                    {selected && <CheckCircle2 className="h-3 w-3 text-white" />}
                  </div>
                  <Icon className={`h-4 w-4 flex-shrink-0 ${selected ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'}`} />
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium ${selected ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}>{label}</p>
                    <p className="text-[11px] text-[var(--text-muted)] mt-0.5">{desc}</p>
                  </div>
                  {result != null && (
                    <span className="text-[11px] font-semibold text-green-600 flex-shrink-0 bg-green-500/10 px-2 py-0.5 rounded-full">
                      {result} removed
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-3 pt-1">
            <button onClick={runCacheClear} disabled={clearing || selectedCats.size === 0}
              className="h-9 px-5 rounded-lg text-sm font-semibold bg-[var(--accent)] hover:bg-[var(--accent)]/90 text-white transition-colors flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed">
              {clearing
                ? <><Loader2 className="h-4 w-4 animate-spin" /> Cleaning…</>
                : <><Trash2 className="h-4 w-4" /> Clean Selected {selectedCats.size > 0 ? `(${selectedCats.size})` : ''}</>}
            </button>
            {selectedCats.size > 0 && !clearing && (
              <button onClick={() => setSelectedCats(new Set())} className="text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors">
                Clear selection
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

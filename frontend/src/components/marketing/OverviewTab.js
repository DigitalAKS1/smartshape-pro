import React, { useState } from 'react';
import {
  Send, Megaphone, Activity, ChevronRight, ChevronDown,
  Cake, Calendar, Gift, Zap, BookOpen, Play, RefreshCw, X,
  Smartphone as PhoneIcon,
} from 'lucide-react';
import { Button } from '../ui/button';

export default function OverviewTab({ tk, campaigns, greetings, drips, waConnected, setTab, analytics, loadDemo, clearDemo }) {
  const [demoLoading, setDemoLoading]   = useState(false);
  const [clearLoading, setClearLoading] = useState(false);
  const [demoOpen, setDemoOpen]         = useState(false);
  const hasDemo = campaigns.some(c => c.name?.includes('[DEMO]'));

  async function handleLoadDemo()  { setDemoLoading(true);  try { await loadDemo();  } finally { setDemoLoading(false);  } }
  async function handleClearDemo() { setClearLoading(true); try { await clearDemo(); } finally { setClearLoading(false); } }

  const msgSent      = analytics?.messages?.sent    ?? campaigns.filter(c => c.status === 'completed').reduce((s, c) => s + c.stats.sent, 0);
  const msgPending   = analytics?.messages?.pending ?? 0;
  const dripActive   = analytics?.drips?.active     ?? drips.filter(d => d.active).length;
  const greetSent    = analytics?.greetings?.total_sent ?? 0;
  const activeGreets = greetings.filter(g => g.active).length;
  const completedCamps = campaigns.filter(c => c.status === 'completed').length;

  const STATUS_DOT = {
    completed: 'bg-emerald-500',
    scheduled: 'bg-blue-500',
    running:   'bg-yellow-500 animate-pulse',
    queued:    'bg-indigo-500',
    draft:     'bg-gray-400',
  };
  const STATUS_PILL = {
    completed: 'bg-emerald-500/10 text-emerald-600',
    scheduled: 'bg-blue-500/10 text-blue-600',
    running:   'bg-yellow-500/10 text-yellow-600',
    queued:    'bg-indigo-500/10 text-indigo-600',
    draft:     'bg-gray-500/10 text-gray-500',
  };

  return (
    <div className="space-y-4">

      {/* ── 1. Three hero metric cards ─────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">

        {/* Messages Sent */}
        <div className={`${tk.card} border ${tk.bdr} rounded-2xl p-5 relative overflow-hidden`}>
          <div className="absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r from-blue-500 to-indigo-500 rounded-t-2xl" />
          <div className="flex items-center justify-between mb-4">
            <div className="w-9 h-9 rounded-xl bg-blue-500/10 flex items-center justify-center">
              <Send className="h-[18px] w-[18px] text-blue-500" />
            </div>
            {msgPending > 0 && (
              <span className="flex items-center gap-1 text-[10px] font-semibold text-orange-500 bg-orange-500/10 px-2 py-0.5 rounded-full">
                <span className="w-1 h-1 rounded-full bg-orange-400 animate-pulse" />
                {msgPending} pending
              </span>
            )}
          </div>
          <p className={`text-3xl font-black ${tk.t1} leading-none tracking-tight`}>
            {msgSent ? msgSent.toLocaleString('en-IN') : '0'}
          </p>
          <p className={`text-xs ${tk.tm} mt-2`}>Total messages sent</p>
        </div>

        {/* Campaigns */}
        <div className={`${tk.card} border ${tk.bdr} rounded-2xl p-5 relative overflow-hidden`}>
          <div className="absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r from-purple-500 to-pink-500 rounded-t-2xl" />
          <div className="flex items-center justify-between mb-4">
            <div className="w-9 h-9 rounded-xl bg-purple-500/10 flex items-center justify-center">
              <Megaphone className="h-[18px] w-[18px] text-purple-500" />
            </div>
            {completedCamps > 0 && (
              <span className="text-[10px] font-semibold text-emerald-600 bg-emerald-500/10 px-2 py-0.5 rounded-full">
                {completedCamps} done
              </span>
            )}
          </div>
          <p className={`text-3xl font-black ${tk.t1} leading-none tracking-tight`}>{campaigns.length}</p>
          <p className={`text-xs ${tk.tm} mt-2`}>Total campaigns</p>
        </div>

        {/* Automation Health */}
        <div className={`${tk.card} border ${tk.bdr} rounded-2xl p-5 relative overflow-hidden`}>
          <div className="absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r from-amber-400 to-pink-500 rounded-t-2xl" />
          <div className="flex items-center justify-between mb-4">
            <div className="w-9 h-9 rounded-xl bg-amber-500/10 flex items-center justify-center">
              <Activity className="h-[18px] w-[18px] text-amber-500" />
            </div>
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${(dripActive + activeGreets) > 0 ? 'bg-emerald-500/10 text-emerald-600' : `${tk.tm} bg-[var(--bg-hover)]`}`}>
              {(dripActive + activeGreets) > 0 ? 'Running' : 'Idle'}
            </span>
          </div>
          <p className={`text-3xl font-black ${tk.t1} leading-none tracking-tight`}>{dripActive + activeGreets}</p>
          <p className={`text-xs ${tk.tm} mt-2`}>{activeGreets} greetings · {dripActive} drip sequences</p>
        </div>
      </div>

      {/* ── 2. WhatsApp connection banner ──────────────────────────────────── */}
      {!waConnected ? (
        <div className="relative rounded-2xl overflow-hidden border border-yellow-500/20">
          <div className="absolute inset-0 bg-gradient-to-r from-yellow-500/8 via-orange-500/5 to-transparent pointer-events-none" />
          <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-yellow-400 to-orange-500" />
          <div className="flex items-center gap-4 pl-5 pr-4 py-4">
            <div className="w-10 h-10 rounded-xl bg-yellow-500/15 flex items-center justify-center flex-shrink-0">
              <PhoneIcon className="h-5 w-5 text-yellow-500" />
            </div>
            <div className="flex-1 min-w-0">
              <p className={`text-sm font-bold ${tk.t1}`}>WhatsApp Business not connected</p>
              <p className={`text-xs ${tk.tm} mt-0.5`}>Connect to send campaigns, auto-greetings and drip messages directly to schools</p>
            </div>
            <Button size="sm"
              className="bg-yellow-500 hover:bg-yellow-400 text-white font-bold h-9 px-5 flex-shrink-0 text-xs rounded-xl"
              onClick={() => setTab('setup')}>
              Connect Now →
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2.5 px-4 py-2.5 rounded-xl border border-emerald-500/20 bg-emerald-500/5">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse flex-shrink-0" />
          <span className="text-xs font-semibold text-emerald-600">WhatsApp Business connected</span>
          <span className={`text-xs ${tk.tm}`}>— campaigns, drips and greetings are live</span>
        </div>
      )}

      {/* ── 3. Main 2/3 + 1/3 content grid ────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* Left 2/3 — Recent Campaigns */}
        <div className={`lg:col-span-2 ${tk.card} border ${tk.bdr} rounded-2xl overflow-hidden`}>
          <div className={`flex items-center justify-between px-4 py-3.5 border-b ${tk.bdr}`}>
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-purple-500/10 flex items-center justify-center">
                <Megaphone className="h-3.5 w-3.5 text-purple-500" />
              </div>
              <span className={`text-sm font-bold ${tk.t1}`}>Recent Campaigns</span>
              {campaigns.length > 0 && (
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full bg-[var(--bg-hover)] ${tk.tm}`}>
                  {campaigns.length}
                </span>
              )}
            </div>
            <button onClick={() => setTab('campaigns')}
              className="text-[11px] text-[var(--accent)] hover:text-[var(--accent)]/80 flex items-center gap-0.5 font-semibold transition-colors">
              View all <ChevronRight className="h-3 w-3" />
            </button>
          </div>

          {campaigns.length === 0 ? (
            <div className="py-12 flex flex-col items-center text-center px-8">
              <div className="w-14 h-14 rounded-2xl bg-purple-500/10 flex items-center justify-center mb-3">
                <Megaphone className="h-6 w-6 text-purple-400" />
              </div>
              <p className={`text-sm font-semibold ${tk.t1} mb-1`}>No campaigns yet</p>
              <p className={`text-xs ${tk.tm} mb-5 max-w-[280px] leading-relaxed`}>
                Reach all your school contacts with one WhatsApp or email blast
              </p>
              <button onClick={() => setTab('campaigns')}
                className="text-xs px-5 py-2 rounded-xl bg-[var(--accent)] text-white font-bold hover:bg-[var(--accent)]/90 transition-colors">
                + Create First Campaign
              </button>
            </div>
          ) : (
            <div className="divide-y divide-[var(--border-color)]/50">
              {campaigns.slice(0, 5).map(c => (
                <div key={c.id} className={`px-4 py-3.5 flex items-center gap-3 ${tk.hov} transition-colors`}>
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${STATUS_DOT[c.status] || 'bg-gray-400'}`} />
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-semibold ${tk.t1} truncate leading-snug`}>{c.name}</p>
                    <p className={`text-[11px] ${tk.tm} mt-0.5`}>
                      {c.audience_count} contacts · {c.created_at}
                    </p>
                  </div>
                  <div className="flex items-center gap-2.5 flex-shrink-0">
                    {c.stats.sent > 0 && (
                      <div className="text-right">
                        <p className={`text-sm font-bold ${tk.t1} leading-none`}>{c.stats.sent.toLocaleString('en-IN')}</p>
                        <p className={`text-[10px] ${tk.tm}`}>sent</p>
                      </div>
                    )}
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-lg ${STATUS_PILL[c.status] || STATUS_PILL.draft}`}>
                      {c.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right 1/3 — Quick Actions + Drips */}
        <div className="flex flex-col gap-3">

          {/* Quick actions */}
          <div className={`${tk.card} border ${tk.bdr} rounded-2xl overflow-hidden`}>
            <div className={`px-4 py-3 border-b ${tk.bdr}`}>
              <p className={`text-[10px] font-bold uppercase tracking-widest ${tk.tm}`}>Quick Actions</p>
            </div>
            <div className="p-2 space-y-1">
              {[
                { icon: Megaphone, label: 'New Campaign',    hint: 'WhatsApp or Email blast',    tab: 'campaigns', primary: true  },
                { icon: BookOpen,  label: 'Browse Templates',hint: '15 expert messages',          tab: 'templates', primary: false },
                { icon: Gift,      label: 'Auto Greetings',  hint: `${activeGreets} active rules`, tab: 'greetings', primary: false },
                { icon: Zap,       label: 'Drip Sequences',  hint: `${dripActive} running`,       tab: 'drips',     primary: false },
              ].map(a => {
                const AIcon = a.icon;
                return (
                  <button key={a.tab} onClick={() => setTab(a.tab)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all ${
                      a.primary
                        ? 'bg-[var(--accent)] hover:bg-[var(--accent)]/90 text-white'
                        : `${tk.hov} group`
                    }`}>
                    <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${a.primary ? 'bg-white/20' : 'bg-[var(--bg-hover)]'}`}>
                      <AIcon className={`h-3.5 w-3.5 ${a.primary ? 'text-white' : tk.tm}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-xs font-semibold leading-none ${a.primary ? 'text-white' : tk.t1}`}>{a.label}</p>
                      <p className={`text-[10px] mt-0.5 ${a.primary ? 'text-white/70' : tk.tm}`}>{a.hint}</p>
                    </div>
                    <ChevronRight className={`h-3.5 w-3.5 flex-shrink-0 ${a.primary ? 'text-white/60' : tk.tm}`} />
                  </button>
                );
              })}
            </div>
          </div>

          {/* Active Drips mini-card (only if any) */}
          {drips.filter(d => d.active).length > 0 && (
            <div className={`${tk.card} border ${tk.bdr} rounded-2xl p-4`}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse" />
                  <p className={`text-xs font-bold ${tk.t1}`}>Active Drips</p>
                </div>
                <button onClick={() => setTab('drips')} className="text-[10px] text-[var(--accent)] font-semibold hover:underline">
                  Manage →
                </button>
              </div>
              <div className="space-y-3">
                {drips.filter(d => d.active).slice(0, 3).map(d => {
                  const pctDone = d.enrolled > 0 ? Math.min(Math.round((d.completed / d.enrolled) * 100), 100) : 0;
                  return (
                    <div key={d.id}>
                      <div className="flex items-center justify-between mb-1.5">
                        <p className={`text-[11px] font-semibold ${tk.t1} truncate pr-2`}>{d.name}</p>
                        <span className={`text-[10px] ${tk.tm} flex-shrink-0`}>{d.enrolled} enrolled</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-[var(--bg-hover)] overflow-hidden">
                        <div className="h-full rounded-full bg-gradient-to-r from-yellow-400 to-amber-500 transition-all"
                          style={{ width: `${pctDone}%` }} />
                      </div>
                      <p className={`text-[10px] ${tk.tm} mt-1`}>{pctDone}% completed</p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Greeting rules mini-card */}
          {activeGreets > 0 && (
            <div className={`${tk.card} border ${tk.bdr} rounded-2xl p-4`}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-pink-400" />
                  <p className={`text-xs font-bold ${tk.t1}`}>Greeting Rules</p>
                </div>
                <button onClick={() => setTab('greetings')} className="text-[10px] text-[var(--accent)] font-semibold hover:underline">
                  Manage →
                </button>
              </div>
              <div className="space-y-2">
                {greetings.filter(g => g.active).slice(0, 3).map(g => (
                  <div key={g.id} className="flex items-center gap-2">
                    <div className={`w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0 ${g.type === 'birthday' ? 'bg-pink-500/10' : 'bg-amber-500/10'}`}>
                      {g.type === 'birthday'
                        ? <Cake className="h-3 w-3 text-pink-500" />
                        : <Calendar className="h-3 w-3 text-amber-500" />}
                    </div>
                    <p className={`text-[11px] ${tk.t2} truncate`}>{g.name}</p>
                  </div>
                ))}
                {activeGreets > 3 && (
                  <p className={`text-[10px] ${tk.tm} pl-8`}>+{activeGreets - 3} more active</p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── 4. Demo section — collapsed at bottom ──────────────────────────── */}
      <div className={`border border-dashed ${tk.bdr} rounded-xl overflow-hidden`}>
        <div className="flex items-center gap-3 px-4 py-2.5 cursor-pointer select-none"
          onClick={() => setDemoOpen(p => !p)}>
          <Zap className={`h-3.5 w-3.5 text-[var(--accent)] flex-shrink-0`} />
          <p className={`text-xs font-semibold ${tk.t2} flex-1`}>
            Try the Demo — load sample data to explore all features
          </p>
          <div className="flex items-center gap-2 flex-shrink-0" onClick={e => e.stopPropagation()}>
            {hasDemo && (
              <Button size="sm" variant="outline"
                className="h-6 px-2 gap-1 text-[10px] border-red-400/40 text-red-400 hover:bg-red-400/10"
                disabled={clearLoading} onClick={handleClearDemo}>
                {clearLoading ? <RefreshCw className="h-2.5 w-2.5 animate-spin" /> : <X className="h-2.5 w-2.5" />}
                Clear
              </Button>
            )}
            <Button size="sm"
              className="h-6 px-2.5 gap-1 text-[10px] bg-[var(--accent)] hover:bg-[var(--accent)]/90 text-white"
              disabled={demoLoading} onClick={handleLoadDemo}>
              {demoLoading ? <RefreshCw className="h-2.5 w-2.5 animate-spin" /> : <Play className="h-2.5 w-2.5" />}
              {hasDemo ? 'Re-seed' : 'Load Demo'}
            </Button>
            <ChevronDown className={`h-3.5 w-3.5 ${tk.tm} transition-transform ${demoOpen ? 'rotate-180' : ''}`} />
          </div>
        </div>
        {demoOpen && (
          <div className={`border-t ${tk.bdr} px-4 pb-4 pt-3 bg-[var(--bg-hover)]`}>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 mb-3">
              {[
                { n: '1', label: '5 school contacts', detail: 'Ramesh, Priya, Rajesh, Anita, Suresh', col: 'text-blue-500', bg: 'bg-blue-500/10' },
                { n: '2', label: '3 campaigns', detail: 'Completed · Queued · Draft', col: 'text-purple-500', bg: 'bg-purple-500/10' },
                { n: '3', label: 'Drip flow', detail: 'Day 0, 3, 7 steps seeded', col: 'text-yellow-600', bg: 'bg-yellow-500/10' },
                { n: '4', label: 'Greeting logs', detail: "Teacher's Day + New Year sent", col: 'text-pink-500', bg: 'bg-pink-500/10' },
              ].map(s => (
                <div key={s.n} className={`${s.bg} rounded-xl p-3`}>
                  <p className={`text-[10px] font-bold ${s.col} mb-0.5`}>{s.label}</p>
                  <p className={`text-[10px] ${tk.tm} leading-relaxed`}>{s.detail}</p>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              {[
                { label: 'Campaigns →', tab: 'campaigns' },
                { label: 'Analytics →', tab: 'analytics' },
                { label: 'Templates →', tab: 'templates' },
                { label: 'Greetings →', tab: 'greetings' },
              ].map(l => (
                <button key={l.tab} onClick={() => setTab(l.tab)}
                  className={`text-[11px] px-2.5 py-1.5 rounded-lg border ${tk.bdr} ${tk.hov} ${tk.t2} transition-colors`}>
                  {l.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

    </div>
  );
}

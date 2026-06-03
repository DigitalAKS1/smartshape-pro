import React from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import {
  Save, Eye, EyeOff, Check, Sparkles, PhoneCall, PhoneOff,
  ToggleLeft, ToggleRight, AlertTriangle,
} from 'lucide-react';

/**
 * AISection — Gemini API key + AI Dialler configuration (the 'ai' tab).
 */
export default function AISection({
  aiKey, setAiKey, aiKeySet, aiKeyMasked,
  aiSaving, showAiKey, setShowAiKey, saveAiKey,
  dialler, setDialler, diallerSaving, showVapiKey, setShowVapiKey, saveDialler,
}) {
  const card      = 'bg-[var(--bg-card)] border-[var(--border-color)]';
  const inputCls  = 'bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]';
  const textPri   = 'text-[var(--text-primary)]';
  const textSec   = 'text-[var(--text-secondary)]';
  const textMuted = 'text-[var(--text-muted)]';

  return (
    <div className="space-y-5">
      {/* Gemini Card Scanner */}
      <div className={`${card} border rounded-xl p-5`}>
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-purple-500/15 flex items-center justify-center">
            <Sparkles className="h-5 w-5 text-purple-400" />
          </div>
          <div>
            <h2 className={`text-lg font-semibold ${textPri}`}>Gemini AI — Business Card Scanner</h2>
            <p className={`text-xs ${textMuted}`}>Powers the "Scan Card" feature in the Sales app</p>
          </div>
        </div>

        {aiKeySet && (
          <div className="flex items-center gap-2 mb-4 px-3 py-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/25">
            <Check className="h-4 w-4 text-emerald-400 flex-shrink-0" />
            <div>
              <p className="text-sm font-semibold text-emerald-400">API key configured</p>
              <p className={`text-xs ${textMuted} font-mono`}>{aiKeyMasked}</p>
            </div>
          </div>
        )}

        <div className="space-y-4">
          <div>
            <Label className={`text-xs font-semibold ${textMuted} uppercase tracking-wide mb-1.5 block`}>
              Gemini API Key {aiKeySet ? '(enter new key to replace)' : '*'}
            </Label>
            <div className="relative">
              <Input
                type={showAiKey ? 'text' : 'password'}
                value={aiKey}
                onChange={e => setAiKey(e.target.value)}
                placeholder="AIza…"
                className={`pr-10 bg-[var(--bg-primary)] border-[var(--border-color)] ${textPri} font-mono`}
              />
              <button type="button" onClick={() => setShowAiKey(v => !v)} className={`absolute right-3 top-1/2 -translate-y-1/2 ${textMuted}`}>
                {showAiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <p className={`text-xs ${textMuted} mt-1.5`}>
              Get your free key at{' '}
              <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer" className="text-purple-400 underline">
                aistudio.google.com/app/apikey
              </a>
              {' '}— free tier is enough for card scanning.
            </p>
          </div>

          <Button onClick={saveAiKey} disabled={aiSaving || !aiKey.trim()} className="bg-purple-600 hover:bg-purple-700 text-white font-semibold disabled:opacity-50">
            <Save className="mr-2 h-4 w-4" />
            {aiSaving ? 'Saving…' : 'Save API Key'}
          </Button>
        </div>
      </div>

      {/* How Gemini works */}
      <div className={`${card} border rounded-xl p-5`}>
        <h3 className={`text-sm font-semibold ${textPri} mb-3`}>How it works</h3>
        <ul className={`space-y-2 text-xs ${textSec}`}>
          <li className="flex items-start gap-2"><span className="text-purple-400 font-bold mt-0.5">1.</span>Sales rep taps "Scan Card" in the Visits screen and takes a photo of a business card.</li>
          <li className="flex items-start gap-2"><span className="text-purple-400 font-bold mt-0.5">2.</span>The image is sent to Gemini 1.5 Flash which reads the name, phone, email, school and role.</li>
          <li className="flex items-start gap-2"><span className="text-purple-400 font-bold mt-0.5">3.</span>The rep reviews the extracted details and taps "Use These Details" — the contact form is pre-filled.</li>
          <li className="flex items-start gap-2"><span className="text-purple-400 font-bold mt-0.5">4.</span>Gemini free tier allows ~1,500 scans/day — more than enough for field sales use.</li>
        </ul>
      </div>

      {/* AI Dialler */}
      <div className={`${card} border rounded-xl overflow-hidden`}>
        {/* Header with master toggle */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-color)]">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${dialler.enabled ? 'bg-[#e94560]/15' : 'bg-[var(--bg-hover)]'}`}>
              <PhoneCall className={`h-5 w-5 ${dialler.enabled ? 'text-[#e94560]' : textMuted}`} />
            </div>
            <div>
              <h2 className={`text-lg font-semibold ${textPri}`}>AI Dialler</h2>
              <p className={`text-xs ${textMuted}`}>Auto-call staff &amp; customers when tasks are overdue</p>
            </div>
          </div>
          <button
            onClick={() => setDialler(d => ({ ...d, enabled: !d.enabled }))}
            className="flex items-center gap-2 transition-all"
            title={dialler.enabled ? 'Disable AI Dialler' : 'Enable AI Dialler'}
          >
            {dialler.enabled
              ? <ToggleRight className="h-8 w-8 text-[#e94560]" />
              : <ToggleLeft className={`h-8 w-8 ${textMuted}`} />}
            <span className={`text-sm font-semibold ${dialler.enabled ? 'text-[#e94560]' : textMuted}`}>
              {dialler.enabled ? 'Enabled' : 'Disabled'}
            </span>
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* Recommendation banner */}
          {!dialler.enabled && (
            <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-amber-500/10 border border-amber-500/20">
              <AlertTriangle className="h-4 w-4 text-amber-400 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-amber-300 leading-relaxed">
                <span className="font-semibold">Recommended for teams of 25+ people.</span> For smaller teams, WhatsApp alerts are sufficient. Enable this when your operation scales.
              </p>
            </div>
          )}

          {/* VAPI Credentials */}
          {dialler.enabled && (
            <div className="space-y-4 p-4 rounded-xl bg-[var(--bg-primary)] border border-[var(--border-color)]">
              <h3 className={`text-sm font-semibold ${textPri}`}>VAPI Credentials</h3>

              {dialler.vapi_key_set && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/25">
                  <Check className="h-4 w-4 text-emerald-400 flex-shrink-0" />
                  <p className="text-xs text-emerald-400 font-mono">Key configured: {dialler.vapi_key_masked}</p>
                </div>
              )}

              <div>
                <Label className={`text-xs font-semibold ${textMuted} uppercase tracking-wide mb-1.5 block`}>
                  VAPI API Key {dialler.vapi_key_set ? '(enter new to replace)' : '*'}
                </Label>
                <div className="relative">
                  <Input type={showVapiKey ? 'text' : 'password'} value={dialler.vapi_api_key}
                    onChange={e => setDialler(d => ({ ...d, vapi_api_key: e.target.value }))}
                    placeholder="vapi_xxxxxxxx" className={`pr-10 bg-[var(--bg-card)] border-[var(--border-color)] ${textPri} font-mono`} />
                  <button type="button" onClick={() => setShowVapiKey(v => !v)} className={`absolute right-3 top-1/2 -translate-y-1/2 ${textMuted}`}>
                    {showVapiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <p className={`text-xs ${textMuted} mt-1`}>Get your key at <span className="text-[#e94560]">vapi.ai</span> · ~₹4/min for AI calls</p>
              </div>

              <div>
                <Label className={`text-xs font-semibold ${textMuted} uppercase tracking-wide mb-1.5 block`}>Caller Phone Number</Label>
                <Input value={dialler.caller_phone}
                  onChange={e => setDialler(d => ({ ...d, caller_phone: e.target.value }))}
                  placeholder="+91 98765 43210" className={`bg-[var(--bg-card)] border-[var(--border-color)] ${textPri}`} />
                <p className={`text-xs ${textMuted} mt-1`}>Your Twilio/Exotel number that makes the outbound calls</p>
              </div>
            </div>
          )}

          {/* Per-module toggles */}
          <div className="space-y-3">
            <h3 className={`text-sm font-semibold ${textPri}`}>Enable Per Module</h3>

            {[
              { key: 'fms',             label: 'FMS — Flow Management',   desc: 'Call stage owner when a flow stage exceeds TAT',        icon: '🔄', color: 'text-blue-400'   },
              { key: 'delegation',      label: 'Delegation Tasks',         desc: 'Call delegatee when an assigned task is overdue',       icon: '👥', color: 'text-purple-400' },
              { key: 'task_management', label: 'Task Management',          desc: 'Call staff when high/medium priority tasks are late',   icon: '✅', color: 'text-green-400'  },
            ].map(({ key, label, desc, icon, color }) => {
              const mod = dialler.modules[key] || {};
              const isOn = mod.enabled && dialler.enabled;
              return (
                <div key={key} className={`rounded-xl border p-4 transition-all ${isOn ? 'border-[#e94560]/30 bg-[#e94560]/[0.03]' : 'border-[var(--border-color)] bg-[var(--bg-primary)]'}`}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2.5">
                      <span className="text-lg leading-none">{icon}</span>
                      <div>
                        <p className={`text-sm font-semibold ${textPri}`}>{label}</p>
                        <p className={`text-[11px] ${textMuted}`}>{desc}</p>
                      </div>
                    </div>
                    <button
                      disabled={!dialler.enabled}
                      onClick={() => setDialler(d => ({ ...d, modules: { ...d.modules, [key]: { ...d.modules[key], enabled: !d.modules[key].enabled } } }))}
                      className={`transition-all ${!dialler.enabled ? 'opacity-30 cursor-not-allowed' : ''}`}>
                      {isOn
                        ? <ToggleRight className="h-7 w-7 text-[#e94560]" />
                        : <ToggleLeft className={`h-7 w-7 ${textMuted}`} />}
                    </button>
                  </div>
                  {isOn && (
                    <div className="grid grid-cols-2 gap-3 mt-3 pt-3 border-t border-[var(--border-color)]">
                      <div>
                        <Label className={`text-[10px] font-semibold ${textMuted} uppercase mb-1 block`}>Call after overdue (mins)</Label>
                        <Input type="number" min={5} value={mod.trigger_minutes || 30}
                          onChange={e => setDialler(d => ({ ...d, modules: { ...d.modules, [key]: { ...d.modules[key], trigger_minutes: parseInt(e.target.value) || 30 } } }))}
                          className={`h-8 text-xs bg-[var(--bg-card)] border-[var(--border-color)] ${textPri}`} />
                      </div>
                      <div>
                        <Label className={`text-[10px] font-semibold ${textMuted} uppercase mb-1 block`}>Escalate after (mins)</Label>
                        <Input type="number" min={30} value={mod.escalation_minutes || 120}
                          onChange={e => setDialler(d => ({ ...d, modules: { ...d.modules, [key]: { ...d.modules[key], escalation_minutes: parseInt(e.target.value) || 120 } } }))}
                          className={`h-8 text-xs bg-[var(--bg-card)] border-[var(--border-color)] ${textPri}`} />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            {/* Customer calls */}
            <div className={`rounded-xl border p-4 transition-all ${dialler.customer_calls?.enabled && dialler.enabled ? 'border-emerald-500/30 bg-emerald-500/[0.03]' : 'border-[var(--border-color)] bg-[var(--bg-primary)]'}`}>
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2.5">
                  <span className="text-lg leading-none">📞</span>
                  <div>
                    <p className={`text-sm font-semibold ${textPri}`}>Customer Calls</p>
                    <p className={`text-[11px] ${textMuted}`}>Call schools for payment follow-up &amp; quotation response</p>
                  </div>
                </div>
                <button
                  disabled={!dialler.enabled}
                  onClick={() => setDialler(d => ({ ...d, customer_calls: { ...d.customer_calls, enabled: !d.customer_calls?.enabled } }))}
                  className={!dialler.enabled ? 'opacity-30 cursor-not-allowed' : ''}>
                  {dialler.customer_calls?.enabled && dialler.enabled
                    ? <ToggleRight className="h-7 w-7 text-emerald-400" />
                    : <ToggleLeft className={`h-7 w-7 ${textMuted}`} />}
                </button>
              </div>
              {dialler.customer_calls?.enabled && dialler.enabled && (
                <div className="grid grid-cols-2 gap-3 mt-3 pt-3 border-t border-[var(--border-color)]">
                  <div>
                    <Label className={`text-[10px] font-semibold ${textMuted} uppercase mb-1 block`}>Payment overdue (days)</Label>
                    <Input type="number" min={1} value={dialler.customer_calls?.payment_overdue_days || 3}
                      onChange={e => setDialler(d => ({ ...d, customer_calls: { ...d.customer_calls, payment_overdue_days: parseInt(e.target.value) || 3 } }))}
                      className={`h-8 text-xs bg-[var(--bg-card)] border-[var(--border-color)] ${textPri}`} />
                  </div>
                  <div>
                    <Label className={`text-[10px] font-semibold ${textMuted} uppercase mb-1 block`}>Quotation follow-up (days)</Label>
                    <Input type="number" min={1} value={dialler.customer_calls?.quotation_followup_days || 2}
                      onChange={e => setDialler(d => ({ ...d, customer_calls: { ...d.customer_calls, quotation_followup_days: parseInt(e.target.value) || 2 } }))}
                      className={`h-8 text-xs bg-[var(--bg-card)] border-[var(--border-color)] ${textPri}`} />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Save */}
          <Button onClick={saveDialler} disabled={diallerSaving} className="bg-[#e94560] hover:bg-[#f05c75] text-white font-semibold disabled:opacity-50">
            <Save className="mr-2 h-4 w-4" />
            {diallerSaving ? 'Saving…' : 'Save Dialler Settings'}
          </Button>
        </div>
      </div>
    </div>
  );
}

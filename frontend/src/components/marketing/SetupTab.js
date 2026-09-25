import React from 'react';
import { Wifi, WifiOff, Target, Users, MessageSquare, FileText, Gift, RefreshCw, Smartphone as PhoneIcon } from 'lucide-react';

// Marketing → WhatsApp. Numbers, limits and business hours live in Settings → WhatsApp now
// (spec 2026-09-24, W1); this tab shows the company number's state and the Blueprint.
export default function SetupTab({ tk, waConnected, openQrDialog }) {
  return (
    <div className="space-y-5">
      {/* Status bar — the company number */}
      <div className={`${tk.card} border ${waConnected ? 'border-green-500/30' : 'border-[var(--border-color)]'} rounded-xl p-4`}>
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${waConnected ? 'bg-green-500/15' : 'bg-[var(--bg-primary)]'}`}>
            {waConnected ? <Wifi className="h-5 w-5 text-green-500" /> : <WifiOff className="h-5 w-5 text-gray-400" />}
          </div>
          <div className="flex-1">
            <p className={`text-sm font-semibold ${tk.t1}`} data-testid="setup-wa-status">
              {waConnected ? 'Company WhatsApp connected' : 'Company WhatsApp not connected'}
            </p>
            <p className={`text-xs ${tk.tm} mt-0.5`}>
              Campaigns go from each contact owner's own number, or the company number when the owner has none.
            </p>
          </div>
        </div>
      </div>

      {/* Numbers are managed in one place now */}
      <div className={`${tk.card} border ${tk.bdr} rounded-xl p-4 flex flex-col sm:flex-row sm:items-center gap-3`}>
        <PhoneIcon className={`h-4 w-4 ${tk.tm} flex-shrink-0`} />
        <p className={`text-sm ${tk.t1} flex-1`}>
          WhatsApp numbers, limits and business hours are managed in Settings → WhatsApp. Each salesperson links their
          company SIM on My WhatsApp.
        </p>
        <button type="button" onClick={openQrDialog} data-testid="setup-open-wa-settings"
          className={`px-3 py-1.5 rounded-lg text-xs font-medium border border-[var(--border-color)] ${tk.t1} ${tk.hov}`}>
          Open Settings → WhatsApp
        </button>
      </div>

      {/* Expert marketing plan summary */}
      <div className={`${tk.card} border ${tk.bdr} rounded-xl p-4`}>
        <div className="flex items-center gap-2 mb-4">
          <Target className={`h-4 w-4 ${tk.tm}`} />
          <h3 className={`text-sm font-semibold ${tk.t1}`}>WhatsApp Marketing Blueprint</h3>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {[
            { stage: '1. Awareness',      action: 'First-touch intro messages to new leads',           icon: Users,       col: 'text-blue-500',   bg: 'bg-blue-500/10',   link: 'Drip Sequences (lead_created)' },
            { stage: '2. Interest',        action: 'Catalogue share + product showcase campaigns',      icon: MessageSquare, col: 'text-purple-500', bg: 'bg-purple-500/10', link: 'Campaigns → Catalogue templates' },
            { stage: '3. Consideration',   action: 'Quotation follow-up sequence (2→5→10→14 days)',    icon: FileText,    col: 'text-orange-500', bg: 'bg-orange-500/10', link: 'Drip Sequences (quotation_sent)' },
            { stage: '4. Decision',        action: 'Bulk order discount + urgency offer',              icon: Target,      col: 'text-green-500',  bg: 'bg-green-500/10',  link: 'Campaigns → Offer templates' },
            { stage: '5. Retention',       action: 'Festival greetings + reorder reminders',           icon: Gift,        col: 'text-pink-500',   bg: 'bg-pink-500/10',   link: 'Greetings + Seasonal campaigns' },
            { stage: '6. Re-engagement',   action: 'Cold lead revival after 30 days of silence',      icon: RefreshCw,   col: 'text-red-400',    bg: 'bg-red-400/10',    link: 'Drip Sequences (manual)' },
          ].map(s => {
            const Icon = s.icon;
            return (
              <div key={s.stage} className={`${s.bg} rounded-xl p-3.5`}>
                <div className="flex items-center gap-2 mb-2">
                  <Icon className={`h-4 w-4 ${s.col}`} />
                  <span className={`text-xs font-bold ${s.col}`}>{s.stage}</span>
                </div>
                <p className={`text-xs ${tk.t2} leading-relaxed mb-1.5`}>{s.action}</p>
                <p className={`text-[10px] ${tk.tm} font-medium`}>→ {s.link}</p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

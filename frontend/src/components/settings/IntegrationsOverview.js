import React from 'react';
import { Mail, MessageSquare, Video, Cloud, Sparkles, FileSpreadsheet, GraduationCap, CheckCircle2, XCircle, ChevronRight } from 'lucide-react';

// Connector cards shown on the Integrations → Overview landing. `key` matches the
// keys returned by GET /settings/integrations/status; `tab` is the section to open.
const CONNECTORS = [
  { tab: 'email',         key: 'gmail',         label: 'Gmail',         icon: Mail,            desc: 'Send emails & catalogue links' },
  { tab: 'whatsapp',      key: 'whatsapp',      label: 'WhatsApp',      icon: MessageSquare,   desc: 'Messaging, templates & broadcasts' },
  { tab: 'zoom',          key: 'zoom',          label: 'Zoom',          icon: Video,           desc: 'Create meetings from the app' },
  { tab: 'cloudinary',    key: 'cloudinary',    label: 'Cloudinary',    icon: Cloud,           desc: 'Image & file uploads (CDN)' },
  { tab: 'ai',            key: 'ai',            label: 'AI (Gemini)',   icon: Sparkles,        desc: 'Card scanning & insights' },
  { tab: 'sheets',        key: 'sheets',        label: 'Google Sheets', icon: FileSpreadsheet, desc: 'Export inventory & quotations' },
  { tab: 'school_portal', key: 'school_portal', label: 'School Portal', icon: GraduationCap,   desc: 'Quoted-school login access' },
];

export default function IntegrationsOverview({ status = {}, onOpen }) {
  const connectedCount = CONNECTORS.filter(c => status?.[c.key]?.configured).length;

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between">
        <div>
          <h2 className="text-xl font-semibold text-[var(--text-primary)]">Integrations</h2>
          <p className="text-sm text-[var(--text-secondary)] mt-0.5">Connect the services SmartShape uses. Click any card to configure.</p>
        </div>
        <span className="text-xs font-medium text-[var(--text-muted)] whitespace-nowrap">
          {connectedCount}/{CONNECTORS.length} connected
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {CONNECTORS.map(({ tab, key, label, icon: Icon, desc }) => {
          const configured = !!status?.[key]?.configured;
          return (
            <button key={tab} type="button" onClick={() => onOpen(tab)}
              className="group text-left bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl p-4 hover:border-[#e94560]/50 hover:bg-[var(--bg-hover)] transition-all">
              <div className="flex items-start justify-between gap-3">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${configured ? 'bg-[#e94560]/10 text-[#e94560]' : 'bg-[var(--bg-primary)] text-[var(--text-muted)]'}`}>
                  <Icon className="h-5 w-5" />
                </div>
                {configured ? (
                  <span className="flex items-center gap-1 text-[11px] font-semibold text-green-600"><CheckCircle2 className="h-3.5 w-3.5" /> Connected</span>
                ) : (
                  <span className="flex items-center gap-1 text-[11px] font-medium text-[var(--text-muted)]"><XCircle className="h-3.5 w-3.5" /> Not set</span>
                )}
              </div>
              <p className="mt-3 font-semibold text-[var(--text-primary)] flex items-center gap-1">
                {label}
                <ChevronRight className="h-4 w-4 text-[var(--text-muted)] opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all" />
              </p>
              <p className="text-xs text-[var(--text-muted)] mt-0.5 leading-relaxed">{desc}</p>
            </button>
          );
        })}
      </div>
    </div>
  );
}

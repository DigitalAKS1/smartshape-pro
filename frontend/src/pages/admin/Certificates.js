import React, { useState, useEffect } from 'react';
import AdminLayout from '../../components/layouts/AdminLayout';
import { useCertificates } from '../../hooks/useCertificates';
import { Award, Layers, ClipboardList, RefreshCw } from 'lucide-react';

const PINK = '#e94560';
const TABS = [
  { id: 'templates', label: 'Templates', icon: Layers      },
  { id: 'batches',   label: 'Batches',   icon: ClipboardList },
];

export default function Certificates() {
  const s = useCertificates();
  const [tab, setTab] = useState('templates');

  const card      = 'bg-[var(--bg-card)] border-[var(--border-color)]';
  const textPri   = 'text-[var(--text-primary)]';
  const textSec   = 'text-[var(--text-secondary)]';
  const textMuted = 'text-[var(--text-muted)]';

  useEffect(() => {
    s.loadTemplates();
    s.loadBatches();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRefresh = () => {
    if (tab === 'templates') s.loadTemplates();
    else s.loadBatches();
  };

  return (
    <AdminLayout>
      <div className="space-y-5">

        {/* Header */}
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl hidden sm:flex" style={{ background: PINK + '18' }}>
              <Award className="h-5 w-5" style={{ color: PINK }} />
            </div>
            <div>
              <h1 className={`text-2xl sm:text-3xl font-semibold ${textPri} tracking-tight`}>Certificates</h1>
              <p className={`${textMuted} text-xs mt-0.5`}>Design templates, generate batches, deliver via WhatsApp &amp; email</p>
            </div>
          </div>
          <button
            onClick={handleRefresh}
            className={`p-2 rounded-lg border border-[var(--border-color)] ${textMuted} hover:bg-[var(--bg-hover)]`}
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>

        {/* Tab bar */}
        <div className={`${card} border rounded-xl p-1 flex gap-0.5 overflow-x-auto`}>
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-medium whitespace-nowrap transition-all flex-shrink-0
                ${tab === t.id ? 'text-white' : `${textSec} hover:bg-[var(--bg-hover)]`}`}
              style={tab === t.id ? { background: PINK } : {}}
            >
              <t.icon className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{t.label}</span>
            </button>
          ))}
        </div>

        {/* Templates tab — placeholder (TemplateDesigner is Task 9) */}
        {tab === 'templates' && (
          <div className={`${card} border rounded-xl p-8 text-center`}>
            <Layers className="h-10 w-10 mx-auto mb-3" style={{ color: PINK }} />
            <p className={`${textPri} font-medium mb-1`}>Certificate Templates</p>
            <p className={`${textMuted} text-sm`}>
              {s.templates.length > 0
                ? `${s.templates.length} template${s.templates.length !== 1 ? 's' : ''} — designer coming in Task 9`
                : 'No templates yet — designer coming in Task 9'}
            </p>
          </div>
        )}

        {/* Batches tab — placeholder (BatchCreator/Detail are Task 10) */}
        {tab === 'batches' && (
          <div className={`${card} border rounded-xl p-8 text-center`}>
            <ClipboardList className="h-10 w-10 mx-auto mb-3" style={{ color: PINK }} />
            <p className={`${textPri} font-medium mb-1`}>Certificate Batches</p>
            <p className={`${textMuted} text-sm`}>
              {s.loading
                ? 'Loading…'
                : s.batches.length > 0
                  ? `${s.batches.length} batch${s.batches.length !== 1 ? 'es' : ''} — batch UI coming in Task 10`
                  : 'No batches yet — batch creator coming in Task 10'}
            </p>
          </div>
        )}

      </div>
    </AdminLayout>
  );
}

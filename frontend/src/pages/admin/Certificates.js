import React, { useState, useEffect } from 'react';
import AdminLayout from '../../components/layouts/AdminLayout';
import { useCertificates } from '../../hooks/useCertificates';
import TemplateDesigner from '../../components/certs/TemplateDesigner';
import BatchCreator from '../../components/certs/BatchCreator';
import BatchDetail from '../../components/certs/BatchDetail';
import { Award, Layers, ClipboardList, RefreshCw, Trash2, ChevronDown, ChevronUp, Plus, Calendar, ChevronRight } from 'lucide-react';
import { certsApi } from '../../lib/api';
import { toast } from 'sonner';

const PINK = '#e94560';
const TABS = [
  { id: 'templates', label: 'Templates', icon: Layers      },
  { id: 'batches',   label: 'Batches',   icon: ClipboardList },
];

export default function Certificates() {
  const s = useCertificates();
  const [tab, setTab]             = useState('templates');
  const [showDesigner, setShowDesigner] = useState(false);
  const [deletingId, setDeletingId]     = useState(null);

  /* ── Batches tab state ── */
  const [showCreator, setShowCreator]     = useState(false);
  const [selectedBatchId, setSelectedBatchId] = useState(null);

  const card      = 'bg-[var(--bg-card)] border-[var(--border-color)]';
  const textPri   = 'text-[var(--text-primary)]';
  const textSec   = 'text-[var(--text-secondary)]';
  const textMuted = 'text-[var(--text-muted)]';

  useEffect(() => {
    s.loadTemplates();
    s.loadBatches();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* load selected batch whenever selectedBatchId changes */
  useEffect(() => {
    if (selectedBatchId) {
      s.loadBatch(selectedBatchId);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBatchId]);

  const handleRefresh = () => {
    if (tab === 'templates') s.loadTemplates();
    else s.loadBatches();
  };

  const handleDeleteTemplate = async (id, name) => {
    if (!window.confirm(`Delete template "${name}"? This cannot be undone.`)) return;
    setDeletingId(id);
    try {
      await certsApi.deleteTemplate(id);
      toast.success('Template deleted');
      s.loadTemplates();
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Failed to delete template');
    } finally {
      setDeletingId(null);
    }
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

        {/* ── Templates tab ── */}
        {tab === 'templates' && (
          <div className="space-y-4">

            {/* Toggle designer */}
            <div className="flex items-center justify-between">
              <p className={`text-sm font-medium ${textPri}`}>
                {s.templates.length > 0
                  ? `${s.templates.length} template${s.templates.length !== 1 ? 's' : ''}`
                  : 'No templates yet'}
              </p>
              <button
                onClick={() => setShowDesigner(v => !v)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-white"
                style={{ background: PINK }}
              >
                {showDesigner ? (
                  <><ChevronUp className="h-4 w-4" />Hide Designer</>
                ) : (
                  <><ChevronDown className="h-4 w-4" />New Template</>
                )}
              </button>
            </div>

            {/* Designer panel */}
            {showDesigner && (
              <TemplateDesigner
                onSaved={() => {
                  setShowDesigner(false);
                  s.loadTemplates();
                }}
              />
            )}

            {/* Template list */}
            {s.templates.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {s.templates.map(tpl => (
                  <div key={tpl.template_id} className={`${card} border rounded-xl overflow-hidden`}>
                    {/* Background preview */}
                    {tpl.background_url ? (
                      <img
                        src={tpl.background_url}
                        alt={tpl.name}
                        className="w-full h-32 object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div className="w-full h-32 flex items-center justify-center bg-[var(--bg-primary)]">
                        <Layers className={`h-8 w-8 ${textMuted}`} />
                      </div>
                    )}
                    <div className="p-3 space-y-1.5">
                      <p className={`font-medium text-sm ${textPri} truncate`}>{tpl.name}</p>
                      <div className="flex items-center justify-between gap-2">
                        <div className="space-y-0.5">
                          {tpl.orientation && (
                            <p className={`text-xs ${textMuted} capitalize`}>{tpl.orientation}</p>
                          )}
                          {tpl.width_px && tpl.height_px && (
                            <p className={`text-xs ${textMuted}`}>{tpl.width_px} × {tpl.height_px} px</p>
                          )}
                          {Array.isArray(tpl.fields) && (
                            <p className={`text-xs ${textMuted}`}>
                              {tpl.fields.length} field{tpl.fields.length !== 1 ? 's' : ''}
                            </p>
                          )}
                        </div>
                        <button
                          onClick={() => handleDeleteTemplate(tpl.template_id, tpl.name)}
                          disabled={deletingId === (tpl.template_id)}
                          className="p-1.5 rounded-lg text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors disabled:opacity-40"
                          title="Delete template"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : !showDesigner ? (
              <div className={`${card} border rounded-xl p-8 text-center border-dashed`}>
                <Layers className="h-10 w-10 mx-auto mb-3" style={{ color: PINK }} />
                <p className={`${textPri} font-medium mb-1`}>No templates yet</p>
                <p className={`${textMuted} text-sm`}>Click "New Template" above to design your first certificate.</p>
              </div>
            ) : null}
          </div>
        )}

        {/* ── Batches tab ── */}
        {tab === 'batches' && (
          <div className="space-y-4">

            {/* ── Batch detail view ── */}
            {selectedBatchId && s.currentBatch ? (
              <BatchDetail
                batch={s.currentBatch}
                loadBatch={s.loadBatch}
                generate={s.generate}
                send={s.send}
                onBack={() => {
                  setSelectedBatchId(null);
                  s.loadBatches();
                }}
              />
            ) : (
              <>
                {/* Header row */}
                <div className="flex items-center justify-between gap-3">
                  <p className={`text-sm font-medium ${textPri}`}>
                    {s.loading
                      ? 'Loading…'
                      : s.batches.length > 0
                        ? `${s.batches.length} batch${s.batches.length !== 1 ? 'es' : ''}`
                        : 'No batches yet'}
                  </p>
                  <button
                    onClick={() => setShowCreator(v => !v)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-white"
                    style={{ background: PINK }}
                  >
                    {showCreator ? (
                      <><ChevronUp className="h-4 w-4" />Hide</>
                    ) : (
                      <><Plus className="h-4 w-4" />New Batch</>
                    )}
                  </button>
                </div>

                {/* BatchCreator panel */}
                {showCreator && (
                  <BatchCreator
                    templates={s.templates}
                    onCreated={(newBatch) => {
                      setShowCreator(false);
                      s.loadBatches();
                      if (newBatch?.batch_id) {
                        setSelectedBatchId(newBatch.batch_id);
                      }
                    }}
                    onCancel={() => setShowCreator(false)}
                  />
                )}

                {/* Batch list */}
                {s.batches.length > 0 ? (
                  <div className="space-y-2">
                    {s.batches.map(b => (
                      <button
                        key={b.batch_id}
                        type="button"
                        onClick={() => {
                          setShowCreator(false);
                          setSelectedBatchId(b.batch_id);
                        }}
                        className={`w-full text-left ${card} border rounded-xl px-4 py-3 hover:bg-[var(--bg-hover)] transition-colors flex items-center gap-3`}
                      >
                        <div className="p-2 rounded-lg flex-shrink-0" style={{ background: PINK + '18' }}>
                          <ClipboardList className="h-4 w-4" style={{ color: PINK }} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className={`font-medium text-sm ${textPri} truncate`}>{b.title}</p>
                          <div className={`flex items-center gap-3 text-xs ${textMuted} mt-0.5`}>
                            {b.shared_values?.date && (
                              <span className="flex items-center gap-1">
                                <Calendar className="h-3 w-3" />
                                {b.shared_values.date}
                              </span>
                            )}
                            <span>{b.counts?.total ?? 0} attendees</span>
                            <span className="capitalize">{b.status}</span>
                          </div>
                        </div>
                        <ChevronRight className={`h-4 w-4 flex-shrink-0 ${textMuted}`} />
                      </button>
                    ))}
                  </div>
                ) : !showCreator ? (
                  <div className={`${card} border rounded-xl p-8 text-center border-dashed`}>
                    <ClipboardList className="h-10 w-10 mx-auto mb-3" style={{ color: PINK }} />
                    <p className={`${textPri} font-medium mb-1`}>No batches yet</p>
                    <p className={`${textMuted} text-sm`}>
                      Click "New Batch" to generate and send certificates to a group.
                    </p>
                  </div>
                ) : null}
              </>
            )}
          </div>
        )}

      </div>
    </AdminLayout>
  );
}

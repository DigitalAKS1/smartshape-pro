import React, { useState, useRef, useEffect, useCallback } from 'react';
import AdminLayout from '../../components/layouts/AdminLayout';
import { importSystem, masterImport, fields as fieldsApi } from '../../lib/api';
import { Button } from '../../components/ui/button';
import { toast } from 'sonner';
import { Upload, CheckCircle, XCircle, FileText, Play, Clock, Download } from 'lucide-react';
import ZoomCrmImport from '../../components/crm/ZoomCrmImport';

export default function ImportCenter() {
  const [preview, setPreview] = useState(null);
  const [mapping, setMapping] = useState([]);
  const [mapMode, setMapMode] = useState('auto'); // 'auto' | 'manual'
  const [allFields, setAllFields] = useState([]);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null);
  const [logs, setLogs] = useState([]);
  const [activeTab, setActiveTab] = useState('import');
  // Manual picker state
  const [selectedSource, setSelectedSource] = useState(null);
  const fileRef = useRef(null);

  const card = 'bg-[var(--bg-card)] border-[var(--border-color)]';
  const inputCls = 'bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]';
  const textPri = 'text-[var(--text-primary)]';
  const textSec = 'text-[var(--text-secondary)]';
  const textMuted = 'text-[var(--text-muted)]';

  const SCHOOL_COLS = 'school_name, email, phone, school_type, city, state, contact_name, password';

  // Load all field definitions on mount
  useEffect(() => {
    fieldsApi.list()
      .then(res => setAllFields(Array.isArray(res.data) ? res.data : []))
      .catch(() => setAllFields([]));
  }, []);

  const handleFileSelect = async (file) => {
    if (!file) return;
    setPreview(null); setResult(null); setMapping([]); setSelectedSource(null);
    try {
      const res = await masterImport.preview(file, 'school');
      const data = res.data;
      setPreview(data);
      setMapping(data.mapping ? data.mapping.map(m => ({ ...m })) : []);
    } catch { toast.error('Failed to preview file'); }
  };

  // Auto-map: update a mapping entry by index via the select dropdown
  const updateMap = useCallback((idx, newKey) => {
    setMapping(prev => {
      const next = [...prev];
      const f = allFields.find(af => af.key === newKey);
      next[idx] = {
        ...next[idx],
        key: newKey || null,
        field_id: f ? f.field_id : null,
        confidence: newKey ? (next[idx].confidence === 'none' ? 'medium' : next[idx].confidence) : 'none',
      };
      return next;
    });
  }, [allFields]);

  // Manual-map: link a source column to a field (enforces 1-to-1)
  const linkManual = useCallback((source, field) => {
    setMapping(prev => {
      const next = prev.map(m => {
        // Unlink this field if it was already assigned elsewhere
        if (m.key === field.key && m.source !== source) {
          return { ...m, key: null, field_id: null, confidence: 'none' };
        }
        if (m.source === source) {
          return { ...m, key: field.key, field_id: field.field_id, confidence: 'manual' };
        }
        return m;
      });
      return next;
    });
    setSelectedSource(null);
  }, []);

  // Manual-map: unlink a source column
  const unlinkSource = useCallback((source) => {
    setMapping(prev => prev.map(m =>
      m.source === source ? { ...m, key: null, field_id: null, confidence: 'none' } : m
    ));
  }, []);

  // Build rows_keyed from preview.rows_keyed re-keyed through current mapping
  const buildRowsKeyed = useCallback(() => {
    if (!preview || !preview.rows_keyed) return [];
    const h2k = {};
    mapping.forEach(m => { if (m.key) h2k[m.source] = m; });
    // rows_keyed from preview is already keyed by original mapping keys
    // Re-key from rows_raw (keyed by SOURCE header) through the CURRENT mapping,
    // so user edits — including assigning a field to a column that auto-mapped
    // to nothing — always take effect. Falls back to rows_keyed if rows_raw absent.
    const raw = preview.rows_raw || preview.rows_keyed || [];
    return raw.map(row => {
      const out = {};
      mapping.forEach(m => {
        if (!m.key) return;
        if (m.source in row) out[m.key] = row[m.source];
      });
      return out;
    });
  }, [preview, mapping]);

  const runExecute = async () => {
    if (!preview) return;
    setImporting(true);
    try {
      const rows_keyed = buildRowsKeyed();
      const res = await masterImport.execute({ rows_keyed, mapping, create_leads: false });
      setResult(res.data);
      toast.success(`Import complete: ${res.data.counts?.create || 0} created, ${res.data.counts?.update || 0} updated`);
      setPreview(null); setMapping([]);
    } catch { toast.error('Import failed'); }
    setImporting(false);
  };

  const handleDownloadTemplate = async () => {
    try {
      const res = await masterImport.template(true);
      const { headers, rows } = res.data;
      const lines = [headers.join(',')];
      (rows || []).forEach(r => {
        lines.push(headers.map(h => `"${(r[h] || '').replace(/"/g, '""')}"`).join(','));
      });
      const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'import_template_with_ids.csv'; a.click();
      URL.revokeObjectURL(url);
    } catch { toast.error('Failed to download template'); }
  };

  const loadLogs = async () => {
    try { const res = await importSystem.logs(); setLogs(res.data); } catch {}
  };

  // Derived: which keys are already used (for 1-to-1 enforcement in manual mode)
  const usedKeys = new Set(mapping.filter(m => m.key).map(m => m.key));

  const confidenceDot = (c) => c === 'high' ? '🟢' : c === 'medium' ? '🟡' : c === 'manual' ? '🔵' : '⚪';

  const linkedMappings = mapping.filter(m => m.key);
  const unlinkedMappings = mapping.filter(m => !m.key);

  return (
    <AdminLayout>
      <div className="space-y-5" translate="no">
        <h1 className={`text-3xl sm:text-4xl font-semibold ${textPri} tracking-tight`} data-testid="import-center-title">Import Center</h1>

        <div className={`flex gap-1 ${card} border rounded-md p-1`}>
          {['import', 'zoom', 'logs'].map(tab => (
            <button key={tab} onClick={() => { setActiveTab(tab); if (tab === 'logs') loadLogs(); }}
              className={`flex-1 px-4 py-2 rounded text-sm font-medium transition-all capitalize ${activeTab === tab ? 'bg-[#e94560] text-white' : `${textSec} hover:bg-[var(--bg-hover)]`}`}
              data-testid={`import-tab-${tab}`}>
              {tab === 'import' ? 'Import Data' : tab === 'zoom' ? 'Zoom CRM' : 'Import History'}
            </button>
          ))}
        </div>

        {activeTab === 'zoom' && <ZoomCrmImport />}

        {activeTab === 'import' && (
          <div className="space-y-4">
            {/* Step 1: Entity Type (school-only; master-data engine always fans out to School+Contact+Lead) */}
            <div className={`${card} border rounded-md p-5 space-y-4`}>
              <h2 className={`text-lg font-medium ${textPri}`}>Step 1: Data Type</h2>
              <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-md border text-sm font-medium bg-[#e94560] text-white border-[#e94560]`} data-testid="entity-type-school">
                Importing: School master data (School + Contact + Lead)
              </div>
              <p className={`text-xs ${textMuted}`}>Expected columns: <code className="bg-[var(--bg-primary)] px-1.5 py-0.5 rounded text-[11px]">{SCHOOL_COLS}</code></p>
            </div>

            {/* Step 2: Upload */}
            <div className={`${card} border rounded-md p-5 space-y-4`}>
              <div className="flex items-center justify-between">
                <h2 className={`text-lg font-medium ${textPri}`}>Step 2: Upload File</h2>
                <Button variant="outline" onClick={handleDownloadTemplate}
                  className={`border-[var(--border-color)] ${textSec} text-xs flex items-center gap-1.5`}>
                  <Download className="h-3.5 w-3.5" /> Download template (with IDs)
                </Button>
              </div>
              <div className="bg-[var(--bg-primary)] border-2 border-dashed border-[var(--border-color)] rounded-md p-8 text-center cursor-pointer hover:border-[#e94560]/40 transition-all"
                onClick={() => fileRef.current?.click()} data-testid="import-upload-area">
                <Upload className={`h-10 w-10 mx-auto mb-2 ${textMuted}`} />
                <p className={textSec}>Click to upload CSV or Excel file</p>
                <p className={`text-xs ${textMuted} mt-1`}>.csv or .xlsx accepted</p>
                <input ref={fileRef} type="file" accept=".csv,.xlsx" className="hidden"
                  onChange={e => { if (e.target.files?.[0]) handleFileSelect(e.target.files[0]); e.target.value = ''; }} />
              </div>
            </div>

            {/* Step 3: Mapping */}
            {preview && (
              <div className={`${card} border rounded-md p-5 space-y-4`} data-testid="import-preview">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <h2 className={`text-lg font-medium ${textPri}`}>Step 3: Map Columns</h2>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => { setMapMode('auto'); setSelectedSource(null); }}
                      className={`px-3 py-1.5 rounded text-sm font-medium border transition-all ${mapMode === 'auto' ? 'bg-[#e94560] text-white border-[#e94560]' : `${card} border ${textSec}`}`}>
                      Auto map
                    </button>
                    <button
                      onClick={() => { setMapMode('manual'); setSelectedSource(null); }}
                      className={`px-3 py-1.5 rounded text-sm font-medium border transition-all ${mapMode === 'manual' ? 'bg-[#e94560] text-white border-[#e94560]' : `${card} border ${textSec}`}`}>
                      Manual 1-to-1
                    </button>
                  </div>
                </div>

                {/* Counts summary */}
                <div className={`text-sm ${textSec} flex gap-4 flex-wrap`}>
                  <span className="text-green-400">Will create {preview.counts?.create ?? 0}</span>
                  <span className="text-blue-400">update {preview.counts?.update ?? 0}</span>
                  <span className="text-yellow-400">review {preview.counts?.needs_review ?? 0}</span>
                  {(preview.counts?.error ?? 0) > 0 && <span className="text-red-400">error {preview.counts.error}</span>}
                </div>

                {/* AUTO MODE */}
                {mapMode === 'auto' && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-[var(--bg-primary)]">
                          <th className={`text-left text-xs py-2 px-3 ${textMuted}`}>Your column</th>
                          <th className={`text-left text-xs py-2 px-3 ${textMuted}`}>Maps to</th>
                          <th className={`text-left text-xs py-2 px-3 ${textMuted}`}>Confidence</th>
                        </tr>
                      </thead>
                      <tbody>
                        {mapping.map((m, i) => (
                          <tr key={i} className="border-t border-[var(--border-color)]">
                            <td className={`px-3 py-2 font-mono text-xs ${textPri}`}>{m.source}</td>
                            <td className="px-3 py-2">
                              <select
                                value={m.key || ''}
                                onChange={e => updateMap(i, e.target.value)}
                                className={`text-xs rounded border px-2 py-1 ${inputCls} w-full max-w-[220px]`}>
                                <option value="">— ignore —</option>
                                <option value="school_id">School ID (match key)</option>
                                {allFields.map(f => (
                                  <option key={f.field_id} value={f.key}>{f.label}</option>
                                ))}
                              </select>
                            </td>
                            <td className="px-3 py-2 text-base">{confidenceDot(m.confidence)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* MANUAL 1-TO-1 MODE */}
                {mapMode === 'manual' && (
                  <div className="space-y-4">
                    <p className={`text-xs ${textMuted}`}>
                      Click a source column (left), then a field (right) to link them. Each field can only be linked once.
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {/* Left pane: source columns */}
                      <div className={`border rounded-md ${card} overflow-hidden`}>
                        <div className={`px-3 py-2 text-xs font-semibold ${textMuted} bg-[var(--bg-primary)] border-b border-[var(--border-color)]`}>
                          Source columns ({preview.headers?.length ?? 0})
                        </div>
                        <div className="max-h-64 overflow-y-auto">
                          {(preview.headers || []).map(h => {
                            const isLinked = mapping.find(m => m.source === h && m.key);
                            const isSelected = selectedSource === h;
                            return (
                              <button
                                key={h}
                                onClick={() => setSelectedSource(isSelected ? null : h)}
                                className={`w-full text-left px-3 py-2 text-xs border-b border-[var(--border-color)] last:border-0 transition-all flex items-center justify-between gap-2
                                  ${isSelected ? 'bg-[#e94560]/20 border-[#e94560]/30' : 'hover:bg-[var(--bg-hover)]'}
                                  ${isLinked ? 'opacity-60' : ''}`}>
                                <span className={`font-mono ${textPri}`}>{h}</span>
                                {isLinked && (
                                  <span className="text-[10px] text-blue-400 shrink-0">
                                    linked to {mapping.find(m => m.source === h)?.key}
                                  </span>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {/* Right pane: registered fields */}
                      <div className={`border rounded-md ${card} overflow-hidden`}>
                        <div className={`px-3 py-2 text-xs font-semibold ${textMuted} bg-[var(--bg-primary)] border-b border-[var(--border-color)]`}>
                          Available fields {selectedSource ? `(click to link to "${selectedSource}")` : '(select a source column first)'}
                        </div>
                        <div className="max-h-64 overflow-y-auto">
                          {allFields.map(f => {
                            const alreadyUsed = usedKeys.has(f.key) && !mapping.find(m => m.source === selectedSource && m.key === f.key);
                            return (
                              <button
                                key={f.field_id}
                                disabled={!selectedSource || alreadyUsed}
                                onClick={() => selectedSource && !alreadyUsed && linkManual(selectedSource, f)}
                                className={`w-full text-left px-3 py-2 text-xs border-b border-[var(--border-color)] last:border-0 transition-all flex items-center justify-between gap-2
                                  ${alreadyUsed ? 'opacity-40 cursor-not-allowed' : selectedSource ? 'hover:bg-[var(--bg-hover)] cursor-pointer' : 'cursor-default opacity-60'}`}>
                                <span className={textPri}>{f.label}</span>
                                <span className={`text-[10px] ${textMuted}`}>{f.key}</span>
                              </button>
                            );
                          })}
                          {allFields.length === 0 && (
                            <p className={`px-3 py-4 text-xs ${textMuted}`}>No fields loaded</p>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Mapped links list */}
                    {linkedMappings.length > 0 && (
                      <div className={`rounded-md border ${card} p-3 space-y-1`}>
                        <p className={`text-xs font-semibold ${textMuted} mb-2`}>Mapped ({linkedMappings.length})</p>
                        <div className="flex flex-wrap gap-2">
                          {linkedMappings.map(m => (
                            <div key={m.source} className="flex items-center gap-1.5 bg-[var(--bg-primary)] border border-[var(--border-color)] rounded px-2 py-1 text-xs">
                              <span className={`font-mono ${textSec}`}>{m.source}</span>
                              <span className={textMuted}>→</span>
                              <span className={textPri}>{m.key}</span>
                              <button
                                onClick={() => unlinkSource(m.source)}
                                className="text-red-400 hover:text-red-300 ml-0.5 leading-none"
                                title="Unlink">
                                ✕
                              </button>
                            </div>
                          ))}
                        </div>
                        {unlinkedMappings.length > 0 && (
                          <p className={`text-xs ${textMuted} mt-1`}>
                            {unlinkedMappings.length} column{unlinkedMappings.length > 1 ? 's' : ''} ignored (not linked)
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Import action */}
                <div className="flex items-center justify-between flex-wrap gap-2 pt-2">
                  <Button variant="outline" onClick={() => { setPreview(null); setMapping([]); }}
                    className={`border-[var(--border-color)] ${textSec}`}>Cancel</Button>
                  <Button onClick={runExecute} disabled={importing || preview.total === 0}
                    className="bg-[#e94560] hover:bg-[#f05c75] text-white" data-testid="execute-import-btn">
                    <Play className="mr-1.5 h-4 w-4" />
                    {importing ? 'Importing...' : `Import ${preview.total} rows`}
                  </Button>
                </div>
              </div>
            )}

            {result && (
              <div className={`${card} border rounded-md p-5 text-center`}>
                <CheckCircle className="h-12 w-12 text-green-400 mx-auto mb-3" />
                <p className={`text-lg font-medium ${textPri}`}>Import Complete</p>
                <p className={`text-sm ${textSec} mt-1`}>
                  {result.counts?.create ?? 0} created, {result.counts?.update ?? 0} updated, {result.counts?.error ?? 0} failed
                </p>
              </div>
            )}
          </div>
        )}

        {activeTab === 'logs' && (
          <div className={`${card} border rounded-md overflow-hidden`} data-testid="import-logs">
            {logs.length === 0 ? (
              <div className="p-12 text-center"><FileText className={`h-12 w-12 mx-auto mb-3 ${textMuted}`} strokeWidth={1} /><p className={textMuted}>No import history</p></div>
            ) : (
              <table className="w-full text-sm">
                <thead><tr className="bg-[var(--bg-primary)]">
                  <th className={`text-left text-xs py-3 px-4 ${textMuted}`}>Type</th>
                  <th className={`text-left text-xs py-3 px-4 ${textMuted}`}>Total</th>
                  <th className={`text-left text-xs py-3 px-4 ${textMuted}`}>Created</th>
                  <th className={`text-left text-xs py-3 px-4 ${textMuted}`}>Updated</th>
                  <th className={`text-left text-xs py-3 px-4 ${textMuted}`}>Failed</th>
                  <th className={`text-left text-xs py-3 px-4 ${textMuted}`}>By</th>
                  <th className={`text-left text-xs py-3 px-4 ${textMuted}`}>Date</th>
                </tr></thead>
                <tbody>
                  {logs.map((log, idx) => (
                    <tr key={log.log_id || idx} className="border-t border-[var(--border-color)] hover:bg-[var(--bg-hover)]">
                      <td className={`px-4 py-3 ${textPri} capitalize font-medium`}>{log.entity_type || 'school'}</td>
                      <td className={`px-4 py-3 font-mono ${textPri}`}>{log.total_rows ?? (log.counts ? Object.values(log.counts).reduce((a,b)=>a+b,0) : '-')}</td>
                      <td className="px-4 py-3 font-mono text-green-400">{log.counts?.create ?? log.success_count ?? '-'}</td>
                      <td className="px-4 py-3 font-mono text-blue-400">{log.counts?.update ?? '-'}</td>
                      <td className="px-4 py-3 font-mono text-red-400">{log.counts?.error ?? log.failed_count ?? '-'}</td>
                      <td className={`px-4 py-3 ${textSec}`}>{log.by || log.uploaded_by}</td>
                      <td className={`px-4 py-3 text-xs ${textMuted}`}>{log.at ? new Date(log.at).toLocaleString() : log.created_at ? new Date(log.created_at).toLocaleString() : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </AdminLayout>
  );
}

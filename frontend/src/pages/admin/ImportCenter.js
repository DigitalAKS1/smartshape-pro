import React, { useState, useRef } from 'react';
import AdminLayout from '../../components/layouts/AdminLayout';
import { importSystem } from '../../lib/api';
import { Button } from '../../components/ui/button';
import { toast } from 'sonner';
import { Upload, CheckCircle, XCircle, FileText, Play, Clock } from 'lucide-react';

export default function ImportCenter() {
  const [entityType, setEntityType] = useState('contacts');
  const [preview, setPreview] = useState(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null);
  const [logs, setLogs] = useState([]);
  const [activeTab, setActiveTab] = useState('import');
  const fileRef = useRef(null);

  const card = 'bg-[var(--bg-card)] border-[var(--border-color)]';
  const inputCls = 'bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]';
  const textPri = 'text-[var(--text-primary)]';
  const textSec = 'text-[var(--text-secondary)]';
  const textMuted = 'text-[var(--text-muted)]';

  const COLS = { contacts: 'name, phone, email, company, designation, source, notes', schools: 'school_name, email, phone, school_type, city, state, contact_name, password', inventory: 'code, name, type, stock_qty, min_level, description' };

  const handleFileSelect = async (file) => {
    if (!file) return;
    setPreview(null); setResult(null);
    try {
      const res = await importSystem.preview(file, entityType);
      setPreview(res.data);
    } catch { toast.error('Failed to preview file'); }
  };

  const handleExecute = async () => {
    if (!preview) return;
    setImporting(true);
    try {
      const res = await importSystem.execute({ entity_type: entityType, rows: preview.rows });
      setResult(res.data);
      toast.success(`Imported: ${res.data.created} created, ${res.data.failed} failed`);
      setPreview(null);
    } catch { toast.error('Import failed'); }
    setImporting(false);
  };

  const loadLogs = async () => {
    try { const res = await importSystem.logs(); setLogs(res.data); } catch {}
  };

  return (
    <AdminLayout>
      <div className="space-y-5">
        <h1 className={`text-3xl sm:text-4xl font-semibold ${textPri} tracking-tight`} data-testid="import-center-title">Import Center</h1>

        <div className={`flex gap-1 ${card} border rounded-md p-1`}>
          {['import', 'logs'].map(tab => (
            <button key={tab} onClick={() => { setActiveTab(tab); if (tab === 'logs') loadLogs(); }}
              className={`flex-1 px-4 py-2 rounded text-sm font-medium transition-all capitalize ${activeTab === tab ? 'bg-[#e94560] text-white' : `${textSec} hover:bg-[var(--bg-hover)]`}`}
              data-testid={`import-tab-${tab}`}>
              {tab === 'import' ? 'Import Data' : 'Import History'}
            </button>
          ))}
        </div>

        {activeTab === 'import' && (
          <div className="space-y-4">
            {/* Entity Type Selector */}
            <div className={`${card} border rounded-md p-5 space-y-4`}>
              <h2 className={`text-lg font-medium ${textPri}`}>Step 1: Select Data Type</h2>
              <div className="flex flex-wrap gap-2">
                {['contacts', 'schools', 'inventory'].map(t => (
                  <button key={t} onClick={() => { setEntityType(t); setPreview(null); setResult(null); }}
                    className={`px-4 py-2 rounded-md text-sm font-medium border transition-all capitalize ${entityType === t ? 'bg-[#e94560] text-white border-[#e94560]' : `${card} border ${textSec}`}`}
                    data-testid={`entity-type-${t}`}>
                    {t}
                  </button>
                ))}
              </div>
              <p className={`text-xs ${textMuted}`}>Expected CSV columns: <code className="bg-[var(--bg-primary)] px-1.5 py-0.5 rounded text-[11px]">{COLS[entityType]}</code></p>
            </div>

            {/* Upload */}
            <div className={`${card} border rounded-md p-5 space-y-4`}>
              <h2 className={`text-lg font-medium ${textPri}`}>Step 2: Upload CSV</h2>
              <div className="bg-[var(--bg-primary)] border-2 border-dashed border-[var(--border-color)] rounded-md p-8 text-center cursor-pointer hover:border-[#e94560]/40 transition-all"
                onClick={() => fileRef.current?.click()} data-testid="import-upload-area">
                <Upload className={`h-10 w-10 mx-auto mb-2 ${textMuted}`} />
                <p className={textSec}>Click to upload CSV file</p>
                <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={e => { if (e.target.files?.[0]) handleFileSelect(e.target.files[0]); e.target.value = ''; }} />
              </div>
            </div>

            {/* Preview */}
            {preview && (
              <div className={`${card} border rounded-md p-5 space-y-4`} data-testid="import-preview">
                <div className="flex items-center justify-between">
                  <h2 className={`text-lg font-medium ${textPri}`}>Step 3: Preview & Import</h2>
                  <div className="flex items-center gap-3 text-sm">
                    <span className="text-green-400">{preview.valid} valid</span>
                    <span className="text-red-400">{preview.errors} errors</span>
                    <span className={textMuted}>{preview.total_rows} total</span>
                  </div>
                </div>
                <div className="overflow-x-auto max-h-80">
                  <table className="w-full text-sm">
                    <thead><tr className="bg-[var(--bg-primary)]">
                      <th className={`text-left text-xs py-2 px-3 ${textMuted}`}>#</th>
                      <th className={`text-left text-xs py-2 px-3 ${textMuted}`}>Status</th>
                      <th className={`text-left text-xs py-2 px-3 ${textMuted}`}>Data</th>
                      <th className={`text-left text-xs py-2 px-3 ${textMuted}`}>Error</th>
                    </tr></thead>
                    <tbody>
                      {preview.rows.map((row, i) => (
                        <tr key={i} className="border-t border-[var(--border-color)]">
                          <td className={`px-3 py-2 ${textMuted}`}>{row.row_num}</td>
                          <td className="px-3 py-2">{row.status === 'ok' ? <CheckCircle className="h-4 w-4 text-green-400" /> : <XCircle className="h-4 w-4 text-red-400" />}</td>
                          <td className={`px-3 py-2 text-xs font-mono ${textSec} max-w-xs truncate`}>{Object.values(row.data).join(', ')}</td>
                          <td className="px-3 py-2 text-xs text-red-400">{row.error}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setPreview(null)} className={`border-[var(--border-color)] ${textSec}`}>Cancel</Button>
                  <Button onClick={handleExecute} disabled={importing || preview.valid === 0} className="bg-[#e94560] hover:bg-[#f05c75] text-white" data-testid="execute-import-btn">
                    <Play className="mr-1.5 h-4 w-4" /> {importing ? 'Importing...' : `Import ${preview.valid} rows`}
                  </Button>
                </div>
              </div>
            )}

            {result && (
              <div className={`${card} border rounded-md p-5 text-center`}>
                <CheckCircle className="h-12 w-12 text-green-400 mx-auto mb-3" />
                <p className={`text-lg font-medium ${textPri}`}>Import Complete</p>
                <p className={`text-sm ${textSec} mt-1`}>{result.created} created, {result.failed} failed/skipped</p>
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
                  <th className={`text-left text-xs py-3 px-4 ${textMuted}`}>Success</th>
                  <th className={`text-left text-xs py-3 px-4 ${textMuted}`}>Failed</th>
                  <th className={`text-left text-xs py-3 px-4 ${textMuted}`}>By</th>
                  <th className={`text-left text-xs py-3 px-4 ${textMuted}`}>Date</th>
                </tr></thead>
                <tbody>
                  {logs.map(log => (
                    <tr key={log.log_id} className="border-t border-[var(--border-color)] hover:bg-[var(--bg-hover)]">
                      <td className={`px-4 py-3 ${textPri} capitalize font-medium`}>{log.entity_type}</td>
                      <td className={`px-4 py-3 font-mono ${textPri}`}>{log.total_rows}</td>
                      <td className="px-4 py-3 font-mono text-green-400">{log.success_count}</td>
                      <td className="px-4 py-3 font-mono text-red-400">{log.failed_count}</td>
                      <td className={`px-4 py-3 ${textSec}`}>{log.uploaded_by}</td>
                      <td className={`px-4 py-3 text-xs ${textMuted}`}>{new Date(log.created_at).toLocaleString()}</td>
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

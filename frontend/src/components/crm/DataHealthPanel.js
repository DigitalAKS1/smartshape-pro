import React, { useCallback, useState, useRef, useEffect } from 'react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import {
  Activity, ChevronDown, ChevronRight, Loader2, RefreshCw, GitMerge,
  Phone, Link2, AlertTriangle, Database, ShieldAlert, X, SkipForward, CheckCircle,
} from 'lucide-react';
import { useIsOwner } from '../../hooks/usePermission';
import { crmMaintenance } from '../../lib/api';
import PreviewThenConfirm from './PreviewThenConfirm';

// ── small shared bits ───────────────────────────────────────────────────────

function Stat({ label, value, tone }) {
  const toneCls = { warn: 'text-orange-400', ok: 'text-green-400', danger: 'text-red-400' }[tone] || 'text-[var(--text-primary)]';
  return (
    <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-card)] px-3 py-2">
      <div className="text-[11px] text-[var(--text-muted)]">{label}</div>
      <div className={`text-lg font-semibold ${toneCls}`}>{value}</div>
    </div>
  );
}

function CollapsibleSection({ step, title, Icon, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-md border border-[var(--border-color)] overflow-hidden">
      <button type="button" onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-[var(--bg-hover)] transition-colors bg-[var(--bg-card)]"
        data-testid={`data-health-section-toggle-${step}`}>
        <span className="flex-shrink-0 h-5 w-5 rounded-full bg-[var(--accent)]/15 text-[var(--accent)] text-[11px] font-bold flex items-center justify-center">{step}</span>
        {Icon && <Icon className="h-4 w-4 text-[var(--accent)] flex-shrink-0" />}
        <span className="text-sm font-semibold text-[var(--text-primary)] flex-1">{title}</span>
        {open ? <ChevronDown className="h-4 w-4 text-[var(--text-muted)]" /> : <ChevronRight className="h-4 w-4 text-[var(--text-muted)]" />}
      </button>
      {open && <div className="p-3 space-y-3 border-t border-[var(--border-color)]">{children}</div>}
    </div>
  );
}

const countRows = (obj = {}) => Object.entries(obj).filter(([, n]) => n);

// ── 1. Integrity overview (read-only) ───────────────────────────────────────

function IntegrityOverviewSection() {
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const runScan = () => {
    setLoading(true); setError('');
    crmMaintenance.integrityDetect()
      .then(({ data }) => setReport(data))
      .catch((e) => setError(e.response?.data?.detail || 'Scan failed'))
      .finally(() => setLoading(false));
  };

  return (
    <div className="space-y-3">
      <Button type="button" size="sm" onClick={runScan} disabled={loading} data-testid="integrity-scan-btn"
        variant="outline" className="border-[var(--accent)]/40 text-[var(--accent)] hover:bg-[var(--accent)]/10">
        {loading ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Scanning…</> : <>Run scan</>}
      </Button>
      {error && <p className="text-xs text-red-400">{error}</p>}
      {report && (
        <div className="space-y-3 text-sm" data-testid="integrity-report">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Stat label="Schools" value={report.counts?.schools ?? 0} />
            <Stat label="Leads" value={report.counts?.leads ?? 0} />
            <Stat label="Contacts" value={report.counts?.contacts ?? 0} />
            <Stat label="Soft-deleted schools w/ live children" value={report.schools_soft_deleted_with_children ?? 0} tone={report.schools_soft_deleted_with_children ? 'danger' : 'ok'} />
          </div>

          <div>
            <p className="mb-1 text-xs font-medium text-[var(--text-secondary)]">Lead ⇄ Contact links</p>
            <ul className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs text-[var(--text-secondary)]">
              <li className="flex justify-between"><span>converted_from_contact, no contact_id</span><span className="font-mono">{report.links?.converted_from_no_contact_id ?? 0}</span></li>
              <li className="flex justify-between"><span>dangling contact_id</span><span className="font-mono">{report.links?.dangling_contact_id ?? 0}</span></li>
              <li className="flex justify-between"><span>contact_id set, no back-ref</span><span className="font-mono">{report.links?.lead_contact_id_no_backref ?? 0}</span></li>
              <li className="flex justify-between"><span>converted contact, no lead points back</span><span className="font-mono">{report.links?.contacts_converted_no_lead ?? 0}</span></li>
            </ul>
          </div>

          <div>
            <p className="mb-1 text-xs font-medium text-[var(--text-secondary)]">Duplicate ids</p>
            <ul className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs text-[var(--text-secondary)]">
              <li className="flex justify-between"><span>school_id values reused</span><span className="font-mono">{report.duplicates?.school_id?.length ?? 0}</span></li>
              <li className="flex justify-between"><span>lead_id values reused</span><span className="font-mono">{report.duplicates?.lead_id?.length ?? 0}</span></li>
            </ul>
          </div>

          <div>
            <p className="mb-1 text-xs font-medium text-[var(--text-secondary)]">Phone hygiene per collection</p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="text-[var(--text-muted)]">
                  <th className="text-left py-1">Collection</th><th className="text-right px-2">Clean</th>
                  <th className="text-right px-2">Recoverable</th><th className="text-right px-2">Needs review</th>
                  <th className="text-right px-2">Lossy</th><th className="text-right px-2">Empty</th>
                </tr></thead>
                <tbody>
                  {Object.entries(report.phones || {}).map(([coll, s]) => (
                    <tr key={coll} className="border-t border-[var(--border-color)] text-[var(--text-secondary)]">
                      <td className="py-1 capitalize">{coll}</td>
                      <td className="text-right px-2 font-mono">{s.clean}</td>
                      <td className="text-right px-2 font-mono text-orange-400">{s.recoverable}</td>
                      <td className="text-right px-2 font-mono text-yellow-500">{s.needs_review}</td>
                      <td className="text-right px-2 font-mono text-red-400">{s.lossy}</td>
                      <td className="text-right px-2 font-mono">{s.empty}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── 2. Duplicate schools / merge ────────────────────────────────────────────

function MergePreview({ data }) {
  const ambiguity = data.ambiguous_name_fallback_rows;
  return (
    <div className="space-y-2 text-xs">
      <p className="font-medium text-orange-400">
        Merging {data.merge_ids?.length ?? 0} school(s) into survivor {data.survivor_id}
      </p>
      <div>
        <p className="mb-1 font-medium text-[var(--text-secondary)]">Moved (deduped totals)</p>
        <ul className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-[var(--text-secondary)]">
          {countRows(data.moved).map(([k, n]) => (
            <li key={k} className="flex justify-between capitalize"><span>{k}</span><span className="font-mono">{n}</span></li>
          ))}
          {countRows(data.moved).length === 0 && <li className="text-[var(--text-muted)]">Nothing to move.</li>}
        </ul>
      </div>
      <div>
        <p className="mb-1 font-medium text-[var(--text-secondary)]">Survivor children — before → after</p>
        <ul className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-[var(--text-secondary)]">
          {Object.keys(data.survivor_children_before || {}).map((k) => (
            <li key={k} className="flex justify-between capitalize"><span>{k}</span><span className="font-mono">{data.survivor_children_before[k]} → {data.survivor_children_after?.[k]}</span></li>
          ))}
        </ul>
      </div>
      {ambiguity && ambiguity.count > 0 && (
        <div className="rounded-md border border-red-500/40 bg-red-500/10 p-2 space-y-1" data-testid="merge-ambiguity-warning">
          <p className="flex items-center gap-1.5 font-semibold text-red-400"><AlertTriangle className="h-3.5 w-3.5" /> {ambiguity.count} ambiguous row(s) — verify before confirming</p>
          <p className="text-[var(--text-secondary)]">{ambiguity.note}</p>
          <ul className="space-y-0.5">
            {(ambiguity.samples || []).slice(0, 8).map((s, i) => (
              <li key={i} className="text-[var(--text-muted)]">
                <span className="font-mono">{s.collection}</span> · {s.doc_id} · "{s.school_name}" also matches: {(s.also_matches_schools || []).map((r) => r.school_name || r.school_id).join(', ') || '—'}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function MergeResult({ data }) {
  return (
    <div className="space-y-1 text-xs text-[var(--text-secondary)]">
      <p>Merged {data.merged?.length ?? 0} school(s) into <span className="font-mono">{data.survivor_id}</span>.</p>
      <p>Backups: {(data.backups || []).map((b) => <span key={b} className="font-mono mr-1">{b}</span>)}</p>
      {data.undo_note && <p className="text-[var(--text-muted)]">{data.undo_note}</p>}
    </div>
  );
}

function DuplicateGroupCard({ group, active, onToggle, onMerged }) {
  const members = group.schools || [];
  const [survivorId, setSurvivorId] = useState(members[0]?.school_id || '');
  const mergeIds = members.filter((m) => m.school_id !== survivorId).map((m) => m.school_id);

  return (
    <div className="rounded-md border border-[var(--border-color)] overflow-hidden">
      <button type="button" onClick={onToggle}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left hover:bg-[var(--bg-hover)]"
        data-testid={`dup-group-toggle-${group.normalized_name}`}>
        <span className="text-xs font-medium text-[var(--text-primary)] truncate">{group.normalized_name || '(blank)'} — {members.length} school(s)</span>
        <span className="text-[10px] text-[var(--text-muted)] flex-shrink-0">{group.total_children} total records {active ? <ChevronDown className="inline h-3.5 w-3.5 ml-1" /> : <ChevronRight className="inline h-3.5 w-3.5 ml-1" />}</span>
      </button>
      {active && (
        <div className="p-3 space-y-3 border-t border-[var(--border-color)]">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="text-[var(--text-muted)]">
                <th className="text-left py-1 pr-2">Survivor</th><th className="text-left py-1 pr-2">School</th>
                <th className="text-left py-1 pr-2">City</th><th className="text-left py-1 pr-2">Created</th>
                <th className="text-right py-1">Leads/Contacts/Quotes/Orders</th>
              </tr></thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.school_id} className="border-t border-[var(--border-color)]">
                    <td className="py-1 pr-2">
                      <input type="radio" name={`survivor-${group.normalized_name}`} checked={survivorId === m.school_id}
                        onChange={() => setSurvivorId(m.school_id)} data-testid={`survivor-radio-${m.school_id}`} className="accent-[var(--accent)]" />
                    </td>
                    <td className="py-1 pr-2 text-[var(--text-secondary)]">{m.school_name || '(blank)'} <span className="text-[var(--text-muted)] font-mono">({m.school_id})</span></td>
                    <td className="py-1 pr-2 text-[var(--text-secondary)]">{m.city || '—'}</td>
                    <td className="py-1 pr-2 text-[var(--text-muted)]">{m.created_at ? m.created_at.slice(0, 10) : '—'}</td>
                    <td className="py-1 text-right font-mono text-[var(--text-secondary)]">
                      {m.children?.leads || 0}/{m.children?.contacts || 0}/{m.children?.quotations || 0}/{m.children?.orders || 0}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <PreviewThenConfirm
            key={`${group.normalized_name}:${survivorId}`}
            previewLabel="Preview merge"
            confirmLabel="Merge"
            confirmWord="MERGE"
            disablePreview={!survivorId || mergeIds.length === 0}
            disabledReason={!survivorId ? 'Pick a survivor above first.' : ''}
            runDryRun={() => crmMaintenance.mergeSchools({ survivor_id: survivorId, merge_ids: mergeIds, dry_run: true, reason: '' })}
            runConfirm={(_preview, reason) => crmMaintenance.mergeSchools({ survivor_id: survivorId, merge_ids: mergeIds, dry_run: false, confirm: true, reason })}
            renderPreview={(data) => <MergePreview data={data} />}
            renderResult={(data) => <MergeResult data={data} />}
            onDone={onMerged}
          />
        </div>
      )}
    </div>
  );
}

function DuplicateSchoolsSection() {
  const [groups, setGroups] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [activeKey, setActiveKey] = useState('');

  const loadGroups = useCallback(() => {
    setLoading(true); setError('');
    crmMaintenance.duplicateSchools()
      .then(({ data }) => setGroups(data.groups || []))
      .catch((e) => setError(e.response?.data?.detail || 'Could not load duplicates'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Button type="button" size="sm" onClick={loadGroups} disabled={loading} data-testid="find-duplicates-btn"
          variant="outline" className="border-[var(--accent)]/40 text-[var(--accent)] hover:bg-[var(--accent)]/10">
          {loading ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Searching…</> : (groups ? <><RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Refresh</> : 'Find duplicates')}
        </Button>
        {groups && <span className="text-xs text-[var(--text-muted)]">{groups.length} duplicate group(s)</span>}
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
      {groups && groups.length === 0 && <p className="text-xs text-[var(--text-muted)]">No duplicate schools found.</p>}
      {groups && groups.length > 0 && (
        <div className="space-y-2" data-testid="duplicate-groups-list">
          {groups.map((g) => (
            <DuplicateGroupCard
              key={g.normalized_name}
              group={g}
              active={activeKey === g.normalized_name}
              onToggle={() => setActiveKey((k) => (k === g.normalized_name ? '' : g.normalized_name))}
              onMerged={() => { loadGroups(); setActiveKey(''); }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── 2b. Fuzzy duplicates (Google-Contacts style, field-by-field) ─────────────

const FUZZY_FIELDS = [
  { key: 'school_name', label: 'Name' },
  { key: 'city', label: 'City' },
  { key: 'state', label: 'State' },
  { key: 'address', label: 'Address' },
  { key: 'phone', label: 'Phone' },
  { key: 'email', label: 'Email' },
  { key: 'board', label: 'Board' },
  { key: 'school_type', label: 'Type' },
  { key: 'pincode', label: 'Pincode' },
  { key: 'assigned_name', label: 'Owner', choiceKey: 'assigned_to' },
];
const childTotal = (c) => (c ? (c.leads + c.contacts + c.quotations + c.orders) : 0);

// Team-verified Excel round-trip: download candidate groups → mark in Excel →
// upload → preview plan → execute merges. Because DPS = Delhi Public School can
// only be judged by a human, the algorithm just surfaces + the team decides.
function ExcelDedupeCard() {
  const fileRef = useRef(null);
  const [downloading, setDownloading] = useState(false);
  const [plan, setPlan] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState('');
  const [merges, setMerges] = useState([]);
  const [undoing, setUndoing] = useState('');

  const loadMerges = useCallback(() => {
    crmMaintenance.mergeLog().then(r => setMerges(r.data.merges || [])).catch(() => {});
  }, []);
  useEffect(() => { loadMerges(); }, [loadMerges]);

  const undo = async (m) => {
    if (!window.confirm(`Undo the merge of "${(m.merge_names || []).join(', ')}" into "${m.survivor_name}"?\n\nThe duplicate school(s) and every moved record are restored.`)) return;
    setUndoing(m.merge_op_id);
    try {
      const { data } = await crmMaintenance.undoMerge(m.merge_op_id);
      const rev = Object.values(data.children_reverted || {}).reduce((a, b) => a + b, 0);
      toast.success(`Un-merged · ${data.schools_restored} school(s) + ${rev} record(s) restored`);
      loadMerges();
      window.dispatchEvent?.(new Event('crm:data-changed'));
    } catch (e) { toast.error(e?.response?.data?.detail || 'Undo failed'); }
    finally { setUndoing(''); }
  };

  const download = async () => {
    setDownloading(true);
    try {
      const res = await crmMaintenance.exportDuplicatesXlsx();
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url; a.download = `duplicate-schools-review-${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success('Downloaded — review in Excel, mark keep/merge/ignore, then upload back');
    } catch (e) { toast.error(e?.response?.data?.detail || 'Download failed'); }
    finally { setDownloading(false); }
  };

  const onUpload = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setUploading(true); setPlan(null);
    try {
      const fd = new FormData(); fd.append('file', f);
      const { data } = await crmMaintenance.applyDuplicateReview(fd);
      setPlan(data);
      if (!data.groups_to_merge) toast('No merges marked in this file');
    } catch (err) { toast.error(err?.response?.data?.detail || 'Could not read the file'); }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = ''; }
  };

  const execute = async () => {
    if (!plan?.plan?.length) return;
    if (!window.confirm(`Merge ${plan.total_schools_merged} school(s) into ${plan.groups_to_merge} survivor(s)? Backups are kept.`)) return;
    setRunning(true);
    let done = 0, moved = 0;
    for (const g of plan.plan) {
      setProgress(`Merging ${g.survivor_name}… (${done + 1}/${plan.plan.length})`);
      try {
        const { data } = await crmMaintenance.mergeSchools({
          survivor_id: g.survivor_id, merge_ids: g.merge_ids,
          dry_run: false, confirm: true, reason: 'Excel-verified duplicate review' });
        moved += Object.values(data.moved || {}).reduce((a, b) => a + b, 0);
        done++;
      } catch (err) { toast.error(`Group ${g.group} failed: ${err?.response?.data?.detail || 'error'}`); }
    }
    setRunning(false); setProgress('');
    toast.success(`Merged ${done} group(s) · ${moved} records moved`);
    setPlan(null);
    loadMerges();
    window.dispatchEvent?.(new Event('crm:data-changed'));
  };

  return (
    <div className="rounded-lg border border-[var(--border-color)] p-3 space-y-2.5 bg-[var(--bg-primary)]/40">
      <p className="text-xs font-semibold text-[var(--text-primary)]">Manual review in Excel (team-verified)</p>
      <p className="text-[11px] text-[var(--text-muted)]">
        DPS Vasant Vihar = Delhi Public School Vasant Vihar — only a human can be sure. Download the grouped
        candidates, mark <b>keep / merge / ignore</b> in Excel, upload back, then execute the confirmed merges.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="outline" onClick={download} disabled={downloading}
          className="border-[var(--border-color)] text-[var(--text-secondary)]" data-testid="dup-download-btn">
          {downloading ? 'Preparing…' : '⬇ Download for Excel'}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => fileRef.current?.click()} disabled={uploading}
          className="border-[var(--border-color)] text-[var(--text-secondary)]" data-testid="dup-upload-btn">
          {uploading ? 'Reading…' : '⬆ Upload verified'}
        </Button>
        <input ref={fileRef} type="file" accept=".xlsx" className="hidden" onChange={onUpload} />
      </div>

      {plan && (
        <div className="rounded-md border border-[var(--border-color)] p-2.5 space-y-1.5">
          {plan.errors?.length > 0 && plan.errors.map((er, i) => (
            <p key={i} className="text-[11px] text-amber-500">⚠ {er}</p>
          ))}
          {plan.groups_to_merge > 0 ? (
            <>
              <p className="text-xs font-medium text-[var(--text-primary)]">
                {plan.groups_to_merge} group(s) → merge {plan.total_schools_merged} school(s), moving {plan.records_moving} records.
              </p>
              <div className="max-h-40 overflow-y-auto space-y-1">
                {plan.plan.map((g) => (
                  <div key={g.group} className="text-[11px] text-[var(--text-secondary)]">
                    <b>{g.survivor_name}</b> ← {g.merges.map(m => m.school_name).join(', ')}
                  </div>
                ))}
              </div>
              <Button type="button" size="sm" onClick={execute} disabled={running}
                className="bg-[#e94560] hover:bg-[#f05c75] text-white" data-testid="dup-execute-btn">
                {running ? (progress || 'Merging…') : `Execute ${plan.groups_to_merge} merge(s)`}
              </Button>
            </>
          ) : (
            <p className="text-[11px] text-[var(--text-muted)]">No rows marked "merge" (with a "keep" survivor).</p>
          )}
        </div>
      )}

      {merges.length > 0 && (
        <div className="rounded-md border border-[var(--border-color)] p-2.5">
          <p className="text-[10px] uppercase tracking-wider font-semibold text-[var(--text-muted)] mb-1.5">Recent merges — one-click undo</p>
          <div className="space-y-1.5 max-h-40 overflow-y-auto">
            {merges.map((m) => (
              <div key={m.merge_op_id} className="flex items-center gap-2 text-[11px]">
                <span className="flex-1 truncate text-[var(--text-secondary)]">
                  <b className="text-[var(--text-primary)]">{m.survivor_name}</b> ← {(m.merge_names || []).join(', ')} · {m.records_moved} rec
                </span>
                <button onClick={() => undo(m)} disabled={undoing === m.merge_op_id}
                  className="flex-shrink-0 h-7 px-2.5 rounded-lg border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-red-500 hover:border-red-500/50 font-semibold">
                  {undoing === m.merge_op_id ? 'Undoing…' : 'Undo'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function FuzzyDuplicatesSection() {
  const [cands, setCands] = useState(null);
  const [idx, setIdx] = useState(0);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [survivor, setSurvivor] = useState('a');   // 'a' | 'b'
  const [choice, setChoice] = useState({});        // field.key -> 'a' | 'b'
  const [info, setInfo] = useState('');

  const load = useCallback(() => {
    setLoading(true); setError('');
    crmMaintenance.duplicateSchoolsFuzzy()
      .then(({ data }) => { setCands(data.candidates || []); setIdx(0); })
      .catch((e) => setError(e.response?.data?.detail || 'Could not load fuzzy duplicates'))
      .finally(() => setLoading(false));
  }, []);

  const cur = cands && cands[idx];

  // defaults whenever the current pair changes
  React.useEffect(() => {
    if (!cur) return;
    const surv = childTotal(cur.b_children) > childTotal(cur.a_children) ? 'b' : 'a';
    setSurvivor(surv);
    const dup = surv === 'a' ? 'b' : 'a';
    const sel = {};
    FUZZY_FIELDS.forEach((f) => {
      const sv = cur[surv]?.[f.key], dv = cur[dup]?.[f.key];
      sel[f.key] = (!sv && dv) ? dup : surv;
    });
    setChoice(sel);
  }, [cur]);

  const drop = () => { setCands((prev) => prev.filter((_, i) => i !== idx)); setIdx((i) => Math.max(0, Math.min(i, (cands?.length || 1) - 2))); };

  const doMerge = async () => {
    if (!cur) return;
    const dup = survivor === 'a' ? 'b' : 'a';
    const survivor_id = cur[survivor].school_id;
    const duplicate_id = cur[dup].school_id;
    const field_choices = {};
    FUZZY_FIELDS.forEach((f) => {
      const side = choice[f.key] || survivor;
      field_choices[f.choiceKey || f.key] = cur[side].school_id;  // survivor id = keep
    });
    setBusy(true); setError('');
    try {
      const { data } = await crmMaintenance.mergeSchools({
        survivor_id, merge_ids: [duplicate_id], dry_run: false, confirm: true,
        reason: 'fuzzy duplicate merge', field_choices,
      });
      const mv = data.moved || {};
      const moved = Object.values(mv).reduce((a, b) => a + b, 0);
      window.dispatchEvent?.(new Event('crm:data-changed'));
      setError(''); drop();
      // lightweight inline note
      setInfo(`Merged — ${moved} child record(s) moved to the kept school.`);
    } catch (e) {
      setError(e.response?.data?.detail || 'Merge failed');
    }
    setBusy(false);
  };

  const doDismiss = async () => {
    if (!cur) return;
    setBusy(true);
    try {
      await crmMaintenance.dismissDuplicatePair(cur.a.school_id, cur.b.school_id);
      drop();
    } catch (e) { setError(e.response?.data?.detail || 'Dismiss failed'); }
    setBusy(false);
  };

  if (!cands) {
    return (
      <div className="space-y-3">
        <ExcelDedupeCard />
        <p className="text-[11px] text-[var(--text-muted)] pt-1">— or review pairs one-by-one in the app —</p>
        <Button type="button" size="sm" onClick={load} disabled={loading} data-testid="find-fuzzy-btn"
          variant="outline" className="border-[var(--accent)]/40 text-[var(--accent)] hover:bg-[var(--accent)]/10">
          {loading ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Scanning…</> : 'Find near-duplicates'}
        </Button>
        {error && <p className="text-xs text-red-400">{error}</p>}
        <p className="text-xs text-[var(--text-muted)]">Fuzzy matches on name + city + address — catches duplicates that don’t share an identical name (handled by the section above).</p>
      </div>
    );
  }

  if (!cur) {
    return (
      <div className="space-y-2">
        {info && <p className="text-xs text-green-400">{info}</p>}
        <p className="text-xs text-[var(--text-muted)] flex items-center gap-1.5"><CheckCircle className="h-3.5 w-3.5 text-green-500" /> No near-duplicate pairs to review.</p>
        <Button type="button" size="sm" variant="outline" onClick={load} className="text-[var(--text-secondary)]">
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Re-scan
        </Button>
      </div>
    );
  }

  const dup = survivor === 'a' ? 'b' : 'a';
  const scorePct = Math.round((cur.score || 0) * 100);
  const Header = ({ side }) => {
    const s = cur[side]; const counts = side === 'a' ? cur.a_children : cur.b_children;
    const keep = side === survivor;
    return (
      <button type="button" onClick={() => setSurvivor(side)}
        className={`flex-1 text-left rounded-md border p-2.5 transition-all ${keep ? 'border-[var(--accent)] bg-[var(--accent)]/10' : 'border-[var(--border-color)]'}`}>
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold text-[var(--text-primary)] truncate">{s.school_name || '(no name)'}</span>
          <span className={`text-[9px] px-1.5 py-0.5 rounded-full shrink-0 ${keep ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-muted)] border border-[var(--border-color)]'}`}>{keep ? 'KEEP' : 'merge in'}</span>
        </div>
        <div className="text-[10px] mt-0.5 text-[var(--text-muted)]">{counts.contacts}c · {counts.leads}l · {counts.orders}o · {counts.quotations}q</div>
      </button>
    );
  };

  return (
    <div className="space-y-3" data-testid="fuzzy-duplicates">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <span className="text-xs text-[var(--text-muted)]">Pair {idx + 1} of {cands.length} · {scorePct}% match</span>
        <Button type="button" size="sm" variant="ghost" onClick={load} className="text-[var(--text-muted)] h-7 px-2"><RefreshCw className="h-3.5 w-3.5" /></Button>
      </div>
      <p className="text-[11px] text-[var(--text-muted)]">Click a card to choose which school to <b>keep</b>, then pick the winning value per field. Merge moves the other’s contacts/leads/orders/quotes onto the kept school and removes it (reversible — triple backup).</p>
      <div className="flex gap-2">{['a', 'b'].map((side) => <Header key={side} side={side} />)}</div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead><tr className="text-[var(--text-muted)]">
            <th className="text-left py-1">Field</th>
            <th className="text-left px-2">{cur.a.school_name || 'A'}</th>
            <th className="text-left px-2">{cur.b.school_name || 'B'}</th>
          </tr></thead>
          <tbody>
            {FUZZY_FIELDS.map((f) => {
              const av = cur.a?.[f.key] ?? '', bv = cur.b?.[f.key] ?? '';
              const sel = choice[f.key] || survivor;
              const conflict = String(av || '') !== String(bv || '');
              const Cell = ({ side, val }) => (
                <td className="px-2 py-1">
                  <label className={`flex items-start gap-1.5 rounded px-1.5 py-0.5 cursor-pointer ${sel === side ? 'bg-[var(--accent)]/15 ring-1 ring-[var(--accent)]' : ''}`}>
                    <input type="radio" name={`fz_${f.key}`} checked={sel === side}
                      onChange={() => setChoice((p) => ({ ...p, [f.key]: side }))} className="mt-0.5 accent-[var(--accent)]" />
                    <span className={val ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]'}>{val || '—'}</span>
                  </label>
                </td>
              );
              return (
                <tr key={f.key} className={`border-t border-[var(--border-color)] ${conflict ? '' : 'opacity-60'}`}>
                  <td className="py-1 text-[var(--text-secondary)]">{f.label}</td>
                  <Cell side="a" val={av} /><Cell side="b" val={bv} />
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}

      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex gap-2">
          <Button type="button" size="sm" variant="outline" onClick={doDismiss} disabled={busy} data-testid="fuzzy-dismiss-btn" className="text-[var(--text-secondary)]"><X className="mr-1.5 h-3.5 w-3.5" /> Not a duplicate</Button>
          <Button type="button" size="sm" variant="outline" onClick={() => setIdx((i) => (i + 1) % cands.length)} disabled={busy || cands.length < 2} className="text-[var(--text-secondary)]"><SkipForward className="mr-1.5 h-3.5 w-3.5" /> Skip</Button>
        </div>
        <Button type="button" size="sm" onClick={doMerge} disabled={busy} data-testid="fuzzy-merge-btn"
          className="bg-[var(--accent)] text-white hover:opacity-90">
          <GitMerge className="mr-1.5 h-3.5 w-3.5" /> {busy ? 'Merging…' : `Merge into “${cur[survivor].school_name || 'kept'}”`}
        </Button>
      </div>
    </div>
  );
}

// ── 3. Phone repair ──────────────────────────────────────────────────────────

function PhoneRepairPreview({ data }) {
  return (
    <div className="space-y-2 text-xs">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead><tr className="text-[var(--text-muted)]">
            <th className="text-left py-1">Collection</th><th className="text-right px-2">Recoverable</th>
            <th className="text-right px-2">Lossy (skipped)</th><th className="text-right px-2">Needs review (skipped)</th>
          </tr></thead>
          <tbody>
            {Object.entries(data.per_collection || {}).map(([coll, s]) => (
              <tr key={coll} className="border-t border-[var(--border-color)] text-[var(--text-secondary)]">
                <td className="py-1 capitalize">{coll}</td>
                <td className="text-right px-2 font-mono text-orange-400">{s.recoverable}</td>
                <td className="text-right px-2 font-mono text-red-400">{s.lossy}</td>
                <td className="text-right px-2 font-mono text-yellow-500">{s.needs_review}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[var(--text-secondary)]">
        Only <b className="text-orange-400">recoverable</b> ({data.totals?.recoverable ?? 0}) numbers are rewritten.
        Lossy ({data.totals?.lossy ?? 0}) and needs-review ({data.totals?.needs_review ?? 0}) numbers are intentionally
        <b> flagged, not fixed</b> — normalizing them would fabricate a wrong number.
      </p>
      {Object.keys(data.skipped_samples || {}).length > 0 && (
        <div>
          <p className="mb-1 text-[var(--text-muted)]">Skipped sample values (never overwritten):</p>
          <ul className="space-y-0.5 text-[var(--text-muted)]">
            {Object.entries(data.skipped_samples).map(([coll, vals]) => (
              <li key={coll}><span className="capitalize">{coll}</span>: {vals.join(', ')}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function PhoneRepairResult({ data }) {
  return (
    <div className="text-xs text-[var(--text-secondary)] space-y-1">
      <p>Normalized {data.totals?.recoverable ?? 0} number(s); flagged {data.totals?.lossy ?? 0} lossy + {data.totals?.needs_review ?? 0} needs-review.</p>
      {data.backup_id && <p>Backup: <span className="font-mono">{data.backup_id}</span></p>}
    </div>
  );
}

function PhoneRepairSection() {
  return (
    <PreviewThenConfirm
      previewLabel="Preview phone repair"
      confirmWord="CONFIRM"
      runDryRun={() => crmMaintenance.repairPhones({ dry_run: true, reason: '' })}
      runConfirm={(_preview, reason) => crmMaintenance.repairPhones({ dry_run: false, reason })}
      renderPreview={(data) => <PhoneRepairPreview data={data} />}
      renderResult={(data) => <PhoneRepairResult data={data} />}
    />
  );
}

// ── 4. Link repair (migrations) ─────────────────────────────────────────────

function UnifyLinksSection() {
  return (
    <PreviewThenConfirm
      previewLabel="Preview unify-links"
      confirmWord="CONFIRM"
      runDryRun={() => crmMaintenance.unifyLinks({ dry_run: true, reason: '' })}
      runConfirm={(_preview, reason) => crmMaintenance.unifyLinks({ dry_run: false, reason })}
      renderPreview={(data) => (
        <div className="text-xs space-y-1 text-[var(--text-secondary)]">
          <p>Would set <span className="font-mono">{data.leads_would_set_contact_id}</span> lead.contact_id, back-ref <span className="font-mono">{data.contacts_would_backref}</span> contact(s).</p>
          {data.sample_leads?.length > 0 && <p className="text-[var(--text-muted)]">e.g. {data.sample_leads.slice(0, 5).map((s) => s.lead_id).join(', ')}</p>}
        </div>
      )}
      renderResult={(data) => (
        <div className="text-xs text-[var(--text-secondary)] space-y-1">
          <p>Updated {data.leads_updated ?? 0} lead(s), {data.contacts_updated ?? 0} contact(s).</p>
          {data.backup_id && <p>Backup: <span className="font-mono">{data.backup_id}</span></p>}
        </div>
      )}
    />
  );
}

function DanglingLinksSection() {
  return (
    <PreviewThenConfirm
      previewLabel="Preview dangling-link repair"
      confirmWord="CONFIRM"
      runDryRun={() => crmMaintenance.repairDanglingContactLinks({ dry_run: true, reason: '' })}
      runConfirm={(_preview, reason) => crmMaintenance.repairDanglingContactLinks({ dry_run: false, reason })}
      renderPreview={(data) => (
        <div className="text-xs space-y-1 text-[var(--text-secondary)]">
          <p>Would unset contact_id on <span className="font-mono">{data.leads_would_unset}</span> lead(s) pointing at a missing/deleted contact.</p>
          {data.sample?.length > 0 && <p className="text-[var(--text-muted)]">e.g. {data.sample.slice(0, 5).map((s) => s.lead_id).join(', ')}</p>}
        </div>
      )}
      renderResult={(data) => (
        <div className="text-xs text-[var(--text-secondary)] space-y-1">
          <p>Unset {data.leads_unset ?? 0} dangling link(s).</p>
          {data.backup_id && <p>Backup: <span className="font-mono">{data.backup_id}</span></p>}
        </div>
      )}
    />
  );
}

function LinkRepairSection() {
  return (
    <div className="space-y-3">
      <div>
        <p className="mb-1.5 text-xs font-semibold text-[var(--text-primary)]">Unify lead ⇄ contact links</p>
        <UnifyLinksSection />
      </div>
      <div className="pt-2 border-t border-[var(--border-color)]">
        <p className="mb-1.5 text-xs font-semibold text-[var(--text-primary)]">Repair dangling contact links</p>
        <DanglingLinksSection />
      </div>
    </div>
  );
}

// ── panel shell ──────────────────────────────────────────────────────────────

/**
 * SUPERADMIN-only "CRM Data Health" panel — surfaces the guarded integrity
 * scan + migration/repair endpoints (all audited, GO) so the owner can run
 * cleanup from the app instead of raw API calls. Same gate as
 * DataCleanupPanel/OwnerDeleteButton (`useIsOwner`); renders nothing for
 * everyone else. Every write is preview-first (dry-run) with an explicit
 * type-the-word confirm (PreviewThenConfirm) — no action here can execute
 * without its dry-run result already on screen.
 */
export default function DataHealthPanel() {
  const isOwner = useIsOwner();
  const [open, setOpen] = useState(false);

  if (!isOwner) return null;

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}
        className="border-red-500/40 text-red-400 hover:bg-red-500/10 hover:text-red-300" data-testid="data-health-trigger">
        <Activity className="mr-1.5 h-3.5 w-3.5" /> Data Health
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-3xl max-h-[88dvh] overflow-y-auto" data-testid="data-health-panel">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-red-400" /> CRM Data Health
            </DialogTitle>
          </DialogHeader>

          <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 flex items-start gap-2" data-testid="data-health-backup-banner">
            <ShieldAlert className="h-4 w-4 text-red-400 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-red-400">
              <b>Take a fresh Atlas backup before running any repair below.</b> Run the sections in order
              (1 → 4): Integrity Overview first (read-only), then Duplicate Merge, then Phone Repair, then
              Link Repair — each later step is safer once earlier ones are clean.
            </p>
          </div>

          <div className="space-y-2">
            <CollapsibleSection step={1} title="Integrity Overview (read-only scan)" Icon={Database} defaultOpen>
              <IntegrityOverviewSection />
            </CollapsibleSection>

            <CollapsibleSection step={2} title="Duplicate Schools / Merge" Icon={GitMerge}>
              <DuplicateSchoolsSection />
            </CollapsibleSection>

            <CollapsibleSection step="2b" title="Fuzzy Duplicates (near-matches, field-by-field)" Icon={GitMerge}>
              <FuzzyDuplicatesSection />
            </CollapsibleSection>

            <CollapsibleSection step={3} title="Phone Repair" Icon={Phone}>
              <PhoneRepairSection />
            </CollapsibleSection>

            <CollapsibleSection step={4} title="Link Repair (migrations)" Icon={Link2}>
              <LinkRepairSection />
            </CollapsibleSection>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

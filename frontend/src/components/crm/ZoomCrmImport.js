import React, { useState, useEffect } from 'react';
import { Video, Settings, Loader2, Trash2, Plus, Sparkles, Link2, CheckCircle, Upload } from 'lucide-react';
import { crmZoom, certsApi } from '../../lib/api';
import { toast } from 'sonner';

const PINK = '#e94560';

const cleanNameJS = (s) =>
  (s || '').replace(/[ \t]+/g, ' ').trim().split(' ')
    .map(w => w.replace(/[A-Za-z]+/g, m => m.charAt(0).toUpperCase() + m.slice(1).toLowerCase()))
    .join(' ');

/**
 * ZoomCrmImport — fetch a Zoom meeting's attendees (name/school/designation + theme),
 * fuzzy-suggest existing CRM schools/roles, edit, then create Schools + Contacts + Leads.
 */
export default function ZoomCrmImport() {
  const card      = 'bg-[var(--bg-card)] border-[var(--border-color)]';
  const textPri   = 'text-[var(--text-primary)]';
  const textSec   = 'text-[var(--text-secondary)]';
  const textMuted = 'text-[var(--text-muted)]';
  const inputCls  = 'bg-[var(--bg-primary)] border border-[var(--border-color)] text-[var(--text-primary)] rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[#e94560] w-full';
  const cell      = 'bg-transparent border-0 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[#e94560] rounded px-1 py-0.5 w-full';

  const [meetingId, setMeetingId] = useState('');
  const [theme, setTheme] = useState('');
  const [rows, setRows] = useState([]);
  const [fetching, setFetching] = useState(false);
  const [importing, setImporting] = useState(false);
  const [autoClean, setAutoClean] = useState(true);
  const [createContacts, setCreateContacts] = useState(true);
  const [createLeads, setCreateLeads] = useState(true);
  const [result, setResult] = useState(null);

  /* Zoom credentials (shared with certificates) */
  const [zoomCfg, setZoomCfg] = useState(null);
  const [showCfg, setShowCfg] = useState(false);
  const [zAccount, setZAccount] = useState('');
  const [zClient, setZClient] = useState('');
  const [zSecret, setZSecret] = useState('');
  const [savingZoom, setSavingZoom] = useState(false);

  useEffect(() => {
    certsApi.zoomConfigGet().then(r => {
      const c = r.data || {};
      setZoomCfg(c); setZAccount(c.account_id || ''); setZClient(c.client_id || '');
      if (!c.configured) setShowCfg(true);
    }).catch(() => setZoomCfg({ configured: false }));
  }, []);

  const saveZoom = async () => {
    if (!zAccount.trim() || !zClient.trim() || (!zSecret.trim() && !zoomCfg?.has_secret)) {
      toast.error('Enter Account ID, Client ID and Client Secret'); return;
    }
    setSavingZoom(true);
    try {
      const r = await certsApi.zoomConfigSave({ account_id: zAccount.trim(), client_id: zClient.trim(), client_secret: zSecret.trim() || undefined });
      toast.success('Zoom credentials saved');
      setZoomCfg({ configured: r.data?.configured, account_id: zAccount.trim(), client_id: zClient.trim(), has_secret: true });
      setZSecret(''); if (r.data?.configured) setShowCfg(false);
    } catch (err) { toast.error(err?.response?.data?.detail || 'Failed to save Zoom credentials'); }
    finally { setSavingZoom(false); }
  };

  const decorate = (list) => list.map(r => ({
    name: r.name || '', email: r.email || '', phone: r.phone || '',
    school: r.school || '', designation: r.designation || '',
    school_id: r.school_id || '', contact_role_id: r.contact_role_id || '',
    school_match: r.school_match || null, role_match: r.role_match || null,
  }));

  const fetchMeeting = async () => {
    if (!meetingId.trim()) { toast.error('Enter the Zoom meeting ID'); return; }
    setFetching(true); setResult(null);
    try {
      const r = await crmZoom.fetch(meetingId.trim());
      setTheme(r.data?.theme || '');
      let list = decorate(r.data?.rows || []);
      if (autoClean) list = list.map(x => ({ ...x, name: cleanNameJS(x.name), school: x.school }));
      setRows(list);
      if (!list.length) toast.error('No attendees found for that meeting');
      else toast.success(`${list.length} attendees fetched`);
    } catch (err) { toast.error(err?.response?.data?.detail || 'Zoom fetch failed'); }
    finally { setFetching(false); }
  };

  const recheck = async () => {
    if (!rows.length) return;
    try {
      const r = await crmZoom.suggest(rows.map(({ school_match, role_match, ...keep }) => keep));
      setRows(decorate(r.data?.rows || rows));
      toast.success('Matches refreshed');
    } catch { toast.error('Could not refresh matches'); }
  };

  const update = (i, field, val) => setRows(prev => prev.map((r, idx) => {
    if (idx !== i) return r;
    const next = { ...r, [field]: val };
    if (field === 'school') { next.school_id = ''; }          // editing breaks the link until re-accepted
    if (field === 'designation') { next.contact_role_id = ''; }
    return next;
  }));
  const removeRow = (i) => setRows(prev => prev.filter((_, idx) => idx !== i));
  const addRow = () => setRows(prev => [...prev, { name: '', email: '', phone: '', school: '', designation: '', school_id: '', contact_role_id: '', school_match: null, role_match: null }]);
  const cleanAll = () => setRows(prev => prev.map(r => ({ ...r, name: cleanNameJS(r.name) })));

  const acceptSchool = (i) => setRows(prev => prev.map((r, idx) =>
    idx === i && r.school_match ? { ...r, school_id: r.school_match.school_id, school: r.school_match.school_name } : r));
  const acceptRole = (i) => setRows(prev => prev.map((r, idx) =>
    idx === i && r.role_match ? { ...r, contact_role_id: r.role_match.role_id, designation: r.role_match.name } : r));

  const doImport = async () => {
    const payloadRows = rows.map(r => ({
      name: (autoClean ? cleanNameJS(r.name) : r.name).trim(),
      email: (r.email || '').trim(), phone: (r.phone || '').trim(),
      school: (r.school || '').trim(), school_id: r.school_id || '',
      designation: (r.designation || '').trim(), contact_role_id: r.contact_role_id || '',
    })).filter(r => r.name);
    if (!payloadRows.length) { toast.error('Add at least one attendee with a name'); return; }
    setImporting(true);
    try {
      const r = await crmZoom.import({ theme: theme.trim(), rows: payloadRows, create_lead: createLeads, create_contact: createContacts });
      setResult(r.data);
      toast.success(`Imported: ${r.data.contacts_created} contacts, ${r.data.leads_created} leads`);
    } catch (err) { toast.error(err?.response?.data?.detail || 'Import failed'); }
    finally { setImporting(false); }
  };

  return (
    <div className="space-y-4">
      {/* Credentials */}
      <div className={`${card} border rounded-md p-4 space-y-3`}>
        <div className="flex items-center justify-between gap-2">
          <span className={`text-sm ${textSec}`}>
            {zoomCfg?.configured ? 'Zoom connected.' : 'Connect your Zoom API to fetch meeting attendees.'}
          </span>
          <button type="button" onClick={() => setShowCfg(v => !v)} className={`inline-flex items-center gap-1 text-xs ${textSec} hover:underline`}>
            <Settings className="h-3.5 w-3.5" /> {zoomCfg?.configured ? 'Zoom settings' : 'Add credentials'}
          </button>
        </div>
        {showCfg && (
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
            <input className={inputCls} placeholder="Account ID" value={zAccount} onChange={e => setZAccount(e.target.value)} />
            <input className={inputCls} placeholder="Client ID" value={zClient} onChange={e => setZClient(e.target.value)} />
            <input className={inputCls} type="password" placeholder={zoomCfg?.has_secret ? '•••• (unchanged)' : 'Client Secret'} value={zSecret} onChange={e => setZSecret(e.target.value)} />
            <button type="button" onClick={saveZoom} disabled={savingZoom} className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-white disabled:opacity-40" style={{ background: PINK }}>
              {savingZoom ? <Loader2 className="h-4 w-4 animate-spin" /> : <Settings className="h-4 w-4" />} Save
            </button>
          </div>
        )}
      </div>

      {/* Fetch */}
      <div className={`${card} border rounded-md p-4 space-y-2`}>
        <div className="flex flex-col sm:flex-row gap-2">
          <input className={`${inputCls} flex-1`} placeholder="Zoom meeting ID (e.g. 851 2345 6789)" value={meetingId} onChange={e => setMeetingId(e.target.value)} />
          <button type="button" onClick={fetchMeeting} disabled={fetching || !zoomCfg?.configured}
            className="inline-flex items-center justify-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium text-white disabled:opacity-40 self-start" style={{ background: PINK }}>
            {fetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Video className="h-4 w-4" />} Fetch attendees
          </button>
        </div>
        <p className={`text-xs ${textMuted}`}>Pulls name, email, school &amp; designation (from registration or display name) plus the meeting theme. Phone isn't shared by Zoom — add it for WhatsApp.</p>
      </div>

      {/* Review table */}
      {rows.length > 0 && (
        <div className={`${card} border rounded-md p-4 space-y-3`}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={`block text-xs ${textSec} mb-1`}>Meeting Theme (applied to all leads)</label>
              <input className={inputCls} value={theme} onChange={e => setTheme(e.target.value)} placeholder="e.g. Creative Enrichment Series" />
            </div>
            <div className="flex items-end gap-3 flex-wrap">
              <label className={`flex items-center gap-1 text-xs ${textSec} cursor-pointer`}>
                <input type="checkbox" className="accent-[#e94560] h-3.5 w-3.5" checked={autoClean} onChange={() => setAutoClean(v => !v)} /> Auto-clean names
              </label>
              <label className={`flex items-center gap-1 text-xs ${textSec} cursor-pointer`}>
                <input type="checkbox" className="accent-[#e94560] h-3.5 w-3.5" checked={createContacts} onChange={() => setCreateContacts(v => !v)} /> Create contacts
              </label>
              <label className={`flex items-center gap-1 text-xs ${textSec} cursor-pointer`}>
                <input type="checkbox" className="accent-[#e94560] h-3.5 w-3.5" checked={createLeads} onChange={() => setCreateLeads(v => !v)} /> Create leads
              </label>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className={`text-xs font-medium ${textPri}`}>{rows.length} attendee{rows.length !== 1 ? 's' : ''}</span>
            <div className="flex items-center gap-2">
              <button type="button" onClick={cleanAll} className={`inline-flex items-center gap-1 px-2 py-1 rounded border border-[var(--border-color)] text-xs ${textSec} hover:bg-[var(--bg-hover)]`}><Sparkles className="h-3.5 w-3.5" /> Clean all</button>
              <button type="button" onClick={recheck} className={`inline-flex items-center gap-1 px-2 py-1 rounded border border-[var(--border-color)] text-xs ${textSec} hover:bg-[var(--bg-hover)]`}><Link2 className="h-3.5 w-3.5" /> Re-check matches</button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border-color)]">
                  {['Name', 'School', 'Designation', 'Email', 'Phone', ''].map((h, i) => (
                    <th key={i} className={`px-2 py-1.5 text-left text-xs font-semibold uppercase tracking-wide ${textMuted}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-color)]">
                {rows.map((r, i) => (
                  <tr key={i} className="hover:bg-[var(--bg-hover)] align-top">
                    <td className="px-2 py-1 min-w-[140px]"><input className={cell} value={r.name} onChange={e => update(i, 'name', e.target.value)} onBlur={e => autoClean && update(i, 'name', cleanNameJS(e.target.value))} placeholder="Full name" /></td>
                    <td className="px-2 py-1 min-w-[180px]">
                      <input className={cell} value={r.school} onChange={e => update(i, 'school', e.target.value)} placeholder="School" />
                      {r.school_id
                        ? <span className="inline-flex items-center gap-1 text-[11px] text-green-600 dark:text-green-400"><CheckCircle className="h-3 w-3" /> linked</span>
                        : r.school_match && <button type="button" onClick={() => acceptSchool(i)} className="text-[11px] text-[#e94560] hover:underline" title={`Link to existing school (match ${(r.school_match.score*100|0)}%)`}>≈ {r.school_match.school_name} · link</button>}
                    </td>
                    <td className="px-2 py-1 min-w-[150px]">
                      <input className={cell} value={r.designation} onChange={e => update(i, 'designation', e.target.value)} placeholder="Designation" />
                      {r.contact_role_id
                        ? <span className="inline-flex items-center gap-1 text-[11px] text-green-600 dark:text-green-400"><CheckCircle className="h-3 w-3" /> {r.designation}</span>
                        : r.role_match && <button type="button" onClick={() => acceptRole(i)} className="text-[11px] text-[#e94560] hover:underline">≈ {r.role_match.name} · set</button>}
                    </td>
                    <td className="px-2 py-1 min-w-[160px]"><input className={cell} value={r.email} onChange={e => update(i, 'email', e.target.value)} placeholder="Email" /></td>
                    <td className="px-2 py-1 min-w-[120px]"><input className={cell} value={r.phone} onChange={e => update(i, 'phone', e.target.value)} placeholder="Phone" /></td>
                    <td className="px-2 py-1"><button type="button" onClick={() => removeRow(i)} className="p-1 rounded text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20"><Trash2 className="h-3.5 w-3.5" /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between">
            <button type="button" onClick={addRow} className={`inline-flex items-center gap-1 text-xs ${textSec} hover:underline`}><Plus className="h-3.5 w-3.5" /> Add row</button>
            <button type="button" onClick={doImport} disabled={importing}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium text-white disabled:opacity-40" style={{ background: PINK }}>
              {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Upload to CRM
            </button>
          </div>
        </div>
      )}

      {result && (
        <div className={`${card} border rounded-md p-5`}>
          <div className="flex items-center gap-2 mb-2"><CheckCircle className="h-5 w-5 text-green-500" /><p className={`font-medium ${textPri}`}>Import complete</p></div>
          <div className={`text-sm ${textSec} flex flex-wrap gap-x-4 gap-y-1`}>
            <span>Schools created: <b>{result.schools_created}</b></span>
            <span>Schools linked: <b>{result.schools_linked}</b></span>
            <span>Contacts created: <b>{result.contacts_created}</b></span>
            <span>Contacts duplicate: <b>{result.contacts_duplicate}</b></span>
            <span>Leads created: <b>{result.leads_created}</b></span>
            {result.errors?.length > 0 && <span className="text-red-500">Errors: <b>{result.errors.length}</b></span>}
          </div>
        </div>
      )}
    </div>
  );
}

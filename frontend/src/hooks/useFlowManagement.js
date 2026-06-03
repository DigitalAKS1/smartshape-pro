import { useState, useEffect, useCallback, useRef } from 'react';
import { fms as fmsApi, leads as leadsApi } from '../lib/api';
import { useDataSync, useAutoRefresh } from '../lib/dataSync';
import { useAuth } from '../contexts/AuthContext';
import { toast } from 'sonner';

const PALETTE = ['#e94560','#8b5cf6','#10b981','#f59e0b','#3b82f6','#06b6d4','#f97316','#6366f1','#ec4899'];

export function useFlowManagement() {
  const { user } = useAuth();

  const [tab, setTab]               = useState('board');
  const [flows, setFlows]           = useState([]);
  const [summary, setSummary]       = useState({});
  const [scores, setScores]         = useState([]);
  const [settings, setSettings]     = useState(null);
  const [templates, setTemplates]   = useState([]);
  const [calendarData, setCalData]  = useState(null);
  const [calYear, setCalYear]       = useState(new Date().getFullYear());
  const [calMonth, setCalMonth]     = useState(new Date().getMonth() + 1);
  const [expandedFlow, setExpanded] = useState(null);
  const [activeFlowData, setAFD]    = useState(null);
  const [loading, setLoading]       = useState(false);
  const [search, setSearch]         = useState('');
  const [filterType, setFType]      = useState('');

  /* ── dialogs ── */
  const [completeOpen, setCompleteOpen] = useState(false);
  const [completeStage, setCS]          = useState(null);
  const [completeNote, setCNote]        = useState('');
  const [qcOpen, setQcOpen]             = useState(false);
  const [qcStage, setQcStage]           = useState(null);
  const [qcItems, setQcItems]           = useState([]);
  const [qcOverall, setQcOverall]       = useState('pass');
  const [clOpen, setClOpen]             = useState(false);
  const [clFlow, setClFlow]             = useState(null);
  const [clItems, setClItems]           = useState([]);
  const [payOpen, setPayOpen]           = useState(false);
  const [payFlow, setPayFlow]           = useState(null);
  const [payData, setPayData]           = useState(null);
  const [payForm, setPayForm]           = useState({ milestone_type:'advance', amount:'', mode:'upi', reference:'', note:'' });

  /* ── template editor ── */
  const [editTmpl, setEditTmpl] = useState(null);
  const [tmplForm, setTmplForm] = useState({ name:'', description:'', color: PALETTE[0], stages:[] });

  /* ── new flow form ── */
  const [selectedTemplate, setSelTmpl] = useState(null);
  const [newFlow, setNewFlow] = useState({
    title:'', reference_id:'', customer_name:'', customer_phone:'', amount:'', notes:'', lead_id: null,
  });
  const [leadSearch, setLeadSearch]     = useState('');
  const [leadResults, setLeadResults]   = useState([]);
  const [selectedLead, setSelectedLead] = useState(null);
  const leadSearchRef = useRef(null);

  /* ── settings form ── */
  const [settForm, setSettForm] = useState(null);

  /* ─────────────── loaders ──────────────────────────────────────────── */
  const loadBoard = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fmsApi.dashboard({ flow_type: filterType || undefined });
      setFlows(r.data.flows || []);
      setSummary(r.data.summary || {});
    } catch { toast.error('Failed to load'); }
    finally { setLoading(false); }
  }, [filterType]);

  const loadTemplates = useCallback(async () => {
    try { const r = await fmsApi.templates.list(); setTemplates(r.data || []); } catch { /* */ }
  }, []);

  const loadCalendar = useCallback(async () => {
    try {
      const r = await fmsApi.calendar({ year: calYear, month: calMonth });
      setCalData(r.data);
    } catch { /* */ }
  }, [calYear, calMonth]);

  const loadFlow = async (flow_id) => {
    const r = await fmsApi.getFlow(flow_id);
    setAFD(r.data);
    return r.data;
  };
  const loadScores = async () => {
    try { const r = await fmsApi.scores(); setScores(r.data || []); } catch { /* */ }
  };
  const loadSettings = async () => {
    try { const r = await fmsApi.settings(); setSettings(r.data); setSettForm(r.data); } catch { /* */ }
  };

  useEffect(() => { loadBoard(); loadTemplates(); }, [loadBoard, loadTemplates]);
  useEffect(() => { if (tab === 'reports')  loadScores();   }, [tab]);
  useEffect(() => { if (tab === 'settings') loadSettings(); }, [tab]);
  useEffect(() => { if (tab === 'calendar') loadCalendar(); }, [tab, calYear, calMonth]);

  const refreshBoard = useCallback(() => { loadBoard(); loadTemplates(); }, [loadBoard, loadTemplates]);
  useDataSync('fms', refreshBoard);
  useAutoRefresh(loadBoard, 60000);

  /* ─────────────── CRM lead search ──────────────────────────────────── */
  const searchLeads = useCallback(async (q) => {
    if (!q || q.length < 2) { setLeadResults([]); return; }
    try {
      const r = await leadsApi.search({ q, limit: 8 });
      setLeadResults(r.data?.leads || []);
    } catch { setLeadResults([]); }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => searchLeads(leadSearch), 300);
    return () => clearTimeout(t);
  }, [leadSearch, searchLeads]);

  const selectLead = (lead) => {
    setSelectedLead(lead);
    setNewFlow(f => ({
      ...f,
      title: f.title || `Flow — ${lead.company_name}`,
      customer_name: lead.contact_name || lead.company_name || '',
      customer_phone: lead.contact_phone || '',
      lead_id: lead.lead_id,
    }));
    setLeadSearch('');
    setLeadResults([]);
  };

  /* ─────────────── create flow ───────────────────────────────────────── */
  const createFlow = async () => {
    if (!selectedTemplate) { toast.error('Select a flow template first'); return; }
    if (!newFlow.title.trim()) { toast.error('Flow title is required'); return; }
    try {
      await fmsApi.createFlow({
        ...newFlow,
        template_id: selectedTemplate.template_id,
        flow_type: selectedTemplate.key || 'custom',
        amount: parseFloat(newFlow.amount) || 0,
      });
      toast.success('Flow created — all stages scheduled');
      setTab('board');
      setNewFlow({ title:'', reference_id:'', customer_name:'', customer_phone:'', amount:'', notes:'', lead_id: null });
      setSelTmpl(null);
      setSelectedLead(null);
      loadBoard();
    } catch (e) { toast.error(e?.response?.data?.detail || 'Failed'); }
  };

  /* ─────────────── stage actions ─────────────────────────────────────── */
  const openComplete = (stage) => { setCS(stage); setCNote(''); setCompleteOpen(true); };
  const doComplete = async () => {
    if (!completeStage) return;
    try {
      if (completeStage.key === 'qc_check' || completeStage.key === 'qc_material') {
        setCompleteOpen(false); openQC(completeStage); return;
      }
      if (completeStage.key === 'predispatch') {
        setCompleteOpen(false); openChecklist(completeStage); return;
      }
      await fmsApi.completeStage(completeStage.stage_id, { note: completeNote });
      toast.success('Stage completed');
      setCompleteOpen(false);
      if (expandedFlow) loadFlow(expandedFlow).then(setAFD);
      loadBoard();
    } catch (e) { toast.error(e?.response?.data?.detail || 'Failed'); }
  };
  const doApprove = async (stage) => {
    await fmsApi.approveStage(stage.stage_id);
    toast.success('Approved');
    if (expandedFlow) loadFlow(expandedFlow).then(setAFD);
    loadBoard();
  };
  const doReject = async (stage) => {
    const reason = window.prompt('Rejection reason:');
    if (reason === null) return;
    await fmsApi.rejectStage(stage.stage_id, { reason });
    toast.success('Rejected — stage reopened');
    if (expandedFlow) loadFlow(expandedFlow).then(setAFD);
    loadBoard();
  };

  /* QC */
  const openQC = async (stage) => {
    setQcStage(stage); setQcOverall('pass');
    setQcItems([
      { item_name: 'Quantity matches order', result: null, note: '' },
      { item_name: 'Physical condition — no damage', result: null, note: '' },
      { item_name: 'Label / packaging correct', result: null, note: '' },
      { item_name: 'Accessories included', result: null, note: '' },
      { item_name: 'Serial number recorded', result: null, note: '' },
    ]);
    setQcOpen(true);
  };
  const toggleQcItem = (idx, result) => {
    setQcItems(items => {
      const n = [...items]; n[idx] = { ...n[idx], result };
      setQcOverall(n.some(i => i.result === 'fail') ? 'fail' : 'pass');
      return n;
    });
  };
  const submitQC = async () => {
    if (qcItems.some(i => !i.result)) { toast.error('Inspect every item first'); return; }
    await fmsApi.submitQC({ flow_id: qcStage.flow_id, stage_id: qcStage.stage_id, items: qcItems, overall: qcOverall });
    toast.success(qcOverall === 'pass' ? 'QC Passed' : 'QC Failed — rework task created');
    setQcOpen(false);
    if (expandedFlow) loadFlow(expandedFlow).then(setAFD);
    loadBoard();
  };

  /* Checklist */
  const openChecklist = async (stage) => {
    setClFlow(stage);
    const r = await fmsApi.getChecklist(stage.flow_id);
    setClItems(r.data.items.map(i => ({ ...i, checked: false, checked_at: null })));
    setClOpen(true);
  };
  const toggleClItem = (idx) => setClItems(items => {
    const n = [...items];
    n[idx] = { ...n[idx], checked: !n[idx].checked, checked_at: !n[idx].checked ? new Date().toISOString() : null };
    return n;
  });
  const submitChecklist = async () => {
    if (!clItems.every(i => i.checked)) { toast.error('Complete all items before dispatch'); return; }
    await fmsApi.submitChecklist({ flow_id: clFlow.flow_id, items: clItems });
    await fmsApi.completeStage(clFlow.stage_id, { note: 'Pre-dispatch checklist completed' });
    toast.success('Checklist done — dispatch activated');
    setClOpen(false);
    if (expandedFlow) loadFlow(expandedFlow).then(setAFD);
    loadBoard();
  };

  /* Payment */
  const openPayment = async (flow) => {
    setPayFlow(flow);
    const r = await fmsApi.getPayments(flow.flow_id);
    setPayData(r.data);
    setPayForm({ milestone_type:'advance', amount:'', mode:'upi', reference:'', note:'' });
    setPayOpen(true);
  };
  const submitPayment = async () => {
    if (!payForm.amount || isNaN(parseFloat(payForm.amount))) { toast.error('Amount required'); return; }
    await fmsApi.addPayment({ ...payForm, flow_id: payFlow.flow_id, amount: parseFloat(payForm.amount) });
    toast.success('Payment recorded');
    const r = await fmsApi.getPayments(payFlow.flow_id);
    setPayData(r.data);
    setPayForm({ milestone_type:'advance', amount:'', mode:'upi', reference:'', note:'' });
    loadBoard();
  };

  /* ── template CRUD ── */
  const startNewTemplate = () => {
    setTmplForm({ name:'', description:'', color: PALETTE[0], stages:[
      { key:'step_1', label:'Step 1', team:'sales', tat_hours: 4, needs_approval: false }
    ]});
    setEditTmpl('new');
  };
  const startEditTemplate = (t) => {
    setTmplForm({ name: t.name, description: t.description||'', color: t.color, stages: t.stages.map(s => ({...s})) });
    setEditTmpl(t);
  };
  const saveTmpl = async () => {
    if (!tmplForm.name || !tmplForm.stages.length) { toast.error('Name and at least one stage required'); return; }
    try {
      if (editTmpl === 'new') await fmsApi.templates.create(tmplForm);
      else await fmsApi.templates.update(editTmpl.template_id, tmplForm);
      toast.success(editTmpl === 'new' ? 'Template created' : 'Template updated');
      setEditTmpl(null); loadTemplates();
    } catch (e) { toast.error(e?.response?.data?.detail || 'Failed'); }
  };
  const deleteTmpl = async (t) => {
    if (!window.confirm(`Delete template "${t.name}"?`)) return;
    try { await fmsApi.templates.delete(t.template_id); toast.success('Deleted'); loadTemplates(); }
    catch (e) { toast.error(e?.response?.data?.detail || 'Failed'); }
  };
  const addStage = () => setTmplForm(f => ({
    ...f, stages: [...f.stages, { key:`step_${f.stages.length+1}`, label:`Step ${f.stages.length+1}`, team:'sales', tat_hours:4, needs_approval:false }]
  }));
  const updateStage = (idx, field, val) => setTmplForm(f => {
    const s = [...f.stages]; s[idx] = {...s[idx], [field]: val}; return {...f, stages: s};
  });
  const removeStage = (idx) => setTmplForm(f => ({ ...f, stages: f.stages.filter((_,i) => i !== idx) }));
  const moveStage = (idx, dir) => setTmplForm(f => {
    const s = [...f.stages];
    const ni = idx + dir;
    if (ni < 0 || ni >= s.length) return f;
    [s[idx], s[ni]] = [s[ni], s[idx]];
    return {...f, stages: s};
  });

  const saveSettings = async () => {
    await fmsApi.updateSettings(settForm);
    toast.success('Settings saved');
  };

  const filtered = flows.filter(f => {
    if (!search) return true;
    const s = search.toLowerCase();
    return f.title?.toLowerCase().includes(s) || f.customer_name?.toLowerCase().includes(s) || f.reference_id?.toLowerCase().includes(s);
  });

  return {
    /* state */
    tab, setTab,
    flows, filtered, summary, scores, settings,
    templates, calendarData, calYear, setCalYear, calMonth, setCalMonth,
    expandedFlow, setExpanded, activeFlowData, setAFD,
    loading, search, setSearch, filterType, setFType,
    /* complete dialog */
    completeOpen, setCompleteOpen, completeStage, completeNote, setCNote,
    /* qc dialog */
    qcOpen, setQcOpen, qcItems, qcOverall, toggleQcItem, submitQC,
    /* checklist dialog */
    clOpen, setClOpen, clItems, toggleClItem, submitChecklist,
    /* payment dialog */
    payOpen, setPayOpen, payFlow, payData, payForm, setPayForm, submitPayment,
    /* template editor */
    editTmpl, setEditTmpl, tmplForm, setTmplForm,
    PALETTE,
    /* new flow */
    selectedTemplate, setSelTmpl,
    newFlow, setNewFlow,
    leadSearch, setLeadSearch, leadResults, selectedLead, setSelectedLead,
    leadSearchRef,
    /* settings */
    settForm, setSettForm,
    /* handlers */
    loadBoard, loadFlow, loadCalendar,
    openComplete, doComplete, doApprove, doReject,
    openPayment, openChecklist,
    createFlow, selectLead,
    startNewTemplate, startEditTemplate, saveTmpl, deleteTmpl,
    addStage, updateStage, removeStage, moveStage,
    saveSettings,
  };
}

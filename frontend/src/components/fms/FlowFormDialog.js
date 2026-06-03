import React from 'react';
import {
  Plus, Check, X, Eye, CheckSquare, IndianRupee, Pencil, Trash2,
  ChevronUp, ChevronDown, Shield, Search, Building2, Zap, Layers,
} from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';

const PINK = '#e94560';
const PALETTE = ['#e94560','#8b5cf6','#10b981','#f59e0b','#3b82f6','#06b6d4','#f97316','#6366f1','#ec4899'];
const TEAM_OPTIONS = ['sales','store','accounts','dispatch','field','management','purchase','admin'];

function fmt(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true });
}

function TatBadge({ status }) {
  const TAT_STYLE = {
    green:   { cls: 'bg-green-500/15 text-green-500 border-green-500/20', dot: 'bg-green-500', label: 'On Time' },
    pending: { cls: 'bg-[var(--bg-hover)] text-[var(--text-muted)] border-[var(--border-color)]', dot: 'bg-slate-400', label: 'Pending' },
    overdue: { cls: 'bg-red-500/15 text-red-500 border-red-500/20', dot: 'bg-red-500', label: 'Overdue' },
  };
  const s = TAT_STYLE[status] || TAT_STYLE.pending;
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border ${s.cls}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}

/* ── Templates Tab Content ─────────────────────────────────────────────────── */
export function TemplatesTab({
  templates, editTmpl, setEditTmpl, tmplForm, setTmplForm,
  saveTmpl, deleteTmpl, startNewTemplate, startEditTemplate,
  addStage, updateStage, removeStage, moveStage,
  setSelTmpl, setTab,
  card, textPri, textSec, textMuted, inputCls,
}) {
  return (
    <div className="space-y-4">
      {editTmpl ? (
        <div className={`${card} border rounded-xl p-5 space-y-5`}>
          <div className="flex items-center justify-between">
            <h2 className={`text-base font-semibold ${textPri}`}>
              {editTmpl === 'new' ? 'Create New Template' : `Edit: ${editTmpl.name}`}
            </h2>
            <button onClick={() => setEditTmpl(null)} className={`p-1.5 rounded-lg hover:bg-[var(--bg-hover)] ${textMuted}`}>
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label className={`${textSec} text-xs`}>Template Name *</Label>
              <Input value={tmplForm.name} onChange={e => setTmplForm(f => ({...f, name: e.target.value}))}
                className={`${inputCls} mt-1`} placeholder="e.g. Sales Follow-up Flow" />
            </div>
            <div>
              <Label className={`${textSec} text-xs`}>Description</Label>
              <Input value={tmplForm.description} onChange={e => setTmplForm(f => ({...f, description: e.target.value}))}
                className={`${inputCls} mt-1`} placeholder="What is this flow for?" />
            </div>
          </div>

          <div>
            <Label className={`${textSec} text-xs block mb-2`}>Color</Label>
            <div className="flex gap-2 flex-wrap">
              {PALETTE.map(c => (
                <button key={c} onClick={() => setTmplForm(f => ({...f, color: c}))}
                  className={`w-7 h-7 rounded-full transition-transform active:scale-90 ${tmplForm.color === c ? 'ring-2 ring-offset-2 ring-[var(--border-color)] scale-110' : ''}`}
                  style={{ background: c }} />
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-3">
              <Label className={`${textSec} text-xs`}>Stages ({tmplForm.stages.length})</Label>
              <p className={`text-[10px] ${textMuted}`}>Stages run in order — each one starts when the previous is done</p>
            </div>
            <div className="space-y-2">
              {tmplForm.stages.map((stage, idx) => (
                <div key={idx} className={`flex items-center gap-2 p-3 rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)]`}>
                  <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0`}
                    style={{ background: tmplForm.color }}>{idx + 1}</div>
                  <Input value={stage.label} onChange={e => updateStage(idx, 'label', e.target.value)}
                    className={`flex-1 h-8 text-xs ${inputCls}`} placeholder="Stage name" />
                  <select value={stage.team} onChange={e => updateStage(idx, 'team', e.target.value)}
                    className={`h-8 px-2 text-xs rounded-md border border-[var(--border-color)] ${inputCls} w-24`}>
                    {TEAM_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <div className="flex items-center gap-1">
                    <Input type="number" min={0.5} step={0.5} value={stage.tat_hours}
                      onChange={e => updateStage(idx, 'tat_hours', parseFloat(e.target.value) || 1)}
                      className={`h-8 w-16 text-xs text-center ${inputCls}`} />
                    <span className={`text-[10px] ${textMuted}`}>h</span>
                  </div>
                  <button onClick={() => updateStage(idx, 'needs_approval', !stage.needs_approval)}
                    className={`h-8 px-2 rounded-lg text-xs font-medium border transition-colors flex items-center gap-1
                      ${stage.needs_approval ? 'border-amber-500/40 bg-amber-500/10 text-amber-500' : `border-[var(--border-color)] ${textMuted}`}`}>
                    <Shield className="h-3 w-3" />
                    <span className="hidden sm:inline">Approval</span>
                  </button>
                  <div className="flex items-center gap-0.5">
                    <button onClick={() => moveStage(idx, -1)} disabled={idx === 0}
                      className={`p-1 rounded hover:bg-[var(--bg-hover)] ${textMuted} disabled:opacity-30`}>
                      <ChevronUp className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={() => moveStage(idx, 1)} disabled={idx === tmplForm.stages.length - 1}
                      className={`p-1 rounded hover:bg-[var(--bg-hover)] ${textMuted} disabled:opacity-30`}>
                      <ChevronDown className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={() => removeStage(idx)} className="p-1 rounded hover:bg-red-500/10 text-red-400">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
              <button onClick={addStage}
                className={`w-full h-10 border-2 border-dashed border-[var(--border-color)] rounded-xl text-xs font-medium ${textMuted} hover:bg-[var(--bg-hover)] flex items-center justify-center gap-1.5`}>
                <Plus className="h-3.5 w-3.5" /> Add Stage
              </button>
            </div>
          </div>

          <div className="flex gap-3">
            <Button variant="outline" onClick={() => setEditTmpl(null)} className={`border-[var(--border-color)] ${textSec}`}>Cancel</Button>
            <Button onClick={saveTmpl} className="text-white flex-1" style={{ background: tmplForm.color || PINK }}>
              <Check className="h-4 w-4 mr-1" /> {editTmpl === 'new' ? 'Create Template' : 'Save Changes'}
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <div>
              <h2 className={`text-base sm:text-lg font-semibold ${textPri}`}>Flow Templates</h2>
              <p className={`text-xs ${textMuted} mt-0.5`}>Templates define the stages and TAT for each flow type — system + custom</p>
            </div>
            <Button onClick={startNewTemplate} className="text-white h-9" style={{ background: PINK }}>
              <Plus className="h-4 w-4 mr-1" /> New Template
            </Button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {templates.map(t => (
              <div key={t.template_id} className={`${card} border rounded-xl overflow-hidden`}>
                <div className="h-1.5" style={{ background: t.color }} />
                <div className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className={`font-semibold text-sm ${textPri}`}>{t.name}</p>
                      {t.description && <p className={`text-xs ${textMuted} mt-0.5`}>{t.description}</p>}
                    </div>
                    {t.is_system
                      ? <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full bg-[var(--bg-primary)] ${textMuted}`}>SYSTEM</span>
                      : <div className="flex items-center gap-1">
                          <button onClick={() => startEditTemplate(t)} className={`p-1.5 rounded-lg hover:bg-[var(--bg-hover)] ${textMuted}`}>
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button onClick={() => deleteTmpl(t)} className="p-1.5 rounded-lg hover:bg-red-500/10 text-red-400">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                    }
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {(t.stages || []).map((s, i) => (
                      <span key={i} className="text-[10px] font-medium px-2 py-1 rounded-full text-white"
                        style={{ background: t.color }}>
                        {i + 1}. {s.label}
                      </span>
                    ))}
                  </div>
                  <div className={`flex items-center justify-between text-[10px] ${textMuted} pt-2 border-t border-[var(--border-color)]`}>
                    <span>{t.stages?.length || 0} stages</span>
                    <span>{Math.round((t.stages || []).reduce((a, s) => a + (s.tat_hours || 0), 0))}h total TAT</span>
                  </div>
                  <button onClick={() => { setSelTmpl(t); setTab('create'); }}
                    className="w-full h-8 rounded-lg text-xs font-semibold text-white flex items-center justify-center gap-1.5 hover:opacity-90"
                    style={{ background: t.color }}>
                    <Plus className="h-3.5 w-3.5" /> Use this template
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/* ── New Flow Form ──────────────────────────────────────────────────────────── */
export function NewFlowForm({
  templates, selectedTemplate, setSelTmpl,
  newFlow, setNewFlow, createFlow,
  leadSearch, setLeadSearch, leadResults, selectedLead, setSelectedLead, selectLead,
  card, textPri, textSec, textMuted, inputCls,
}) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
      <div className="lg:col-span-2 space-y-3">
        <h2 className={`text-base font-semibold ${textPri}`}>1. Choose Template</h2>
        <div className="space-y-2">
          {templates.filter(t => t.is_active).map(t => (
            <button key={t.template_id} onClick={() => setSelTmpl(t)}
              className={`w-full flex items-center gap-3 p-3.5 rounded-xl border-2 text-left transition-all
                ${selectedTemplate?.template_id === t.template_id
                  ? 'border-[#e94560]'
                  : 'border-[var(--border-color)] hover:border-[var(--text-muted)]/30'}`}
              style={selectedTemplate?.template_id === t.template_id ? { background: t.color + '10', borderColor: t.color } : {}}>
              <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 text-white text-sm font-bold"
                style={{ background: t.color }}>
                {t.name.charAt(0)}
              </div>
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-semibold ${textPri}`}>{t.name}</p>
                <p className={`text-[10px] ${textMuted}`}>{t.stages?.length} stages · {Math.round((t.stages||[]).reduce((a,s) => a+(s.tat_hours||0), 0))}h total TAT</p>
              </div>
              {selectedTemplate?.template_id === t.template_id && (
                <div className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: t.color }}>
                  <Check className="h-3 w-3 text-white" />
                </div>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="lg:col-span-3 space-y-4">
        <h2 className={`text-base font-semibold ${textPri}`}>2. Fill Details</h2>

        <div className="relative">
          <Label className={`${textSec} text-xs mb-1 block`}>Link to CRM Lead (optional)</Label>
          {selectedLead ? (
            <div className="flex items-center gap-3 p-3 rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)]">
              <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                style={{ background: PINK }}>
                {selectedLead.company_name?.charAt(0)}
              </div>
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-semibold ${textPri} truncate`}>{selectedLead.company_name}</p>
                <p className={`text-xs ${textMuted}`}>{selectedLead.contact_name} · {selectedLead.contact_phone}</p>
              </div>
              <button onClick={() => { setSelectedLead(null); setNewFlow(f => ({...f, lead_id: null})); }}
                className={`p-1.5 rounded-lg hover:bg-red-500/10 text-red-400`}>
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <>
              <div className="relative">
                <Search className={`absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 ${textMuted}`} />
                <Input value={leadSearch} onChange={e => setLeadSearch(e.target.value)}
                  placeholder="Search school or contact name…" className={`pl-9 ${inputCls}`} />
              </div>
              {leadResults.length > 0 && (
                <div className={`absolute z-20 mt-1 w-full rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] shadow-xl overflow-hidden`}>
                  {leadResults.map(l => (
                    <button key={l.lead_id} onClick={() => selectLead(l)}
                      className={`w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-[var(--bg-hover)] border-b border-[var(--border-color)] last:border-0`}>
                      <Building2 className={`h-3.5 w-3.5 ${textMuted} flex-shrink-0`} />
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-semibold ${textPri} truncate`}>{l.company_name}</p>
                        <p className={`text-xs ${textMuted}`}>{l.contact_name}</p>
                      </div>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full bg-[var(--bg-primary)] ${textMuted}`}>{l.stage}</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <div>
          <Label className={`${textSec} text-xs mb-1 block`}>Flow Title *</Label>
          <Input value={newFlow.title} onChange={e => setNewFlow({...newFlow, title: e.target.value})}
            className={inputCls} placeholder="e.g. Order — DPS — Premium Package" />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className={`${textSec} text-xs mb-1 block`}>Reference ID</Label>
            <Input value={newFlow.reference_id} onChange={e => setNewFlow({...newFlow, reference_id: e.target.value})}
              className={inputCls} placeholder="ORD-2026-001" />
          </div>
          <div>
            <Label className={`${textSec} text-xs mb-1 block`}>Amount ₹</Label>
            <Input type="number" value={newFlow.amount} onChange={e => setNewFlow({...newFlow, amount: e.target.value})}
              className={inputCls} placeholder="0" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className={`${textSec} text-xs mb-1 block`}>Customer Name</Label>
            <Input value={newFlow.customer_name} onChange={e => setNewFlow({...newFlow, customer_name: e.target.value})}
              className={inputCls} />
          </div>
          <div>
            <Label className={`${textSec} text-xs mb-1 block`}>Customer Phone</Label>
            <Input value={newFlow.customer_phone} onChange={e => setNewFlow({...newFlow, customer_phone: e.target.value})}
              className={inputCls} />
          </div>
        </div>

        <div>
          <Label className={`${textSec} text-xs mb-1 block`}>Notes</Label>
          <textarea value={newFlow.notes} onChange={e => setNewFlow({...newFlow, notes: e.target.value})}
            className={`w-full h-20 px-3 py-2 rounded-lg border text-sm resize-none focus:outline-none ${inputCls}`} />
        </div>

        {selectedTemplate && (
          <div className={`bg-[var(--bg-primary)] rounded-xl p-4 border border-[var(--border-color)]`}>
            <p className={`text-xs font-semibold ${textMuted} uppercase tracking-wider mb-3`}>
              Stages to be created (office-hours TAT):
            </p>
            <div className="flex items-center gap-1.5 flex-wrap">
              {selectedTemplate.stages.map((s, i) => (
                <span key={i} className="text-[10px] font-semibold px-2.5 py-1 rounded-full text-white"
                  style={{ background: selectedTemplate.color }}>
                  {s.label} ({s.tat_hours}h)
                </span>
              ))}
            </div>
          </div>
        )}

        <button onClick={createFlow} disabled={!selectedTemplate}
          className="w-full h-11 text-white font-semibold rounded-lg flex items-center justify-center gap-1.5"
          style={{ background: selectedTemplate?.color || PINK, opacity: selectedTemplate ? 1 : 0.5 }}>
          <Zap className="h-4 w-4" /> Create Flow & Schedule All Stages
        </button>
      </div>
    </div>
  );
}

/* ── Complete Stage Dialog ────────────────────────────────────────────────────── */
export function CompleteStageDialog({
  open, onOpenChange, completeStage, completeNote, setCNote, doComplete,
  textPri, textSec, textMuted, inputCls, dlgCls,
}) {
  function fmt(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true });
  }
  function TatBadge({ status }) {
    const isOver = status === 'overdue';
    return (
      <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border ${isOver ? 'bg-red-500/15 text-red-500 border-red-500/20' : 'bg-[var(--bg-hover)] text-[var(--text-muted)] border-[var(--border-color)]'}`}>
        <span className={`w-1.5 h-1.5 rounded-full ${isOver ? 'bg-red-500' : 'bg-slate-400'}`} />
        {isOver ? 'Overdue' : 'Pending'}
      </span>
    );
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={`${dlgCls} max-w-sm`}>
        <DialogHeader>
          <DialogTitle className={textPri}>Complete Stage</DialogTitle>
          {completeStage && <p className={`text-sm ${textMuted} mt-0.5`}>{completeStage.label}</p>}
        </DialogHeader>
        <div className="py-3 space-y-3">
          {completeStage && (
            <div className={`p-3 rounded-xl bg-[var(--bg-primary)] border border-[var(--border-color)] text-xs space-y-1`}>
              <div className="flex justify-between">
                <span className={textMuted}>Planned done:</span>
                <span className={textSec}>{fmt(completeStage.plan_done)}</span>
              </div>
              <div className="flex justify-between">
                <span className={textMuted}>Current time:</span>
                <span className={textSec}>{fmt(new Date().toISOString())}</span>
              </div>
              <div className="flex justify-between">
                <span className={textMuted}>Status:</span>
                <TatBadge status={new Date() > new Date(completeStage.plan_done) ? 'overdue' : 'pending'} />
              </div>
            </div>
          )}
          <div>
            <Label className={`${textSec} text-xs`}>Completion Note (optional)</Label>
            <Input value={completeNote} onChange={e => setCNote(e.target.value)} className={`${inputCls} mt-1`} />
          </div>
          {completeStage?.needs_approval && (
            <p className="text-xs text-amber-500 flex items-center gap-1.5">
              <Shield className="h-3.5 w-3.5" /> Requires approval — will be sent to department head
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} className={`border-[var(--border-color)] ${textSec}`}>Cancel</Button>
          <Button onClick={doComplete} className="text-white" style={{ background: '#10b981' }}>
            <Check className="h-4 w-4 mr-1" /> Mark Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── QC Dialog ─────────────────────────────────────────────────────────────── */
export function QCDialog({
  open, onOpenChange, qcItems, qcOverall, toggleQcItem, submitQC,
  textPri, textSec, textMuted, dlgCls,
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={`${dlgCls} max-w-lg`}>
        <DialogHeader>
          <DialogTitle className={textPri}>QC Inspection</DialogTitle>
          <p className={`text-xs ${textMuted}`}>Inspect each item — tap ✓ Pass or ✗ Fail</p>
        </DialogHeader>
        <div className="py-3 space-y-2 max-h-[60vh] overflow-y-auto">
          {qcItems.map((item, idx) => (
            <div key={idx} className={`flex items-center gap-3 p-3 rounded-xl border ${item.result === 'pass' ? 'bg-green-500/8 border-green-500/20' : item.result === 'fail' ? 'bg-red-500/8 border-red-500/20' : 'bg-[var(--bg-primary)] border-[var(--border-color)]'}`}>
              <button className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 transition-colors ${item.result === 'pass' ? 'bg-green-500 text-white' : item.result === 'fail' ? 'bg-red-500 text-white' : 'bg-[var(--bg-hover)] text-[var(--text-muted)]'}`}
                onClick={() => toggleQcItem(idx, item.result === 'pass' ? null : 'pass')}>
                <Eye className="h-4 w-4" />
              </button>
              <div className="flex-1">
                <p className={`text-sm font-medium ${textPri}`}>{item.item_name}</p>
                {item.result && <p className={`text-[10px] font-bold uppercase ${item.result === 'pass' ? 'text-green-500' : 'text-red-500'}`}>{item.result}</p>}
              </div>
              <div className="flex gap-1">
                <button onClick={() => toggleQcItem(idx, 'pass')} className={`w-7 h-7 rounded-lg text-xs font-bold flex items-center justify-center ${item.result === 'pass' ? 'bg-green-500 text-white' : 'bg-[var(--bg-hover)] text-green-500'}`}>✓</button>
                <button onClick={() => toggleQcItem(idx, 'fail')} className={`w-7 h-7 rounded-lg text-xs font-bold flex items-center justify-center ${item.result === 'fail' ? 'bg-red-500 text-white' : 'bg-[var(--bg-hover)] text-red-500'}`}>✗</button>
              </div>
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between pt-2 border-t border-[var(--border-color)]">
          <span className={`text-sm font-semibold ${textPri}`}>Overall:</span>
          <span className={`text-sm font-black px-3 py-1 rounded-full ${qcOverall === 'pass' ? 'bg-green-500/15 text-green-500' : 'bg-red-500/15 text-red-500'}`}>{qcOverall.toUpperCase()}</span>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} className={`border-[var(--border-color)] ${textSec}`}>Cancel</Button>
          <Button onClick={submitQC} className="text-white" style={{ background: qcOverall === 'pass' ? '#10b981' : '#ef4444' }}>
            Submit QC — {qcOverall === 'pass' ? 'Pass ✓' : 'Fail (Rework)'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── Checklist Dialog ──────────────────────────────────────────────────────── */
export function ChecklistDialog({
  open, onOpenChange, clItems, toggleClItem, submitChecklist,
  textPri, textSec, textMuted, dlgCls,
}) {
  function fmt(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true });
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={`${dlgCls} max-w-md`}>
        <DialogHeader>
          <DialogTitle className={textPri}>Pre-Dispatch Checklist</DialogTitle>
          <p className={`text-xs ${textMuted}`}>All items must be checked before dispatch</p>
        </DialogHeader>
        <div className="py-3 space-y-2 max-h-[60vh] overflow-y-auto">
          {clItems.map((item, idx) => (
            <button key={idx} onClick={() => toggleClItem(idx)}
              className={`w-full flex items-center gap-3 p-3 rounded-xl border text-left transition-all ${item.checked ? 'bg-green-500/8 border-green-500/20' : 'bg-[var(--bg-primary)] border-[var(--border-color)] hover:bg-[var(--bg-hover)]'}`}>
              {item.checked ? <CheckSquare className="h-5 w-5 text-green-500 flex-shrink-0" /> : <CheckSquare className={`h-5 w-5 ${textMuted} flex-shrink-0 opacity-30`} />}
              <div className="flex-1">
                <p className={`text-sm font-medium ${textPri}`}>{item.label}</p>
                {item.checked && item.checked_at && <p className="text-[10px] text-green-500">Checked {fmt(item.checked_at)}</p>}
              </div>
            </button>
          ))}
        </div>
        <div className="pt-2 border-t border-[var(--border-color)] flex items-center justify-between">
          <span className={`text-xs ${textMuted}`}>{clItems.filter(i => i.checked).length}/{clItems.length} checked</span>
          <div className="h-1.5 w-32 bg-[var(--bg-primary)] rounded-full overflow-hidden">
            <div className="h-full bg-green-500 rounded-full" style={{ width: `${clItems.length ? clItems.filter(i=>i.checked).length/clItems.length*100 : 0}%` }} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} className={`border-[var(--border-color)] ${textSec}`}>Cancel</Button>
          <Button onClick={submitChecklist} className="text-white" style={{ background: clItems.every(i=>i.checked) ? '#10b981' : '#94a3b8' }}>
            Confirm & Advance to Dispatch
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── Payment Dialog ────────────────────────────────────────────────────────── */
export function PaymentDialog({
  open, onOpenChange, payFlow, payData, payForm, setPayForm, submitPayment,
  textPri, textSec, textMuted, inputCls, dlgCls,
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={`${dlgCls} max-w-md`}>
        <DialogHeader>
          <DialogTitle className={textPri}>Payment Collection</DialogTitle>
          {payFlow && <p className={`text-xs ${textMuted}`}>{payFlow.customer_name} · ₹{payFlow.amount?.toLocaleString()}</p>}
        </DialogHeader>
        {payData && (
          <>
            <div className={`p-4 rounded-xl bg-[var(--bg-primary)] border border-[var(--border-color)] space-y-2`}>
              {[['Total', payData.total, textSec], ['Collected', payData.collected, 'text-green-500'], ['Balance', payData.balance, 'text-orange-500']].map(([l,v,c]) => (
                <div key={l} className="flex justify-between text-sm">
                  <span className={c}>{l}</span>
                  <span className={`font-bold ${c}`}>₹{v?.toLocaleString()}</span>
                </div>
              ))}
              <div className="h-1.5 bg-[var(--bg-card)] rounded-full overflow-hidden mt-1">
                <div className="h-full bg-green-500 rounded-full" style={{ width: `${payData.pct_collected}%` }} />
              </div>
              <p className={`text-[10px] ${textMuted} text-right`}>{payData.pct_collected}% collected</p>
            </div>
            {payData.payments?.length > 0 && (
              <div className="space-y-1 max-h-32 overflow-y-auto">
                {payData.payments.map(p => (
                  <div key={p.payment_id} className="flex items-center justify-between text-xs py-1 border-b border-[var(--border-color)]">
                    <span className={`capitalize ${textSec}`}>{p.milestone_type}</span>
                    <span className="font-mono text-green-500 font-bold">₹{p.amount?.toLocaleString()}</span>
                    <span className={textMuted}>{p.mode}</span>
                    <span className={textMuted}>{p.created_at?.slice(0,10)}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="space-y-3 border-t border-[var(--border-color)] pt-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className={`${textSec} text-xs`}>Type</Label>
                  <select value={payForm.milestone_type} onChange={e => setPayForm({...payForm, milestone_type: e.target.value})}
                    className={`w-full h-9 px-2 rounded text-sm ${inputCls} mt-1`}>
                    <option value="advance">Advance</option>
                    <option value="partial">Partial</option>
                    <option value="final">Final Payment</option>
                  </select>
                </div>
                <div>
                  <Label className={`${textSec} text-xs`}>Amount ₹</Label>
                  <Input type="number" value={payForm.amount} onChange={e => setPayForm({...payForm, amount: e.target.value})}
                    className={`${inputCls} h-9 mt-1`} placeholder="0" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className={`${textSec} text-xs`}>Mode</Label>
                  <select value={payForm.mode} onChange={e => setPayForm({...payForm, mode: e.target.value})}
                    className={`w-full h-9 px-2 rounded text-sm ${inputCls} mt-1`}>
                    <option value="upi">UPI</option>
                    <option value="neft">NEFT/RTGS</option>
                    <option value="cheque">Cheque</option>
                    <option value="cash">Cash</option>
                  </select>
                </div>
                <div>
                  <Label className={`${textSec} text-xs`}>Reference / UTR</Label>
                  <Input value={payForm.reference} onChange={e => setPayForm({...payForm, reference: e.target.value})}
                    className={`${inputCls} h-9 mt-1`} />
                </div>
              </div>
              <Button onClick={submitPayment} className="w-full h-10 text-white font-semibold" style={{ background: PINK }}>
                <IndianRupee className="h-4 w-4 mr-1" /> Record Payment
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ── Reports Tab ────────────────────────────────────────────────────────────── */
export function ReportsTab({ scores, card, textPri, textSec, textMuted }) {
  return (
    <div className="space-y-4">
      <h2 className={`text-lg font-semibold ${textPri}`}>Employee Performance Scores</h2>
      <div className={`${card} border rounded-xl overflow-hidden`}>
        <table className="w-full text-sm">
          <thead><tr className="bg-[var(--bg-primary)] border-b border-[var(--border-color)]">
            {['Employee','Stages Done','On Time','Late','On-Time %','Avg Score'].map(h => (
              <th key={h} className={`py-3 px-4 text-left text-[10px] font-semibold uppercase tracking-wider ${textMuted}`}>{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {scores.length === 0 && (
              <tr><td colSpan={6} className={`py-12 text-center ${textMuted} text-sm`}>No scored stages yet</td></tr>
            )}
            {scores.map((row, i) => (
              <tr key={row.email} className="border-b border-[var(--border-color)] hover:bg-[var(--bg-hover)]">
                <td className={`px-4 py-3 font-semibold ${textPri}`}>
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white"
                      style={{ background: i === 0 ? '#f59e0b' : i === 1 ? '#94a3b8' : '#b45309' }}>{i + 1}</div>
                    {row.email}
                  </div>
                </td>
                <td className={`px-4 py-3 font-mono text-xs ${textSec}`}>{row.total_stages}</td>
                <td className="px-4 py-3 text-green-500 font-mono text-xs">{row.green}</td>
                <td className="px-4 py-3 text-red-500 font-mono text-xs">{row.red}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-24 bg-[var(--bg-primary)] rounded-full overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${row.on_time_pct}%`, background: row.on_time_pct >= 80 ? '#10b981' : row.on_time_pct >= 60 ? '#f59e0b' : '#ef4444' }} />
                    </div>
                    <span className={`text-xs font-bold ${textSec}`}>{row.on_time_pct}%</span>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span className="text-lg font-black font-mono" style={{ color: row.avg_score >= 80 ? '#10b981' : row.avg_score >= 60 ? '#f59e0b' : '#ef4444' }}>
                    {row.avg_score}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ── Settings Tab ────────────────────────────────────────────────────────────── */
export function SettingsTab({ settForm, setSettForm, saveSettings, card, textPri, textSec, textMuted, inputCls }) {
  if (!settForm) return null;
  return (
    <div className={`${card} border rounded-xl p-6 max-w-lg space-y-5`}>
      <h2 className={`text-lg font-semibold ${textPri}`}>TAT & Office Hours</h2>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label className={`${textSec} text-xs`}>Office Start Hour (24h)</Label>
          <Input type="number" min={0} max={23} value={settForm.office_start}
            onChange={e => setSettForm({...settForm, office_start: parseInt(e.target.value)})} className={`${inputCls} mt-1`} />
        </div>
        <div>
          <Label className={`${textSec} text-xs`}>Office End Hour (24h)</Label>
          <Input type="number" min={0} max={23} value={settForm.office_end}
            onChange={e => setSettForm({...settForm, office_end: parseInt(e.target.value)})} className={`${inputCls} mt-1`} />
        </div>
      </div>
      <div>
        <Label className={`${textSec} text-xs mb-2 block`}>Weekly Off Days</Label>
        <div className="flex gap-2 flex-wrap">
          {['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map((d, i) => {
            const idx = (i + 1) % 7;
            const sel = settForm.weekly_off?.includes(idx);
            return (
              <button key={d} type="button"
                onClick={() => setSettForm(f => ({ ...f, weekly_off: sel ? f.weekly_off.filter(x => x !== idx) : [...(f.weekly_off||[]), idx] }))}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${sel ? 'text-white border-transparent' : `border-[var(--border-color)] ${textMuted}`}`}
                style={sel ? { background: '#e94560' } : {}}>
                {d}
              </button>
            );
          })}
        </div>
      </div>
      <div>
        <Label className={`${textSec} text-xs`}>Holidays (YYYY-MM-DD, comma-separated)</Label>
        <textarea value={(settForm.holidays || []).join(', ')}
          onChange={e => setSettForm({...settForm, holidays: e.target.value.split(',').map(s => s.trim()).filter(Boolean)})}
          className={`w-full h-24 px-3 py-2 rounded-lg border text-xs resize-none focus:outline-none mt-1 ${inputCls}`}
          placeholder="2026-01-26, 2026-08-15, 2026-10-02" />
      </div>
      <button onClick={saveSettings} className="h-10 px-6 rounded-lg text-white font-semibold" style={{ background: '#e94560' }}>Save Settings</button>
    </div>
  );
}

/* ── FMS Calendar Tab ─────────────────────────────────────────────────────────── */
export function FMSCalendarTab({
  calendarData, calYear, setCalYear, calMonth, setCalMonth, loadCalendar,
  setTab, setExpanded, loadFlow, setAFD,
  card, textPri, textSec, textMuted,
}) {
  const PINK = '#e94560';
  const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className={`text-lg font-semibold ${textPri}`}>{MONTH_NAMES[calMonth - 1]} {calYear}</h2>
          <p className={`text-xs ${textMuted}`}>All stage deadlines — click any entry to open its flow</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => { const d = new Date(calYear, calMonth - 2, 1); setCalYear(d.getFullYear()); setCalMonth(d.getMonth() + 1); }}
            className={`h-8 w-8 rounded-lg border border-[var(--border-color)] ${textMuted} hover:bg-[var(--bg-hover)] flex items-center justify-center`}>‹</button>
          <button onClick={() => { setCalYear(new Date().getFullYear()); setCalMonth(new Date().getMonth() + 1); }}
            className={`h-8 px-3 rounded-lg border border-[var(--border-color)] text-xs font-semibold ${textSec} hover:bg-[var(--bg-hover)]`}>Today</button>
          <button onClick={() => { const d = new Date(calYear, calMonth, 1); setCalYear(d.getFullYear()); setCalMonth(d.getMonth() + 1); }}
            className={`h-8 w-8 rounded-lg border border-[var(--border-color)] ${textMuted} hover:bg-[var(--bg-hover)] flex items-center justify-center`}>›</button>
          <button onClick={loadCalendar} className={`h-8 w-8 rounded-lg border border-[var(--border-color)] ${textMuted} hover:bg-[var(--bg-hover)] flex items-center justify-center`}>
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className={`${card} border rounded-xl overflow-hidden`}>
        <div className="grid grid-cols-7 border-b border-[var(--border-color)]">
          {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d => (
            <div key={d} className={`py-2.5 text-center text-[10px] font-bold uppercase tracking-wider ${textMuted} bg-[var(--bg-primary)]`}>{d}</div>
          ))}
        </div>
        {calendarData && (() => {
          const firstDay = new Date(calYear, calMonth - 1, 1).getDay();
          const daysInMonth = new Date(calYear, calMonth, 0).getDate();
          const todayStr = new Date().toISOString().slice(0, 10);
          const cells = [];
          for (let i = 0; i < firstDay; i++) cells.push(null);
          for (let d = 1; d <= daysInMonth; d++) cells.push(d);
          while (cells.length % 7 !== 0) cells.push(null);
          const weeks = [];
          for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
          return weeks.map((week, wi) => (
            <div key={wi} className="grid grid-cols-7 border-b border-[var(--border-color)] last:border-0">
              {week.map((day, di) => {
                if (!day) return <div key={di} className="h-28 bg-[var(--bg-primary)] border-r border-[var(--border-color)] last:border-0" />;
                const dateStr = `${calYear}-${String(calMonth).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
                const dayItems = calendarData.days?.[dateStr] || [];
                const isToday = dateStr === todayStr;
                const hasOverdue = dayItems.some(t => t.tat_status === 'overdue');
                return (
                  <div key={di}
                    className={`h-28 p-1.5 border-r border-[var(--border-color)] last:border-0 overflow-hidden flex flex-col transition-colors hover:bg-[var(--bg-hover)] ${isToday ? 'bg-[var(--bg-hover)]' : ''}`}>
                    <div className="flex items-center justify-between mb-1">
                      <span className={`text-xs font-bold w-6 h-6 flex items-center justify-center rounded-full ${isToday ? 'text-white' : hasOverdue ? 'text-red-500' : textSec}`}
                        style={isToday ? { background: PINK } : {}}>{day}</span>
                      {dayItems.length > 0 && (
                        <span className={`text-[9px] font-bold px-1 rounded ${hasOverdue ? 'text-red-500 bg-red-500/10' : 'text-amber-500 bg-amber-500/10'}`}>
                          {dayItems.length}
                        </span>
                      )}
                    </div>
                    <div className="space-y-0.5 overflow-hidden flex-1">
                      {dayItems.slice(0, 3).map(item => (
                        <button key={item.stage_id}
                          onClick={() => { setTab('board'); setExpanded(item.flow_id); loadFlow(item.flow_id).then(setAFD); }}
                          className={`w-full text-left text-[9px] px-1.5 py-0.5 rounded truncate font-medium leading-tight
                            ${item.status === 'done'         ? 'bg-green-500/15 text-green-600' :
                              item.tat_status === 'overdue'  ? 'bg-red-500/15 text-red-600' :
                              item.status === 'active'       ? 'bg-amber-500/15 text-amber-600' :
                                                               'bg-[var(--bg-primary)] text-[var(--text-secondary)]'}`}
                          title={`${item.stage_label} — ${item.flow_title}`}>
                          {item.stage_label}
                        </button>
                      ))}
                      {dayItems.length > 3 && <p className={`text-[9px] ${textMuted} pl-1`}>+{dayItems.length - 3} more</p>}
                    </div>
                  </div>
                );
              })}
            </div>
          ));
        })()}
      </div>
    </div>
  );
}

// need RefreshCw for calendar
import { RefreshCw } from 'lucide-react';

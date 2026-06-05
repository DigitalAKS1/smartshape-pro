import React from 'react';
import AdminLayout from '../../components/layouts/AdminLayout';
import { useFlowManagement } from '../../hooks/useFlowManagement';
import FMSDashboard from '../../components/fms/FMSDashboard';
import FlowList from '../../components/fms/FlowList';
import {
  TemplatesTab, NewFlowForm, ReportsTab, SettingsTab, FMSCalendarTab,
  CompleteStageDialog, QCDialog, ChecklistDialog, PaymentDialog,
} from '../../components/fms/FlowFormDialog';
import { RefreshCw, Workflow, Zap, Layers, Calendar, Plus, BarChart2, Settings2 } from 'lucide-react';

const PINK = '#e94560';
const TABS = [
  { id: 'board',     label: 'Flow Board',   icon: Zap      },
  { id: 'templates', label: 'Templates',    icon: Layers   },
  { id: 'calendar',  label: 'Calendar',     icon: Calendar },
  { id: 'create',    label: 'New Flow',     icon: Plus     },
  { id: 'reports',   label: 'Reports',      icon: BarChart2 },
  { id: 'settings',  label: 'TAT Settings', icon: Settings2 },
];

export default function FlowManagement() {
  const s = useFlowManagement();

  const card      = 'bg-[var(--bg-card)] border-[var(--border-color)]';
  const inputCls  = 'bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]';
  const textPri   = 'text-[var(--text-primary)]';
  const textSec   = 'text-[var(--text-secondary)]';
  const textMuted = 'text-[var(--text-muted)]';
  const dlgCls    = `bg-[var(--bg-card)] border-[var(--border-color)] ${textPri}`;

  const theme = { card, textPri, textSec, textMuted, inputCls, dlgCls };

  return (
    <AdminLayout>
      <div className="space-y-5">

        {/* Header */}
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl hidden sm:flex" style={{ background: PINK + '18' }}>
              <Workflow className="h-5 w-5" style={{ color: PINK }} />
            </div>
            <div>
              <h1 className={`text-2xl sm:text-3xl font-semibold ${textPri} tracking-tight`}>Flow Management</h1>
              <p className={`${textMuted} text-xs mt-0.5`}>What · Who · How · When — every process tracked end-to-end</p>
            </div>
          </div>
          <button onClick={s.loadBoard} className={`p-2 rounded-lg border border-[var(--border-color)] ${textMuted} hover:bg-[var(--bg-hover)]`}>
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>

        {/* KPI strip */}
        <FMSDashboard summary={s.summary} card={card} textMuted={textMuted} />

        {/* Tab bar */}
        <div className={`${card} border rounded-xl p-1 flex gap-0.5 overflow-x-auto`}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => s.setTab(t.id)}
              className={`flex items-center gap-1.5 px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-medium whitespace-nowrap transition-all flex-shrink-0
                ${s.tab === t.id ? 'text-white' : `${textSec} hover:bg-[var(--bg-hover)]`}`}
              style={s.tab === t.id ? { background: PINK } : {}}>
              <t.icon className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{t.label}</span>
            </button>
          ))}
        </div>

        {/* Flow Board */}
        {s.tab === 'board' && (
          <FlowList
            filtered={s.filtered} loading={s.loading}
            search={s.search} setSearch={s.setSearch}
            filterType={s.filterType} setFType={s.setFType}
            templates={s.templates}
            expandedFlow={s.expandedFlow} setExpanded={s.setExpanded}
            activeFlowData={s.activeFlowData} setAFD={s.setAFD}
            loadFlow={s.loadFlow} setTab={s.setTab}
            openComplete={s.openComplete} doApprove={s.doApprove} doReject={s.doReject}
            doPause={s.doPause} doResume={s.doResume} fetchLogs={s.fetchLogs}
            openPayment={s.openPayment}
            {...theme}
          />
        )}

        {/* Templates */}
        {s.tab === 'templates' && (
          <TemplatesTab
            templates={s.templates}
            editTmpl={s.editTmpl} setEditTmpl={s.setEditTmpl}
            tmplForm={s.tmplForm} setTmplForm={s.setTmplForm}
            saveTmpl={s.saveTmpl} deleteTmpl={s.deleteTmpl}
            startNewTemplate={s.startNewTemplate} startEditTemplate={s.startEditTemplate}
            addStage={s.addStage} updateStage={s.updateStage}
            removeStage={s.removeStage} moveStage={s.moveStage}
            setSelTmpl={s.setSelTmpl} setTab={s.setTab}
            {...theme}
          />
        )}

        {/* Calendar */}
        {s.tab === 'calendar' && (
          <FMSCalendarTab
            calendarData={s.calendarData}
            calYear={s.calYear} setCalYear={s.setCalYear}
            calMonth={s.calMonth} setCalMonth={s.setCalMonth}
            loadCalendar={s.loadCalendar}
            setTab={s.setTab} setExpanded={s.setExpanded}
            loadFlow={s.loadFlow} setAFD={s.setAFD}
            {...theme}
          />
        )}

        {/* Create Flow */}
        {s.tab === 'create' && (
          <NewFlowForm
            templates={s.templates}
            selectedTemplate={s.selectedTemplate} setSelTmpl={s.setSelTmpl}
            newFlow={s.newFlow} setNewFlow={s.setNewFlow} createFlow={s.createFlow}
            leadSearch={s.leadSearch} setLeadSearch={s.setLeadSearch}
            leadResults={s.leadResults}
            selectedLead={s.selectedLead} setSelectedLead={s.setSelectedLead}
            selectLead={s.selectLead}
            {...theme}
          />
        )}

        {/* Reports */}
        {s.tab === 'reports' && (
          <ReportsTab scores={s.scores} {...theme} />
        )}

        {/* Settings */}
        {s.tab === 'settings' && (
          <SettingsTab
            settForm={s.settForm} setSettForm={s.setSettForm}
            saveSettings={s.saveSettings}
            {...theme}
          />
        )}
      </div>

      {/* Dialogs */}
      <CompleteStageDialog
        open={s.completeOpen} onOpenChange={s.setCompleteOpen}
        completeStage={s.completeStage} completeNote={s.completeNote}
        setCNote={s.setCNote} doComplete={s.doComplete}
        {...theme}
      />

      <QCDialog
        open={s.qcOpen} onOpenChange={s.setQcOpen}
        qcItems={s.qcItems} qcOverall={s.qcOverall}
        toggleQcItem={s.toggleQcItem} submitQC={s.submitQC}
        {...theme}
      />

      <ChecklistDialog
        open={s.clOpen} onOpenChange={s.setClOpen}
        clItems={s.clItems} toggleClItem={s.toggleClItem}
        submitChecklist={s.submitChecklist}
        {...theme}
      />

      <PaymentDialog
        open={s.payOpen} onOpenChange={s.setPayOpen}
        payFlow={s.payFlow} payData={s.payData}
        payForm={s.payForm} setPayForm={s.setPayForm}
        submitPayment={s.submitPayment}
        {...theme}
      />
    </AdminLayout>
  );
}

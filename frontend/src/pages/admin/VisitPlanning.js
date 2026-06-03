import React from 'react';
import AppShell from '../../components/layouts/AppShell';
import { Button } from '../../components/ui/button';
import { toast } from 'sonner';
import { Plus, MapPin, Calendar, CheckCircle, Clock, AlertTriangle, ClipboardList } from 'lucide-react';
import WhatsAppSendDialog from '../../components/WhatsAppSendDialog';

import useVisitPlanning from '../../hooks/useVisitPlanning';
import AdminVisitCard from '../../components/visits/AdminVisitCard';
import VisitCreateDialog from '../../components/visits/VisitCreateDialog';
import VisitCheckoutDialog from '../../components/visits/VisitCheckoutDialog';
import VisitRescheduleDialog from '../../components/visits/VisitRescheduleDialog';

export default function VisitPlanning() {
  const vp = useVisitPlanning();

  if (vp.loading) {
    return (
      <AppShell>
        <div className="flex items-center justify-center h-96">
          <div className="w-8 h-8 border-2 border-[#e94560] border-t-transparent rounded-full animate-spin" />
        </div>
      </AppShell>
    );
  }

  const { tk, isDark } = vp;

  return (
    <AppShell>
      <div className="space-y-5 pb-10">

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <div className="flex items-center gap-3">
              <h1 className={`text-2xl sm:text-3xl font-bold ${tk.t1} tracking-tight`}>Visit Planning</h1>
              <button onClick={() => vp.nav('/delegation')}
                className={`hidden sm:flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-[var(--border-color)] hover:bg-[var(--bg-hover)] ${tk.tm}`}>
                <ClipboardList className="h-3.5 w-3.5" /> Delegation Tasks
              </button>
            </div>
            <p className={`text-sm ${tk.tm} mt-0.5`}>
              {vp.todayCount} today · {vp.upcomingCount} upcoming
              {vp.overdueCount > 0 && <span className="text-[#e94560] ml-1">· {vp.overdueCount} overdue</span>}
            </p>
          </div>
          <Button onClick={vp.openCreate} className="bg-[#e94560] hover:bg-[#f05c75] text-white h-9 px-4 text-sm rounded-lg">
            <Plus className="h-4 w-4 mr-1.5" />Plan Visit
          </Button>
        </div>

        {/* ── Stats strip ─────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { icon: Calendar,      color: 'text-[#e94560]',    value: vp.todayCount,     label: 'Today'   },
            { icon: Clock,         color: 'text-blue-500',     value: vp.upcomingCount,  label: 'Upcoming' },
            { icon: CheckCircle,   color: 'text-emerald-500',  value: vp.completedCount, label: 'Done'    },
            { icon: AlertTriangle, color: 'text-amber-500',    value: vp.overdueCount,   label: 'Overdue' },
          ].map(({ icon: Icon, color, value, label }) => (
            <div key={label} className={`${tk.card} border rounded-xl p-4 flex items-center gap-3`}>
              <div className={`w-9 h-9 rounded-lg ${isDark ? 'bg-[var(--bg-hover)]' : 'bg-[#f8fafc]'} flex items-center justify-center flex-shrink-0`}>
                <Icon className={`h-4.5 w-4.5 ${color}`} style={{ width: 18, height: 18 }} />
              </div>
              <div>
                <p className={`text-xl font-black leading-none ${tk.t1}`}>{value}</p>
                <p className={`text-[11px] uppercase tracking-wide font-medium mt-0.5 ${tk.tm}`}>{label}</p>
              </div>
            </div>
          ))}
        </div>

        {/* ── Filter chips ─────────────────────────────────────────────────── */}
        <div className="flex gap-2 flex-wrap">
          {['all', 'planned', 'in_progress', 'completed', 'cancelled'].map(f => (
            <button key={f} onClick={() => vp.setFilter(f)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all capitalize border ${
                vp.filter === f
                  ? 'bg-[#e94560] text-white border-[#e94560]'
                  : `${tk.card} ${tk.tm} hover:border-[#e94560] hover:text-[#e94560]`
              }`}>
              {f.replace('_', ' ')}
              <span className="ml-1.5 opacity-70">
                {f === 'all' ? vp.plans.length : vp.plans.filter(p => p.status === f).length}
              </span>
            </button>
          ))}
        </div>

        {/* ── Visit groups ─────────────────────────────────────────────────── */}
        {vp.filteredGroups.length === 0 && (
          <div className={`${tk.card} border rounded-2xl p-14 text-center`}>
            <MapPin className={`h-10 w-10 ${tk.tm} mx-auto mb-3 opacity-30`} />
            <p className={`text-sm ${tk.tm}`}>No visits in this view</p>
          </div>
        )}

        {vp.filteredGroups.map(({ key, label, items }) => (
          <div key={key}>
            <div className="flex items-center gap-3 mb-2.5">
              <p className={`text-[11px] uppercase tracking-widest font-bold ${key === 'overdue' ? 'text-[#e94560]' : tk.tm}`}>{label}</p>
              <div className={`flex-1 h-px ${isDark ? 'bg-[var(--border-color)]' : 'bg-[#e2e8f0]'}`} />
              <span className={`text-[11px] font-semibold ${tk.tm}`}>{items.length}</span>
            </div>
            <div className="space-y-2.5">
              {items.map(plan => (
                <AdminVisitCard key={plan.plan_id} plan={plan} tk={tk} isDark={isDark} today={vp.today}
                  onCheckIn={vp.handleCheckIn}
                  onOpenCheckout={vp.openCheckout}
                  onReschedule={vp.openReschedule}
                  onDelete={vp.handleDelete}
                  onHistory={() => vp.setHistoryDialog({ open: true, plan })} />
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* ── Dialogs ──────────────────────────────────────────────────────── */}
      <VisitCreateDialog
        dialogOpen={vp.dialogOpen} setDialogOpen={vp.setDialogOpen}
        form={vp.form} setForm={vp.setForm}
        mapsInput={vp.mapsInput} setMapsInput={vp.setMapsInput}
        gpsLoading={vp.gpsLoading} urlLoading={vp.urlLoading}
        handleGps={vp.handleGps}
        schoolQuery={vp.schoolQuery} setSchoolQuery={vp.setSchoolQuery}
        showSchoolDrop={vp.showSchoolDrop} setShowSchoolDrop={vp.setShowSchoolDrop}
        filteredSchools={vp.filteredSchools}
        handleSelectSchool={vp.handleSelectSchool} clearSchool={vp.clearSchool}
        createSchoolMode={vp.createSchoolMode} setCreateSchoolMode={vp.setCreateSchoolMode}
        newSchool={vp.newSchool} setNewSchool={vp.setNewSchool}
        schoolSaving={vp.schoolSaving} handleCreateSchool={vp.handleCreateSchool}
        contactQuery={vp.contactQuery} setContactQuery={vp.setContactQuery}
        showContactDrop={vp.showContactDrop} setShowContactDrop={vp.setShowContactDrop}
        filteredContacts={vp.filteredContacts}
        selectedContact={vp.selectedContact}
        handleSelectContact={vp.handleSelectContact} clearContact={vp.clearContact}
        createContactMode={vp.createContactMode} setCreateContactMode={vp.setCreateContactMode}
        newContact={vp.newContact} setNewContact={vp.setNewContact}
        contactSaving={vp.contactSaving} handleCreateContact={vp.handleCreateContact}
        leadsList={vp.leadsList}
        spList={vp.spList}
        handleSave={vp.handleSave}
        tk={tk} isDark={isDark}
      />

      <VisitCheckoutDialog
        checkoutDialog={vp.checkoutDialog} setCheckoutDialog={vp.setCheckoutDialog}
        checkoutNotes={vp.checkoutNotes} setCheckoutNotes={vp.setCheckoutNotes}
        checkoutWa={vp.checkoutWa} setCheckoutWa={vp.setCheckoutWa}
        handleCheckOut={vp.handleCheckOut}
        tk={tk} isDark={isDark}
      />

      <VisitRescheduleDialog
        rescheduleDialog={vp.rescheduleDialog} setRescheduleDialog={vp.setRescheduleDialog}
        rescheduleForm={vp.rescheduleForm} setRescheduleForm={vp.setRescheduleForm}
        handleReschedule={vp.handleReschedule}
        historyDialog={vp.historyDialog} setHistoryDialog={vp.setHistoryDialog}
        tk={tk} isDark={isDark}
      />

      <WhatsAppSendDialog open={vp.waOpen} onOpenChange={vp.setWaOpen}
        module={vp.waCtx.module} context={vp.waCtx.context} title={vp.waCtx.title} />
    </AppShell>
  );
}

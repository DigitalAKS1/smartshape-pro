import React from 'react';
import { ChevronLeft, ChevronRight, Plus, Copy, RefreshCw, Settings, Video, Bell } from 'lucide-react';
import { useDelegationCalendar } from '../../../hooks/useDelegationCalendar';
import CalendarMonth from './CalendarMonth';
import AgendaList from './AgendaList';
import CalendarDay from './CalendarDay';
import DayPlanBlockDialog from './DayPlanBlockDialog';
import EventActionDrawer from './EventActionDrawer';
import EventDialog from './EventDialog';
import RemindersPanel from './RemindersPanel';
import DayPopup from './DayPopup';

const PINK = '#e94560';
const SKY = '#0ea5e9';
const SOURCE_LABELS = {
  delegation: 'Tasks', fms: 'FMS', visit: 'Visits', task: 'CRM', followup: 'Calls',
  workshop: 'Workshops', plan: 'My Plan', reminder: 'Reminders',
};
const SOURCE_COLORS = {
  delegation: '#e94560', fms: '#8b5cf6', visit: '#06b6d4', task: '#f59e0b',
  followup: '#10b981', workshop: '#6366f1', plan: '#64748b', reminder: '#f97316',
};

export default function DelegationCalendar({ onEventClick, card, textPri, textSec, textMuted, inputCls }) {
  const c = useDelegationCalendar();
  const [blockDialog, setBlockDialog] = React.useState(null);
  const [selectedEvent, setSelectedEvent] = React.useState(null);
  const [quickAdd, setQuickAdd] = React.useState(null);   // {date, start} slot chooser
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [mForm, setMForm] = React.useState({ provider: '', link: '' });   // default meeting
  const [feedUrls, setFeedUrls] = React.useState(null);                   // {url, webcal_url}
  const [savingM, setSavingM] = React.useState(false);
  const [remindersOpen, setRemindersOpen] = React.useState(false);
  const [dayPopup, setDayPopup] = React.useState(null);   // 'YYYY-MM-DD' or null
  const monthLabel = c.cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  const openSettings = async () => {
    const s = c.calSettings || await c.getCalSettings();
    setMForm({ provider: s?.default_meeting_provider || '', link: s?.default_meeting_link || '' });
    setFeedUrls(s ? { url: s.url, webcal_url: s.webcal_url } : await c.getFeedLink());
    setSettingsOpen(true);
  };

  const rangeDates = () => {
    const out = []; let d = new Date(c.range.from + 'T00:00:00');
    const end = new Date(c.range.to + 'T00:00:00');
    while (d <= end) { out.push(c.helpers.iso(d)); d = c.helpers.addDays(d, 1); }
    return out;
  };

  return (
    <div className="space-y-3">
      <style>{`@keyframes calReveal{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}} .cal-reveal{animation:calReveal .2s ease both}`}</style>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-1.5">
          <button onClick={c.goPrev} aria-label="Previous period" className={`p-2 rounded-lg cursor-pointer transition-colors duration-200 hover:bg-[var(--bg-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#e94560]/60 ${textSec}`}><ChevronLeft className="h-4 w-4" /></button>
          <button onClick={c.goToday} className={`px-3 py-1.5 rounded-lg text-xs font-medium border border-[var(--border-color)] cursor-pointer transition-colors duration-200 ${textSec} hover:bg-[var(--bg-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#e94560]/60`}>Today</button>
          <button onClick={c.goNext} aria-label="Next period" className={`p-2 rounded-lg cursor-pointer transition-colors duration-200 hover:bg-[var(--bg-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#e94560]/60 ${textSec}`}><ChevronRight className="h-4 w-4" /></button>
          <h2 className={`text-base font-bold tracking-tight ${textPri} ml-2`}>
            {c.view === 'month' ? monthLabel
              : c.view === 'week' ? `Week of ${c.range.from}`
              : c.view === 'list' ? 'Next 30 days'
              : new Date(c.range.from + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
          </h2>
        </div>
        <div className="flex items-center gap-2">
          {c.canViewTeam && (
            <select value={c.subjectEmp} onChange={(e) => c.setSubjectEmp(e.target.value)}
              className={`h-9 px-2.5 rounded-lg text-xs border border-[var(--border-color)] ${inputCls}`}>
              <option value="">My calendar</option>
              {c.teamOptions.map(o => <option key={o.emp_id} value={o.emp_id}>{o.name}</option>)}
            </select>
          )}
          <div className={`${card} border rounded-xl p-1 flex gap-0.5`}>
            {['month', 'week', 'day', 'list'].map(v => (
              <button key={v} onClick={() => c.setView(v)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize ${c.view === v ? 'text-white' : `${textSec} hover:bg-[var(--bg-hover)]`}`}
                style={c.view === v ? { background: PINK } : {}}>{v}</button>
            ))}
          </div>
          {!c.subjectEmp && (
            <button onClick={() => c.setEventDialog({ defaults: { date: c.range.from, start_time: '09:00' } })}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white" style={{ background: SKY }}>
              <Plus className="h-3.5 w-3.5" /> Event
            </button>
          )}
          {!c.subjectEmp && (
            <button onClick={() => setRemindersOpen(true)} title="Reminders"
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-[var(--border-color)] ${textSec} hover:bg-[var(--bg-hover)]`}>
              <Bell className="h-3.5 w-3.5" /> Reminders
            </button>
          )}
          {!c.subjectEmp && (
            <button onClick={openSettings} title="Calendar settings"
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-[var(--border-color)] ${textSec} hover:bg-[var(--bg-hover)]`}>
              <Settings className="h-3.5 w-3.5" /> Settings
            </button>
          )}
          {c.view === 'day' && !c.subjectEmp && (
            <button onClick={() => setBlockDialog({ start: '09:00' })}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white" style={{ background: PINK }}>
              <Plus className="h-3.5 w-3.5" /> Block
            </button>
          )}
        </div>
      </div>

      {c.subjectEmp && (
        <div className="px-3 py-1.5 rounded-lg text-xs flex items-center gap-2"
          style={{ background: '#e9456012', color: '#e94560' }}>
          Viewing {(c.teamOptions.find(o => o.emp_id === c.subjectEmp) || {}).name || 'team member'}'s calendar (read-only).
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        {c.ALL_SOURCES.map(s => {
          const on = !c.hidden.has(s);
          return (
            <button key={s} onClick={() => c.toggleSource(s)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] border transition-colors ${on ? '' : 'opacity-40'}`}
              style={{ borderColor: SOURCE_COLORS[s] + '55', background: on ? SOURCE_COLORS[s] + '18' : 'transparent', color: on ? SOURCE_COLORS[s] : textMuted }}>
              <span className="w-2 h-2 rounded-full" style={{ background: SOURCE_COLORS[s] }} />
              {SOURCE_LABELS[s]}
            </button>
          );
        })}
      </div>

      {c.loading && (
        <div className="flex items-center justify-center py-10">
          <div className="animate-spin rounded-full h-7 w-7 border-4 border-[#e94560] border-t-transparent" />
        </div>
      )}

      <div key={c.view + c.range.from} className="cal-reveal">
        {!c.loading && c.view === 'month' && (
          <CalendarMonth cursor={c.cursor} eventsByDate={c.eventsByDate}
            onDayClick={(d) => setDayPopup(c.helpers.iso(d))}
            helpers={c.helpers} card={card} textPri={textPri} textSec={textSec} textMuted={textMuted} />
        )}
        {!c.loading && c.view === 'week' && (
          <AgendaList dates={rangeDates()} eventsByDate={c.eventsByDate}
            onEventClick={(e) => e.source === 'plan' ? setBlockDialog({ block: e }) : setSelectedEvent(e)} card={card} textPri={textPri} textSec={textSec} textMuted={textMuted} />
        )}
        {!c.loading && c.view === 'list' && (
          <AgendaList dates={rangeDates()} eventsByDate={c.eventsByDate}
            onEventClick={(e) => e.source === 'plan' ? setBlockDialog({ block: e }) : setSelectedEvent(e)} card={card} textPri={textPri} textSec={textSec} textMuted={textMuted} />
        )}
        {!c.loading && c.view === 'day' && (
          <CalendarDay
            date={c.range.from} events={c.eventsByDate[c.range.from] || []}
            onEventClick={(e) => setSelectedEvent(e)}
            onAddBlock={(start) => setQuickAdd({ date: c.range.from, start })}
            onEditBlock={(e) => setBlockDialog({ block: e })}
            onDropItem={(ev, start) => c.scheduleItem(ev, c.range.from, start)}
            onMoveBlock={(id, start) => {
              const endHH = String(Math.min(23, parseInt(start.slice(0,2),10) + 1)).padStart(2,'0');
              c.updateBlock(id, { start_time: start, end_time: `${endHH}:00` });
            }}
            readOnly={!!c.subjectEmp}
            card={card} textPri={textPri} textSec={textSec} textMuted={textMuted} />
        )}

        {c.view === 'month' && (
          <p className={`text-[11px] ${textMuted} text-center`}>Tip: click a day to open it.</p>
        )}
      </div>

      {blockDialog && (
        <DayPlanBlockDialog
          block={blockDialog.block}
          date={c.range.from}
          onSave={async (payload) => {
            const ok = blockDialog.block?.entity_id
              ? await c.updateBlock(blockDialog.block.entity_id, payload)
              : await c.createBlock({ ...payload, start_time: payload.start_time || blockDialog.start || '09:00' });
            if (ok) setBlockDialog(null);
          }}
          onDelete={async (id) => { if (await c.deleteBlock(id)) setBlockDialog(null); }}
          onClose={() => setBlockDialog(null)}
          card={card} textPri={textPri} textSec={textSec} textMuted={textMuted} inputCls={inputCls} />
      )}
      {selectedEvent && (
        <EventActionDrawer
          event={selectedEvent}
          onAction={c.runAction}
          onEditEvent={(ev) => c.setEventDialog({ event: ev })}
          onSendInvites={c.sendInvites}
          onManageReminder={() => setRemindersOpen(true)}
          onClose={() => setSelectedEvent(null)}
          card={card} textPri={textPri} textSec={textSec} textMuted={textMuted} inputCls={inputCls} />
      )}

      {/* slot chooser: block or event */}
      {quickAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setQuickAdd(null)}>
          <div className={`${card} border rounded-2xl w-full max-w-xs p-4`} onClick={e => e.stopPropagation()}>
            <p className={`text-sm font-semibold ${textPri} mb-1`}>Add at {quickAdd.start}</p>
            <p className={`text-[11px] ${textMuted} mb-3`}>{quickAdd.date}</p>
            <div className="space-y-2">
              <button onClick={() => { setBlockDialog({ start: quickAdd.start }); setQuickAdd(null); }}
                className="w-full h-10 rounded-lg text-sm font-semibold text-white" style={{ background: PINK }}>
                Personal block
              </button>
              <button onClick={() => { c.setEventDialog({ defaults: { date: quickAdd.date, start_time: quickAdd.start } }); setQuickAdd(null); }}
                className="w-full h-10 rounded-lg text-sm font-semibold text-white" style={{ background: SKY }}>
                Shared event (collaborate)
              </button>
            </div>
          </div>
        </div>
      )}

      {remindersOpen && (
        <RemindersPanel onClose={() => { setRemindersOpen(false); c.reload(); }}
          card={card} textPri={textPri} textSec={textSec} textMuted={textMuted} inputCls={inputCls} />
      )}

      {/* calendar settings: default meeting link + subscribe feed */}
      {settingsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setSettingsOpen(false)}>
          <div className={`${card} border rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto p-5`} onClick={e => e.stopPropagation()}>
            <p className={`text-base font-semibold ${textPri} mb-4`}>Calendar settings</p>

            {/* default meeting link */}
            <div className="space-y-2 mb-5">
              <p className={`text-[11px] font-semibold uppercase tracking-wide ${textMuted} flex items-center gap-1.5`}>
                <Video className="h-3.5 w-3.5" /> Default meeting link
              </p>
              <p className={`text-[11px] ${textMuted}`}>
                New events pre-fill with this. Paste your personal Zoom/Meet room so you don’t re-enter it each time.
              </p>
              <div className="grid grid-cols-2 gap-2">
                <select value={mForm.provider} onChange={e => setMForm(f => ({ ...f, provider: e.target.value }))}
                  className={`h-9 px-2.5 rounded text-sm border border-[var(--border-color)] ${inputCls}`}>
                  <option value="">None</option>
                  <option value="zoom">Zoom</option>
                  <option value="meet">Google Meet</option>
                  <option value="other">Other</option>
                </select>
                <input value={mForm.link} onChange={e => setMForm(f => ({ ...f, link: e.target.value }))}
                  placeholder="https://zoom.us/j/…" disabled={!mForm.provider}
                  className={`h-9 px-2.5 rounded text-sm border border-[var(--border-color)] ${inputCls} disabled:opacity-50`} />
              </div>
              <button disabled={savingM} onClick={async () => {
                  setSavingM(true);
                  await c.saveCalSettings({ default_meeting_provider: mForm.provider,
                    default_meeting_link: mForm.provider ? mForm.link.trim() : '' });
                  setSavingM(false);
                }}
                className="h-9 px-4 rounded-lg text-sm font-semibold text-white" style={{ background: SKY }}>
                Save meeting link
              </button>
            </div>

            <div className="h-px bg-[var(--border-color)] my-4" />

            {/* subscribe feed */}
            <div className="space-y-2">
              <p className={`text-[11px] font-semibold uppercase tracking-wide ${textMuted}`}>Subscribe in your calendar app</p>
              <p className={`text-[11px] ${textMuted}`}>
                Add this private link in Apple/Google/Outlook (“New Calendar Subscription” / “From URL”). Keep it private.
              </p>
              {!feedUrls ? (
                <p className={`text-xs ${textMuted}`}>Loading…</p>
              ) : (
                <>
                  <div className="flex gap-2">
                    <input readOnly value={feedUrls.webcal_url} onFocus={e => e.target.select()}
                      className={`flex-1 h-9 px-2.5 text-xs rounded border border-[var(--border-color)] ${inputCls}`} />
                    <button onClick={() => navigator.clipboard?.writeText(feedUrls.webcal_url)}
                      className="h-9 px-3 rounded-lg text-xs font-semibold border border-[var(--border-color)] flex items-center gap-1" style={{ color: SKY }}>
                      <Copy className="h-3.5 w-3.5" /> Copy
                    </button>
                  </div>
                  <div className="flex items-center justify-between">
                    <a href={feedUrls.webcal_url} className="text-xs font-semibold" style={{ color: SKY }}>Open in calendar app</a>
                    <button onClick={async () => setFeedUrls(await c.rotateFeedLink())}
                      className={`text-[11px] flex items-center gap-1 ${textMuted}`}>
                      <RefreshCw className="h-3 w-3" /> Rotate link
                    </button>
                  </div>
                </>
              )}
            </div>

            <button onClick={() => setSettingsOpen(false)}
              className={`w-full h-9 mt-5 rounded-lg text-sm font-semibold border border-[var(--border-color)] ${textSec}`}>Close</button>
          </div>
        </div>
      )}

      {c.eventDialog && (
        <EventDialog
          event={c.eventDialog.event}
          defaults={c.eventDialog.defaults}
          meetingDefaults={c.meetingDefaults}
          teamOptions={c.collabOptions}
          onSave={async (payload, editId) => {
            const ok = editId ? await c.updateEvent(editId, payload) : await c.createEvent(payload);
            if (ok) c.setEventDialog(null);
          }}
          onClose={() => c.setEventDialog(null)}
          card={card} textPri={textPri} textSec={textSec} textMuted={textMuted} inputCls={inputCls} />
      )}

      {dayPopup && (
        <DayPopup
          date={dayPopup}
          events={c.eventsByDate[dayPopup] || []}
          onOpen={(e) => { setDayPopup(null); e.source === 'plan' ? setBlockDialog({ block: e }) : setSelectedEvent(e); }}
          onOpenDay={() => { c.setCursor(new Date(dayPopup + 'T00:00:00')); c.setView('day'); setDayPopup(null); }}
          onClose={() => setDayPopup(null)}
          card={card} textPri={textPri} textSec={textSec} textMuted={textMuted} />
      )}
    </div>
  );
}

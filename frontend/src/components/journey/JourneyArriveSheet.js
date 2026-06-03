import React from 'react';
import { MapPin, CheckCircle2, Loader2, Phone } from 'lucide-react';

export default function JourneyArriveSheet({
  busy,
  dbLoaded,
  schoolName, setSchoolName,
  schoolSearch, setSchoolSearch,
  selectedSchool, setSelectedSchool,
  showSchoolDrop, setShowSchoolDrop,
  schoolResults,
  selectSchool, clearSchool,
  schoolContacts,
  contactName, setContactName,
  contactDesignation, setContactDesignation,
  contactPhone, setContactPhone,
  contactId, setContactId,
  selectContact,
  linkedVisit, setLinkedVisit,
  unlinkedTodayVisits,
  arrive,
  resetArriveForm,
}) {
  return (
    <div className="fixed inset-0 z-[200] flex items-end" onClick={resetArriveForm}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative w-full bg-[var(--bg-card)] rounded-t-3xl flex flex-col"
        style={{ maxHeight: '88dvh' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Drag handle */}
        <div className="flex-shrink-0 flex justify-center pt-3 pb-1">
          <div className="w-10 h-1.5 bg-[var(--border-color)] rounded-full" />
        </div>

        {/* Header */}
        <div className="flex-shrink-0 px-5 pt-2 pb-3.5 border-b border-[var(--border-color)] flex items-center justify-between">
          <div>
            <p className="text-lg font-bold text-[var(--text-primary)] leading-tight">Arrived at School</p>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">Log your visit details</p>
          </div>
          {!dbLoaded && <Loader2 className="h-4 w-4 animate-spin text-[var(--text-muted)]" />}
        </div>

        {/* Scrollable form */}
        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-5">

          {/* Planned visits quick-link */}
          {unlinkedTodayVisits.length > 0 && (
            <div>
              <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-widest font-semibold mb-2">
                Planned today — tap to auto-fill
              </p>
              <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
                {unlinkedTodayVisits.map(v => {
                  const sel = linkedVisit === (v.visit_id || v.plan_id);
                  return (
                    <button
                      key={v.visit_id || v.plan_id}
                      onClick={() => {
                        setSchoolName(v.school_name || v.name || '');
                        setSchoolSearch(v.school_name || v.name || '');
                        setLinkedVisit(v.visit_id || v.plan_id || '');
                        setSelectedSchool(null);
                      }}
                      className={`flex-shrink-0 flex items-center gap-2 px-3.5 py-2.5 rounded-xl border-2 text-left text-xs transition-all ${
                        sel ? 'border-[#e94560]/50 bg-[#e94560]/10 text-[#e94560]'
                            : 'border-[var(--border-color)] text-[var(--text-secondary)]'
                      }`}
                    >
                      <MapPin className="h-3.5 w-3.5 flex-shrink-0" />
                      <span className="font-semibold whitespace-nowrap">{v.school_name || v.name}</span>
                      {sel && <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0" />}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* School search */}
          <div>
            <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-widest font-semibold mb-2">School</p>
            {selectedSchool ? (
              <div className="flex items-center gap-2 px-4 py-3 rounded-2xl border-2 border-[#e94560]/40 bg-[#e94560]/8">
                <MapPin className="h-4 w-4 text-[#e94560] flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-[var(--text-primary)] truncate">
                    {selectedSchool.school_name || selectedSchool.name}
                  </p>
                  {(selectedSchool.city || selectedSchool.board) && (
                    <p className="text-[10px] text-[var(--text-muted)] truncate">
                      {[selectedSchool.city, selectedSchool.board].filter(Boolean).join(' · ')}
                    </p>
                  )}
                </div>
                <button onClick={clearSchool} className="p-1 text-[var(--text-muted)] flex-shrink-0">
                  <CheckCircle2 className="h-4 w-4 text-[#e94560]" />
                </button>
                <button onClick={clearSchool} className="p-0.5 text-[var(--text-muted)] flex-shrink-0 hover:text-[var(--text-primary)]">
                  <span className="text-base leading-none">×</span>
                </button>
              </div>
            ) : (
              <div className="relative">
                <MapPin className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-muted)] pointer-events-none" />
                <input
                  value={schoolSearch}
                  onChange={e => { setSchoolSearch(e.target.value); setSchoolName(e.target.value); setShowSchoolDrop(true); }}
                  onFocus={() => setShowSchoolDrop(true)}
                  placeholder="Search or type school name…"
                  autoComplete="off"
                  className="w-full bg-[var(--bg-primary)] border-2 border-[var(--border-color)] rounded-2xl pl-10 pr-4 py-3.5 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[#e94560] transition-colors"
                />
                {showSchoolDrop && schoolResults.length > 0 && (
                  <div className="absolute top-full left-0 right-0 mt-1.5 bg-[var(--bg-card)] border border-[var(--border-color)] rounded-2xl shadow-2xl z-10 overflow-hidden">
                    {schoolResults.map(s => (
                      <button
                        key={s.school_id}
                        onClick={() => selectSchool(s)}
                        className="w-full flex items-center gap-3 px-4 py-3 text-left border-b border-[var(--border-color)] last:border-0 hover:bg-[var(--bg-hover)] transition-colors"
                      >
                        <div className="w-8 h-8 rounded-xl bg-[#e94560]/10 flex items-center justify-center flex-shrink-0">
                          <MapPin className="h-3.5 w-3.5 text-[#e94560]" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-[var(--text-primary)] truncate">{s.school_name || s.name}</p>
                          {(s.city || s.board) && (
                            <p className="text-[10px] text-[var(--text-muted)]">{[s.city, s.board].filter(Boolean).join(' · ')}</p>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Contact picker */}
          <div>
            <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-widest font-semibold mb-2">Contact Person</p>
            {schoolContacts.length > 0 && (
              <div className="flex gap-2 overflow-x-auto pb-2 mb-3 no-scrollbar">
                {schoolContacts.slice(0, 8).map(c => {
                  const sel = contactId === c.contact_id;
                  return (
                    <button
                      key={c.contact_id}
                      onClick={() => sel
                        ? (setContactId('') || setContactName('') || setContactDesignation('') || setContactPhone(''))
                        : selectContact(c)
                      }
                      className={`flex-shrink-0 flex flex-col items-center gap-1 px-3 py-2.5 rounded-xl border-2 text-center transition-all ${
                        sel ? 'border-[#e94560]/50 bg-[#e94560]/10' : 'border-[var(--border-color)]'
                      }`}
                    >
                      <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold ${
                        sel ? 'bg-[#e94560] text-white' : 'bg-[var(--bg-primary)] text-[var(--text-secondary)]'
                      }`}>
                        {(c.name || '?').charAt(0).toUpperCase()}
                      </div>
                      <p className={`text-[10px] font-semibold whitespace-nowrap max-w-[68px] truncate ${
                        sel ? 'text-[#e94560]' : 'text-[var(--text-secondary)]'
                      }`}>{(c.name || '').split(' ')[0]}</p>
                      {c.designation && (
                        <p className="text-[9px] text-[var(--text-muted)] truncate max-w-[68px]">{c.designation}</p>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
            <div className="flex gap-2 mb-2">
              <input
                value={contactName}
                onChange={e => { setContactName(e.target.value); setContactId(''); }}
                placeholder="Contact name"
                autoComplete="off"
                className="flex-1 bg-[var(--bg-primary)] border-2 border-[var(--border-color)] rounded-xl px-3.5 py-3 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[#e94560] transition-colors"
              />
              <input
                value={contactDesignation}
                onChange={e => setContactDesignation(e.target.value)}
                placeholder="Designation"
                autoComplete="off"
                className="w-32 bg-[var(--bg-primary)] border-2 border-[var(--border-color)] rounded-xl px-3.5 py-3 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[#e94560] transition-colors"
              />
            </div>
            <div className="relative">
              <Phone className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-muted)] pointer-events-none" />
              <input
                value={contactPhone}
                onChange={e => setContactPhone(e.target.value)}
                placeholder="Contact number"
                type="tel"
                autoComplete="off"
                className="w-full bg-[var(--bg-primary)] border-2 border-[var(--border-color)] rounded-xl pl-10 pr-4 py-3 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[#e94560] transition-colors"
              />
            </div>
          </div>
        </div>

        {/* Submit */}
        <div
          className="flex-shrink-0 px-5 pt-3 border-t border-[var(--border-color)] bg-[var(--bg-card)]"
          style={{ paddingBottom: 'max(20px, env(safe-area-inset-bottom))' }}
        >
          <button
            onClick={arrive}
            disabled={busy || !schoolName.trim()}
            className="w-full py-4 rounded-2xl bg-[#e94560] text-white font-bold text-sm shadow-xl shadow-[#e94560]/30 disabled:opacity-40 flex items-center justify-center gap-2 active:scale-[0.98] transition-all"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <MapPin className="h-4 w-4" />}
            {busy ? 'Getting GPS…' : 'Mark Arrived + Calculate KM'}
          </button>
        </div>
      </div>
    </div>
  );
}

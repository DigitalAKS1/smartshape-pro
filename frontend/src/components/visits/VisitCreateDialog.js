import React from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogFooter, DialogDescription,
} from '../ui/dialog';
import {
  Plus, Search, X, UserPlus, Building2,
  LinkIcon, Navigation, CheckCheck, Loader2,
} from 'lucide-react';

/**
 * Dialog for planning (creating) a new visit.
 * All state and handlers come from useVisitPlanning().
 */
export default function VisitCreateDialog({
  // open state
  dialogOpen, setDialogOpen,
  // form
  form, setForm,
  // location
  mapsInput, setMapsInput,
  gpsLoading, urlLoading,
  handleGps,
  // school picker
  schoolQuery, setSchoolQuery,
  showSchoolDrop, setShowSchoolDrop,
  filteredSchools,
  handleSelectSchool, clearSchool,
  createSchoolMode, setCreateSchoolMode,
  newSchool, setNewSchool, schoolSaving, handleCreateSchool,
  // contact picker
  contactQuery, setContactQuery,
  showContactDrop, setShowContactDrop,
  filteredContacts,
  selectedContact,
  handleSelectContact, clearContact,
  createContactMode, setCreateContactMode,
  newContact, setNewContact, contactSaving, handleCreateContact,
  // lead link
  leadsList,
  // assign to
  spList,
  // save
  handleSave,
  // tokens
  tk, isDark,
}) {
  return (
    <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
      <DialogContent className={`${tk.dlg} border w-[calc(100vw-1rem)] sm:max-w-md max-h-[88dvh] overflow-y-auto rounded-2xl`}>
        <DialogHeader>
          <DialogTitle className={tk.t1}>Plan a Visit</DialogTitle>
          <DialogDescription className={tk.tm}>Fill in the details to schedule a field visit.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3.5 py-1">

          {/* ── School picker ──────────────────────────────────────────── */}
          <div>
            <Label className={`text-xs ${tk.tm} mb-1.5 block`}>School</Label>
            {form.school_name && !createSchoolMode ? (
              <div className={`flex items-center gap-2 rounded-lg px-3 py-2 border ${isDark ? 'bg-[var(--bg-hover)] border-[var(--border-color)]' : 'bg-[#f1f5f9] border-[#e2e8f0]'}`}>
                <Building2 className="h-3.5 w-3.5 text-[#e94560] flex-shrink-0" />
                <span className={`flex-1 text-sm font-medium ${tk.t1}`}>{form.school_name}</span>
                <button type="button" onClick={clearSchool} className={`${tk.tm} hover:text-red-400 p-0.5`}><X className="h-3.5 w-3.5" /></button>
              </div>
            ) : !createSchoolMode ? (
              <div className="relative">
                <Search className={`absolute left-2.5 top-2.5 h-3.5 w-3.5 ${tk.tm} pointer-events-none`} />
                <Input
                  value={schoolQuery}
                  onChange={e => { setSchoolQuery(e.target.value); setShowSchoolDrop(true); }}
                  onFocus={() => setShowSchoolDrop(true)}
                  onBlur={() => setTimeout(() => setShowSchoolDrop(false), 150)}
                  className={`${tk.input} h-10 pl-8 text-sm rounded-lg`}
                  placeholder="Search school…"
                />
                {showSchoolDrop && (
                  <div className={`absolute z-50 mt-1 w-full rounded-xl border shadow-lg max-h-44 overflow-y-auto ${isDark ? 'bg-[var(--bg-card)] border-[var(--border-color)]' : 'bg-white border-[#e2e8f0]'}`}>
                    {filteredSchools.map(s => (
                      <button key={s.school_id} type="button" onMouseDown={() => handleSelectSchool(s)}
                        className="w-full text-left px-3 py-2 hover:bg-[var(--bg-hover)] transition-colors">
                        <p className={`text-sm font-medium ${tk.t1}`}>{s.school_name}</p>
                        {(s.city || s.board) && <p className={`text-xs ${tk.tm}`}>{[s.city, s.board].filter(Boolean).join(' · ')}</p>}
                      </button>
                    ))}
                    <button type="button"
                      onMouseDown={() => { setCreateSchoolMode(true); setShowSchoolDrop(false); setNewSchool(n => ({ ...n, school_name: schoolQuery })); }}
                      className={`w-full text-left px-3 py-2.5 border-t ${isDark ? 'border-[var(--border-color)]' : 'border-[#f1f5f9]'} flex items-center gap-2 text-[#e94560] hover:bg-[var(--bg-hover)] transition-colors`}>
                      <Plus className="h-3.5 w-3.5" />
                      <span className="text-xs font-semibold">{schoolQuery ? `Create "${schoolQuery}"` : 'Create new school'}</span>
                    </button>
                  </div>
                )}
              </div>
            ) : null}
            {createSchoolMode && (
              <div className={`rounded-xl border p-3 space-y-2 ${isDark ? 'bg-[var(--bg-hover)] border-[var(--border-color)]' : 'bg-[#f8fafc] border-[#e2e8f0]'}`}>
                <p className={`text-xs font-semibold ${tk.t2}`}>New School</p>
                <Input value={newSchool.school_name} onChange={e => setNewSchool(s => ({ ...s, school_name: e.target.value }))}
                  className={`h-9 text-sm rounded-lg ${tk.input}`} placeholder="School name *" autoFocus />
                <div className="grid grid-cols-2 gap-2">
                  <Input value={newSchool.city} onChange={e => setNewSchool(s => ({ ...s, city: e.target.value }))}
                    className={`h-9 text-sm rounded-lg ${tk.input}`} placeholder="City" />
                  <Input value={newSchool.board} onChange={e => setNewSchool(s => ({ ...s, board: e.target.value }))}
                    className={`h-9 text-sm rounded-lg ${tk.input}`} placeholder="CBSE / ICSE…" />
                </div>
                <div className="flex gap-2 justify-end">
                  <Button type="button" size="sm" variant="ghost" onClick={() => setCreateSchoolMode(false)} className={`h-8 text-xs ${tk.tm}`}>Cancel</Button>
                  <Button type="button" size="sm" onClick={handleCreateSchool} disabled={schoolSaving || !newSchool.school_name.trim()}
                    className="h-8 text-xs bg-[#e94560] hover:bg-[#f05c75] text-white px-3 rounded-lg">
                    {schoolSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Create'}
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* ── Contact picker ─────────────────────────────────────────── */}
          <div>
            <Label className={`text-xs ${tk.tm} mb-1.5 block`}>Contact Person</Label>
            {selectedContact && !createContactMode ? (
              <div className={`flex items-center gap-2 rounded-lg px-3 py-2 border ${isDark ? 'bg-[var(--bg-hover)] border-[var(--border-color)]' : 'bg-[#f1f5f9] border-[#e2e8f0]'}`}>
                <UserPlus className="h-3.5 w-3.5 text-blue-500 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium ${tk.t1}`}>{selectedContact.first_name} {selectedContact.last_name}</p>
                  {(selectedContact.phone || selectedContact.designation) && (
                    <p className={`text-xs ${tk.tm}`}>{[selectedContact.designation, selectedContact.phone].filter(Boolean).join(' · ')}</p>
                  )}
                </div>
                <button type="button" onClick={clearContact} className={`${tk.tm} hover:text-red-400 p-0.5`}><X className="h-3.5 w-3.5" /></button>
              </div>
            ) : !createContactMode ? (
              <div className="relative">
                <Search className={`absolute left-2.5 top-2.5 h-3.5 w-3.5 ${tk.tm} pointer-events-none`} />
                <Input
                  value={contactQuery}
                  onChange={e => { setContactQuery(e.target.value); setShowContactDrop(true); }}
                  onFocus={() => setShowContactDrop(true)}
                  onBlur={() => setTimeout(() => setShowContactDrop(false), 150)}
                  className={`${tk.input} h-10 pl-8 text-sm rounded-lg`}
                  placeholder="Search contact name or phone…"
                />
                {showContactDrop && (
                  <div className={`absolute z-50 mt-1 w-full rounded-xl border shadow-lg max-h-44 overflow-y-auto ${isDark ? 'bg-[var(--bg-card)] border-[var(--border-color)]' : 'bg-white border-[#e2e8f0]'}`}>
                    {filteredContacts.map(c => (
                      <button key={c.contact_id} type="button" onMouseDown={() => handleSelectContact(c)}
                        className="w-full text-left px-3 py-2 hover:bg-[var(--bg-hover)] transition-colors">
                        <p className={`text-sm font-medium ${tk.t1}`}>{c.first_name} {c.last_name}</p>
                        <p className={`text-xs ${tk.tm}`}>{[c.company, c.designation, c.phone].filter(Boolean).join(' · ')}</p>
                      </button>
                    ))}
                    {filteredContacts.length === 0 && contactQuery && (
                      <div className={`px-3 py-2 text-xs ${tk.tm}`}>No contact found</div>
                    )}
                    <button type="button"
                      onMouseDown={() => { setCreateContactMode(true); setShowContactDrop(false); }}
                      className={`w-full text-left px-3 py-2.5 border-t ${isDark ? 'border-[var(--border-color)]' : 'border-[#f1f5f9]'} flex items-center gap-2 text-blue-500 hover:bg-[var(--bg-hover)] transition-colors`}>
                      <UserPlus className="h-3.5 w-3.5" />
                      <span className="text-xs font-semibold">Create new contact</span>
                    </button>
                  </div>
                )}
              </div>
            ) : null}
            {createContactMode && (
              <div className={`rounded-xl border p-3 space-y-2 ${isDark ? 'bg-[var(--bg-hover)] border-[var(--border-color)]' : 'bg-[#f8fafc] border-[#e2e8f0]'}`}>
                <p className={`text-xs font-semibold ${tk.t2}`}>
                  New Contact{form.school_name ? ` — ${form.school_name}` : ''}
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <Input value={newContact.first_name} onChange={e => setNewContact(c => ({ ...c, first_name: e.target.value }))}
                    className={`h-9 text-sm rounded-lg ${tk.input}`} placeholder="First name *" autoFocus />
                  <Input value={newContact.last_name} onChange={e => setNewContact(c => ({ ...c, last_name: e.target.value }))}
                    className={`h-9 text-sm rounded-lg ${tk.input}`} placeholder="Last name" />
                </div>
                <Input value={newContact.phone} onChange={e => setNewContact(c => ({ ...c, phone: e.target.value }))}
                  className={`h-9 text-sm rounded-lg ${tk.input}`} placeholder="Phone" />
                <Input value={newContact.designation} onChange={e => setNewContact(c => ({ ...c, designation: e.target.value }))}
                  className={`h-9 text-sm rounded-lg ${tk.input}`} placeholder="Designation (Principal, VP…)" />
                <div className="flex gap-2 justify-end">
                  <Button type="button" size="sm" variant="ghost" onClick={() => setCreateContactMode(false)} className={`h-8 text-xs ${tk.tm}`}>Cancel</Button>
                  <Button type="button" size="sm" onClick={handleCreateContact} disabled={contactSaving || !newContact.first_name.trim()}
                    className="h-8 text-xs bg-blue-600 hover:bg-blue-700 text-white px-3 rounded-lg">
                    {contactSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Create'}
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* ── Lead link (optional) ────────────────────────────────────── */}
          <div>
            <Label className={`text-xs ${tk.tm} mb-1.5 block`}>Link to Lead (optional)</Label>
            <select value={form.lead_id} onChange={e => {
              const lead = leadsList.find(l => l.lead_id === e.target.value);
              if (lead) {
                setForm(f => ({ ...f, lead_id: e.target.value, lead_name: lead.company_name || '', school_name: lead.company_name || '', school_id: lead.school_id || '' }));
                setSchoolQuery(lead.company_name || '');
              } else {
                setForm(f => ({ ...f, lead_id: '' }));
              }
            }} className={`w-full h-10 px-3 rounded-lg text-sm border ${tk.sel}`}>
              <option value="">— no lead —</option>
              {leadsList.map(l => <option key={l.lead_id} value={l.lead_id}>{l.company_name || l.contact_name} ({l.stage})</option>)}
            </select>
          </div>

          {/* ── Location input ──────────────────────────────────────────── */}
          <div>
            <Label className={`text-xs ${tk.tm} mb-1.5 block`}>Location</Label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                {urlLoading
                  ? <Loader2 className={`absolute left-2.5 top-2.5 h-3.5 w-3.5 ${tk.tm} animate-spin`} />
                  : <LinkIcon className={`absolute left-2.5 top-2.5 h-3.5 w-3.5 ${tk.tm}`} />
                }
                <Input
                  value={mapsInput}
                  onChange={e => setMapsInput(e.target.value)}
                  className={`${tk.input} h-10 pl-8 text-sm rounded-lg`}
                  placeholder="Paste Google Maps link, share.google/…, or lat,lng"
                />
              </div>
              <Button type="button" size="sm" variant="outline" onClick={handleGps} disabled={gpsLoading}
                className={`border ${isDark ? 'border-[var(--border-color)]' : 'border-[#e2e8f0]'} ${tk.tm} h-10 px-3 flex-shrink-0 rounded-lg`}
                title="Use current GPS location">
                {gpsLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Navigation className="h-3.5 w-3.5" />}
              </Button>
            </div>

            {form.planned_lat && (
              <div className="mt-2 flex items-start gap-2 rounded-xl bg-emerald-50 border border-emerald-100 px-3 py-2.5">
                <CheckCheck className="h-3.5 w-3.5 text-emerald-600 mt-0.5 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-emerald-700 break-all leading-snug">{form.planned_address}</p>
                  <p className="text-[10px] text-emerald-500 mt-0.5">{form.planned_lat?.toFixed(5)}, {form.planned_lng?.toFixed(5)}</p>
                </div>
                <a href={`https://www.google.com/maps?q=${form.planned_lat},${form.planned_lng}`} target="_blank" rel="noreferrer"
                  className="text-emerald-600 hover:text-emerald-800 flex-shrink-0 mt-0.5" title="Preview on Maps">
                  <Navigation className="h-3.5 w-3.5" />
                </a>
              </div>
            )}

            <Input value={form.planned_address}
              onChange={e => setForm({ ...form, planned_address: e.target.value })}
              className={`${tk.input} h-10 text-sm rounded-lg mt-2`}
              placeholder="Or type address manually" />
          </div>

          {/* ── Date + time ─────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className={`text-xs ${tk.tm} mb-1.5 block`}>Visit Date *</Label>
              <Input type="date" value={form.visit_date} onChange={e => setForm({ ...form, visit_date: e.target.value })}
                className={`h-10 text-sm rounded-lg ${tk.input}`} />
            </div>
            <div>
              <Label className={`text-xs ${tk.tm} mb-1.5 block`}>Time</Label>
              <Input type="time" value={form.visit_time} onChange={e => setForm({ ...form, visit_time: e.target.value })}
                className={`h-10 text-sm rounded-lg ${tk.input}`} />
            </div>
          </div>

          {/* ── Assign to ───────────────────────────────────────────────── */}
          <div>
            <Label className={`text-xs ${tk.tm} mb-1.5 block`}>Assign To</Label>
            <select value={form.assigned_to} onChange={e => {
              const sp = spList.find(s => s.email === e.target.value);
              setForm({ ...form, assigned_to: e.target.value, assigned_name: sp?.name || '' });
            }} className={`w-full h-10 px-3 rounded-lg text-sm border ${tk.sel}`}>
              <option value="">Select team member</option>
              {spList.map(sp => <option key={sp.email} value={sp.email}>{sp.name}</option>)}
            </select>
          </div>

          {/* ── Purpose ─────────────────────────────────────────────────── */}
          <div>
            <Label className={`text-xs ${tk.tm} mb-1.5 block`}>Purpose</Label>
            <Input value={form.purpose} onChange={e => setForm({ ...form, purpose: e.target.value })}
              className={`h-10 text-sm rounded-lg ${tk.input}`} placeholder="Demo, Follow-up, Delivery…" />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => setDialogOpen(false)} className={tk.tm}>Cancel</Button>
          <Button onClick={handleSave} className="bg-[#e94560] hover:bg-[#f05c75] text-white rounded-lg px-5">
            Plan Visit
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

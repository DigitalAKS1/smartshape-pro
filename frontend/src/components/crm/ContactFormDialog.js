import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { useTheme } from '../../contexts/ThemeContext';
import { useAuth } from '../../contexts/AuthContext';
import { toast } from 'sonner';
import { SCHOOL_TYPES } from '../../lib/crmConstants';
import {
  Upload, Download, FileText, CheckCircle, Building2,
  ExternalLink, AlertTriangle, ArrowRightCircle, X,
} from 'lucide-react';

export default function ContactFormDialog({
  // Contact create/edit dialog
  contactDialogOpen, setContactDialogOpen,
  editContact,
  contactForm, setContactForm,
  schoolsList, rolesList, sourcesList, spList, tagsList, designationsList,
  contactsList = [],
  saveContact,
  // Convert to lead dialog
  convertDialogOpen, setConvertDialogOpen,
  convertContact,
  convertForm, setConvertForm,
  convertAddNewSchool, setConvertAddNewSchool,
  convertNewSchool, setConvertNewSchool,
  handleConvert,
  // Contact import dialog
  contactImportOpen, setContactImportOpen,
  contactFileRef,
  importFile, setImportFile,
  importTags, setImportTags,
  importNotes, setImportNotes,
  importing,
  importResult,
  handleContactImport,
  resetImportDialog,
  downloadSampleCsv,
}) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { isDark } = useTheme();

  const inputCls = 'bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]';
  const textPri = 'text-[var(--text-primary)]';
  const textSec = 'text-[var(--text-secondary)]';
  const textMuted = 'text-[var(--text-muted)]';
  const dlgCls = isDark ? 'bg-[var(--bg-card)] border-[var(--border-color)] text-[var(--text-primary)]' : 'bg-white border-[var(--border-color)] text-[var(--text-primary)]';

  // Live duplicate detection (new contacts only) — matches on last-10-digit phone
  const normPhone = (p) => (p || '').replace(/\D/g, '').slice(-10);
  const typedPhone = normPhone(contactForm.phone);
  const dupContact = !editContact && typedPhone.length >= 10
    ? contactsList.find(c => normPhone(c.phone) === typedPhone)
    : null;

  const handleSaveContact = () => {
    if (!contactForm.name || !contactForm.name.trim()) { toast.error('Name is required'); return; }
    if (!contactForm.phone || !contactForm.phone.trim()) { toast.error('Phone is required'); return; }
    if (!/^[0-9+\-\s]{7,15}$/.test(contactForm.phone)) { toast.error('Phone looks invalid'); return; }
    if (contactForm.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactForm.email)) { toast.error('Email looks invalid'); return; }
    saveContact();
  };

  return (
    <>
      {/* CONTACT DIALOG */}
      <Dialog open={contactDialogOpen} onOpenChange={setContactDialogOpen}>
        <DialogContent className={`${dlgCls} w-[calc(100vw-1rem)] sm:max-w-md max-h-[90dvh] overflow-y-auto`}>
          <DialogHeader><DialogTitle className={textPri}>{editContact ? 'Edit Contact' : 'Add Contact'}</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div><Label className={`${textSec} text-xs`}>Name *</Label><Input value={contactForm.name} onChange={e => setContactForm({...contactForm, name: e.target.value})} className={inputCls} placeholder="Full name" data-testid="contact-name-input" /></div>
              <div><Label className={`${textSec} text-xs`}>Phone *</Label><Input value={contactForm.phone} onChange={e => setContactForm({...contactForm, phone: e.target.value})} className={inputCls} placeholder="+91..." data-testid="contact-phone-input" /></div>
            </div>
            <div><Label className={`${textSec} text-xs`}>Email</Label><Input value={contactForm.email} onChange={e => setContactForm({...contactForm, email: e.target.value})} className={inputCls} placeholder="email@example.com" data-testid="contact-email-input" /></div>

            {dupContact && (
              <div className="flex items-start gap-2 text-xs px-3 py-2 rounded-md bg-amber-500/10 border border-amber-500/30 text-amber-500" data-testid="contact-dup-warning">
                <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
                <span>
                  A contact with this phone already exists: <strong>{dupContact.name}</strong>
                  {dupContact.company ? ` (${dupContact.company})` : ''}. Saving will create a duplicate.
                </span>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label className={`${textSec} text-xs`}>School</Label>
                <select
                  value={contactForm.school_id || (contactForm.company ? '__new__' : '')}
                  onChange={e => {
                    const sid = e.target.value;
                    if (!sid) {
                      setContactForm({...contactForm, school_id: '', company: ''});
                    } else if (sid === '__new__') {
                      setContactForm({...contactForm, school_id: '', company: contactForm.company});
                    } else {
                      const sch = schoolsList.find(s => s.school_id === sid);
                      setContactForm({...contactForm, school_id: sid, company: sch?.school_name || ''});
                    }
                  }}
                  className={`w-full h-10 px-3 rounded-md text-sm ${inputCls}`}>
                  <option value="">— Select school —</option>
                  {schoolsList.map(s => <option key={s.school_id} value={s.school_id}>{s.school_name}</option>)}
                  <option value="__new__">➕ New school (type name below)</option>
                </select>
                {!contactForm.school_id && (
                  <Input value={contactForm.company} onChange={e => setContactForm({...contactForm, company: e.target.value})} className={`${inputCls} mt-1.5`} placeholder="Type new school name..." />
                )}
                {contactForm.school_id
                  ? <div className="flex items-center justify-between mt-0.5">
                      <p className="text-[10px] text-green-500 flex items-center gap-1"><CheckCircle className="h-3 w-3" /> Linked to school database</p>
                      <button type="button" onClick={() => { setContactDialogOpen(false); navigate(`/school-profile/${contactForm.school_id}`); }}
                        className="text-[10px] text-[#e94560] hover:underline flex items-center gap-0.5">
                        View profile <ExternalLink className="h-2.5 w-2.5" />
                      </button>
                    </div>
                  : contactForm.company
                    ? <p className="text-[10px] text-amber-500 mt-0.5 flex items-center gap-1"><Building2 className="h-3 w-3" /> Will be registered as new school</p>
                    : null}
              </div>
              <div>
                <Label className={`${textSec} text-xs`}>Contact Role</Label>
                <select value={contactForm.contact_role_id || ''} onChange={e => setContactForm({...contactForm, contact_role_id: e.target.value})} className={`w-full h-10 px-3 rounded-md text-sm ${inputCls}`} data-testid="contact-role-select">
                  <option value="">{rolesList.length ? 'Select role' : 'Loading...'}</option>
                  {rolesList.map(r => <option key={r.role_id} value={r.role_id}>{r.name}</option>)}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label className={`${textSec} text-xs`}>Job Designation</Label>
                <select value={contactForm.designation || ''} onChange={e => setContactForm({...contactForm, designation: e.target.value})} className={`w-full h-10 px-3 rounded-md text-sm ${inputCls}`} data-testid="contact-designation-select">
                  <option value="">{designationsList.length ? 'Select designation' : 'Loading...'}</option>
                  {designationsList.filter(d => d.is_active !== false).map(d => <option key={d.designation_id} value={d.name}>{d.name}{d.department ? ` (${d.department})` : ''}</option>)}
                </select>
              </div>
              <div>
                <Label className={`${textSec} text-xs`}>Source</Label>
                <select value={contactForm.source_id || ''} onChange={e => { const src = sourcesList.find(s => s.source_id === e.target.value); setContactForm({...contactForm, source_id: e.target.value, source: src?.name || ''}); }} className={`w-full h-10 px-3 rounded-md text-sm ${inputCls}`} data-testid="contact-source-select">
                  <option value="">{sourcesList.length ? 'Select source' : 'Loading...'}</option>
                  {sourcesList.map(s => <option key={s.source_id} value={s.source_id}>{s.name}</option>)}
                </select>
              </div>
              <div>
                <Label className={`${textSec} text-xs`}>Assigned To</Label>
                <select value={contactForm.assigned_to || ''} onChange={e => setContactForm({...contactForm, assigned_to: e.target.value})} className={`w-full h-10 px-3 rounded-md text-sm ${inputCls}`}>
                  <option value="">Unassigned</option>
                  {spList.map(sp => <option key={sp.email} value={sp.email}>{sp.name}</option>)}
                </select>
              </div>
            </div>

            <div><Label className={`${textSec} text-xs`}>Notes</Label><Input value={contactForm.notes} onChange={e => setContactForm({...contactForm, notes: e.target.value})} className={inputCls} placeholder="Any additional info..." /></div>
            <div><Label className={`${textSec} text-xs`}>Birthday (YYYY-MM-DD)</Label><Input type="date" value={contactForm.birthday} onChange={e => setContactForm({...contactForm, birthday: e.target.value})} className={inputCls} /></div>

            {tagsList.length > 0 && (
              <div>
                <Label className={`${textSec} text-xs`}>Tags</Label>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {tagsList.map(t => {
                    const sel = (contactForm.tag_ids || []).includes(t.tag_id);
                    return (
                      <button key={t.tag_id} type="button"
                        onClick={() => setContactForm(prev => ({
                          ...prev,
                          tag_ids: sel ? (prev.tag_ids || []).filter(id => id !== t.tag_id) : [...(prev.tag_ids || []), t.tag_id],
                        }))}
                        className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs border transition-all ${sel ? 'text-white border-transparent' : `${textMuted} border-[var(--border-color)]`}`}
                        style={sel ? { backgroundColor: t.color } : {}}>
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: t.color }} />
                        {t.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setContactDialogOpen(false)} className="border-[var(--border-color)] text-[var(--text-secondary)]">Cancel</Button>
            <Button onClick={handleSaveContact} className="bg-[#e94560] hover:bg-[#f05c75] text-white" data-testid="save-contact-button">{editContact ? 'Update' : 'Add Contact'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* CONVERT TO LEAD DIALOG */}
      <Dialog open={convertDialogOpen} onOpenChange={setConvertDialogOpen}>
        <DialogContent className={`${dlgCls} w-[calc(100vw-1rem)] sm:max-w-md`}>
          <DialogHeader><DialogTitle className={textPri}>Convert to Lead</DialogTitle></DialogHeader>
          {convertContact && (
            <div className="space-y-4 py-2">
              <div className="bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-md p-3">
                <p className={`${textPri} font-medium`}>{convertContact.name}</p>
                <p className={`text-sm ${textMuted}`}>{convertContact.phone}{convertContact.email ? ` • ${convertContact.email}` : ''}</p>
                {convertContact.company && <p className={`text-xs ${textMuted} mt-1`}>{convertContact.company}{convertContact.designation ? ` • ${convertContact.designation}` : ''}</p>}
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <Label className={`${textSec} text-xs`}>Link to School</Label>
                  <button onClick={() => { setConvertAddNewSchool(!convertAddNewSchool); setConvertForm({...convertForm, school_id: ''}); }} className="text-xs text-[#e94560] hover:underline">
                    {convertAddNewSchool ? '← Select Existing' : '+ Create New School'}
                  </button>
                </div>
                {convertAddNewSchool ? (
                  <div className="bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-md p-3 space-y-2">
                    <Input value={convertNewSchool.school_name} onChange={e => setConvertNewSchool({...convertNewSchool, school_name: e.target.value})} placeholder="School name *" className={`${inputCls} text-sm`} data-testid="convert-new-school-name" />
                    <div className="grid grid-cols-2 gap-2">
                      <select value={convertNewSchool.school_type} onChange={e => setConvertNewSchool({...convertNewSchool, school_type: e.target.value})} className={`h-9 px-2 rounded text-sm ${inputCls}`}>
                        {SCHOOL_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                      <Input value={convertNewSchool.city} onChange={e => setConvertNewSchool({...convertNewSchool, city: e.target.value})} placeholder="City" className={`${inputCls} text-sm`} />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <Input value={convertNewSchool.phone} onChange={e => setConvertNewSchool({...convertNewSchool, phone: e.target.value})} placeholder="Phone" className={`${inputCls} text-sm`} />
                      <Input type="number" value={convertNewSchool.school_strength} onChange={e => setConvertNewSchool({...convertNewSchool, school_strength: parseInt(e.target.value) || 0})} placeholder="Strength" className={`${inputCls} text-sm`} />
                    </div>
                  </div>
                ) : (
                  <select value={convertForm.school_id} onChange={e => setConvertForm({...convertForm, school_id: e.target.value})} className={`w-full h-10 px-3 rounded-md text-sm ${inputCls}`} data-testid="convert-school-select">
                    <option value="">-- No school (create later) --</option>
                    {schoolsList.map(s => <option key={s.school_id} value={s.school_id}>{s.school_name} ({s.city || s.school_type})</option>)}
                  </select>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label className={`${textSec} text-xs`}>Lead Type</Label>
                  <select value={convertForm.lead_type} onChange={e => setConvertForm({...convertForm, lead_type: e.target.value})} className={`w-full h-10 px-3 rounded-md text-sm ${inputCls}`} data-testid="convert-lead-type">
                    <option value="hot">Hot</option><option value="warm">Warm</option><option value="cold">Cold</option>
                  </select>
                </div>
                <div>
                  <Label className={`${textSec} text-xs`}>Priority</Label>
                  <select value={convertForm.priority} onChange={e => setConvertForm({...convertForm, priority: e.target.value})} className={`w-full h-10 px-3 rounded-md text-sm ${inputCls}`}>
                    <option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
                  </select>
                </div>
              </div>

              <div><Label className={`${textSec} text-xs`}>Interested Product</Label><Input value={convertForm.interested_product} onChange={e => setConvertForm({...convertForm, interested_product: e.target.value})} className={inputCls} placeholder="e.g. Premium Package" /></div>

              <div>
                <Label className={`${textSec} text-xs`}>Assign To</Label>
                <select value={convertForm.assigned_to} onChange={e => setConvertForm({...convertForm, assigned_to: e.target.value})} className={`w-full h-10 px-3 rounded-md text-sm ${inputCls}`} data-testid="convert-assign-to">
                  <option value={user?.email}>{user?.name} (Me)</option>
                  {spList.filter(s => s.email !== user?.email).map(sp => <option key={sp.email} value={sp.email}>{sp.name}</option>)}
                </select>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConvertDialogOpen(false)} className="border-[var(--border-color)] text-[var(--text-secondary)]">Cancel</Button>
            <Button onClick={handleConvert} className="bg-[#e94560] hover:bg-[#f05c75] text-white" data-testid="confirm-convert-button">
              <ArrowRightCircle className="mr-1.5 h-4 w-4" /> Convert to Lead
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* CONTACT IMPORT DIALOG */}
      <Dialog open={contactImportOpen} onOpenChange={(open) => { if (!open) resetImportDialog(); setContactImportOpen(open); }}>
        <DialogContent className={`${dlgCls} w-[calc(100vw-1rem)] sm:max-w-lg`}>
          <DialogHeader>
            <DialogTitle className={textPri}>Import Contacts from CSV</DialogTitle>
          </DialogHeader>

          {importResult ? (
            /* Result view */
            <div className="py-4 space-y-4">
              <div className="text-center space-y-2">
                <div className="w-14 h-14 rounded-full bg-green-500/15 flex items-center justify-center mx-auto">
                  <CheckCircle className="h-7 w-7 text-green-500" />
                </div>
                <p className={`text-base font-semibold ${textPri}`}>Import Complete</p>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-green-500">{importResult.created}</p>
                  <p className={`text-xs ${textMuted} mt-0.5`}>Created</p>
                </div>
                <div className="bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-yellow-500">{importResult.duplicates}</p>
                  <p className={`text-xs ${textMuted} mt-0.5`}>Skipped</p>
                </div>
                <div className="bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg p-3 text-center">
                  <p className={`text-2xl font-bold ${importResult.errors?.length ? 'text-red-500' : textMuted}`}>{importResult.errors?.length || 0}</p>
                  <p className={`text-xs ${textMuted} mt-0.5`}>Errors</p>
                </div>
              </div>
              {importResult.errors?.length > 0 && (
                <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 space-y-1">
                  <p className="text-xs font-semibold text-red-400">Row errors:</p>
                  {importResult.errors.slice(0, 5).map((e, i) => (
                    <p key={i} className="text-xs text-red-400">• {e}</p>
                  ))}
                </div>
              )}
              <Button onClick={() => { setContactImportOpen(false); resetImportDialog(); }} className="w-full bg-[#e94560] hover:bg-[#f05c75] text-white">Done</Button>
            </div>
          ) : (
            /* Upload form */
            <div className="space-y-4 py-2">
              <div className="bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg p-3 flex items-start justify-between gap-3">
                <div>
                  <p className={`text-xs font-semibold ${textSec} mb-1`}>CSV columns</p>
                  <p className={`text-xs font-mono ${textMuted} leading-relaxed`}>name · phone · email · school<br />designation · source · notes</p>
                </div>
                <button onClick={downloadSampleCsv}
                  className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-[var(--border-color)] ${textSec} hover:bg-[var(--bg-hover)] whitespace-nowrap flex-shrink-0 transition-colors`}>
                  <Download className="h-3 w-3" /> Sample CSV
                </button>
              </div>

              <div
                className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-all ${importFile ? 'border-[var(--accent)] bg-[var(--accent-bg)]' : 'border-[var(--border-color)] hover:border-[var(--accent)]/50 hover:bg-[var(--bg-hover)]'}`}
                onClick={() => !importFile && contactFileRef.current?.click()}
                onDragOver={e => e.preventDefault()}
                onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f?.name.endsWith('.csv')) setImportFile(f); }}>
                {importFile ? (
                  <div className="flex items-center justify-center gap-3">
                    <FileText className="h-5 w-5 text-[var(--accent)] flex-shrink-0" />
                    <div className="text-left">
                      <p className={`text-sm font-medium ${textPri}`}>{importFile.name}</p>
                      <p className={`text-xs ${textMuted}`}>{(importFile.size / 1024).toFixed(1)} KB</p>
                    </div>
                    <button onClick={e => { e.stopPropagation(); setImportFile(null); contactFileRef.current.value = ''; }} className={`ml-1 ${textMuted} hover:text-red-500 transition-colors`}>
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <>
                    <Upload className={`h-7 w-7 mx-auto mb-2 ${textMuted}`} />
                    <p className={`text-sm font-medium ${textSec}`}>Drag & drop or click to browse</p>
                    <p className={`text-xs ${textMuted} mt-0.5`}>.CSV files only</p>
                  </>
                )}
                <input ref={contactFileRef} type="file" accept=".csv" className="hidden" data-testid="contact-import-file-input"
                  onChange={e => { if (e.target.files?.[0]) setImportFile(e.target.files[0]); }} />
              </div>

              {/* Tag selector */}
              <div>
                <p className={`text-xs font-semibold ${textSec} mb-2`}>
                  Apply Tags to All Imported Contacts <span className={`font-normal ${textMuted}`}>(optional)</span>
                </p>
                {tagsList.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {tagsList.map(tag => {
                      const sel = importTags.includes(tag.tag_id);
                      return (
                        <button key={tag.tag_id}
                          onClick={() => setImportTags(prev => sel ? prev.filter(id => id !== tag.tag_id) : [...prev, tag.tag_id])}
                          className={`text-xs px-2.5 py-1 rounded-full border transition-all ${sel ? 'border-transparent text-white' : `border-[var(--border-color)] ${textSec} hover:border-[var(--accent)]/50`}`}
                          style={sel ? { backgroundColor: tag.color || '#e94560' } : {}}>
                          {sel ? '✓ ' : ''}{tag.name}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <p className={`text-xs ${textMuted}`}>No tags defined — create tags in CRM Masters first.</p>
                )}
              </div>

              {/* Global notes */}
              <div>
                <p className={`text-xs font-semibold ${textSec} mb-1.5`}>
                  Additional Notes <span className={`font-normal ${textMuted}`}>(appended to all contacts)</span>
                </p>
                <textarea value={importNotes} onChange={e => setImportNotes(e.target.value)}
                  placeholder="e.g. Imported from Education Expo 2024 — Delhi"
                  rows={2}
                  className={`w-full px-3 py-2 rounded-md text-sm resize-none border ${inputCls}`} />
              </div>

              <p className={`text-xs ${textMuted} flex items-center gap-1.5`}>
                <AlertTriangle className="h-3 w-3 flex-shrink-0" />
                Rows with the same name + phone as existing contacts will be skipped.
              </p>
            </div>
          )}

          {!importResult && (
            <DialogFooter>
              <Button variant="outline" onClick={() => { setContactImportOpen(false); resetImportDialog(); }} className={`border-[var(--border-color)] ${textSec}`}>Cancel</Button>
              <Button disabled={!importFile || importing} onClick={handleContactImport} className="bg-[#e94560] hover:bg-[#f05c75] text-white">
                {importing ? 'Importing…' : <><Upload className="mr-1.5 h-3.5 w-3.5" />Import Contacts</>}
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

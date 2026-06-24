import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { useTheme } from '../../contexts/ThemeContext';
import useSchoolTypes from '../../hooks/useSchoolTypes';
import { tags as tagsApi } from '../../lib/api';
import InterestedProductField from './InterestedProductField';
import AddressFields from './AddressFields';

export default function LeadFormDialog({
  open, onOpenChange,
  editLead,
  leadForm, setLeadForm,
  addNewSchool, setAddNewSchool,
  newSchool, setNewSchool,
  newTagInput, setNewTagInput,
  schoolsList, spList, rolesList, sourcesList, tagsList, setTagsList, contactsList,
  saveLead,
}) {
  const { isDark } = useTheme();
  const schoolTypeOptions = useSchoolTypes();
  const inputCls = 'bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]';
  const textPri = 'text-[var(--text-primary)]';
  const textSec = 'text-[var(--text-secondary)]';
  const textMuted = 'text-[var(--text-muted)]';
  const dlgCls = isDark ? 'bg-[var(--bg-card)] border-[var(--border-color)] text-[var(--text-primary)]' : 'bg-white border-[var(--border-color)] text-[var(--text-primary)]';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={`${dlgCls} w-[calc(100vw-1rem)] sm:max-w-lg max-h-[88dvh] overflow-y-auto`}>
        <DialogHeader><DialogTitle className={textPri}>{editLead ? 'Edit Lead' : 'New Lead'}</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          {/* School selection — only for new leads */}
          {!editLead && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <Label className={`${textSec} text-xs`}>School *</Label>
                <button onClick={() => setAddNewSchool(!addNewSchool)} className="text-xs text-[#e94560]">
                  {addNewSchool ? 'Select Existing' : '+ Add New School'}
                </button>
              </div>
              {addNewSchool ? (
                <div className="bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-md p-3 space-y-2">
                  <Input value={newSchool.school_name} onChange={e => setNewSchool({...newSchool, school_name: e.target.value})} placeholder="School name *" className={`${inputCls} text-sm`} />
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <select value={newSchool.school_type} onChange={e => setNewSchool({...newSchool, school_type: e.target.value})} className={`h-9 px-2 rounded text-sm ${inputCls}`}>
                      {schoolTypeOptions.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                    <Input value={newSchool.phone} onChange={e => setNewSchool({...newSchool, phone: e.target.value})} placeholder="Phone" className={`${inputCls} text-sm`} />
                  </div>
                  <AddressFields
                    pincode={newSchool.pincode} city={newSchool.city} state={newSchool.state}
                    onChange={({ pincode, city, state }) => setNewSchool({ ...newSchool, pincode, city, state })}
                    inputCls={`${inputCls} text-sm`}
                  />
                  <Input type="number" value={newSchool.school_strength} onChange={e => setNewSchool({...newSchool, school_strength: parseInt(e.target.value) || 0})} placeholder="Strength (students)" className={`${inputCls} text-sm`} />
                </div>
              ) : (
                <select value={leadForm.school_id} onChange={e => setLeadForm({...leadForm, school_id: e.target.value, contact_id: '', contact_name: '', contact_phone: '', contact_email: '', contact_role_id: '', designation: ''})} className={`w-full h-10 px-3 rounded-md text-sm ${inputCls}`} data-testid="school-select">
                  <option value="">Select school</option>
                  {schoolsList.map(s => <option key={s.school_id} value={s.school_id}>{s.school_name} ({s.city})</option>)}
                </select>
              )}
            </div>
          )}

          {/* Contact — pick a person already under this school, or add a new one */}
          {!editLead && leadForm.school_id && !addNewSchool && (
            <div>
              <Label className={`${textSec} text-xs`}>Contact</Label>
              <select
                value={leadForm.contact_id || ''}
                onChange={e => {
                  const cid = e.target.value;
                  const c = (contactsList || []).find(x => x.contact_id === cid);
                  setLeadForm({
                    ...leadForm,
                    contact_id: cid,
                    contact_name: cid ? (c?.name || '') : '',
                    contact_phone: cid ? (c?.phone || '') : '',
                    contact_email: cid ? (c?.email || '') : '',
                    contact_role_id: cid ? (c?.contact_role_id || '') : '',
                    designation: cid ? (c?.designation || '') : '',
                  });
                }}
                className={`w-full h-10 px-3 rounded-md text-sm ${inputCls}`}
                data-testid="lead-contact-picker"
              >
                <option value="">+ Add New Contact</option>
                {(contactsList || []).filter(c => c.school_id === leadForm.school_id).map(c => (
                  <option key={c.contact_id} value={c.contact_id}>
                    {c.name}{c.designation ? ` — ${c.designation}` : ''}{c.phone ? ` (${c.phone})` : ''}
                  </option>
                ))}
              </select>
              {leadForm.contact_id && (
                <p className={`${textMuted} text-[10px] mt-0.5`}>Using an existing contact — fields below are read-only. Choose “+ Add New Contact” to enter a new person.</p>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label className={`${textSec} text-xs`}>Contact Name *</Label>
              <Input value={leadForm.contact_name} onChange={e => setLeadForm({...leadForm, contact_name: e.target.value})} disabled={!editLead && !!leadForm.contact_id} className={`${inputCls} ${!editLead && leadForm.contact_id ? 'opacity-60' : ''}`} data-testid="lead-contact-input" />
            </div>
            <div>
              <Label className={`${textSec} text-xs`}>Role / Designation</Label>
              <select value={leadForm.contact_role_id || ''} disabled={!editLead && !!leadForm.contact_id} onChange={e => { const role = rolesList.find(r => r.role_id === e.target.value); setLeadForm({...leadForm, contact_role_id: e.target.value, designation: role?.name || leadForm.designation}); }} className={`w-full h-10 px-3 rounded-md text-sm ${inputCls} ${!editLead && leadForm.contact_id ? 'opacity-60' : ''}`} data-testid="lead-role-select">
                <option value="">{rolesList.length ? 'Select role' : 'Loading roles...'}</option>
                {rolesList.map(r => <option key={r.role_id} value={r.role_id}>{r.name}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><Label className={`${textSec} text-xs`}>Phone *</Label><Input value={leadForm.contact_phone} onChange={e => setLeadForm({...leadForm, contact_phone: e.target.value})} disabled={!editLead && !!leadForm.contact_id} className={`${inputCls} ${!editLead && leadForm.contact_id ? 'opacity-60' : ''}`} data-testid="lead-phone-input" /></div>
            <div><Label className={`${textSec} text-xs`}>Email</Label><Input value={leadForm.contact_email} onChange={e => setLeadForm({...leadForm, contact_email: e.target.value})} disabled={!editLead && !!leadForm.contact_id} className={`${inputCls} ${!editLead && leadForm.contact_id ? 'opacity-60' : ''}`} /></div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div>
              <Label className={`${textSec} text-xs`}>Source</Label>
              <select value={leadForm.source_id || ''} onChange={e => { const src = sourcesList.find(s => s.source_id === e.target.value); setLeadForm({...leadForm, source_id: e.target.value, source: src?.name || ''}); }} className={`w-full h-10 px-3 rounded-md text-sm ${inputCls}`} data-testid="lead-source-select">
                <option value="">{sourcesList.length ? 'Select source' : 'Loading sources...'}</option>
                {sourcesList.map(s => <option key={s.source_id} value={s.source_id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <Label className={`${textSec} text-xs`}>Type</Label>
              <select value={leadForm.lead_type} onChange={e => setLeadForm({...leadForm, lead_type: e.target.value})} className={`w-full h-10 px-3 rounded-md text-sm ${inputCls}`}>
                <option value="hot">Hot</option><option value="warm">Warm</option><option value="cold">Cold</option>
              </select>
            </div>
            <div>
              <Label className={`${textSec} text-xs`}>Priority</Label>
              <select value={leadForm.priority} onChange={e => setLeadForm({...leadForm, priority: e.target.value})} className={`w-full h-10 px-3 rounded-md text-sm ${inputCls}`}>
                <option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
              </select>
            </div>
          </div>

          <InterestedProductField value={leadForm.interested_product} onChange={v => setLeadForm({...leadForm, interested_product: v})} />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label className={`${textSec} text-xs`}>Assign To *</Label>
              <select value={leadForm.assigned_to} onChange={e => setLeadForm({...leadForm, assigned_to: e.target.value})} className={`w-full h-10 px-3 rounded-md text-sm ${inputCls}`}>
                <option value="">Select</option>{spList.map(sp => <option key={sp.email} value={sp.email}>{sp.name}</option>)}
              </select>
            </div>
            <div><Label className={`${textSec} text-xs`}>Next Follow-up</Label><Input type="date" value={leadForm.next_followup_date} onChange={e => setLeadForm({...leadForm, next_followup_date: e.target.value})} className={inputCls} /></div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label className={`${textSec} text-xs`}>Assignment Type</Label>
              <select value={leadForm.assignment_type || 'manual'} onChange={e => setLeadForm({...leadForm, assignment_type: e.target.value})} className={`w-full h-10 px-3 rounded-md text-sm ${inputCls}`} data-testid="lead-assignment-type-select">
                <option value="manual">Manual</option>
                <option value="self">Self</option>
                <option value="round_robin">Round Robin</option>
                <option value="auto">Auto</option>
              </select>
            </div>
            <div><Label className={`${textSec} text-xs`}>Likely Closure Date</Label><Input type="date" value={leadForm.likely_closure_date || ''} onChange={e => setLeadForm({...leadForm, likely_closure_date: e.target.value})} className={inputCls} data-testid="lead-likely-closure-input" /></div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label className={`${textSec} text-xs`}>Expected Value (₹)</Label>
              <Input type="number" min="0" value={leadForm.expected_value ?? ''} onChange={e => setLeadForm({...leadForm, expected_value: e.target.value})} placeholder="Estimated deal size" className={inputCls} data-testid="lead-expected-value-input" />
              <p className={`${textMuted} text-[10px] mt-0.5`}>Auto-overridden by a linked quotation total.</p>
            </div>
            <div><Label className={`${textSec} text-xs`}>Notes</Label><Input value={leadForm.notes} onChange={e => setLeadForm({...leadForm, notes: e.target.value})} className={inputCls} /></div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label className={`${textSec} text-xs`}>Referred By (Contact)</Label>
              <select value={leadForm.referred_by_contact_id || ''} onChange={e => setLeadForm({...leadForm, referred_by_contact_id: e.target.value})} className={`w-full h-10 px-3 rounded-md text-sm ${inputCls}`}>
                <option value="">None</option>
                {contactsList.map(c => <option key={c.contact_id} value={c.contact_id}>{c.name}{c.company ? ` (${c.company})` : ''}</option>)}
              </select>
            </div>
            <div>
              <Label className={`${textSec} text-xs`}>Referral Reward</Label>
              <select value={leadForm.referral_reward_status || 'none'} onChange={e => setLeadForm({...leadForm, referral_reward_status: e.target.value})} className={`w-full h-10 px-3 rounded-md text-sm ${inputCls}`}>
                <option value="none">None</option>
                <option value="pending">Pending</option>
                <option value="given">Given</option>
              </select>
            </div>
          </div>

          {/* Tag Multi-select */}
          <div>
            <Label className={`${textSec} text-xs`}>Tags</Label>
            <div className="flex flex-wrap gap-1.5 mt-1 mb-1">
              {tagsList.map(t => {
                const sel = (leadForm.tags || []).includes(t.tag_id);
                return (
                  <button key={t.tag_id} type="button"
                    onClick={() => setLeadForm({...leadForm, tags: sel ? (leadForm.tags||[]).filter(id => id !== t.tag_id) : [...(leadForm.tags||[]), t.tag_id]})}
                    className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs border transition-all ${sel ? 'text-white border-transparent' : `${textMuted} border-[var(--border-color)]`}`}
                    style={sel ? { backgroundColor: t.color } : {}}>
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: t.color }} />
                    {t.name}
                  </button>
                );
              })}
            </div>
            <div className="flex gap-1 mt-1">
              <input value={newTagInput} onChange={e => setNewTagInput(e.target.value)}
                onKeyDown={async e => {
                  if (e.key === 'Enter' && newTagInput.trim()) {
                    e.preventDefault();
                    const res = await tagsApi.create({ name: newTagInput.trim(), color: '#6366f1' });
                    const newTag = res.data;
                    setTagsList(prev => [...prev, newTag]);
                    setLeadForm(prev => ({...prev, tags: [...(prev.tags||[]), newTag.tag_id]}));
                    setNewTagInput('');
                  }
                }}
                placeholder="Type new tag + Enter" className={`${inputCls} h-7 text-xs px-2 rounded flex-1 border`} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} className="border-[var(--border-color)] text-[var(--text-secondary)]">Cancel</Button>
          <Button onClick={saveLead} className="bg-[#e94560] hover:bg-[#f05c75]" data-testid="save-lead-button">{editLead ? 'Update' : 'Create Lead'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

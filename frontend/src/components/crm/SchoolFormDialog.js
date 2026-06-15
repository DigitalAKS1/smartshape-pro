import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { useTheme } from '../../contexts/ThemeContext';
import { toast } from 'sonner';
import { BUDGET_RANGES } from '../../lib/crmConstants';
import useSchoolTypes from '../../hooks/useSchoolTypes';
import AddressFields from './AddressFields';
import OwnerDeleteButton from '../common/OwnerDeleteButton';

export default function SchoolFormDialog({
  open, onOpenChange,
  editSchool, setEditSchool,
  editSchoolForm, setEditSchoolForm,
  groupsList, designationsList,
  handleSaveSchool,
  onCascadeDeleted,
}) {
  const { isDark } = useTheme();
  const schoolTypeOptions = useSchoolTypes();
  const inputCls = 'bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]';
  const textPri = 'text-[var(--text-primary)]';
  const textSec = 'text-[var(--text-secondary)]';
  const textMuted = 'text-[var(--text-muted)]';
  const dlgCls = isDark ? 'bg-[var(--bg-card)] border-[var(--border-color)] text-[var(--text-primary)]' : 'bg-white border-[var(--border-color)] text-[var(--text-primary)]';

  const f = editSchoolForm;
  const isPhone = (v) => /^[0-9+\-\s]{7,15}$/.test(v);
  // Save with lightweight validation — blocks only on clearly malformed input
  const handleValidatedSave = () => {
    if (!f.school_name || !f.school_name.trim()) { toast.error('School name is required'); return; }
    if (f.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email)) { toast.error('Email looks invalid'); return; }
    if (f.phone && !isPhone(f.phone)) { toast.error('Phone looks invalid'); return; }
    if (f.alternate_contact && !isPhone(f.alternate_contact)) { toast.error('Alternate phone looks invalid'); return; }
    if (f.pincode && !/^[1-9][0-9]{5}$/.test(String(f.pincode))) { toast.error('Pincode must be 6 digits'); return; }
    if (f.website && !/^https?:\/\/.+/.test(f.website)) { toast.error('Website must start with http:// or https://'); return; }
    if (!f.phone && !f.email) { toast.error('Add at least a phone or an email — a school with neither is unreachable'); return; }
    handleSaveSchool();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) setEditSchool(null); }}>
      <DialogContent className={`${dlgCls} w-[calc(100vw-1rem)] sm:max-w-lg max-h-[88dvh] overflow-y-auto`}>
        <DialogHeader><DialogTitle className={textPri}>{editSchool ? 'Edit School' : 'Add School'}</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <Label className={`${textSec} text-xs`}>School Name *</Label>
            <Input value={editSchoolForm.school_name || ''} onChange={e => setEditSchoolForm({...editSchoolForm, school_name: e.target.value})} className={inputCls} data-testid="school-name-input" />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label className={`${textSec} text-xs`}>Group / Trust</Label>
              <select value={editSchoolForm.group_id || ''} onChange={e => setEditSchoolForm({...editSchoolForm, group_id: e.target.value})} className={`w-full h-10 px-3 rounded-md text-sm ${inputCls}`} data-testid="school-group-select">
                <option value="">{groupsList.length ? '-- Select Group --' : 'No groups defined'}</option>
                {groupsList.map(g => <option key={g.group_id} value={g.group_id}>{g.group_name}</option>)}
              </select>
            </div>
            <div>
              <Label className={`${textSec} text-xs`}>Email</Label>
              <Input type="email" value={editSchoolForm.email || ''} onChange={e => setEditSchoolForm({...editSchoolForm, email: e.target.value})} className={inputCls} data-testid="school-email-input" />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label className={`${textSec} text-xs`}>Type</Label>
              <select value={editSchoolForm.school_type || 'CBSE'} onChange={e => setEditSchoolForm({...editSchoolForm, school_type: e.target.value})} className={`w-full h-10 px-3 rounded-md text-sm ${inputCls}`} data-testid="school-type-select">
                {schoolTypeOptions.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <Label className={`${textSec} text-xs`}>Phone</Label>
              <Input value={editSchoolForm.phone || ''} onChange={e => setEditSchoolForm({...editSchoolForm, phone: e.target.value})} placeholder="10-digit number" className={inputCls} />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><Label className={`${textSec} text-xs`}>Alternate Phone</Label><Input value={editSchoolForm.alternate_contact || ''} onChange={e => setEditSchoolForm({...editSchoolForm, alternate_contact: e.target.value})} className={inputCls} data-testid="school-alt-phone-input" /></div>
            <div><Label className={`${textSec} text-xs`}>No. of Branches</Label><Input type="number" min="0" value={editSchoolForm.number_of_branches ?? ''} onChange={e => setEditSchoolForm({...editSchoolForm, number_of_branches: e.target.value === '' ? '' : (parseInt(e.target.value) || 0)})} placeholder="e.g. 1" className={inputCls} /></div>
          </div>

          <AddressFields
            pincode={editSchoolForm.pincode} city={editSchoolForm.city} state={editSchoolForm.state}
            onChange={({ pincode, city, state }) => setEditSchoolForm({ ...editSchoolForm, pincode, city, state })}
            inputCls={inputCls}
          />

          <div>
            <Label className={`${textSec} text-xs`}>Address</Label>
            <Input value={editSchoolForm.address || ''} onChange={e => setEditSchoolForm({...editSchoolForm, address: e.target.value})} placeholder="Street, area, landmark…" className={inputCls} data-testid="school-address-input" />
          </div>

          <div>
            <Label className={`${textSec} text-xs`}>Website</Label>
            <Input value={editSchoolForm.website || ''} onChange={e => setEditSchoolForm({...editSchoolForm, website: e.target.value})} placeholder="https://…" className={inputCls} data-testid="school-website-input" />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><Label className={`${textSec} text-xs`}>Contact Name</Label><Input value={editSchoolForm.primary_contact_name || ''} onChange={e => setEditSchoolForm({...editSchoolForm, primary_contact_name: e.target.value})} className={inputCls} /></div>
            <div>
              <Label className={`${textSec} text-xs`}>Role / Designation</Label>
              <select value={editSchoolForm.designation || ''} onChange={e => setEditSchoolForm({...editSchoolForm, designation: e.target.value})} className={`w-full h-10 px-3 rounded-md text-sm ${inputCls}`} data-testid="school-role-select">
                <option value="">Select</option>
                {(designationsList.length ? designationsList.filter(d => d.is_active !== false) : []).map(d => <option key={d.designation_id} value={d.name}>{d.name}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label className={`${textSec} text-xs`}>Strength (students)</Label>
              <Input type="number" min="0" value={editSchoolForm.school_strength || ''} onChange={e => setEditSchoolForm({...editSchoolForm, school_strength: e.target.value === '' ? '' : (parseInt(e.target.value) || 0)})} placeholder="e.g. 1200" className={inputCls} data-testid="school-strength-input" />
            </div>
            <div>
              <Label className={`${textSec} text-xs`}>Annual Budget</Label>
              <select value={editSchoolForm.annual_budget_range || ''} onChange={e => setEditSchoolForm({...editSchoolForm, annual_budget_range: e.target.value})} className={`w-full h-10 px-3 rounded-md text-sm ${inputCls}`} data-testid="school-budget-select">
                <option value="">Not set</option>
                {BUDGET_RANGES.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label className={`${textSec} text-xs`}>Existing Vendor</Label>
              <Input value={editSchoolForm.existing_vendor || ''} onChange={e => setEditSchoolForm({...editSchoolForm, existing_vendor: e.target.value})} placeholder="Current supplier, if any" className={inputCls} />
            </div>
            <div>
              <Label className={`${textSec} text-xs`}>GSTIN</Label>
              <Input value={editSchoolForm.gstin || ''} onChange={e => setEditSchoolForm({...editSchoolForm, gstin: e.target.value.toUpperCase()})} placeholder="e.g. 27ABCDE1234F1Z5" maxLength={15} className={inputCls} data-testid="school-gstin-input" />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label className={`${textSec} text-xs`}>LinkedIn URL</Label>
              <Input value={editSchoolForm.linkedin_url || ''} onChange={e => setEditSchoolForm({...editSchoolForm, linkedin_url: e.target.value})} placeholder="https://linkedin.com/in/..." className={inputCls} />
            </div>
            <div>
              <Label className={`${textSec} text-xs`}>Instagram ID / URL</Label>
              <Input value={editSchoolForm.instagram_url || ''} onChange={e => setEditSchoolForm({...editSchoolForm, instagram_url: e.target.value})} placeholder="@handle or https://instagram.com/..." className={inputCls} />
            </div>
          </div>
        </div>
        <DialogFooter>
          {editSchool && (
            <OwnerDeleteButton
              kind="school"
              id={editSchool.school_id}
              name={editSchool.school_name}
              label="Delete + all data"
              className="mr-auto"
              onDeleted={() => { onOpenChange(false); setEditSchool(null); onCascadeDeleted?.(); }}
            />
          )}
          <Button variant="outline" onClick={() => { onOpenChange(false); setEditSchool(null); }} className="border-[var(--border-color)] text-[var(--text-secondary)]">Cancel</Button>
          <Button onClick={handleValidatedSave} className="bg-[#e94560] hover:bg-[#f05c75] text-white" data-testid="save-school-button">{editSchool ? 'Update School' : 'Add School'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { useTheme } from '../../contexts/ThemeContext';
import { SCHOOL_TYPES } from '../../lib/crmConstants';

export default function SchoolFormDialog({
  open, onOpenChange,
  editSchool, setEditSchool,
  editSchoolForm, setEditSchoolForm,
  groupsList, designationsList,
  handleSaveSchool,
}) {
  const { isDark } = useTheme();
  const inputCls = 'bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]';
  const textPri = 'text-[var(--text-primary)]';
  const textSec = 'text-[var(--text-secondary)]';
  const dlgCls = isDark ? 'bg-[var(--bg-card)] border-[var(--border-color)] text-[var(--text-primary)]' : 'bg-white border-[var(--border-color)] text-[var(--text-primary)]';

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
              <select value={editSchoolForm.school_type || 'CBSE'} onChange={e => setEditSchoolForm({...editSchoolForm, school_type: e.target.value})} className={`w-full h-10 px-3 rounded-md text-sm ${inputCls}`}>
                {SCHOOL_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <Label className={`${textSec} text-xs`}>Phone</Label>
              <Input value={editSchoolForm.phone || ''} onChange={e => setEditSchoolForm({...editSchoolForm, phone: e.target.value})} className={inputCls} />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><Label className={`${textSec} text-xs`}>City</Label><Input value={editSchoolForm.city || ''} onChange={e => setEditSchoolForm({...editSchoolForm, city: e.target.value})} className={inputCls} /></div>
            <div><Label className={`${textSec} text-xs`}>State</Label><Input value={editSchoolForm.state || ''} onChange={e => setEditSchoolForm({...editSchoolForm, state: e.target.value})} className={inputCls} /></div>
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
            <div><Label className={`${textSec} text-xs`}>Strength</Label><Input type="number" value={editSchoolForm.school_strength || 0} onChange={e => setEditSchoolForm({...editSchoolForm, school_strength: parseInt(e.target.value) || 0})} className={inputCls} /></div>
            <div><Label className={`${textSec} text-xs`}>Existing Vendor</Label><Input value={editSchoolForm.existing_vendor || ''} onChange={e => setEditSchoolForm({...editSchoolForm, existing_vendor: e.target.value})} className={inputCls} /></div>
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
          <Button variant="outline" onClick={() => { onOpenChange(false); setEditSchool(null); }} className="border-[var(--border-color)] text-[var(--text-secondary)]">Cancel</Button>
          <Button onClick={handleSaveSchool} className="bg-[#e94560] hover:bg-[#f05c75] text-white" data-testid="save-school-button">{editSchool ? 'Update School' : 'Add School'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

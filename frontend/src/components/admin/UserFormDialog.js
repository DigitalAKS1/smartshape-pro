import React from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { FieldTooltip } from '../ui/Tooltip';
import { Label } from '../ui/label';
import { Switch } from '../ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Shield, Eye, EyeOff } from 'lucide-react';
import { SALES_ROLES } from '../../lib/salesPermissions';

const LEVELS = [
  { value: 'none', label: 'No Access', short: '—', cls: 'text-[var(--text-muted)]' },
  { value: 'read', label: 'Read Only', short: 'R', cls: 'text-blue-400' },
  { value: 'read_write', label: 'Read + Write', short: 'RW', cls: 'text-yellow-400' },
  { value: 'read_write_delete', label: 'Full Access', short: 'RWD', cls: 'text-green-400' },
];

function PermMatrix({ modules, permissions, onChange, disabled }) {
  const inputCls = 'bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]';

  const setLevel = (modName, level) => {
    const cur = permissions[modName] || { level: 'none', can_download: false };
    const updated = { ...permissions, [modName]: { ...cur, level } };
    if (level === 'none') updated[modName].can_download = false;
    onChange(updated);
  };

  const toggleDownload = (modName) => {
    const cur = permissions[modName] || { level: 'read_write', can_download: false };
    onChange({ ...permissions, [modName]: { ...cur, can_download: !cur.can_download } });
  };

  if (disabled === 'admin') {
    return (
      <div className="flex items-center gap-2 p-3 rounded-md bg-[#e94560]/10 border border-[#e94560]/30">
        <Shield className="h-4 w-4 text-[#e94560]" />
        <p className="text-sm text-[#e94560]">Admin role has full access to all modules</p>
      </div>
    );
  }
  if (disabled === 'accounts') {
    return (
      <div className="flex items-center gap-2 p-3 rounded-md bg-yellow-500/10 border border-yellow-500/30">
        <Shield className="h-4 w-4 text-yellow-400" />
        <p className="text-sm text-yellow-400">Accounts team sees ALL quotations, orders, payments and payroll. No CRM access.</p>
      </div>
    );
  }
  if (disabled === 'store') {
    return (
      <div className="flex items-center gap-2 p-3 rounded-md bg-blue-500/10 border border-blue-500/30">
        <Shield className="h-4 w-4 text-blue-400" />
        <p className="text-sm text-blue-400">Store team sees ALL orders, dispatches and manages all inventory. No CRM access.</p>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-[var(--border-color)] overflow-hidden">
      <div className="grid grid-cols-[1fr_auto_auto] gap-0 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)] bg-[var(--bg-primary)] px-3 py-2 border-b border-[var(--border-color)]">
        <span>Module</span>
        <span className="w-36 text-center">Permission Level</span>
        <span className="w-20 text-center">Download</span>
      </div>
      <div className="divide-y divide-[var(--border-color)]">
        {modules.filter(m => m.is_active).map(mod => {
          const perm = permissions[mod.name] || { level: 'none', can_download: false };
          const level = perm.level || 'none';
          const canDl = perm.can_download || false;
          const levelObj = LEVELS.find(l => l.value === level) || LEVELS[0];
          return (
            <div key={mod.module_id} className={`grid grid-cols-[1fr_auto_auto] items-center gap-0 px-3 py-2.5 hover:bg-[var(--bg-hover)] transition-colors ${level !== 'none' ? '' : 'opacity-60'}`}>
              <div>
                <p className="text-sm font-medium text-[var(--text-primary)]">{mod.display_name}</p>
                <p className="text-[10px] text-[var(--text-muted)]">{mod.category}</p>
              </div>
              <div className="w-36 px-1">
                <select value={level} onChange={e => setLevel(mod.name, e.target.value)}
                  className={`w-full h-8 px-2 rounded text-xs font-medium ${inputCls} ${levelObj.cls}`}>
                  {LEVELS.map(l => (
                    <option key={l.value} value={l.value} className="text-[var(--text-primary)]">{l.label}</option>
                  ))}
                </select>
              </div>
              <div className="w-20 flex justify-center">
                <Switch checked={canDl} onCheckedChange={() => toggleDownload(mod.name)}
                  disabled={level === 'none'} data-testid={`dl-${mod.name}`} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function UserFormDialog({
  open, onOpenChange,
  editUser, form, setForm,
  showPassword, setShowPassword,
  allModules, allDesignations,
  handleDesignationChange,
  handlePermissionsChange,
  handleSave,
}) {
  const textPri  = 'text-[var(--text-primary)]';
  const textSec  = 'text-[var(--text-secondary)]';
  const textMuted = 'text-[var(--text-muted)]';
  const inputCls = 'bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={`bg-[var(--bg-card)] border-[var(--border-color)] ${textPri} w-[calc(100vw-1rem)] sm:max-w-2xl max-h-[88dvh] overflow-y-auto`}>
        <DialogHeader>
          <DialogTitle className={`${textPri} text-lg`}>{editUser ? 'Edit User' : 'Create New User'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* Basic info */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><Label className={`${textSec} text-xs uppercase tracking-wide mb-1.5 block`}>Name *</Label>
              <Input value={form.name} onChange={e => setForm({...form, name: e.target.value})} className={inputCls} placeholder="Full name" /></div>
            <div><Label className={`${textSec} text-xs uppercase tracking-wide mb-1.5 block`}>Email *</Label>
              <Input type="email" value={form.email} onChange={e => setForm({...form, email: e.target.value})} className={inputCls} placeholder="user@company.com" disabled={!!editUser} /></div>
            <div><Label className={`${textSec} text-xs uppercase tracking-wide mb-1.5 block`}>{editUser ? 'New Password (blank = keep)' : 'Password *'}</Label>
              <div className="relative">
                <Input type={showPassword ? 'text' : 'password'} value={form.password} onChange={e => setForm({...form, password: e.target.value})} className={`${inputCls} pr-10`} placeholder="••••••••" />
                <button type="button" onClick={() => setShowPassword(!showPassword)} className={`absolute right-3 top-1/2 -translate-y-1/2 ${textMuted}`}>
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <div><Label className={`${textSec} text-xs uppercase tracking-wide mb-1.5 block`}>Phone</Label>
              <Input value={form.phone} onChange={e => setForm({...form, phone: e.target.value})} className={inputCls} placeholder="+91-9876543210" /></div>
            <div><Label className={`${textSec} text-xs uppercase tracking-wide mb-1.5 block`}>Calling Number<FieldTooltip text="The rep's phone that Bonvoice rings first for click-to-call. Defaults to Phone if blank." /></Label>
              <Input value={form.calling_number} onChange={e => setForm({...form, calling_number: e.target.value})} className={inputCls} placeholder="Defaults to Phone" /></div>
          </div>

          {/* Designation + Role */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><Label className={`${textSec} text-xs uppercase tracking-wide mb-1.5 block`}>Designation</Label>
              <Select value={form.designation || '_none'} onValueChange={handleDesignationChange}>
                <SelectTrigger className={inputCls}><SelectValue placeholder="Select..." /></SelectTrigger>
                <SelectContent className="bg-[var(--bg-card)] border-[var(--border-color)]">
                  <SelectItem value="_none" className={`${textPri} hover:bg-[var(--bg-hover)]`}>-- Custom --</SelectItem>
                  {allDesignations.filter(d => d.is_active).map(d => (
                    <SelectItem key={d.code} value={d.code} className={`${textPri} hover:bg-[var(--bg-hover)]`}>{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div><Label className={`${textSec} text-xs uppercase tracking-wide mb-1.5 block`}>Role Level<FieldTooltip text="Controls what data this user can access." /></Label>
              <Select value={form.role} onValueChange={v => setForm({...form, role: v})}>
                <SelectTrigger className={inputCls}><SelectValue /></SelectTrigger>
                <SelectContent className="bg-[var(--bg-card)] border-[var(--border-color)]">
                  <SelectItem value="admin" className={`${textPri} hover:bg-[var(--bg-hover)]`}>Admin — full access</SelectItem>
                  <SelectItem value="accounts" className={`${textPri} hover:bg-[var(--bg-hover)]`}>Accounts — all quotations & financials</SelectItem>
                  <SelectItem value="store" className={`${textPri} hover:bg-[var(--bg-hover)]`}>Store — all orders & inventory</SelectItem>
                  <SelectItem value="sales_person" className={`${textPri} hover:bg-[var(--bg-hover)]`}>Sales — own data only</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Sales Portal Role */}
          {form.role === 'sales_person' && (
            <div>
              <Label className={`${textSec} text-xs uppercase tracking-wide mb-1.5 block`}>Sales Portal Role</Label>
              <div className="grid grid-cols-3 gap-2">
                {Object.entries(SALES_ROLES).map(([key, def]) => (
                  <button key={key} type="button" onClick={() => setForm({...form, sales_role: key})}
                    className={`p-3 rounded-lg border text-left transition-all ${form.sales_role === key ? `${def.cls} ring-1` : `border-[var(--border-color)] hover:bg-[var(--bg-hover)]`}`}>
                    <p className={`text-sm font-semibold ${form.sales_role === key ? '' : textPri}`}>{def.label}</p>
                    <p className={`text-[10px] mt-0.5 ${textMuted} leading-snug`}>{def.description}</p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Permission Matrix */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <Label className={`${textSec} text-xs uppercase tracking-wide`}>Module Permissions<FieldTooltip text="Controls which sections of the app this user can open." /></Label>
              {form.role !== 'admin' && (
                <div className="flex gap-1">
                  <button onClick={() => {
                    const all = {};
                    allModules.filter(m => m.is_active).forEach(m => { all[m.name] = { level: 'read_write', can_download: false }; });
                    handlePermissionsChange(all);
                  }} className="text-xs text-[#e94560] hover:underline">All R+W</button>
                  <span className={textMuted}>•</span>
                  <button onClick={() => handlePermissionsChange({})} className={`text-xs ${textMuted} hover:underline`}>Clear all</button>
                </div>
              )}
            </div>
            <PermMatrix
              modules={allModules}
              permissions={form.module_permissions}
              onChange={handlePermissionsChange}
              disabled={['admin', 'accounts', 'store'].includes(form.role) ? form.role : null}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} className={`border-[var(--border-color)] ${textSec}`}>Cancel</Button>
          <Button onClick={handleSave} className="bg-[#e94560] hover:bg-[#f05c75] text-white">
            {editUser ? 'Update User' : 'Create User'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

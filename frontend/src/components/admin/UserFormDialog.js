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
import { defaultScopeForRoles } from '../../lib/moduleScope';

const LEVELS = [
  { value: 'none', label: 'No Access', short: '—', cls: 'text-[var(--text-muted)]' },
  { value: 'read', label: 'Read Only', short: 'R', cls: 'text-blue-400' },
  { value: 'read_write', label: 'Read + Write', short: 'RW', cls: 'text-yellow-400' },
  { value: 'read_write_delete', label: 'Full Access', short: 'RWD', cls: 'text-green-400' },
];

const SCOPES = [
  { value: 'own', label: 'Own records' },
  { value: 'all', label: 'All records' },
];

const ROLE_OPTIONS = [
  { value: 'admin',        label: 'Admin',    hint: 'Full access to everything' },
  { value: 'accounts',     label: 'Accounts', hint: 'All quotations & financials' },
  { value: 'store',        label: 'Store',    hint: 'All orders & inventory' },
  { value: 'sales_person', label: 'Sales',    hint: 'Leads, CRM & own quotations' },
];

function PermMatrix({ modules, permissions, onChange, disabled, roles }) {
  const inputCls = 'bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]';

  // What a grant with no explicit `scope` actually resolves to on the server —
  // see lib/moduleScope.js. Hard-coding 'all' here both LIED about a pre-backfill
  // sales rep's access and silently widened it the moment any level was edited.
  const defaultScope = defaultScopeForRoles(roles);

  const setLevel = (modName, level) => {
    const cur = permissions[modName] || { level: 'none', can_download: false };
    const updated = { ...permissions, [modName]: { ...cur, level } };
    if (level === 'none') updated[modName].can_download = false;
    else if (!updated[modName].scope) updated[modName].scope = defaultScope;
    onChange(updated);
  };

  const toggleDownload = (modName) => {
    const cur = permissions[modName] || { level: 'read_write', can_download: false };
    onChange({ ...permissions, [modName]: { ...cur, can_download: !cur.can_download } });
  };

  const setScope = (modName, scope) => {
    const cur = permissions[modName] || { level: 'read', can_download: false };
    onChange({ ...permissions, [modName]: { ...cur, scope } });
  };

  if (disabled === 'admin') {
    return (
      <div className="flex items-center gap-2 p-3 rounded-md bg-[#e94560]/10 border border-[#e94560]/30">
        <Shield className="h-4 w-4 text-[#e94560]" />
        <p className="text-sm text-[#e94560]">Admin role has full access to all modules</p>
      </div>
    );
  }
  return (
    <div className="rounded-md border border-[var(--border-color)] overflow-hidden">
      <div className="grid grid-cols-[1fr_auto_auto_auto] gap-0 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)] bg-[var(--bg-primary)] px-3 py-2 border-b border-[var(--border-color)]">
        <span>Module</span>
        <span className="w-36 text-center">Permission Level</span>
        <span className="w-32 text-center">Data Scope</span>
        <span className="w-20 text-center">Download</span>
      </div>
      <div className="divide-y divide-[var(--border-color)]">
        {modules.filter(m => m.is_active).map(mod => {
          const perm = permissions[mod.name] || { level: 'none', can_download: false };
          const level = perm.level || 'none';
          const canDl = perm.can_download || false;
          const scope = perm.scope || defaultScope;
          const levelObj = LEVELS.find(l => l.value === level) || LEVELS[0];
          return (
            <div key={mod.module_id} className={`grid grid-cols-[1fr_auto_auto_auto] items-center gap-0 px-3 py-2.5 hover:bg-[var(--bg-hover)] transition-colors ${level !== 'none' ? '' : 'opacity-60'}`}>
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
              <div className="w-32 px-1">
                <select value={scope} onChange={e => setScope(mod.name, e.target.value)}
                  disabled={level === 'none'}
                  data-testid={`scope-${mod.name}`}
                  className={`w-full h-8 px-2 rounded text-xs font-medium ${inputCls} ${scope === 'own' ? 'text-orange-400' : 'text-emerald-400'} disabled:opacity-40`}>
                  {SCOPES.map(s => (
                    <option key={s.value} value={s.value} className="text-[var(--text-primary)]">{s.label}</option>
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
  handleRolesChange,
  applyRolePresets,
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
            <div><Label className={`${textSec} text-xs uppercase tracking-wide mb-1.5 block`}>Roles<FieldTooltip text="Tick every job this person does. Roles are presets — the permission matrix below is what actually applies." /></Label>
              <div className="grid grid-cols-2 gap-1.5">
                {ROLE_OPTIONS.map(r => {
                  const checked = (form.roles || []).includes(r.value);
                  const isAdminRole = r.value === 'admin';
                  const adminOn = (form.roles || []).includes('admin');
                  return (
                    <button key={r.value} type="button"
                      onClick={() => handleRolesChange(r.value)}
                      disabled={adminOn && !isAdminRole}
                      data-testid={`role-${r.value}`}
                      className={`px-2.5 py-2 rounded-lg border text-left transition-all disabled:opacity-40 ${checked ? 'border-[#e94560] bg-[#e94560]/10' : 'border-[var(--border-color)] hover:bg-[var(--bg-hover)]'}`}>
                      <p className={`text-xs font-semibold ${checked ? 'text-[#e94560]' : textPri}`}>{r.label}</p>
                      <p className={`text-[10px] ${textMuted} leading-snug`}>{r.hint}</p>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Sales Portal Role */}
          {(form.roles || []).includes('sales_person') && (
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
              {!(form.roles || []).includes('admin') && (
                <div className="flex gap-1">
                  <button onClick={applyRolePresets} className="text-xs text-[#e94560] hover:underline">Apply role presets</button>
                  <span className={textMuted}>•</span>
                  <button onClick={() => {
                    const all = {};
                    allModules.filter(m => m.is_active).forEach(m => { all[m.name] = { level: 'read_write', can_download: false, scope: 'all' }; });
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
              roles={form.roles}
              disabled={(form.roles || []).includes('admin') ? 'admin' : null}
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

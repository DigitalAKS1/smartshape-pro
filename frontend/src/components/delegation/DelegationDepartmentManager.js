import React from 'react';
import { Plus, Building2, Shield, UserCheck, User, RefreshCcw, X } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';

const PINK = '#e94560';
const ROLES = ['boss', 'delegator', 'delegatee'];
const ROLE_META = {
  boss:      { Icon: Shield,    label: 'Boss' },
  delegator: { Icon: UserCheck, label: 'Delegator' },
  delegatee: { Icon: User,      label: 'Delegatee' },
};

function empColor(id = '') {
  const n = id.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  return `hsl(${(n * 47) % 360}, 55%, 42%)`;
}
function empInitials(name = '') {
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() || '?';
}
function RoleTag({ role }) {
  return (
    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full capitalize"
      style={{ background: PINK + '18', color: PINK }}>{role}</span>
  );
}

export default function DelegationDepartmentManager({
  employees, departments,
  syncing, syncUsersNow,
  setDeptOpen, setEmpOpen, setEditEmp, setEmpForm,
  deptOpen, deptForm, setDeptForm, saveDept,
  empOpen, editEmp, empForm, setEmpForm: setEmpFormProp, saveEmp, toggleRole,
  card, textPri, textSec, textMuted, inputCls, dlgCls,
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className={`text-lg font-semibold ${textPri}`}>Team Members ({employees.length})</h2>
          <p className={`text-xs ${textMuted} mt-0.5`}>SmartShape users auto-linked by email</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button size="sm" variant="outline" onClick={syncUsersNow} disabled={syncing}
            className={`border-[var(--border-color)] ${textSec} h-8 text-xs`}>
            <RefreshCcw className={`h-3.5 w-3.5 mr-1 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? 'Syncing…' : 'Sync Users'}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setDeptOpen(true)}
            className={`border-[var(--border-color)] ${textSec} h-8 text-xs`}>
            <Building2 className="h-3.5 w-3.5 mr-1" /> Add Dept
          </Button>
          <Button size="sm" onClick={() => {
            setEditEmp(null);
            setEmpFormProp({ name:'', email:'', phone:'', department_id:'', department_name:'', roles:[], delegation_targets:[] });
            setEmpOpen(true);
          }} className="h-8 text-xs text-white" style={{ background: PINK }}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Add Member
          </Button>
        </div>
      </div>

      {/* Role summary */}
      <div className="grid grid-cols-3 gap-3">
        {ROLES.map(r => {
          const { Icon, label } = ROLE_META[r];
          const count = employees.filter(e => e.roles?.includes(r)).length;
          return (
            <div key={r} className={`${card} border rounded-xl p-4 flex items-center gap-3`}>
              <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ background: PINK + '20' }}>
                <Icon className="h-4 w-4" style={{ color: PINK }} />
              </div>
              <div>
                <p className={`text-xl font-black font-mono ${textPri}`}>{count}</p>
                <p className={`text-xs capitalize ${textMuted}`}>{label}s</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Employees table */}
      <div className={`${card} border rounded-xl overflow-hidden`}>
        <table className="w-full text-sm">
          <thead><tr className="bg-[var(--bg-primary)] border-b border-[var(--border-color)]">
            {['Member', 'Email / Phone', 'Department', 'Roles', 'Actions'].map(h => (
              <th key={h} className={`py-3 px-4 text-left text-[10px] font-semibold uppercase tracking-wider ${textMuted}`}>{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {employees.length === 0 && (
              <tr><td colSpan={5} className={`py-14 text-center text-sm ${textMuted}`}>No team members — click Sync Users above</td></tr>
            )}
            {employees.map(e => (
              <tr key={e.emp_id} className="border-b border-[var(--border-color)] hover:bg-[var(--bg-hover)]">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
                      style={{ background: empColor(e.emp_id) }}>
                      {empInitials(e.name)}
                    </div>
                    <div>
                      <p className={`font-semibold ${textPri} text-sm`}>{e.name}</p>
                      {e.synced_from_users && (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-blue-500/15 text-blue-400">LINKED</span>
                      )}
                    </div>
                  </div>
                </td>
                <td className={`px-4 py-3 ${textMuted} text-xs`}>
                  <p>{e.email || '—'}</p>
                  {e.phone && <p className="font-mono">{e.phone}</p>}
                </td>
                <td className={`px-4 py-3 text-sm ${textSec}`}>{e.department_name || '—'}</td>
                <td className="px-4 py-3">
                  <div className="flex gap-1 flex-wrap">
                    {(e.roles || []).map(r => <RoleTag key={r} role={r} />)}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <button onClick={() => {
                    setEditEmp(e);
                    setEmpFormProp({ name: e.name, email: e.email||'', phone: e.phone||'', department_id: e.department_id||'', department_name: e.department_name||'', roles: e.roles||[], delegation_targets: e.delegation_targets||[] });
                    setEmpOpen(true);
                  }} className={`p-1.5 rounded-lg hover:bg-[var(--bg-hover)] ${textMuted}`}>
                    <UserCheck className="h-3.5 w-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Departments list */}
      <div className={`${card} border rounded-xl overflow-hidden`}>
        <div className={`px-4 py-3 border-b border-[var(--border-color)]`}>
          <h3 className={`text-sm font-semibold ${textPri}`}>Departments ({departments.length})</h3>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 p-4">
          {departments.map(d => (
            <div key={d.dept_id} className={`flex items-center gap-2 p-2.5 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-color)]`}>
              <Building2 className="h-3.5 w-3.5 flex-shrink-0" style={{ color: PINK }} />
              <span className={`text-xs font-medium ${textPri} truncate`}>{d.name}</span>
              <span className={`ml-auto text-[10px] font-mono ${textMuted}`}>
                {employees.filter(e => e.department_id === d.dept_id).length}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Add Department Dialog */}
      <Dialog open={deptOpen} onOpenChange={setDeptOpen}>
        <DialogContent className={`${dlgCls} max-w-sm`}>
          <DialogHeader><DialogTitle className={textPri}>Add Department</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label className={`${textSec} text-xs`}>Department Name *</Label>
              <Input value={deptForm.name} onChange={e => setDeptForm({...deptForm, name: e.target.value})} className={inputCls} placeholder="e.g. Sales" />
            </div>
            <div>
              <Label className={`${textSec} text-xs`}>Description</Label>
              <Input value={deptForm.description} onChange={e => setDeptForm({...deptForm, description: e.target.value})} className={inputCls} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeptOpen(false)} className={`border-[var(--border-color)] ${textSec}`}>Cancel</Button>
            <Button onClick={saveDept} className="text-white" style={{ background: PINK }}>Add</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add / Edit Employee Dialog */}
      <Dialog open={empOpen} onOpenChange={setEmpOpen}>
        <DialogContent className={`${dlgCls} max-w-md`}>
          <DialogHeader><DialogTitle className={textPri}>{editEmp ? 'Edit Member' : 'Add Team Member'}</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className={`${textSec} text-xs`}>Full Name *</Label>
                <Input value={empForm.name} onChange={e => setEmpFormProp({...empForm, name: e.target.value})} className={inputCls} />
              </div>
              <div>
                <Label className={`${textSec} text-xs`}>Phone</Label>
                <Input value={empForm.phone} onChange={e => setEmpFormProp({...empForm, phone: e.target.value})} className={inputCls} />
              </div>
            </div>
            <div>
              <Label className={`${textSec} text-xs`}>Email (must match SmartShape login)</Label>
              <Input type="email" value={empForm.email} onChange={e => setEmpFormProp({...empForm, email: e.target.value})} className={inputCls} />
            </div>
            <div>
              <Label className={`${textSec} text-xs`}>Department</Label>
              <select value={empForm.department_id} onChange={e => {
                const d = departments.find(x => x.dept_id === e.target.value);
                setEmpFormProp({...empForm, department_id: e.target.value, department_name: d?.name || ''});
              }} className={`w-full h-10 px-3 rounded-md text-sm ${inputCls}`}>
                <option value="">— Select —</option>
                {departments.map(d => <option key={d.dept_id} value={d.dept_id}>{d.name}</option>)}
              </select>
            </div>
            <div>
              <Label className={`${textSec} text-xs block mb-2`}>Roles * (select all that apply)</Label>
              <div className="flex gap-2">
                {ROLES.map(r => {
                  const { Icon, label } = ROLE_META[r];
                  const sel = empForm.roles.includes(r);
                  return (
                    <button key={r} type="button" onClick={() => toggleRole(r)}
                      className={`flex-1 flex flex-col items-center gap-1.5 py-3 rounded-xl border-2 text-xs font-bold capitalize transition-all ${sel ? 'border-[#e94560] text-[#e94560]' : `border-[var(--border-color)] ${textMuted}`}`}
                      style={sel ? { background: PINK + '12' } : {}}>
                      <Icon className="h-4 w-4" />{label}
                    </button>
                  );
                })}
              </div>
            </div>

            {(empForm.roles.includes('delegator') || empForm.roles.includes('boss')) && (
              <div>
                <Label className={`${textSec} text-xs block mb-1.5`}>
                  Can Delegate To
                  <span className={`ml-1.5 font-normal ${textMuted}`}>(empty = all delegatees)</span>
                </Label>
                <div className={`min-h-[36px] flex flex-wrap gap-1.5 p-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] mb-2`}>
                  {(empForm.delegation_targets || []).length === 0 && (
                    <span className={`text-xs ${textMuted} self-center`}>No restrictions — can assign to all</span>
                  )}
                  {(empForm.delegation_targets || []).map(tid => {
                    const te = employees.find(e => e.emp_id === tid);
                    return te ? (
                      <span key={tid}
                        className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full"
                        style={{ background: PINK + '18', color: PINK, border: `1px solid ${PINK}40` }}>
                        {te.name}
                        <button type="button"
                          onClick={() => setEmpFormProp(f => ({ ...f, delegation_targets: (f.delegation_targets || []).filter(x => x !== tid) }))}
                          className="ml-0.5 hover:opacity-70">
                          <X className="h-2.5 w-2.5" />
                        </button>
                      </span>
                    ) : null;
                  })}
                </div>
                <select value="" onChange={e => {
                  if (!e.target.value) return;
                  setEmpFormProp(f => ({ ...f, delegation_targets: [...new Set([...(f.delegation_targets || []), e.target.value])] }));
                }} className={`w-full h-9 px-3 rounded-md text-xs ${inputCls}`}>
                  <option value="">+ Add member to allowed list…</option>
                  {employees
                    .filter(e => e.roles?.includes('delegatee') && !(empForm.delegation_targets || []).includes(e.emp_id))
                    .map(e => <option key={e.emp_id} value={e.emp_id}>{e.name}{e.department_name ? ` (${e.department_name})` : ''}</option>)}
                </select>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEmpOpen(false)} className={`border-[var(--border-color)] ${textSec}`}>Cancel</Button>
            <Button onClick={saveEmp} className="text-white" style={{ background: PINK }}>{editEmp ? 'Update' : 'Add Member'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

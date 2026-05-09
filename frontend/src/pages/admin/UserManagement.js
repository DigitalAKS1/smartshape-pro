import React, { useState, useEffect } from 'react';
import AdminLayout from '../../components/layouts/AdminLayout';
import { adminUsers, modules as modulesApi, designations as desgApi, exportData } from '../../lib/api';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Switch } from '../../components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../../components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { toast } from 'sonner';
import { UserPlus, Edit2, Trash2, Shield, Users, Eye, EyeOff, Download, Lock, FileEdit, Trash, ChevronDown } from 'lucide-react';
import { useTheme } from '../../contexts/ThemeContext';

const LEVELS = [
  { value: 'none', label: 'No Access', short: '—', cls: 'text-[var(--text-muted)]' },
  { value: 'read', label: 'Read Only', short: 'R', cls: 'text-blue-400' },
  { value: 'read_write', label: 'Read + Write', short: 'RW', cls: 'text-yellow-400' },
  { value: 'read_write_delete', label: 'Full Access', short: 'RWD', cls: 'text-green-400' },
];

function PermMatrix({ modules, permissions, onChange, disabled }) {
  const { isDark } = useTheme();
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
              {/* Level selector */}
              <div className="w-36 px-1">
                <select value={level} onChange={e => setLevel(mod.name, e.target.value)}
                  className={`w-full h-8 px-2 rounded text-xs font-medium ${inputCls} ${levelObj.cls}`}>
                  {LEVELS.map(l => (
                    <option key={l.value} value={l.value} className="text-[var(--text-primary)]">{l.label}</option>
                  ))}
                </select>
              </div>
              {/* Download toggle */}
              <div className="w-20 flex justify-center">
                <Switch
                  checked={canDl}
                  onCheckedChange={() => toggleDownload(mod.name)}
                  disabled={level === 'none'}
                  data-testid={`dl-${mod.name}`}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function UserManagement() {
  const { isDark } = useTheme();
  const [users, setUsers] = useState([]);
  const [allModules, setAllModules] = useState([]);
  const [allDesignations, setAllDesignations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editUser, setEditUser] = useState(null);
  const [showPassword, setShowPassword] = useState(false);
  const [permTab, setPermTab] = useState('matrix'); // 'matrix' | 'legacy'

  const [form, setForm] = useState({
    email: '', password: '', name: '', role: 'sales_person',
    designation: '', phone: '',
    assigned_modules: [],
    module_permissions: {},
  });

  const card = 'bg-[var(--bg-card)] border-[var(--border-color)]';
  const textPri = 'text-[var(--text-primary)]';
  const textSec = 'text-[var(--text-secondary)]';
  const textMuted = 'text-[var(--text-muted)]';
  const inputCls = 'bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]';

  const fetchData = async () => {
    try {
      const [usersRes, modsRes, desgRes] = await Promise.all([
        adminUsers.getAll(), modulesApi.getAll(), desgApi.getAll(),
      ]);
      setUsers(usersRes.data);
      setAllModules(modsRes.data);
      setAllDesignations(desgRes.data);
    } catch { toast.error('Failed to load data'); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, []);

  const openCreate = () => {
    setEditUser(null);
    setForm({ email: '', password: '', name: '', role: 'sales_person', designation: '', phone: '', assigned_modules: [], module_permissions: {} });
    setShowPassword(false);
    setPermTab('matrix');
    setDialogOpen(true);
  };

  const openEdit = (u) => {
    setEditUser(u);
    setForm({
      email: u.email, password: '', name: u.name, role: u.role,
      designation: u.designation || '', phone: u.phone || '',
      assigned_modules: u.assigned_modules || [],
      module_permissions: u.module_permissions || {},
    });
    setShowPassword(false);
    setPermTab('matrix');
    setDialogOpen(true);
  };

  const handleDesignationChange = (code) => {
    const desg = allDesignations.find(d => d.code === code);
    if (desg) {
      setForm(prev => ({ ...prev, designation: code, role: desg.role_level, assigned_modules: desg.default_modules || [] }));
    } else {
      setForm(prev => ({ ...prev, designation: code }));
    }
  };

  const handlePermissionsChange = (newPerms) => {
    const assigned = Object.entries(newPerms).filter(([, p]) => p.level !== 'none').map(([m]) => m);
    setForm(prev => ({ ...prev, module_permissions: newPerms, assigned_modules: assigned }));
  };

  const handleSave = async () => {
    try {
      if (editUser) {
        const payload = {
          name: form.name, role: form.role, designation: form.designation,
          phone: form.phone, assigned_modules: form.assigned_modules,
          module_permissions: form.module_permissions,
        };
        if (form.password) payload.password = form.password;
        await adminUsers.update(editUser.user_id, payload);
        toast.success('User updated');
      } else {
        if (!form.email || !form.password || !form.name) { toast.error('Email, password, and name are required'); return; }
        await adminUsers.create({ ...form });
        toast.success('User created');
      }
      setDialogOpen(false);
      fetchData();
    } catch (err) { toast.error(err.response?.data?.detail || 'Failed to save user'); }
  };

  const handleDelete = async (userId) => {
    if (!window.confirm('Are you sure you want to delete this user?')) return;
    try { await adminUsers.delete(userId); toast.success('User deleted'); fetchData(); }
    catch (err) { toast.error(err.response?.data?.detail || 'Failed to delete user'); }
  };

  const handleToggleActive = async (u) => {
    try { await adminUsers.update(u.user_id, { is_active: !u.is_active }); toast.success(u.is_active ? 'User deactivated' : 'User activated'); fetchData(); }
    catch { toast.error('Failed to update user'); }
  };

  const getLevelBadge = (u) => {
    if (u.role === 'admin') return <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#e94560]/20 text-[#e94560] border border-[#e94560]/30 font-medium">Admin</span>;
    const perms = u.module_permissions || {};
    const withDelete = Object.values(perms).filter(p => p.level === 'read_write_delete').length;
    const withWrite = Object.values(perms).filter(p => p.level === 'read_write').length;
    const withDownload = Object.values(perms).filter(p => p.can_download).length;
    return (
      <div className="flex flex-wrap gap-1">
        {withDelete > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/15 text-green-400 border border-green-500/30">{withDelete} Full</span>}
        {withWrite > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-500/15 text-yellow-400 border border-yellow-500/30">{withWrite} R+W</span>}
        {withDownload > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-400 border border-blue-500/30">{withDownload} DL</span>}
        {withDelete === 0 && withWrite === 0 && <span className={`text-[10px] ${textMuted}`}>{(u.assigned_modules || []).length} modules</span>}
      </div>
    );
  };

  if (loading) return <AdminLayout><div className="flex items-center justify-center h-96"><div className="animate-spin rounded-full h-12 w-12 border-4 border-[#e94560] border-t-transparent" /></div></AdminLayout>;

  return (
    <AdminLayout>
      <div className="space-y-5">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className={`text-2xl sm:text-3xl font-semibold ${textPri} tracking-tight`}>User Management</h1>
            <p className={`${textSec} mt-0.5 text-sm`}>{users.length} users • Manage access &amp; permissions</p>
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={() => { exportData.download('users'); toast.success('Exporting...'); }} variant="outline" size="sm" className={`border-[var(--border-color)] ${textSec}`}>
              <Download className="mr-1.5 h-3.5 w-3.5" /> Export
            </Button>
            <Button onClick={openCreate} size="sm" className="bg-[#e94560] hover:bg-[#f05c75] text-white">
              <UserPlus className="mr-1.5 h-3.5 w-3.5" /> Create User
            </Button>
          </div>
        </div>

        {/* Permission legend */}
        <div className={`${card} border rounded-md p-3 flex flex-wrap gap-4 text-xs`}>
          <span className={`font-semibold ${textMuted} uppercase tracking-wide`}>Permission Levels:</span>
          {[
            { cls: 'text-[var(--text-muted)]', label: 'No Access — cannot see module' },
            { cls: 'text-blue-400', label: 'Read Only — view data only' },
            { cls: 'text-yellow-400', label: 'Read + Write — view, create & edit' },
            { cls: 'text-green-400', label: 'Full Access — includes delete' },
          ].map(l => <span key={l.label} className={l.cls}>{l.label}</span>)}
          <span className="text-[#e94560]">DL = Download permission (admin-controlled)</span>
        </div>

        {/* Users table */}
        <div className={`${card} border rounded-md overflow-hidden`}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="bg-[var(--bg-primary)] border-b border-[var(--border-color)]">
                <th className={`text-left text-xs uppercase py-3 px-4 ${textMuted}`}>User</th>
                <th className={`text-left text-xs uppercase py-3 px-4 ${textMuted} hidden sm:table-cell`}>Role</th>
                <th className={`text-left text-xs uppercase py-3 px-4 ${textMuted} hidden md:table-cell`}>Permissions</th>
                <th className={`text-center text-xs uppercase py-3 px-4 ${textMuted}`}>Status</th>
                <th className={`text-right text-xs uppercase py-3 px-4 ${textMuted}`}>Actions</th>
              </tr></thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.user_id} className={`border-b border-[var(--border-color)] hover:bg-[var(--bg-hover)] transition-colors`}>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-[var(--bg-hover)] flex items-center justify-center text-[var(--text-primary)] font-semibold text-sm flex-shrink-0">
                          {u.name?.charAt(0)?.toUpperCase()}
                        </div>
                        <div>
                          <p className={`font-medium ${textPri}`}>{u.name}</p>
                          <p className={`text-xs ${textMuted}`}>{u.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-4 hidden sm:table-cell">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium border ${u.role === 'admin' ? 'bg-[#e94560]/20 text-[#e94560] border-[#e94560]/30' : 'bg-blue-500/20 text-blue-400 border-blue-500/30'}`}>
                        {u.designation ? allDesignations.find(d => d.code === u.designation)?.name || u.designation : (u.role === 'admin' ? 'Admin' : 'Sales Person')}
                      </span>
                    </td>
                    <td className="py-3 px-4 hidden md:table-cell">{getLevelBadge(u)}</td>
                    <td className="py-3 px-4 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        <Switch checked={u.is_active !== false} onCheckedChange={() => handleToggleActive(u)} />
                        <span className={`text-xs hidden lg:inline ${u.is_active !== false ? 'text-green-400' : 'text-red-400'}`}>
                          {u.is_active !== false ? 'Active' : 'Off'}
                        </span>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <Button size="sm" variant="ghost" onClick={() => openEdit(u)} className={`${textSec} h-8 px-2`}><Edit2 className="h-3.5 w-3.5" /></Button>
                      {u.role !== 'admin' && (
                        <Button size="sm" variant="ghost" onClick={() => handleDelete(u.user_id)} className="text-red-400 h-8 px-2"><Trash2 className="h-3.5 w-3.5" /></Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Create/Edit Dialog */}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className={`bg-[var(--bg-card)] border-[var(--border-color)] ${textPri} max-w-2xl max-h-[90vh] overflow-y-auto`}>
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
              </div>

              {/* Designation + Role */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div><Label className={`${textSec} text-xs uppercase tracking-wide mb-1.5 block`}>Designation</Label>
                  <Select value={form.designation || '_none'} onValueChange={v => handleDesignationChange(v === '_none' ? '' : v)}>
                    <SelectTrigger className={inputCls}><SelectValue placeholder="Select..." /></SelectTrigger>
                    <SelectContent className="bg-[var(--bg-card)] border-[var(--border-color)]">
                      <SelectItem value="_none" className={`${textPri} hover:bg-[var(--bg-hover)]`}>-- Custom --</SelectItem>
                      {allDesignations.filter(d => d.is_active).map(d => (
                        <SelectItem key={d.code} value={d.code} className={`${textPri} hover:bg-[var(--bg-hover)]`}>{d.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div><Label className={`${textSec} text-xs uppercase tracking-wide mb-1.5 block`}>Role Level</Label>
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

              {/* Permission Matrix */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <Label className={`${textSec} text-xs uppercase tracking-wide`}>Module Permissions</Label>
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
              <Button variant="outline" onClick={() => setDialogOpen(false)} className={`border-[var(--border-color)] ${textSec}`}>Cancel</Button>
              <Button onClick={handleSave} className="bg-[#e94560] hover:bg-[#f05c75] text-white">{editUser ? 'Update User' : 'Create User'}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AdminLayout>
  );
}

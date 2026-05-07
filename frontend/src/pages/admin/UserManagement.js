import React, { useState, useEffect } from 'react';
import AdminLayout from '../../components/layouts/AdminLayout';
import { adminUsers, modules as modulesApi, designations as desgApi, exportData } from '../../lib/api';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Badge } from '../../components/ui/badge';
import { Switch } from '../../components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '../../components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import { toast } from 'sonner';
import { UserPlus, Edit2, Trash2, Shield, Users, Eye, EyeOff, Download } from 'lucide-react';

export default function UserManagement() {
  const [users, setUsers] = useState([]);
  const [allModules, setAllModules] = useState([]);
  const [allDesignations, setAllDesignations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editUser, setEditUser] = useState(null);
  const [showPassword, setShowPassword] = useState(false);
  const [form, setForm] = useState({
    email: '',
    password: '',
    name: '',
    role: 'sales_person',
    designation: '',
    phone: '',
    assigned_modules: [],
  });

  const fetchData = async () => {
    try {
      const [usersRes, modsRes, desgRes] = await Promise.all([
        adminUsers.getAll(),
        modulesApi.getAll(),
        desgApi.getAll(),
      ]);
      setUsers(usersRes.data);
      setAllModules(modsRes.data);
      setAllDesignations(desgRes.data);
    } catch (err) {
      toast.error('Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const openCreate = () => {
    setEditUser(null);
    setForm({ email: '', password: '', name: '', role: 'sales_person', designation: '', phone: '', assigned_modules: [] });
    setShowPassword(false);
    setDialogOpen(true);
  };

  const openEdit = (u) => {
    setEditUser(u);
    setForm({
      email: u.email,
      password: '',
      name: u.name,
      role: u.role,
      designation: u.designation || '',
      phone: u.phone || '',
      assigned_modules: u.assigned_modules || [],
    });
    setShowPassword(false);
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

  const toggleModule = (modName) => {
    setForm((prev) => ({
      ...prev,
      assigned_modules: prev.assigned_modules.includes(modName)
        ? prev.assigned_modules.filter((m) => m !== modName)
        : [...prev.assigned_modules, modName],
    }));
  };

  const selectAllModules = () => {
    setForm((prev) => ({
      ...prev,
      assigned_modules: allModules.filter((m) => m.is_active).map((m) => m.name),
    }));
  };

  const clearAllModules = () => {
    setForm((prev) => ({ ...prev, assigned_modules: [] }));
  };

  const handleSave = async () => {
    try {
      if (editUser) {
        const payload = { name: form.name, role: form.role, designation: form.designation, phone: form.phone, assigned_modules: form.assigned_modules };
        if (form.password) payload.password = form.password;
        await adminUsers.update(editUser.user_id, payload);
        toast.success('User updated');
      } else {
        if (!form.email || !form.password || !form.name) {
          toast.error('Email, password, and name are required');
          return;
        }
        await adminUsers.create({ ...form });
        toast.success('User created');
      }
      setDialogOpen(false);
      fetchData();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to save user');
    }
  };

  const handleDelete = async (userId) => {
    if (!window.confirm('Are you sure you want to delete this user?')) return;
    try {
      await adminUsers.delete(userId);
      toast.success('User deleted');
      fetchData();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to delete user');
    }
  };

  const handleToggleActive = async (u) => {
    try {
      await adminUsers.update(u.user_id, { is_active: !u.is_active });
      toast.success(u.is_active ? 'User deactivated' : 'User activated');
      fetchData();
    } catch (err) {
      toast.error('Failed to update user');
    }
  };

  const getRoleBadge = (role) => {
    if (role === 'admin') return 'bg-[#e94560]/20 text-[#e94560] border-[#e94560]/30';
    return 'bg-blue-500/20 text-blue-300 border-blue-500/30';
  };

  if (loading) {
    return (
      <AdminLayout>
        <div className="flex items-center justify-center h-96">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-[#e94560] border-t-transparent" />
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="space-y-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-semibold text-[var(--text-primary)] tracking-tight" data-testid="user-management-title">User Management</h1>
            <p className="text-[var(--text-secondary)] mt-1">Create and manage user accounts with module access</p>
          </div>
          <div className="flex items-center gap-3">
            <Button onClick={() => { exportData.download('users'); toast.success('Exporting users...'); }} variant="outline" className="border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]" data-testid="export-users-button">
              <Download className="mr-2 h-4 w-4" /> Export CSV
            </Button>
            <Button onClick={openCreate} className="bg-[#e94560] hover:bg-[#f05c75] text-white" data-testid="create-user-button">
              <UserPlus className="mr-2 h-4 w-4" /> Create User
            </Button>
          </div>
        </div>

        {/* Users Table */}
        <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full" data-testid="users-table">
              <thead>
                <tr className="border-b border-[var(--border-color)]">
                  <th className="text-left text-xs uppercase tracking-wide text-[var(--text-secondary)] py-4 px-6">User</th>
                  <th className="text-left text-xs uppercase tracking-wide text-[var(--text-secondary)] py-4 px-6">Role</th>
                  <th className="text-left text-xs uppercase tracking-wide text-[var(--text-secondary)] py-4 px-6">Modules</th>
                  <th className="text-left text-xs uppercase tracking-wide text-[var(--text-secondary)] py-4 px-6">Status</th>
                  <th className="text-right text-xs uppercase tracking-wide text-[var(--text-secondary)] py-4 px-6">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.user_id} className="border-b border-[var(--border-color)] hover:bg-[var(--bg-hover)] transition-colors" data-testid={`user-row-${u.email}`}>
                    <td className="py-4 px-6">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-[var(--bg-hover)] flex items-center justify-center text-[var(--text-primary)] font-medium">
                          {u.name?.charAt(0)?.toUpperCase()}
                        </div>
                        <div>
                          <p className="text-[var(--text-primary)] font-medium">{u.name}</p>
                          <p className="text-xs text-[var(--text-muted)]">{u.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="py-4 px-6">
                      <span className={`inline-block px-3 py-1 rounded-full text-xs font-medium border ${getRoleBadge(u.role)}`}>
                        {u.designation ? allDesignations.find(d => d.code === u.designation)?.name || u.designation : (u.role === 'admin' ? 'Admin' : 'Sales Person')}
                      </span>
                    </td>
                    <td className="py-4 px-6">
                      <div className="flex flex-wrap gap-1 max-w-[300px]">
                        {(u.assigned_modules || []).slice(0, 4).map((mod) => (
                          <span key={mod} className="inline-block px-2 py-0.5 rounded text-xs bg-[var(--bg-hover)] text-[var(--text-secondary)] border border-[var(--border-color)]">
                            {mod.replace(/_/g, ' ')}
                          </span>
                        ))}
                        {(u.assigned_modules || []).length > 4 && (
                          <span className="text-xs text-[var(--text-muted)]">+{u.assigned_modules.length - 4} more</span>
                        )}
                        {(!u.assigned_modules || u.assigned_modules.length === 0) && (
                          <span className="text-xs text-[var(--text-muted)]">No modules assigned</span>
                        )}
                      </div>
                    </td>
                    <td className="py-4 px-6">
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={u.is_active !== false}
                          onCheckedChange={() => handleToggleActive(u)}
                          data-testid={`user-toggle-${u.email}`}
                        />
                        <span className={`text-xs ${u.is_active !== false ? 'text-green-400' : 'text-red-400'}`}>
                          {u.is_active !== false ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                    </td>
                    <td className="py-4 px-6 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => openEdit(u)}
                          className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
                          data-testid={`edit-user-${u.email}`}
                        >
                          <Edit2 className="h-4 w-4" />
                        </Button>
                        {u.role !== 'admin' && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleDelete(u.user_id)}
                            className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                            data-testid={`delete-user-${u.email}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Create/Edit Dialog */}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="bg-[var(--bg-card)] border-[var(--border-color)] text-[var(--text-primary)] max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="text-[var(--text-primary)] text-xl" data-testid="user-dialog-title">
                {editUser ? 'Edit User' : 'Create New User'}
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-6 py-4">
              {/* Basic Info */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label className="text-[var(--text-secondary)] uppercase text-xs tracking-wide mb-2 block">Name *</Label>
                  <Input
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className="bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]"
                    placeholder="Full name"
                    data-testid="user-name-input"
                  />
                </div>
                <div>
                  <Label className="text-[var(--text-secondary)] uppercase text-xs tracking-wide mb-2 block">Email *</Label>
                  <Input
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    className="bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]"
                    placeholder="user@company.com"
                    disabled={!!editUser}
                    data-testid="user-email-input"
                  />
                </div>
                <div>
                  <Label className="text-[var(--text-secondary)] uppercase text-xs tracking-wide mb-2 block">
                    {editUser ? 'New Password (leave blank to keep)' : 'Password *'}
                  </Label>
                  <div className="relative">
                    <Input
                      type={showPassword ? 'text' : 'password'}
                      value={form.password}
                      onChange={(e) => setForm({ ...form, password: e.target.value })}
                      className="bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)] pr-10"
                      placeholder="••••••••"
                      data-testid="user-password-input"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
                <div>
                  <Label className="text-[var(--text-secondary)] uppercase text-xs tracking-wide mb-2 block">Phone</Label>
                  <Input
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    className="bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]"
                    placeholder="+91-9876543210"
                    data-testid="user-phone-input"
                  />
                </div>
              </div>

              {/* Designation */}
              <div>
                <Label className="text-[var(--text-secondary)] uppercase text-xs tracking-wide mb-2 block">Designation</Label>
                <Select value={form.designation || '_none'} onValueChange={(v) => handleDesignationChange(v === '_none' ? '' : v)}>
                  <SelectTrigger className="bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]" data-testid="user-designation-select">
                    <SelectValue placeholder="Select designation..." />
                  </SelectTrigger>
                  <SelectContent className="bg-[var(--bg-card)] border-[var(--border-color)]">
                    <SelectItem value="_none" className="text-[var(--text-primary)] hover:bg-[var(--bg-hover)]">-- Custom (manual) --</SelectItem>
                    {allDesignations.filter(d => d.is_active).map(d => (
                      <SelectItem key={d.code} value={d.code} className="text-[var(--text-primary)] hover:bg-[var(--bg-hover)]">{d.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[10px] text-[var(--text-muted)] mt-1">Selecting a designation auto-fills role & modules</p>
              </div>

              {/* Role */}
              <div>
                <Label className="text-[var(--text-secondary)] uppercase text-xs tracking-wide mb-2 block">Role Level</Label>
                <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v })}>
                  <SelectTrigger className="bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]" data-testid="user-role-select">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-[var(--bg-card)] border-[var(--border-color)]">
                    <SelectItem value="admin" className="text-[var(--text-primary)] hover:bg-[var(--bg-hover)]">Admin</SelectItem>
                    <SelectItem value="sales_person" className="text-[var(--text-primary)] hover:bg-[var(--bg-hover)]">Sales Person</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Module Assignment */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <Label className="text-[var(--text-secondary)] uppercase text-xs tracking-wide">Assign Modules</Label>
                  <div className="flex gap-2">
                    <Button size="sm" variant="ghost" onClick={selectAllModules} className="text-xs text-[#e94560] hover:text-[#f05c75]" data-testid="select-all-modules">
                      Select All
                    </Button>
                    <Button size="sm" variant="ghost" onClick={clearAllModules} className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]" data-testid="clear-all-modules">
                      Clear All
                    </Button>
                  </div>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {allModules.filter((m) => m.is_active).map((mod) => {
                    const checked = form.assigned_modules.includes(mod.name);
                    return (
                      <button
                        key={mod.module_id}
                        type="button"
                        onClick={() => toggleModule(mod.name)}
                        className={`flex items-center gap-2 p-3 rounded-md border text-left transition-all ${
                          checked
                            ? 'bg-[#e94560]/10 border-[#e94560]/40 text-white'
                            : 'bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-secondary)] hover:border-[#e94560]/20'
                        }`}
                        data-testid={`module-toggle-${mod.name}`}
                      >
                        <div className={`w-4 h-4 rounded border flex items-center justify-center ${
                          checked ? 'bg-[#e94560] border-[#e94560]' : 'border-[#6b6b80]'
                        }`}>
                          {checked && <span className="text-[var(--text-primary)] text-xs">&#10003;</span>}
                        </div>
                        <div>
                          <p className="text-sm font-medium">{mod.display_name}</p>
                          <p className="text-xs text-[var(--text-muted)]">{mod.category}</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)} className="border-[var(--border-color)] text-[var(--text-secondary)]">
                Cancel
              </Button>
              <Button onClick={handleSave} className="bg-[#e94560] hover:bg-[#f05c75] text-white" data-testid="save-user-button">
                {editUser ? 'Update User' : 'Create User'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AdminLayout>
  );
}

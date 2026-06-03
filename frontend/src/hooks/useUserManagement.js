import { useState, useEffect } from 'react';
import { adminUsers, modules as modulesApi, designations as desgApi } from '../lib/api';
import { toast } from 'sonner';

export function useUserManagement() {
  const [users, setUsers] = useState([]);
  const [allModules, setAllModules] = useState([]);
  const [allDesignations, setAllDesignations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [roleFilter, setRoleFilter] = useState('all');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editUser, setEditUser] = useState(null);
  const [showPassword, setShowPassword] = useState(false);
  const [permTab, setPermTab] = useState('matrix');

  const emptyForm = {
    email: '', password: '', name: '', role: 'sales_person',
    sales_role: 'executive',
    designation: '', phone: '',
    assigned_modules: [],
    module_permissions: {},
  };

  const [form, setForm] = useState(emptyForm);

  const fetchData = async () => {
    try {
      const [usersRes, modsRes, desgRes] = await Promise.all([
        adminUsers.getAll(), modulesApi.getAll(), desgApi.getAll(),
      ]);
      setUsers(usersRes.data);
      setAllModules(modsRes.data);
      setAllDesignations(desgRes.data);
    } catch {
      toast.error('Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const openCreate = () => {
    setEditUser(null);
    setForm(emptyForm);
    setShowPassword(false);
    setPermTab('matrix');
    setDialogOpen(true);
  };

  const openEdit = (u) => {
    setEditUser(u);
    setForm({
      email: u.email, password: '', name: u.name, role: u.role,
      sales_role: u.sales_role || 'executive',
      designation: u.designation || '', phone: u.phone || '',
      assigned_modules: u.assigned_modules || [],
      module_permissions: u.module_permissions || {},
    });
    setShowPassword(false);
    setPermTab('matrix');
    setDialogOpen(true);
  };

  const handleDesignationChange = (v) => {
    const code = v === '_none' ? '' : v;
    const desg = allDesignations.find(d => d.code === code);
    setForm(prev => ({
      ...prev,
      designation: code,
      ...(desg?.default_modules?.length > 0 && Object.keys(prev.module_permissions).length === 0
        ? { assigned_modules: desg.default_modules }
        : {}),
    }));
  };

  const handlePermissionsChange = (newPerms) => {
    const assigned = Object.entries(newPerms)
      .filter(([, p]) => p.level !== 'none')
      .map(([m]) => m);
    setForm(prev => ({ ...prev, module_permissions: newPerms, assigned_modules: assigned }));
  };

  const handleSave = async () => {
    try {
      if (editUser) {
        const payload = {
          name: form.name, role: form.role, designation: form.designation,
          phone: form.phone, assigned_modules: form.assigned_modules,
          module_permissions: form.module_permissions,
          ...(form.role === 'sales_person' ? { sales_role: form.sales_role } : {}),
        };
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
    } catch {
      toast.error('Failed to update user');
    }
  };

  const filteredUsers = roleFilter === 'all'
    ? users
    : users.filter(u => u.role === roleFilter);

  return {
    users, filteredUsers, allModules, allDesignations,
    loading, roleFilter, setRoleFilter,
    dialogOpen, setDialogOpen,
    editUser, form, setForm,
    showPassword, setShowPassword,
    permTab, setPermTab,
    openCreate, openEdit,
    handleDesignationChange,
    handlePermissionsChange,
    handleSave, handleDelete,
    handleToggleActive,
  };
}

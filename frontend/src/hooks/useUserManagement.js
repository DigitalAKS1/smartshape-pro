import { useState, useEffect } from 'react';
import { adminUsers, modules as modulesApi, designations as desgApi, rolePresets } from '../lib/api';
import { toast } from 'sonner';

const PRIMARY_ROLE_ORDER = ['admin', 'accounts', 'store', 'sales_person'];

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
    email: '', password: '', name: '', role: 'sales_person', roles: ['sales_person'],
    sales_role: 'executive',
    designation: '', phone: '', calling_number: '',
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
      roles: (Array.isArray(u.roles) && u.roles.length) ? u.roles : [u.role || 'sales_person'],
      sales_role: u.sales_role || 'executive',
      designation: u.designation || '', phone: u.phone || '',
      calling_number: u.calling_number || '',
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

  // Toggle one role on/off. Admin is exclusive.
  const handleRolesChange = (role) => {
    setForm(prev => {
      const cur = prev.roles || [];
      let next;
      if (role === 'admin') {
        next = cur.includes('admin') ? [] : ['admin'];
      } else {
        next = cur.includes(role) ? cur.filter(r => r !== role) : [...cur.filter(r => r !== 'admin'), role];
      }
      if (!next.length) next = ['sales_person'];
      const primary = PRIMARY_ROLE_ORDER.find(r => next.includes(r));
      return { ...prev, roles: next, role: primary };
    });
  };

  // Pull the merged presets for every ticked role from the backend and overwrite the matrix.
  const applyRolePresets = async () => {
    const roles = form.roles || [];
    if (roles.includes('admin')) {
      setForm(prev => ({ ...prev, module_permissions: {}, assigned_modules: [] }));
      return;
    }
    try {
      const res = await rolePresets.get(roles);
      const merged = res.data?.module_permissions || {};
      setForm(prev => ({
        ...prev,
        module_permissions: merged,
        assigned_modules: Object.entries(merged).filter(([, p]) => p.level !== 'none').map(([m]) => m),
      }));
      toast.success('Role presets applied');
    } catch {
      toast.error('Could not load role presets');
    }
  };

  const handleSave = async () => {
    try {
      if (editUser) {
        const payload = {
          name: form.name, role: form.role, roles: form.roles, designation: form.designation,
          phone: form.phone, calling_number: form.calling_number,
          assigned_modules: form.assigned_modules,
          module_permissions: form.module_permissions,
          ...((form.roles || []).includes('sales_person') ? { sales_role: form.sales_role } : {}),
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

  const rolesOfUser = (u) => (Array.isArray(u.roles) && u.roles.length ? u.roles : [u.role]);

  const filteredUsers = roleFilter === 'all'
    ? users
    : users.filter(u => rolesOfUser(u).includes(roleFilter));

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
    handleRolesChange,
    applyRolePresets,
    handleSave, handleDelete,
    handleToggleActive,
  };
}

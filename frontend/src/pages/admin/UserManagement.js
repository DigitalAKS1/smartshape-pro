import React from 'react';
import AdminLayout from '../../components/layouts/AdminLayout';
import { exportData } from '../../lib/api';
import { Button } from '../../components/ui/button';
import { Switch } from '../../components/ui/switch';
import { toast } from 'sonner';
import { UserPlus, Edit2, Trash2, Download } from 'lucide-react';
import { SALES_ROLES } from '../../lib/salesPermissions';
import { useUserManagement } from '../../hooks/useUserManagement';
import { UserFormDialog } from '../../components/admin/UserFormDialog';

const ROLE_META = {
  admin:        { label: 'Admin',    cls: 'bg-[#e94560]/20 text-[#e94560] border-[#e94560]/30' },
  accounts:     { label: 'Accounts', cls: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' },
  store:        { label: 'Store',    cls: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
  sales_person: { label: 'Sales',    cls: 'bg-purple-500/20 text-purple-400 border-purple-500/30' },
};

export default function UserManagement() {
  const {
    users, filteredUsers, allModules, allDesignations,
    loading, roleFilter, setRoleFilter,
    dialogOpen, setDialogOpen,
    editUser, form, setForm,
    showPassword, setShowPassword,
    openCreate, openEdit,
    handleDesignationChange,
    handlePermissionsChange,
    handleSave, handleDelete,
    handleToggleActive,
  } = useUserManagement();

  const card      = 'bg-[var(--bg-card)] border-[var(--border-color)]';
  const textPri   = 'text-[var(--text-primary)]';
  const textSec   = 'text-[var(--text-secondary)]';
  const textMuted = 'text-[var(--text-muted)]';

  const getLevelBadge = (u) => {
    if (u.role === 'admin') return (
      <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#e94560]/20 text-[#e94560] border border-[#e94560]/30 font-medium">Admin</span>
    );
    const perms = u.module_permissions || {};
    const withDelete   = Object.values(perms).filter(p => p.level === 'read_write_delete').length;
    const withWrite    = Object.values(perms).filter(p => p.level === 'read_write').length;
    const withDownload = Object.values(perms).filter(p => p.can_download).length;
    return (
      <div className="flex flex-wrap gap-1">
        {withDelete   > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/15 text-green-400 border border-green-500/30">{withDelete} Full</span>}
        {withWrite    > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-500/15 text-yellow-400 border border-yellow-500/30">{withWrite} R+W</span>}
        {withDownload > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-400 border border-blue-500/30">{withDownload} DL</span>}
        {withDelete === 0 && withWrite === 0 && (
          <span className={`text-[10px] ${textMuted}`}>{(u.assigned_modules || []).length} modules</span>
        )}
      </div>
    );
  };

  if (loading) return (
    <AdminLayout>
      <div className="flex items-center justify-center h-96">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-[#e94560] border-t-transparent" />
      </div>
    </AdminLayout>
  );

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

        {/* Role filter pills */}
        <div className="flex items-center gap-2 flex-wrap">
          {[
            { id: 'all',          label: `All (${users.length})` },
            { id: 'admin',        label: `Admin (${users.filter(u => u.role === 'admin').length})` },
            { id: 'accounts',     label: `Accounts (${users.filter(u => u.role === 'accounts').length})` },
            { id: 'store',        label: `Store (${users.filter(u => u.role === 'store').length})` },
            { id: 'sales_person', label: `Sales (${users.filter(u => u.role === 'sales_person').length})` },
          ].map(f => (
            <button key={f.id} onClick={() => setRoleFilter(f.id)}
              className={`text-xs px-3 py-1.5 rounded-full font-medium border transition-all ${
                roleFilter === f.id ? 'bg-[#e94560] text-white border-[#e94560]' : `${card} border ${textMuted} hover:border-[#e94560]/40`
              }`}>
              {f.label}
            </button>
          ))}
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
                {filteredUsers.map(u => (
                  <tr key={u.user_id} className="border-b border-[var(--border-color)] hover:bg-[var(--bg-hover)] transition-colors">
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
                      <div className="flex flex-wrap items-center gap-1">
                        {u.designation && (
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium border border-[var(--border-color)] bg-[var(--bg-hover)] ${textSec}`}>
                            {allDesignations.find(d => d.code === u.designation)?.name || u.designation}
                          </span>
                        )}
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium border ${(ROLE_META[u.role] || ROLE_META.sales_person).cls}`}>
                          {(ROLE_META[u.role] || ROLE_META.sales_person).label}
                        </span>
                        {u.role === 'sales_person' && u.sales_role && (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold border ${SALES_ROLES[u.sales_role]?.cls || 'bg-gray-500/20 text-gray-400 border-gray-500/30'}`}>
                            {SALES_ROLES[u.sales_role]?.label || u.sales_role}
                          </span>
                        )}
                      </div>
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

        <UserFormDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          editUser={editUser}
          form={form}
          setForm={setForm}
          showPassword={showPassword}
          setShowPassword={setShowPassword}
          allModules={allModules}
          allDesignations={allDesignations}
          handleDesignationChange={handleDesignationChange}
          handlePermissionsChange={handlePermissionsChange}
          handleSave={handleSave}
        />
      </div>
    </AdminLayout>
  );
}

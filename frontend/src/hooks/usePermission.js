import { useAuth } from '../contexts/AuthContext';

/**
 * Returns the logical team for the current user.
 *   'admin'    – full access to everything
 *   'accounts' – all quotations/orders/payments; no CRM
 *   'store'    – all orders/dispatches/inventory; no CRM
 *   'sales'    – own data only
 */
export function useTeam() {
  const { user } = useAuth();
  if (!user) return 'guest';
  const role = user.role;
  if (role === 'admin') return 'admin';
  if (role === 'accounts') return 'accounts';
  if (role === 'store') return 'store';
  return 'sales';
}

/**
 * Returns permission flags for a given module.
 * Permission level is derived first from team/role, then from explicit module_permissions.
 */
export function usePermission(module) {
  const { user } = useAuth();
  const team = useTeam();

  if (!user) return { canView: false, canWrite: false, canDelete: false, canDownload: false };
  if (team === 'admin') return { canView: true, canWrite: true, canDelete: true, canDownload: true };

  // ── Accounts team ──
  if (team === 'accounts') {
    const accountsWrite = ['quotations', 'accounts', 'payroll'];
    const accountsRead  = ['dashboard', 'analytics', 'leave_management'];
    if (accountsWrite.includes(module))
      return { canView: true, canWrite: true, canDelete: false, canDownload: true };
    if (accountsRead.includes(module))
      return { canView: true, canWrite: false, canDelete: false, canDownload: false };
    return { canView: false, canWrite: false, canDelete: false, canDownload: false };
  }

  // ── Store team ──
  if (team === 'store') {
    const storeManage = ['inventory', 'stock_management', 'purchase_alerts', 'physical_count', 'store', 'package_master'];
    const storeRead   = ['quotations', 'dashboard', 'leave_management'];
    if (storeManage.includes(module))
      return { canView: true, canWrite: true, canDelete: false, canDownload: true };
    if (storeRead.includes(module))
      return { canView: true, canWrite: false, canDelete: false, canDownload: false };
    return { canView: false, canWrite: false, canDelete: false, canDownload: false };
  }

  // ── Sales team — read from explicit module_permissions ──
  const modulePerms = user.module_permissions?.[module];
  const isAssigned  = (user.assigned_modules || []).includes(module);

  if (!isAssigned && !modulePerms)
    return { canView: false, canWrite: false, canDelete: false, canDownload: false };

  const level = modulePerms?.level || (isAssigned ? 'read_write' : 'none');
  return {
    canView:     level !== 'none',
    canWrite:    level === 'read_write' || level === 'read_write_delete',
    canDelete:   level === 'read_write_delete',
    canDownload: modulePerms?.can_download === true,
  };
}

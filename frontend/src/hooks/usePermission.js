import { useAuth } from '../contexts/AuthContext';

// The single owner account allowed to perform irreversible deletes (orders, and
// cascade-deleting a school/contact with all related data). Must match the backend
// SUPERADMIN_EMAIL in rbac.py. The backend is the real gate; this only hides UI.
export const OWNER_EMAIL = 'info@smartshape.in';

/**
 * True only for the owner account (info@smartshape.in). Use to show owner-only
 * destructive actions. Server-side require_superadmin still enforces the rule.
 */
export function useIsOwner() {
  const { user } = useAuth();
  return (user?.email || '').trim().toLowerCase() === OWNER_EMAIL;
}

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

const NONE = { canView: false, canWrite: false, canDelete: false, canDownload: false };

/**
 * Returns permission flags for a given module.
 *
 * Capability is the UNION of:
 *   1) the user's explicit per-module grant (module_permissions) — the source of
 *      truth going forward, mirroring the backend `require_module` gate; and
 *   2) legacy role defaults (kept additively so nothing a team sees today
 *      disappears during rollout).
 *
 * This lets an admin grant any user any module (e.g. accounts → procurement) and
 * have the UI surface it, while existing role-based menus keep working.
 */
export function usePermission(module) {
  const { user } = useAuth();
  const team = useTeam();

  if (!user) return NONE;
  if (team === 'admin') return { canView: true, canWrite: true, canDelete: true, canDownload: true };

  // 1) Explicit module grant (works for every non-admin team)
  const modulePerms = user.module_permissions?.[module];
  const isAssigned  = (user.assigned_modules || []).includes(module);
  const level = modulePerms?.level || (isAssigned ? 'read_write' : 'none');
  const grant = {
    canView:     level !== 'none',
    canWrite:    level === 'read_write' || level === 'read_write_delete',
    canDelete:   level === 'read_write_delete',
    canDownload: modulePerms?.can_download === true,
  };

  // 2) Legacy role defaults (additive — never removes existing access)
  let roleDefault = NONE;
  if (team === 'accounts') {
    const accountsWrite = ['quotations', 'accounts', 'payroll'];
    const accountsRead  = ['dashboard', 'analytics', 'leave_management'];
    if (accountsWrite.includes(module))
      roleDefault = { canView: true, canWrite: true, canDelete: false, canDownload: true };
    else if (accountsRead.includes(module))
      roleDefault = { canView: true, canWrite: false, canDelete: false, canDownload: false };
  } else if (team === 'store') {
    const storeManage = ['inventory', 'stock_management', 'purchase_alerts', 'physical_count', 'store', 'package_master'];
    const storeRead   = ['quotations', 'dashboard', 'leave_management'];
    if (storeManage.includes(module))
      roleDefault = { canView: true, canWrite: true, canDelete: false, canDownload: true };
    else if (storeRead.includes(module))
      roleDefault = { canView: true, canWrite: false, canDelete: false, canDownload: false };
  }

  return {
    canView:     grant.canView     || roleDefault.canView,
    canWrite:    grant.canWrite    || roleDefault.canWrite,
    canDelete:   grant.canDelete   || roleDefault.canDelete,
    canDownload: grant.canDownload || roleDefault.canDownload,
  };
}

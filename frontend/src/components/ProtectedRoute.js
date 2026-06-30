import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

const ROUTE_MODULE_MAP = {
  '/dashboard': 'dashboard',
  '/create-quotation': 'quotations',
  '/quotations': 'quotations',
  '/view-quotation': 'quotations',
  '/edit-quotation': 'quotations',
  '/inventory': 'inventory',
  '/purchase-alerts': 'purchase_alerts',
  '/package-master': 'package_master',
  '/stock-management': 'stock_management',
  '/physical-count': 'physical_count',
  '/analytics': 'analytics',
  '/conversion': 'analytics',
  '/payroll': 'payroll',
  '/accounts': 'accounts',
  '/hr': 'hr',
  // '/leave-management' is NOT here — it's universal (any authenticated user)
  '/store': 'store',
  '/field-sales': 'field_sales',
  '/visit-planning': 'field_sales',
  '/visit-calendar': 'field_sales',
  '/leads': 'leads',
  '/crm-masters': 'leads',
  '/dispatch-tracking': 'leads',
  '/customer-engagement': 'leads',
  '/marketing': 'leads',
  '/school-profile': 'leads',
  '/orders': 'quotations',
  '/procurement': 'procurement',
  '/procurement-masters': 'procurement',
  '/settings': 'settings',
  '/app-settings': 'settings',
  '/import-center': 'settings',
  '/master-fields': 'settings',
  '/activity-logs': 'settings',
  '/user-management': 'user_management',
  '/module-master': 'user_management',
  '/sales': 'sales_portal',
  '/sales/leads': 'sales_portal',
  '/sales/attendance': 'sales_portal',
  '/sales/visits': 'sales_portal',
  '/sales/quotations': 'sales_portal',
  '/sales/expenses': 'sales_portal',
  // '/today' is NOT here — Today's Actions is universal (any authenticated user),
  // like '/leave-management'. The company '/dashboard' stays gated on 'dashboard'.
  '/admin-control': 'analytics',
  '/delegation': 'delegation',
};

export default function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0a12] flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-[#e94560] border-t-transparent"></div>
          <p className="mt-4 text-[#a0a0b0]">Loading...</p>
        </div>
      </div>
    );
  }

  if (location.state?.user) return children;
  if (!user) return <Navigate to="/login" replace />;

  // Module-based access check
  const userModules = user.assigned_modules || [];
  const isAdmin = user.role === 'admin';
  // Match exact or prefix (for dynamic routes like /view-quotation/:id, /edit-quotation/:id)
  let requiredModule = ROUTE_MODULE_MAP[location.pathname];
  if (!requiredModule) {
    const prefix = Object.keys(ROUTE_MODULE_MAP).find(k => location.pathname.startsWith(k + '/') || location.pathname.startsWith(k));
    if (prefix) requiredModule = ROUTE_MODULE_MAP[prefix];
  }

  // Safe rollout: a user with NO modules assigned yet is treated as legacy
  // (full access) rather than locked out. Per-module gating only applies once an
  // admin has granted at least one module; admins always bypass. This prevents
  // the production "No Access" lockout when module grants aren't populated yet.
  if (requiredModule && !isAdmin && userModules.length > 0 && !userModules.includes(requiredModule)) {
    // User HAS some modules but not this one — send them to one they can use.
    if (userModules.includes('sales_portal')) return <Navigate to="/sales" replace />;
    if (userModules.includes('dashboard')) return <Navigate to="/dashboard" replace />;
    const firstMod = userModules[0];
    const fallback = Object.entries(ROUTE_MODULE_MAP).find(([, mod]) => mod === firstMod);
    if (fallback) return <Navigate to={fallback[0]} replace />;
  }

  return children;
}
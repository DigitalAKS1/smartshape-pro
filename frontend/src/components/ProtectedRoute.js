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
  '/leads': 'leads',
  '/settings': 'settings',
  '/user-management': 'user_management',
  '/module-master': 'user_management',
  '/sales': 'sales_portal',
  '/sales/attendance': 'sales_portal',
  '/sales/visits': 'sales_portal',
  '/sales/quotations': 'sales_portal',
  '/sales/expenses': 'sales_portal',
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

  if (requiredModule && !isAdmin && !userModules.includes(requiredModule)) {
    // Redirect to first accessible route
    if (userModules.includes('sales_portal')) return <Navigate to="/sales" replace />;
    if (userModules.includes('dashboard')) return <Navigate to="/dashboard" replace />;
    const firstMod = userModules[0];
    const fallback = Object.entries(ROUTE_MODULE_MAP).find(([, mod]) => mod === firstMod);
    if (fallback) return <Navigate to={fallback[0]} replace />;
    // User has no modules — show access denied instead of redirect loop
    return (
      <div className="min-h-screen bg-[#0a0a12] flex items-center justify-center">
        <div className="text-center max-w-md space-y-4">
          <div className="w-16 h-16 mx-auto rounded-full bg-[#e94560]/20 flex items-center justify-center">
            <svg className="w-8 h-8 text-[#e94560]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m0 0v2m0-2h2m-2 0H10m4-6a4 4 0 11-8 0 4 4 0 018 0z" /></svg>
          </div>
          <h2 className="text-2xl font-semibold text-white">No Access</h2>
          <p className="text-[#a0a0b0]">Your account doesn't have any modules assigned yet. Please contact your administrator to get access.</p>
        </div>
      </div>
    );
  }

  return children;
}
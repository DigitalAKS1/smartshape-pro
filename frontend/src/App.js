import React from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { Toaster } from './components/ui/sonner';
import ProtectedRoute from './components/ProtectedRoute';
import OfflineBanner from './components/OfflineBanner';

// Auth pages
import Login from './pages/Login';
import Register from './pages/Register';
import AuthCallback from './pages/AuthCallback';

// Admin pages
import Dashboard from './pages/admin/Dashboard';
import CreateQuotation from './pages/admin/CreateQuotation';
import Quotations from './pages/admin/Quotations';
import Inventory from './pages/admin/Inventory';
import PurchaseAlerts from './pages/admin/PurchaseAlerts';
import PackageMaster from './pages/admin/PackageMaster';
import StockManagement from './pages/admin/StockManagement';
import PhysicalCount from './pages/admin/PhysicalCount';
import Analytics from './pages/admin/Analytics';
import Payroll from './pages/admin/Payroll';
import Settings from './pages/admin/Settings';
import UserManagement from './pages/admin/UserManagement';
import ModuleMaster from './pages/admin/ModuleMaster';
import CRMMasters from './pages/admin/CRMMasters';
import AdminControl from './pages/admin/AdminControl';
import TodayDashboard from './pages/TodayDashboard';
import Accounts from './pages/admin/Accounts';
import HR from './pages/admin/HR';
import Store from './pages/admin/Store';
import FieldSales from './pages/admin/FieldSales';
import LeadsCRM from './pages/admin/LeadsCRM';
import EditQuotation from './pages/admin/EditQuotation';
import ConversionTracking from './pages/admin/ConversionTracking';
import ViewQuotation from './pages/admin/ViewQuotation';
import LeaveManagement from './pages/admin/LeaveManagement';
import VisitPlanning from './pages/admin/VisitPlanning';
import VisitCalendar from './pages/admin/VisitCalendar';
import OrdersManagement from './pages/admin/OrdersManagement';
import AppSettings from './pages/admin/AppSettings';
import ImportCenter from './pages/admin/ImportCenter';
import ActivityLogsPage from './pages/admin/ActivityLogs';

// Sales pages
import SalesHome from './pages/sales/SalesHome';
import SalesAttendance from './pages/sales/SalesAttendance';
import SalesVisits from './pages/sales/SalesVisits';
import SalesQuotations from './pages/sales/SalesQuotations';
import SalesExpenses from './pages/sales/SalesExpenses';

// Public page
import CataloguePage from './pages/CataloguePage';

// School Portal
import SchoolLogin from './pages/SchoolLogin';
import SchoolDashboard from './pages/school/SchoolDashboard';

import { ThemeProvider } from './contexts/ThemeContext';

import './App.css';

function SmartRedirect() {
  const { user } = useAuth();
  const userModules = user?.assigned_modules || [];
  const isAdmin = user?.role === 'admin';
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;

  // Mobile → land on Today's Actions dashboard
  if (isMobile) {
    return <Navigate to="/today" replace />;
  }

  if (isAdmin || userModules.includes('dashboard')) {
    return <Navigate to="/dashboard" replace />;
  }
  if (userModules.includes('quotations')) {
    return <Navigate to="/create-quotation" replace />;
  }
  if (userModules.includes('leads')) {
    return <Navigate to="/leads" replace />;
  }
  if (userModules.includes('inventory')) {
    return <Navigate to="/inventory" replace />;
  }
  if (userModules.includes('sales_portal')) {
    return <Navigate to="/sales" replace />;
  }
  // Find any assigned module's route
  const ROUTE_FOR_MODULE = {
    dashboard: '/dashboard', quotations: '/quotations', inventory: '/inventory',
    stock_management: '/stock-management', purchase_alerts: '/purchase-alerts',
    package_master: '/package-master', physical_count: '/physical-count',
    analytics: '/analytics', payroll: '/payroll', accounts: '/accounts',
    hr: '/hr', store: '/store', field_sales: '/field-sales', leads: '/leads', settings: '/settings',
    user_management: '/user-management', sales_portal: '/sales',
  };
  for (const mod of userModules) {
    if (ROUTE_FOR_MODULE[mod]) return <Navigate to={ROUTE_FOR_MODULE[mod]} replace />;
  }
  // No modules at all — show dashboard which will show "No Access" via ProtectedRoute
  return <Navigate to="/dashboard" replace />;
}

function AppRouter() {
  const location = useLocation();
  
  // Synchronously check for session_id in URL fragment to process Google OAuth
  if (location.hash?.includes('session_id=')) {
    return <AuthCallback />;
  }

  return (
    <Routes>
      {/* Public Routes */}
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/catalogue/:token" element={<CataloguePage />} />
      <Route path="/school/login" element={<SchoolLogin />} />
      <Route path="/school" element={<SchoolDashboard />} />
      
      {/* Protected Routes - Admin */}
      <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
      <Route path="/today" element={<ProtectedRoute><TodayDashboard /></ProtectedRoute>} />
      <Route path="/create-quotation" element={<ProtectedRoute><CreateQuotation /></ProtectedRoute>} />
      <Route path="/quotations" element={<ProtectedRoute><Quotations /></ProtectedRoute>} />
      <Route path="/inventory" element={<ProtectedRoute><Inventory /></ProtectedRoute>} />
      <Route path="/purchase-alerts" element={<ProtectedRoute><PurchaseAlerts /></ProtectedRoute>} />
      <Route path="/package-master" element={<ProtectedRoute><PackageMaster /></ProtectedRoute>} />
      <Route path="/stock-management" element={<ProtectedRoute><StockManagement /></ProtectedRoute>} />
      <Route path="/physical-count" element={<ProtectedRoute><PhysicalCount /></ProtectedRoute>} />
      <Route path="/analytics" element={<ProtectedRoute><Analytics /></ProtectedRoute>} />
      <Route path="/payroll" element={<ProtectedRoute><Payroll /></ProtectedRoute>} />
      <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
      <Route path="/user-management" element={<ProtectedRoute><UserManagement /></ProtectedRoute>} />
      <Route path="/module-master" element={<ProtectedRoute><ModuleMaster /></ProtectedRoute>} />
      <Route path="/crm-masters" element={<ProtectedRoute><CRMMasters /></ProtectedRoute>} />
      <Route path="/admin-control" element={<ProtectedRoute><AdminControl /></ProtectedRoute>} />
      <Route path="/accounts" element={<ProtectedRoute><Accounts /></ProtectedRoute>} />
      <Route path="/hr" element={<ProtectedRoute><HR /></ProtectedRoute>} />
      <Route path="/store" element={<ProtectedRoute><Store /></ProtectedRoute>} />
      <Route path="/field-sales" element={<ProtectedRoute><FieldSales /></ProtectedRoute>} />
      <Route path="/leads" element={<ProtectedRoute><LeadsCRM /></ProtectedRoute>} />
      <Route path="/edit-quotation/:id" element={<ProtectedRoute><EditQuotation /></ProtectedRoute>} />
      <Route path="/conversion" element={<ProtectedRoute><ConversionTracking /></ProtectedRoute>} />
      <Route path="/view-quotation/:id" element={<ProtectedRoute><ViewQuotation /></ProtectedRoute>} />
      <Route path="/leave-management" element={<ProtectedRoute><LeaveManagement /></ProtectedRoute>} />
      <Route path="/visit-planning" element={<ProtectedRoute><VisitPlanning /></ProtectedRoute>} />
      <Route path="/visit-calendar" element={<ProtectedRoute><VisitCalendar /></ProtectedRoute>} />
      <Route path="/orders" element={<ProtectedRoute><OrdersManagement /></ProtectedRoute>} />
      <Route path="/app-settings" element={<ProtectedRoute><AppSettings /></ProtectedRoute>} />
      <Route path="/import-center" element={<ProtectedRoute><ImportCenter /></ProtectedRoute>} />
      <Route path="/activity-logs" element={<ProtectedRoute><ActivityLogsPage /></ProtectedRoute>} />
      
      {/* Protected Routes - Sales */}
      <Route path="/sales" element={<ProtectedRoute><SalesHome /></ProtectedRoute>} />
      <Route path="/sales/attendance" element={<ProtectedRoute><SalesAttendance /></ProtectedRoute>} />
      <Route path="/sales/visits" element={<ProtectedRoute><SalesVisits /></ProtectedRoute>} />
      <Route path="/sales/quotations" element={<ProtectedRoute><SalesQuotations /></ProtectedRoute>} />
      <Route path="/sales/expenses" element={<ProtectedRoute><SalesExpenses /></ProtectedRoute>} />
      
      {/* Default redirect */}
      <Route path="/" element={<ProtectedRoute><SmartRedirect /></ProtectedRoute>} />
      <Route path="*" element={<ProtectedRoute><SmartRedirect /></ProtectedRoute>} />
    </Routes>
  );
}

function App() {
  return (
    <ThemeProvider>
      <div className="App">
        <BrowserRouter>
          <AuthProvider>
            <AppRouter />
            <OfflineBanner />
            <Toaster position="top-right" />
          </AuthProvider>
        </BrowserRouter>
      </div>
    </ThemeProvider>
  );
}

export default App;

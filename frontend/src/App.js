import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { Toaster } from './components/ui/sonner';
import ProtectedRoute from './components/ProtectedRoute';
import OfflineBanner from './components/OfflineBanner';
import { ThemeProvider } from './contexts/ThemeContext';
import GeofenceGuard from './components/GeofenceGuard';
import './App.css';

// Auth pages — kept eager (first paint, tiny, avoid spinner flash on login/OAuth)
import Login from './pages/Login';
import Register from './pages/Register';
import AuthCallback from './pages/AuthCallback';

// Every other page is code-split via React.lazy so the initial bundle stays
// small and each screen loads its own chunk on demand.
// Admin pages
const Dashboard = lazy(() => import('./pages/admin/Dashboard'));
const CreateQuotation = lazy(() => import('./pages/admin/CreateQuotation'));
const Quotations = lazy(() => import('./pages/admin/Quotations'));
const Inventory = lazy(() => import('./pages/admin/Inventory'));
const ProductTypes = lazy(() => import('./pages/admin/ProductTypes'));
const PurchaseAlerts = lazy(() => import('./pages/admin/PurchaseAlerts'));
const PackageMaster = lazy(() => import('./pages/admin/PackageMaster'));
const StockManagement = lazy(() => import('./pages/admin/StockManagement'));
const PhysicalCount = lazy(() => import('./pages/admin/PhysicalCount'));
const Analytics = lazy(() => import('./pages/admin/Analytics'));
const Payroll = lazy(() => import('./pages/admin/Payroll'));
const UserManagement = lazy(() => import('./pages/admin/UserManagement'));
const ModuleMaster = lazy(() => import('./pages/admin/ModuleMaster'));
const CRMMasters = lazy(() => import('./pages/admin/CRMMasters'));
const ProcurementMasters = lazy(() => import('./pages/admin/ProcurementMasters'));
const Procurement = lazy(() => import('./pages/admin/Procurement'));
const ReturnableChallans = lazy(() => import('./pages/admin/ReturnableChallans'));
const AdminControl = lazy(() => import('./pages/admin/AdminControl'));
const TodayDashboard = lazy(() => import('./pages/TodayDashboard'));
const Accounts = lazy(() => import('./pages/admin/Accounts'));
const HR = lazy(() => import('./pages/admin/HR'));
const Store = lazy(() => import('./pages/admin/Store'));
const FieldSales = lazy(() => import('./pages/admin/FieldSales'));
const LeadsCRM = lazy(() => import('./pages/admin/LeadsCRM'));
const EditQuotation = lazy(() => import('./pages/admin/EditQuotation'));
const ConversionTracking = lazy(() => import('./pages/admin/ConversionTracking'));
const ViewQuotation = lazy(() => import('./pages/admin/ViewQuotation'));
const CustomerEngagement = lazy(() => import('./pages/admin/CustomerEngagement'));
const LeaveManagement = lazy(() => import('./pages/admin/LeaveManagement'));
const VisitPlanning = lazy(() => import('./pages/admin/VisitPlanning'));
const VisitCalendar = lazy(() => import('./pages/admin/VisitCalendar'));
const OrdersManagement = lazy(() => import('./pages/admin/OrdersManagement'));
const AppSettings = lazy(() => import('./pages/admin/AppSettings'));
const ImportCenter = lazy(() => import('./pages/admin/ImportCenter'));
const ActivityLogsPage = lazy(() => import('./pages/admin/ActivityLogs'));
const DispatchTracking = lazy(() => import('./pages/admin/DispatchTracking'));
const SchoolProfile = lazy(() => import('./pages/admin/SchoolProfile'));
const MarketingHub = lazy(() => import('./pages/admin/MarketingHub'));
const DelegationApp = lazy(() => import('./pages/admin/DelegationApp'));
const FlowManagement = lazy(() => import('./pages/admin/FlowManagement'));
const Certificates = lazy(() => import('./pages/admin/Certificates'));

// Sales pages
const SalesHome = lazy(() => import('./pages/sales/SalesHome'));
const SalesLeads = lazy(() => import('./pages/sales/SalesLeads'));
const SalesAttendance = lazy(() => import('./pages/sales/SalesAttendance'));
const SalesVisits = lazy(() => import('./pages/sales/SalesVisits'));
const SalesQuotations = lazy(() => import('./pages/sales/SalesQuotations'));
const SalesExpenses = lazy(() => import('./pages/sales/SalesExpenses'));

// Error pages
const NotFound = lazy(() => import('./pages/NotFound'));

// Public page
const CataloguePage = lazy(() => import('./pages/CataloguePage'));
const CustomerPortal = lazy(() => import('./pages/CustomerPortal'));
const CustomerLogin = lazy(() => import('./pages/CustomerLogin'));
const GetApp = lazy(() => import('./pages/GetApp'));
const ZoomJoin = lazy(() => import('./pages/ZoomJoin'));

// School Portal
const SchoolLogin = lazy(() => import('./pages/SchoolLogin'));
const SchoolActivate = lazy(() => import('./pages/SchoolActivate'));
const Privacy = lazy(() => import('./pages/Privacy'));
const Terms = lazy(() => import('./pages/Terms'));
const SchoolDashboard = lazy(() => import('./pages/school/SchoolDashboard'));
// Teacher Portal
const TeacherLogin = lazy(() => import('./pages/TeacherLogin'));
const TeacherActivate = lazy(() => import('./pages/TeacherActivate'));
const TeacherDashboard = lazy(() => import('./pages/teacher/TeacherDashboard'));
const ContentReview = lazy(() => import('./pages/admin/ContentReview'));
const CompetitionsAdmin = lazy(() => import('./pages/admin/CompetitionsAdmin'));
const PortalInbox = lazy(() => import('./pages/admin/PortalInbox'));
const MeetingsAdmin = lazy(() => import('./pages/admin/MeetingsAdmin'));

// Lightweight fallback shown while a route chunk loads.
function RouteFallback() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
      <div className="animate-spin rounded-full h-8 w-8 border-2 border-gray-300 border-t-gray-600" />
    </div>
  );
}

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
  if (userModules.includes('payroll') || userModules.includes('hr') || userModules.includes('accounts')) {
    const dest = userModules.includes('accounts') ? '/accounts' : userModules.includes('payroll') ? '/payroll' : '/hr';
    return <Navigate to={dest} replace />;
  }
  if (userModules.includes('leave_management')) {
    return <Navigate to="/leave-management" replace />;
  }
  // Find any assigned module's route
  const ROUTE_FOR_MODULE = {
    dashboard: '/dashboard', quotations: '/quotations', inventory: '/inventory',
    stock_management: '/stock-management', purchase_alerts: '/purchase-alerts',
    package_master: '/package-master', physical_count: '/physical-count',
    analytics: '/analytics', payroll: '/payroll', accounts: '/accounts',
    hr: '/hr', store: '/store', leave_management: '/leave-management',
    field_sales: '/field-sales', leads: '/leads', settings: '/settings',
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
    <>
      <GeofenceGuard />
      <Suspense fallback={<RouteFallback />}>
      <Routes>
      {/* Public Routes */}
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/catalogue/:token" element={<CataloguePage />} />
      <Route path="/my-quote/:token" element={<CustomerPortal />} />
      <Route path="/customer-login" element={<CustomerLogin />} />
      <Route path="/school/login" element={<SchoolLogin />} />
      <Route path="/school/activate" element={<SchoolActivate />} />
      <Route path="/school" element={<SchoolDashboard />} />
      <Route path="/teacher/login" element={<TeacherLogin />} />
      <Route path="/teacher/activate" element={<TeacherActivate />} />
      <Route path="/teacher" element={<TeacherDashboard />} />
      <Route path="/portal-inbox" element={<ProtectedRoute><PortalInbox /></ProtectedRoute>} />
      <Route path="/teacher-review" element={<ProtectedRoute><ContentReview /></ProtectedRoute>} />
      <Route path="/competitions-admin" element={<ProtectedRoute><CompetitionsAdmin /></ProtectedRoute>} />
      <Route path="/meetings-admin" element={<ProtectedRoute><MeetingsAdmin /></ProtectedRoute>} />
      <Route path="/get-app" element={<GetApp />} />
      <Route path="/privacy" element={<Privacy />} />
      <Route path="/terms" element={<Terms />} />
      <Route path="/zoom/:eventId" element={<ZoomJoin />} />
      
      {/* Protected Routes - Admin */}
      <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
      <Route path="/today" element={<ProtectedRoute><TodayDashboard /></ProtectedRoute>} />
      <Route path="/create-quotation" element={<ProtectedRoute><CreateQuotation /></ProtectedRoute>} />
      <Route path="/quotations" element={<ProtectedRoute><Quotations /></ProtectedRoute>} />
      <Route path="/inventory" element={<ProtectedRoute><Inventory /></ProtectedRoute>} />
      <Route path="/product-types" element={<ProtectedRoute><ProductTypes /></ProtectedRoute>} />
      <Route path="/purchase-alerts" element={<ProtectedRoute><PurchaseAlerts /></ProtectedRoute>} />
      <Route path="/package-master" element={<ProtectedRoute><PackageMaster /></ProtectedRoute>} />
      <Route path="/stock-management" element={<ProtectedRoute><StockManagement /></ProtectedRoute>} />
      <Route path="/physical-count" element={<ProtectedRoute><PhysicalCount /></ProtectedRoute>} />
      <Route path="/analytics" element={<ProtectedRoute><Analytics /></ProtectedRoute>} />
      <Route path="/payroll" element={<ProtectedRoute><Payroll /></ProtectedRoute>} />
      <Route path="/settings" element={<Navigate to="/app-settings" replace />} />
      <Route path="/user-management" element={<ProtectedRoute><UserManagement /></ProtectedRoute>} />
      <Route path="/module-master" element={<ProtectedRoute><ModuleMaster /></ProtectedRoute>} />
      <Route path="/crm-masters" element={<ProtectedRoute><CRMMasters /></ProtectedRoute>} />
      <Route path="/procurement" element={<ProtectedRoute><Procurement /></ProtectedRoute>} />
      <Route path="/procurement-masters" element={<ProtectedRoute><ProcurementMasters /></ProtectedRoute>} />
      <Route path="/returnable-challans" element={<ProtectedRoute><ReturnableChallans /></ProtectedRoute>} />
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
      <Route path="/dispatch-tracking" element={<ProtectedRoute><DispatchTracking /></ProtectedRoute>} />
      <Route path="/customer-engagement" element={<ProtectedRoute><CustomerEngagement /></ProtectedRoute>} />
      <Route path="/school-profile/:school_id" element={<ProtectedRoute><SchoolProfile /></ProtectedRoute>} />
      <Route path="/marketing" element={<ProtectedRoute><MarketingHub /></ProtectedRoute>} />
      <Route path="/delegation" element={<ProtectedRoute><DelegationApp /></ProtectedRoute>} />
      <Route path="/flow-management" element={<ProtectedRoute><FlowManagement /></ProtectedRoute>} />
      <Route path="/certificates" element={<ProtectedRoute><Certificates /></ProtectedRoute>} />
      
      {/* Protected Routes - Sales */}
      <Route path="/sales" element={<ProtectedRoute><SalesHome /></ProtectedRoute>} />
      <Route path="/sales/leads" element={<ProtectedRoute><SalesLeads /></ProtectedRoute>} />
      <Route path="/sales/attendance" element={<ProtectedRoute><SalesAttendance /></ProtectedRoute>} />
      <Route path="/sales/visits" element={<ProtectedRoute><SalesVisits /></ProtectedRoute>} />
      <Route path="/sales/quotations" element={<ProtectedRoute><SalesQuotations /></ProtectedRoute>} />
      <Route path="/sales/expenses" element={<ProtectedRoute><SalesExpenses /></ProtectedRoute>} />
      
      {/* Default redirect */}
      <Route path="/" element={<ProtectedRoute><SmartRedirect /></ProtectedRoute>} />
      <Route path="*" element={<NotFound />} />
    </Routes>
      </Suspense>
    </>
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

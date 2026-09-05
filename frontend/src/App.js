import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { Toaster } from './components/ui/sonner';
import CallWidget from './components/telephony/CallWidget';
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
//
// Chunk filenames carry a content hash, so a deploy replaces every one of them.
// A tab that was already open — or a browser holding a cached index.html — then
// asks for a chunk that no longer exists on the server, and the route dies with
// "Loading chunk 6082 failed". Nothing is actually wrong with the page: that
// copy of the app is simply out of date. So retry once for a plain network
// blip, and otherwise fetch the app again. The sessionStorage flag makes it a
// single attempt, so a genuinely missing chunk surfaces as an error instead of
// putting the tab in a reload loop.
const CHUNK_RELOAD_FLAG = 'ssp_chunk_reload';

const readFlag = () => { try { return sessionStorage.getItem(CHUNK_RELOAD_FLAG); } catch { return null; } };
const writeFlag = (v) => { try { v ? sessionStorage.setItem(CHUNK_RELOAD_FLAG, v) : sessionStorage.removeItem(CHUNK_RELOAD_FLAG); } catch { /* private mode */ } };

function lazyRoute(load) {
  return lazy(() => load().then(
    (mod) => { writeFlag(null); return mod; },
    (err) => load().catch(() => {
      if (readFlag()) throw err;          // already reloaded once — show the error
      writeFlag('1');
      window.location.reload();
      return new Promise(() => {});       // hold the tree until the reload lands
    }),
  ));
}

// Admin pages
const Dashboard = lazyRoute(() => import('./pages/admin/Dashboard'));
const CreateQuotation = lazyRoute(() => import('./pages/admin/CreateQuotation'));
const Quotations = lazyRoute(() => import('./pages/admin/Quotations'));
const Inventory = lazyRoute(() => import('./pages/admin/Inventory'));
const ProductTypes = lazyRoute(() => import('./pages/admin/ProductTypes'));
const PurchaseAlerts = lazyRoute(() => import('./pages/admin/PurchaseAlerts'));
const PackageMaster = lazyRoute(() => import('./pages/admin/PackageMaster'));
const StockManagement = lazyRoute(() => import('./pages/admin/StockManagement'));
const PhysicalCount = lazyRoute(() => import('./pages/admin/PhysicalCount'));
const Analytics = lazyRoute(() => import('./pages/admin/Analytics'));
const Payroll = lazyRoute(() => import('./pages/admin/Payroll'));
const UserManagement = lazyRoute(() => import('./pages/admin/UserManagement'));
const ModuleMaster = lazyRoute(() => import('./pages/admin/ModuleMaster'));
const CRMMasters = lazyRoute(() => import('./pages/admin/CRMMasters'));
const OfflineMail = lazyRoute(() => import('./pages/admin/OfflineMail'));
const ActivityMonitor = lazyRoute(() => import('./pages/admin/ActivityMonitor'));
const ProcurementMasters = lazyRoute(() => import('./pages/admin/ProcurementMasters'));
const Procurement = lazyRoute(() => import('./pages/admin/Procurement'));
const ReturnableChallans = lazyRoute(() => import('./pages/admin/ReturnableChallans'));
const AdminControl = lazyRoute(() => import('./pages/admin/AdminControl'));
const TodayDashboard = lazyRoute(() => import('./pages/TodayDashboard'));
const Accounts = lazyRoute(() => import('./pages/admin/Accounts'));
const HR = lazyRoute(() => import('./pages/admin/HR'));
const Store = lazyRoute(() => import('./pages/admin/Store'));
const FieldSales = lazyRoute(() => import('./pages/admin/FieldSales'));
const LeadsCRM = lazyRoute(() => import('./pages/admin/LeadsCRM'));
const EditQuotation = lazyRoute(() => import('./pages/admin/EditQuotation'));
const ConversionTracking = lazyRoute(() => import('./pages/admin/ConversionTracking'));
const ViewQuotation = lazyRoute(() => import('./pages/admin/ViewQuotation'));
const CustomerEngagement = lazyRoute(() => import('./pages/admin/CustomerEngagement'));
const LeaveManagement = lazyRoute(() => import('./pages/admin/LeaveManagement'));
const VisitPlanning = lazyRoute(() => import('./pages/admin/VisitPlanning'));
const VisitCalendar = lazyRoute(() => import('./pages/admin/VisitCalendar'));
const OrdersManagement = lazyRoute(() => import('./pages/admin/OrdersManagement'));
const AppSettings = lazyRoute(() => import('./pages/admin/AppSettings'));
const ActivationCenter = lazyRoute(() => import('./pages/admin/ActivationCenter'));
const ImportCenter = lazyRoute(() => import('./pages/admin/ImportCenter'));
const CallsLog = lazyRoute(() => import('./pages/admin/CallsLog'));
const ActivityLogsPage = lazyRoute(() => import('./pages/admin/ActivityLogs'));
const DispatchTracking = lazyRoute(() => import('./pages/admin/DispatchTracking'));
const SchoolProfile = lazyRoute(() => import('./pages/admin/SchoolProfile'));
const ReportsHub = lazyRoute(() => import('./pages/admin/ReportsHub'));
const MarketingHub = lazyRoute(() => import('./pages/admin/MarketingHub'));
const DelegationApp = lazyRoute(() => import('./pages/admin/DelegationApp'));
const FlowManagement = lazyRoute(() => import('./pages/admin/FlowManagement'));
const Certificates = lazyRoute(() => import('./pages/admin/Certificates'));
const MasterFields = lazyRoute(() => import('./pages/admin/MasterFields'));

// Sales pages
const SalesHome = lazyRoute(() => import('./pages/sales/SalesHome'));
const SalesLeads = lazyRoute(() => import('./pages/sales/SalesLeads'));
const SalesAttendance = lazyRoute(() => import('./pages/sales/SalesAttendance'));
const SalesVisits = lazyRoute(() => import('./pages/sales/SalesVisits'));
const SalesQuotations = lazyRoute(() => import('./pages/sales/SalesQuotations'));
const SalesExpenses = lazyRoute(() => import('./pages/sales/SalesExpenses'));

// Error pages
const NotFound = lazyRoute(() => import('./pages/NotFound'));

// Public page
const CataloguePage = lazyRoute(() => import('./pages/CataloguePage'));
const PublicForm = lazyRoute(() => import('./pages/PublicForm'));
const CustomerPortal = lazyRoute(() => import('./pages/CustomerPortal'));
const CustomerLogin = lazyRoute(() => import('./pages/CustomerLogin'));
const GetApp = lazyRoute(() => import('./pages/GetApp'));
const ZoomJoin = lazyRoute(() => import('./pages/ZoomJoin'));

// School Portal
const SchoolLogin = lazyRoute(() => import('./pages/SchoolLogin'));
const SchoolActivate = lazyRoute(() => import('./pages/SchoolActivate'));
const Privacy = lazyRoute(() => import('./pages/Privacy'));
const Terms = lazyRoute(() => import('./pages/Terms'));
const SchoolDashboard = lazyRoute(() => import('./pages/school/SchoolDashboard'));
// Teacher Portal
const TeacherLogin = lazyRoute(() => import('./pages/TeacherLogin'));
const TeacherActivate = lazyRoute(() => import('./pages/TeacherActivate'));
const TeacherDashboard = lazyRoute(() => import('./pages/teacher/TeacherDashboard'));
const ContentReview = lazyRoute(() => import('./pages/admin/ContentReview'));
const CompetitionsAdmin = lazyRoute(() => import('./pages/admin/CompetitionsAdmin'));
const PortalInbox = lazyRoute(() => import('./pages/admin/PortalInbox'));
const MeetingsAdmin = lazyRoute(() => import('./pages/admin/MeetingsAdmin'));
const FormsList = lazyRoute(() => import('./pages/admin/FormsList'));
const FormBuilder = lazyRoute(() => import('./pages/admin/FormBuilder'));
const FormResponses = lazyRoute(() => import('./pages/admin/FormResponses'));

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
  // No modules at all — legacy user, treated as full access (fail-open); land on dashboard.
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
      <Route path="/f/:token" element={<PublicForm />} />
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
      <Route path="/forms" element={<ProtectedRoute><FormsList /></ProtectedRoute>} />
      <Route path="/forms/:formId" element={<ProtectedRoute><FormBuilder /></ProtectedRoute>} />
      <Route path="/forms/:formId/responses" element={<ProtectedRoute><FormResponses /></ProtectedRoute>} />
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
      <Route path="/offline-mail" element={<ProtectedRoute><OfflineMail /></ProtectedRoute>} />
      <Route path="/activity-monitor" element={<ProtectedRoute><ActivityMonitor /></ProtectedRoute>} />
      <Route path="/procurement" element={<ProtectedRoute><Procurement /></ProtectedRoute>} />
      <Route path="/procurement-masters" element={<ProtectedRoute><ProcurementMasters /></ProtectedRoute>} />
      <Route path="/returnable-challans" element={<ProtectedRoute><ReturnableChallans /></ProtectedRoute>} />
      <Route path="/admin-control" element={<ProtectedRoute><AdminControl /></ProtectedRoute>} />
      <Route path="/accounts" element={<ProtectedRoute><Accounts /></ProtectedRoute>} />
      <Route path="/hr" element={<ProtectedRoute><HR /></ProtectedRoute>} />
      <Route path="/store" element={<ProtectedRoute><Store /></ProtectedRoute>} />
      <Route path="/field-sales" element={<ProtectedRoute><FieldSales /></ProtectedRoute>} />
      <Route path="/leads" element={<ProtectedRoute><LeadsCRM /></ProtectedRoute>} />
      <Route path="/calls" element={<ProtectedRoute><CallsLog /></ProtectedRoute>} />
      <Route path="/edit-quotation/:id" element={<ProtectedRoute><EditQuotation /></ProtectedRoute>} />
      <Route path="/conversion" element={<ProtectedRoute><ConversionTracking /></ProtectedRoute>} />
      <Route path="/view-quotation/:id" element={<ProtectedRoute><ViewQuotation /></ProtectedRoute>} />
      <Route path="/leave-management" element={<ProtectedRoute><LeaveManagement /></ProtectedRoute>} />
      <Route path="/visit-planning" element={<ProtectedRoute><VisitPlanning /></ProtectedRoute>} />
      <Route path="/visit-calendar" element={<ProtectedRoute><VisitCalendar /></ProtectedRoute>} />
      <Route path="/orders" element={<ProtectedRoute><OrdersManagement /></ProtectedRoute>} />
      <Route path="/app-settings" element={<ProtectedRoute><AppSettings /></ProtectedRoute>} />
      <Route path="/activation" element={<ProtectedRoute><ActivationCenter /></ProtectedRoute>} />
      <Route path="/import-center" element={<ProtectedRoute><ImportCenter /></ProtectedRoute>} />
      <Route path="/activity-logs" element={<ProtectedRoute><ActivityLogsPage /></ProtectedRoute>} />
      <Route path="/dispatch-tracking" element={<ProtectedRoute><DispatchTracking /></ProtectedRoute>} />
      <Route path="/customer-engagement" element={<ProtectedRoute><CustomerEngagement /></ProtectedRoute>} />
      <Route path="/school-profile/:school_id" element={<ProtectedRoute><SchoolProfile /></ProtectedRoute>} />
      <Route path="/reports" element={<ProtectedRoute><ReportsHub /></ProtectedRoute>} />
      <Route path="/marketing" element={<ProtectedRoute><MarketingHub /></ProtectedRoute>} />
      <Route path="/delegation" element={<ProtectedRoute><DelegationApp /></ProtectedRoute>} />
      <Route path="/flow-management" element={<ProtectedRoute><FlowManagement /></ProtectedRoute>} />
      <Route path="/certificates" element={<ProtectedRoute><Certificates /></ProtectedRoute>} />
      <Route path="/master-fields" element={<ProtectedRoute><MasterFields /></ProtectedRoute>} />
      
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
            <CallWidget />
            <Toaster position="top-right" />
          </AuthProvider>
        </BrowserRouter>
      </div>
    </ThemeProvider>
  );
}

export default App;

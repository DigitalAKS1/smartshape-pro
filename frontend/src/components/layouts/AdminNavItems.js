import {
  LayoutDashboard, FileText, Package, AlertTriangle, Settings, BarChart3,
  Warehouse, ClipboardList, DollarSign, Users,
  Smartphone, Layers, IndianRupee, UserCog, Store, MapPin, Target,
  CalendarDays, Calendar, ShoppingCart, Upload, Activity,
  Home, MoreHorizontal, Zap, Heart, Truck,
} from 'lucide-react';

/**
 * MODULE_ROUTE_MAP — maps module keys to route definitions.
 * Each entry is either a single route object or an array of route objects.
 */
export const MODULE_ROUTE_MAP = {
  dashboard: [
    { path: '/today', icon: Target, label: "Today's Actions" },
    { path: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  ],
  quotations: [
    { path: '/create-quotation', icon: FileText, label: 'Create Quotation' },
    { path: '/quotations', icon: FileText, label: 'Quotations' },
    { path: '/orders', icon: ShoppingCart, label: 'Orders & Holds' },
  ],
  inventory: { path: '/inventory', icon: Package, label: 'Inventory' },
  purchase_alerts: { path: '/purchase-alerts', icon: AlertTriangle, label: 'Purchase Alerts' },
  package_master: { path: '/package-master', icon: Settings, label: 'Package Master' },
  stock_management: { path: '/stock-management', icon: Warehouse, label: 'Stock Management' },
  physical_count: { path: '/physical-count', icon: ClipboardList, label: 'Physical Count' },
  analytics: [
    { path: '/analytics', icon: BarChart3, label: 'Analytics' },
    { path: '/admin-control', icon: Target, label: 'Admin Control' },
    { path: '/conversion', icon: Target, label: 'Conversion Tracking' },
  ],
  payroll: { path: '/payroll', icon: DollarSign, label: 'Payroll' },
  accounts: { path: '/accounts', icon: IndianRupee, label: 'Accounts' },
  hr: { path: '/hr', icon: UserCog, label: 'HR' },
  store: { path: '/store', icon: Store, label: 'Store' },
  field_sales: [
    { path: '/field-sales', icon: MapPin, label: 'Field Sales' },
    { path: '/visit-planning', icon: Calendar, label: 'Visit Planning' },
    { path: '/visit-calendar', icon: CalendarDays, label: 'Visit Calendar' },
  ],
  leads: [
    { path: '/leads', icon: Target, label: 'Leads & CRM' },
    { path: '/crm-masters', icon: Layers, label: 'CRM Masters' },
    { path: '/dispatch-tracking', icon: Package, label: 'Dispatch Tracking' },
    { path: '/customer-engagement', icon: Heart, label: 'Customer Engagement' },
    { path: '/marketing', icon: Zap, label: 'Marketing & WhatsApp' },
  ],
  procurement: [
    { path: '/procurement', icon: ShoppingCart, label: 'Procurement' },
    { path: '/procurement-masters', icon: Truck, label: 'Procurement Masters' },
  ],
  delegation: { path: '/delegation', icon: ClipboardList, label: 'Delegation System' },
  flow_management: { path: '/flow-management', icon: Zap, label: 'Flow Management' },
  sales_portal: { path: '/sales', icon: Smartphone, label: 'Sales Portal' },
  user_management: [
    { path: '/user-management', icon: Users, label: 'User Management' },
    { path: '/module-master', icon: Layers, label: 'Module Master' },
  ],
  settings: [
    { path: '/app-settings', icon: Settings, label: 'App Settings' },
    { path: '/import-center', icon: Upload, label: 'Import Center' },
    { path: '/activity-logs', icon: Activity, label: 'Activity Logs' },
  ],
};

export const SIDEBAR_SECTIONS = [
  { label: null,                modules: ['dashboard'] },
  { label: 'Sales',             modules: ['quotations', 'leads', 'field_sales', 'sales_portal'] },
  { label: 'Store & Inventory', modules: ['inventory', 'stock_management', 'purchase_alerts', 'physical_count', 'package_master', 'store'] },
  { label: 'Procurement',       modules: ['procurement'] },
  { label: 'Finance & HR',      modules: ['accounts', 'payroll', 'hr'] },
  { label: 'Reports',           modules: ['analytics'] },
  { label: 'Delegation',        modules: ['delegation'] },
  { label: 'Flow Management',   modules: ['flow_management'] },
  { label: 'Administration',    modules: ['user_management', 'settings'] },
];

export const TEAM_MODULES = {
  accounts: ['dashboard', 'quotations', 'accounts', 'payroll', 'analytics', 'delegation', 'flow_management'],
  store:    ['dashboard', 'quotations', 'inventory', 'stock_management', 'purchase_alerts', 'physical_count', 'store', 'package_master', 'procurement', 'delegation', 'flow_management'],
  sales:    ['dashboard', 'quotations', 'field_sales', 'sales_portal', 'leads', 'delegation', 'flow_management'],
};

export const BOTTOM_NAV_ITEMS = [
  { path: '/today',       icon: Home,          label: 'Home',   module: 'dashboard',    related: ['/dashboard'] },
  { path: '/leads',       icon: Target,        label: 'CRM',    module: 'leads',        related: ['/school-profile', '/crm-masters', '/dispatch-tracking', '/customer-engagement', '/marketing'] },
  { path: '/field-sales', icon: MapPin,        label: 'Field',  module: 'field_sales',  related: ['/visit-planning', '/visit-calendar'] },
  { path: '/delegation',  icon: ClipboardList, label: 'Tasks',  module: 'delegation',   related: [] },
  { path: '/sales',       icon: Smartphone,    label: 'Sales',  module: 'sales_portal', related: ['/quotations', '/create-quotation', '/view-quotation', '/edit-quotation', '/orders'] },
];

export const MORE_ITEM = { path: '__more__', icon: MoreHorizontal, label: 'More' };

export function getPageTitle(pathname) {
  const allRoutes = Object.values(MODULE_ROUTE_MAP).flat();
  const exact = allRoutes.find(r => r?.path === pathname);
  if (exact) return exact.label;
  if (pathname.startsWith('/school-profile/'))  return 'School Profile';
  if (pathname === '/marketing')                return 'Marketing & WhatsApp';
  if (pathname.startsWith('/view-quotation/'))  return 'View Quotation';
  if (pathname.startsWith('/edit-quotation/'))  return 'Edit Quotation';
  if (pathname.startsWith('/catalogue/'))       return 'Catalogue';
  return 'SmartShape Pro';
}

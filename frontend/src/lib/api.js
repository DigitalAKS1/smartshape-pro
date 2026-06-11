import axios from 'axios';
import { emitChange } from './dataSync';

const API = axios.create({
  baseURL: `${process.env.REACT_APP_BACKEND_URL}/api`,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

// ── Auto-emit domain change after any successful mutation ──────────────────
API.interceptors.response.use((res) => {
  const method = res.config?.method?.toLowerCase();
  if (method && ['post', 'put', 'delete', 'patch'].includes(method)) {
    const url = res.config?.url || '';
    let domain = 'all';
    if (/\/(vendors|vendor-items|purchase-items|purchase-orders|requisitions|goods-receipts|qc-templates|procurement)/.test(url)) domain = 'procurement';
    else if (/\/(dies|packages|stock)/.test(url))  domain = 'inventory';
    else if (/\/delegation/.test(url))             domain = 'delegation';
    else if (/\/(leads|contacts|schools)/.test(url)) domain = 'crm';
    else if (/\/quotations/.test(url))             domain = 'quotations';
    else if (/\/visit-plans/.test(url))            domain = 'visits';
    else if (/\/settings/.test(url))               domain = 'settings';
    else if (/\/(tasks|actions)/.test(url))        domain = 'today';
    else if (/\/certs/.test(url))                  domain = 'certs';
    emitChange(domain);
  }
  return res;
});

// Auto-refresh on 401
let isRefreshing = false;
let failedQueue = [];

const processQueue = (error) => {
  failedQueue.forEach((p) => (error ? p.reject(error) : p.resolve()));
  failedQueue = [];
};

API.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;
    if (error.response?.status === 401 && !original._retry && !original.url?.includes('/auth/')) {
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve: () => resolve(API(original)), reject });
        });
      }
      original._retry = true;
      isRefreshing = true;
      try {
        await API.post('/auth/refresh');
        processQueue(null);
        return API(original);
      } catch (refreshErr) {
        processQueue(refreshErr);
        window.location.href = '/login';
        return Promise.reject(refreshErr);
      } finally {
        isRefreshing = false;
      }
    }
    return Promise.reject(error);
  }
);

export function formatApiErrorDetail(detail) {
  if (detail == null) return 'Something went wrong. Please try again.';
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail))
    return detail
      .map((e) => (e && typeof e.msg === 'string' ? e.msg : JSON.stringify(e)))
      .filter(Boolean)
      .join(' ');
  if (detail && typeof detail.msg === 'string') return detail.msg;
  return String(detail);
}

// Auth
export const auth = {
  register: (data) => API.post('/auth/register', data),
  login: (data) => API.post('/auth/login', data),
  logout: () => API.post('/auth/logout'),
  me: () => API.get('/auth/me'),
  googleSession: (sessionId) => API.post('/auth/google/session', { session_id: sessionId }),
};

// Dies
export const dies = {
  getAll: (includeArchived) => API.get('/dies', { params: includeArchived ? { include_archived: true } : {} }),
  create: (data) => API.post('/dies', data),
  update: (id, data) => API.put(`/dies/${id}`, data),
  archive: (id) => API.put(`/dies/${id}/archive`),
  delete: (id) => API.delete(`/dies/${id}`),
  bulkDelete: (ids) => API.post('/dies/bulk-delete', { die_ids: ids }),
  runLowStockAlert: () => API.post('/low-stock-alert/run'),
  uploadImage: (id, file) => {
    const formData = new FormData();
    formData.append('file', file);
    return API.post(`/dies/${id}/upload-image`, formData, { headers: { 'Content-Type': 'multipart/form-data' } });
  },
  importCsv: (file) => {
    const fd = new FormData();
    fd.append('file', file);
    return API.post('/dies/import', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
  },
};

// Visit Plans
export const visitPlans = {
  getAll: () => API.get('/visit-plans'),
  create: (data) => API.post('/visit-plans', data),
  update: (id, data) => API.put(`/visit-plans/${id}`, data),
  delete: (id) => API.delete(`/visit-plans/${id}`),
  checkIn: (id, data) => API.post(`/visit-plans/${id}/check-in`, data),
  checkOut: (id, data) => API.post(`/visit-plans/${id}/check-out`, data),
  distance: (id, lat, lng) => API.get(`/visit-plans/${id}/distance`, { params: { lat, lng } }),
  reschedule: (id, data) => API.post(`/visit-plans/${id}/reschedule`, data),
  resolveMapsUrl: (url) => API.get('/resolve-maps-url', { params: { url } }),
};

// Office Location & Geofence
export const officeSettings = {
  get: () => API.get('/settings/office-location'),
  save: (data) => API.post('/settings/office-location', data),
};

// Admin field monitoring
export const fieldAdmin = {
  geofenceAlerts: () => API.get('/admin/geofence-alerts'),
  loginLogs: () => API.get('/admin/login-logs'),
};

// Sales targets (monthly quotas)
export const salesTargets = {
  myProgress:  (month_year) => API.get('/sales/targets/progress', { params: { month_year } }),
  getAll:      (month_year) => API.get('/admin/sales-targets', { params: { month_year } }),
  set:         (data)       => API.post('/admin/sales-targets', data),
};

// Auth location update (post-login geo ping)
export const authLocationUpdate = (lat, lng) => API.post('/auth/login-location', { lat, lng });

// Punch Clock
export const punchApi = {
  punch:              (data)   => API.post('/attendance/punch', data),
  todayPunches:       ()       => API.get('/attendance/today-punches'),
  geofenceExit:       (data)   => API.post('/attendance/geofence-exit', data),
  geofenceFieldAlert: (data)   => API.post('/attendance/geofence-field-alert', data),
  punchReport:        (params) => API.get('/admin/punch-report', { params }),
};

export const wfhApi = {
  get: ()     => API.get('/profile/wfh-location'),
  set: (data) => API.put('/profile/wfh-location', data),
};

// Trusted Device Management (admin)
export const deviceApi = {
  list:       (status = 'all', user_email = '') => API.get('/admin/devices', { params: { status, user_email } }),
  approve:    (id) => API.post(`/admin/devices/${id}/approve`),
  revoke:     (id) => API.post(`/admin/devices/${id}/revoke`),
  remove:     (id) => API.delete(`/admin/devices/${id}`),
  getPolicy:  ()   => API.get('/admin/devices/policy'),
  savePolicy: (data) => API.put('/admin/devices/policy', data),
};

// Packages
export const packages = {
  getAll: () => API.get('/packages'),
  create: (data) => API.post('/packages', data),
  update: (id, data) => API.put(`/packages/${id}`, data),
  delete: (id) => API.delete(`/packages/${id}`),
};

// Company Settings
export const companySettings = {
  get: () => API.get('/settings/company'),
  save: (data) => API.post('/settings/company', data),
};

// Sales Persons
export const salesPersons = {
  getAll: () => API.get('/salespersons'),
  create: (data) => API.post('/salespersons', data),
};

// Quotations
export const quotations = {
  getAll: (salesPersonId) => API.get('/quotations', { params: { sales_person_id: salesPersonId } }),
  create: (data) => API.post('/quotations', data),
  update: (id, data) => API.put(`/quotations/${id}`, data),
  delete: (id) => API.delete(`/quotations/${id}`),
  sendCatalogue: (id) => API.post(`/quotations/${id}/send-catalogue`),
  updateStatus: (id, status) => API.put(`/quotations/${id}/status`, null, { params: { status } }),
  newVersion: (id) => API.post(`/quotations/${id}/new-version`),
  getVersions: (id) => API.get(`/quotations/${id}/versions`),
  downloadPdf: (id) => {
    fetch(`${process.env.REACT_APP_BACKEND_URL}/api/quotations/${id}/pdf?t=${Date.now()}`, { credentials: 'include', cache: 'no-store' })
      .then(r => r.blob())
      .then(blob => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `Quotation_${id}.pdf`; document.body.appendChild(a); a.click(); document.body.removeChild(a); });
  },
  backfillLeads: () => API.post('/quotations/backfill-leads'),
};

// Schools
export const schools = {
  getAll: () => API.get('/schools'),
  create: (data) => API.post('/schools', data),
  update: (id, data) => API.put(`/schools/${id}`, data),
  delete: (id) => API.delete(`/schools/${id}`),
  getProfile: (id) => API.get(`/schools/${id}/profile`),
  assign: (id, data) => API.post(`/schools/${id}/assign`, data),
  bulkAssign: (data) => API.post('/schools/bulk-assign', data),
  backfillOwners: () => API.post('/schools/backfill-owners'),
};

// Contacts
export const contacts = {
  getAll: () => API.get('/contacts'),
  create: (data) => API.post('/contacts', data),
  update: (id, data) => API.put(`/contacts/${id}`, data),
  delete: (id) => API.delete(`/contacts/${id}`),
  convertToLead: (id, data) => API.post(`/contacts/${id}/convert-to-lead`, data),
  addTag: (contactId, tagId) => API.post(`/contacts/${contactId}/tags`, { tag_id: tagId }),
  removeTag: (contactId, tagId) => API.delete(`/contacts/${contactId}/tags/${tagId}`),
  getActivity: (id) => API.get(`/contacts/${id}/activity`),
  importCsv: (file, { tagIds = [], globalNotes = '' } = {}) => {
    const fd = new FormData();
    fd.append('file', file);
    if (tagIds.length > 0) fd.append('tag_ids', tagIds.join(','));
    if (globalNotes) fd.append('global_notes', globalNotes);
    return API.post('/contacts/import', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
  },
};

// Groups
export const groups = {
  getAll: () => API.get('/groups'),
  create: (data) => API.post('/groups', data),
  update: (id, data) => API.put(`/groups/${id}`, data),
  delete: (id) => API.delete(`/groups/${id}`),
};

// Sources
export const sources = {
  getAll: () => API.get('/sources'),
  create: (data) => API.post('/sources', data),
  update: (id, data) => API.put(`/sources/${id}`, data),
  delete: (id) => API.delete(`/sources/${id}`),
};

// Contact Roles
export const contactRoles = {
  getAll: () => API.get('/contact-roles'),
  create: (data) => API.post('/contact-roles', data),
  update: (id, data) => API.put(`/contact-roles/${id}`, data),
  delete: (id) => API.delete(`/contact-roles/${id}`),
};

// Greeting Rules
export const greetingRules = {
  getAll: () => API.get('/greetings/rules'),
  create: (data) => API.post('/greetings/rules', data),
  update: (id, data) => API.put(`/greetings/rules/${id}`, data),
  delete: (id) => API.delete(`/greetings/rules/${id}`),
  logs: (params) => API.get('/greetings/logs', { params }),
};

// Demo seeder
export const demo = {
  seedMarketing: () => API.post('/demo/marketing'),
  clearMarketing: () => API.delete('/demo/marketing'),
};

// WhatsApp Marketing
export const whatsApp = {
  // Templates
  getTemplates:   ()       => API.get('/whatsapp/templates'),
  createTemplate: (data)   => API.post('/whatsapp/templates', data),
  updateTemplate: (id, d)  => API.put(`/whatsapp/templates/${id}`, d),
  deleteTemplate: (id)     => API.delete(`/whatsapp/templates/${id}`),
  // Campaigns
  getCampaigns:   ()       => API.get('/whatsapp/campaigns'),
  createCampaign: (data)   => API.post('/whatsapp/campaigns', data),
  updateCampaign: (id, d)  => API.put(`/whatsapp/campaigns/${id}`, d),
  deleteCampaign: (id)     => API.delete(`/whatsapp/campaigns/${id}`),
  launchCampaign: (id)     => API.post(`/whatsapp/campaigns/${id}/launch`),
  // Analytics & queue
  getAnalytics:   ()       => API.get('/whatsapp/analytics'),
  getQueue:       (params) => API.get('/whatsapp/queue', { params }),
  getProvider:    ()       => API.get('/whatsapp/provider'),
  saveProvider:   (data)   => API.post('/whatsapp/provider', data),
  // ── Evolution API — WhatsApp instance management ──────────────────────────
  instanceConnect: ()           => API.post('/whatsapp/instance/create'),
  instanceStatus:  ()           => API.get('/whatsapp/instance/status'),
  instanceQR:      ()           => API.get('/whatsapp/instance/qr'),
  instanceLogout:  ()           => API.delete('/whatsapp/instance/logout'),
  // ── Multi-instance management ─────────────────────────────────────────────
  listInstances:   ()           => API.get('/whatsapp/instances'),
  createInstance:  (name)       => API.post(`/whatsapp/instances/${name}`),
  deleteInstance:  (name)       => API.delete(`/whatsapp/instances/${name}`),
  instanceQRFor:   (name)       => API.get(`/whatsapp/instances/${name}/qr`),
  instanceStatusFor: (name)     => API.get(`/whatsapp/instances/${name}/status`),
  // ── Proxy configuration ───────────────────────────────────────────────────
  getProxy:        (name)       => API.get(`/whatsapp/proxy/${name}`),
  setProxy:        (name, data) => API.post(`/whatsapp/proxy/${name}`, data),
  // ── Attachments ───────────────────────────────────────────────────────────
  uploadAttachment: (file) => {
    const fd = new FormData();
    fd.append('file', file);
    return API.post('/whatsapp/attachments/upload', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  listAttachments: () => API.get('/whatsapp/attachments'),
};

// Email Marketing
export const email = {
  getTemplates:   ()       => API.get('/email/templates'),
  createTemplate: (data)   => API.post('/email/templates', data),
  updateTemplate: (id, d)  => API.put(`/email/templates/${id}`, d),
  deleteTemplate: (id)     => API.delete(`/email/templates/${id}`),
  getCampaigns:   ()       => API.get('/email/campaigns'),
  createCampaign: (data)   => API.post('/email/campaigns', data),
  updateCampaign: (id, d)  => API.put(`/email/campaigns/${id}`, d),
  deleteCampaign: (id)     => API.delete(`/email/campaigns/${id}`),
  launchCampaign: (id)     => API.post(`/email/campaigns/${id}/launch`),
  getAnalytics:   ()       => API.get('/email/analytics'),
  getQueue:       (params) => API.get('/email/queue', { params }),
};

// Drip Sequences
export const dripSequences = {
  getAll: () => API.get('/drip/sequences'),
  create: (data) => API.post('/drip/sequences', data),
  update: (id, data) => API.put(`/drip/sequences/${id}`, data),
  delete: (id) => API.delete(`/drip/sequences/${id}`),
  enroll: (data) => API.post('/drip/enroll', data),
  enrollments: (params) => API.get('/drip/enrollments', { params }),
  cancelEnrollment: (id) => API.put(`/drip/enrollments/${id}/cancel`),
};

// Tags
export const tags = {
  getAll: () => API.get('/tags'),
  create: (data) => API.post('/tags', data),
  update: (id, data) => API.put(`/tags/${id}`, data),
  delete: (id) => API.delete(`/tags/${id}`),
};

// Leads / CRM
export const leads = {
  getAll: () => API.get('/leads'),
  create: (data) => API.post('/leads', data),
  update: (id, data) => API.put(`/leads/${id}`, data),
  delete: (id) => API.delete(`/leads/${id}`),
  getNotes: (id) => API.get(`/leads/${id}/notes`),
  addNote: (id, data) => API.post(`/leads/${id}/notes`, data),
  forecast: () => API.get('/leads/forecast'),
  funnel: (params) => API.get('/leads/funnel', { params }),
  needsAttention: () => API.get('/leads/needs-attention'),
  scheduleDemo: (id, data) => API.post(`/leads/${id}/schedule-demo`, data),
  autoAssign: (leadIds) => API.post('/leads/auto-assign', leadIds ? { lead_ids: leadIds } : {}),
  reassign: (data) => API.post('/leads/reassign', data),
  bulkAssign: (data) => API.post('/leads/bulk-assign', data),
  bulkTag: (data) => API.post('/leads/bulk-tag', data),
  bulkStage: (data) => API.post('/leads/bulk-stage', data),
  lock: (id, isLocked) => API.post(`/leads/${id}/lock`, { is_locked: isLocked }),
  importCsv: (file) => {
    const fd = new FormData();
    fd.append('file', file);
    return API.post('/leads/import', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
  },
};

// Pipeline settings (probabilities, idle limits, lost reasons, digest)
export const pipelineSettings = {
  get: () => API.get('/pipeline-settings'),
  update: (data) => API.put('/pipeline-settings', data),
};

// School type master (CBSE, ICSE, Cambridge, ...)
export const schoolTypes = {
  getAll: () => API.get('/school-types'),
  create: (data) => API.post('/school-types', data),
  update: (id, data) => API.put(`/school-types/${id}`, data),
  delete: (id) => API.delete(`/school-types/${id}`),
};

// Interested-product master (custom/individual entries; packages are the primary options)
export const interestedProducts = {
  getAll: () => API.get('/interested-products'),
  create: (data) => API.post('/interested-products', data),
  delete: (id) => API.delete(`/interested-products/${id}`),
};

// Follow-ups
export const followups = {
  getAll: (leadId) => API.get('/followups', { params: { lead_id: leadId } }),
  create: (data) => API.post('/followups', data),
  update: (id, data) => API.put(`/followups/${id}`, data),
};

// Training / Workshop sessions
export const training = {
  sessions:      ()       => API.get('/training/sessions'),
  updateSession: (id, d)  => API.put(`/training/sessions/${id}`, d),
};

// Tasks / Follow-ups
export const tasks = {
  getAll: () => API.get('/tasks'),
  create: (data) => API.post('/tasks', data),
  update: (id, data) => API.put(`/tasks/${id}`, data),
  delete: (id) => API.delete(`/tasks/${id}`),
};

// Stock
export const stock = {
  createMovement: (data) => API.post('/stock/movement', data),
  getMovements: () => API.get('/stock/movements'),
};

// Purchase Alerts
export const alerts = {
  getAll: (status) => API.get('/purchase-alerts', { params: { status } }),
  updateStatus: (id, status) => API.put(`/purchase-alerts/${id}/status`, null, { params: { status } }),
};

// Analytics
export const analytics = {
  getDashboard:  () => API.get('/analytics/dashboard'),
  getCharts:     () => API.get('/analytics/charts'),
  getConversion: () => API.get('/analytics/conversion'),
};

// Sales - Attendance
export const attendance = {
  checkIn: (data) => API.post('/sales/attendance/check-in', data),
  checkOut: (lat, lng) => API.post('/sales/attendance/check-out', null, { params: { lat, lng } }),
  getAll: () => API.get('/sales/attendance'),
  getToday: () => API.get('/sales/attendance/today'),
};

// Sales - Visits
export const visits = {
  getAll: () => API.get('/sales/visits'),
  create: (data) => API.post('/sales/visits', data),
  checkIn: (id, lat, lng) => API.post(`/sales/visits/${id}/check-in`, null, { params: { lat, lng } }),
  update: (id, data) => API.put(`/sales/visits/${id}`, data),
  scanCard: (image_base64, media_type) => API.post('/sales/scan-card', { image_base64, media_type }),
};

export const journeyApi = {
  start:   (data)              => API.post('/sales/journey/start', data),
  active:  ()                  => API.get('/sales/journey/active'),
  arrive:  (id, data)          => API.post(`/sales/journey/${id}/arrive`, data),
  depart:  (id, data)          => API.post(`/sales/journey/${id}/depart`, data),
  end:     (id, data)          => API.post(`/sales/journey/${id}/end`, data),
  history: (date = '')         => API.get('/sales/journeys', { params: date ? { date } : {} }),
};

// Sales - Expenses
export const expenses = {
  getAll: (monthYear) => API.get('/sales/expenses', { params: { month_year: monthYear } }),
  create: (data) => API.post('/sales/expenses', data),
  submitReimbursement: (monthYear) => API.post('/sales/expenses/submit-reimbursement', null, { params: { month_year: monthYear } }),
};

// Payroll
export const payroll = {
  getReimbursements: (monthYear) => API.get('/payroll/reimbursements', { params: { month_year: monthYear } }),
  approve: (id) => API.put(`/payroll/reimbursements/${id}/approve`),
  reject: (id, notes) => API.put(`/payroll/reimbursements/${id}/reject`, null, { params: { notes } }),
};

// Catalogue (public)
export const catalogue = {
  get: (token) => axios.get(`${process.env.REACT_APP_BACKEND_URL}/api/catalogue/${token}`),
  submit: (token, selectedDies) => axios.post(`${process.env.REACT_APP_BACKEND_URL}/api/catalogue/${token}/submit`, { selected_dies: selectedDies }),
};

// AI
export const ai = {
  getInsights: (query) => API.post('/ai/insights', null, { params: { query } }),
};

// Notifications
export const notifications = {
  getAll: () => API.get('/notifications'),
  markAllRead: () => API.put('/notifications/read-all'),
};

// Conversion Analytics
export const conversionAnalytics = {
  get: () => API.get('/analytics/conversion'),
};

// Orders
export const orders = {
  getAll: () => API.get('/orders'),
  get: (id) => API.get(`/orders/${id}`),
  create: (data) => API.post('/orders', data),
  updateStatus: (id, data) => API.put(`/orders/${id}/status`, data),
  updateProductionStage: (id, stage, note) => API.put(`/orders/${id}/production-stage`, { production_stage: stage, note }),
  recordPayment: (id, data) => API.post(`/orders/${id}/payment`, data),
  getPayments: (id) => API.get(`/orders/${id}/payments`),
  exportOne: (id, fmt) => API.get(`/orders/${id}/export`, { params: { format: fmt }, responseType: 'blob' }),
  exportBulk: (ids, fmt) => API.post('/orders/export', { order_ids: ids, format: fmt }, { responseType: 'blob' }),
};

// Invoices — bulk JSON/XML import auto-mapped to school + sales order
export const invoices = {
  list: (params) => API.get('/invoices', { params }),
  bulkImport: (file) => {
    const fd = new FormData();
    fd.append('file', file);
    return API.post('/invoices/bulk-import', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
  },
  map: (id, data) => API.post(`/invoices/${id}/map`, data),
  remove: (id) => API.delete(`/invoices/${id}`),
  templateUrl: (fmt) => `${process.env.REACT_APP_BACKEND_URL}/api/invoices/import-template?format=${fmt}`,
};

// Trigger a browser download from an axios blob response (uses server filename).
export function downloadBlob(res, fallbackName) {
  const blob = new Blob([res.data], { type: res.headers?.['content-type'] || 'application/octet-stream' });
  const cd = res.headers?.['content-disposition'] || '';
  const m = cd.match(/filename="?([^";]+)"?/);
  const name = (m && m[1]) || fallbackName || 'download';
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export const adminAnalytics = {
  funnel: () => API.get('/admin/funnel'),
};

export const todayActions = {
  get: () => API.get('/today/actions'),
  markDone: (data) => API.post('/today/mark-done', data),
};

// Holds
export const holds = {
  getAll: () => API.get('/holds'),
  release: (itemId) => API.post(`/holds/${itemId}/release`),
  confirm: (itemId) => API.post(`/holds/${itemId}/confirm`),
  bulkRelease: (itemIds) => API.post('/holds/bulk-release', { item_ids: itemIds }),
};

// School Portal Auth
export const schoolAuth = {
  login: (data) => API.post('/school/auth/login', data),
  me: () => API.get('/school/me'),
  orders: () => API.get('/school/orders'),
  orderDetail: (id) => API.get(`/school/orders/${id}`),
  quotations: () => API.get('/school/quotations'),
  notifications: () => API.get('/school/notifications'),
  markRead: () => API.put('/school/notifications/read'),
};

// Dispatches
export const dispatches = {
  getAll: () => API.get('/dispatches'),
  create: (data) => API.post('/dispatches', data),
  markDelivered: (id) => API.put(`/dispatches/${id}/delivered`),
  updateTracking: (id, data) => API.put(`/dispatches/${id}/tracking`, data),
};

// Import System
export const importSystem = {
  preview: (file, entityType) => {
    const fd = new FormData();
    fd.append('file', file);
    return API.post(`/import/preview?entity_type=${entityType}`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
  },
  execute: (data) => API.post('/import/execute', data),
  logs: () => API.get('/import/logs'),
};

// Activity Logs
export const activityLogs = {
  getAll: (params = {}) => API.get('/activity-logs', { params }),
};

// School password (admin)
export const schoolAdmin = {
  setPassword: (schoolId, password) => API.put(`/schools/${schoolId}/set-password`, { password }),
};

// Settings
export const settingsApi = {
  getCompany: () => API.get('/settings/company'),
  saveCompany: (data) => API.post('/settings/company', data),
  uploadLogo: (file) => {
    const fd = new FormData();
    fd.append('file', file);
    return API.post('/settings/company/upload-logo', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
  },
  getEmail: () => API.get('/settings/email'),
  saveEmail: (data) => API.post('/settings/email', data),
  getWhatsApp: () => API.get('/settings/whatsapp'),
  saveWhatsApp: (data) => API.post('/settings/whatsapp', data),
  getAI: () => API.get('/settings/ai'),
  saveAI: (data) => API.post('/settings/ai', data),
  getDialler: () => API.get('/settings/ai-dialler'),
  saveDialler: (data) => API.put('/settings/ai-dialler', data),
};

// WhatsApp Send
export const whatsappApi = {
  send: (data) => API.post('/whatsapp/send', data),
  sendFile: (data) => API.post('/whatsapp/send-file', data),
};

// Email Send
export const emailApi = {
  send: (data) => API.post('/email/send', data),
};

// Dispatch PDF
export const dispatchApi = {
  downloadPdf: (id) => {
    const url = `${API.defaults.baseURL}/dispatches/${id}/pdf`;
    window.open(url, '_blank');
  },
};

// Leave Management
export const leaves = {
  getAll: () => API.get('/leaves'),
  apply: (data) => API.post('/leaves', data),
  approve: (id, data) => API.put(`/leaves/${id}/approve`, data),
  cancel: (id) => API.delete(`/leaves/${id}`),
  getBalance: (email) => API.get('/leaves/balance', { params: { email } }),
};

// Modules
export const modules = {
  getAll: () => API.get('/modules'),
  update: (moduleId, data) => API.put(`/modules/${moduleId}`, data),
};

// Designations
export const designations = {
  getAll: () => API.get('/designations'),
  create: (data) => API.post('/designations', data),
  update: (id, data) => API.put(`/designations/${id}`, data),
  delete: (id) => API.delete(`/designations/${id}`),
};

// Admin User Management
export const adminUsers = {
  getAll: () => API.get('/admin/users'),
  create: (data) => API.post('/admin/users', data),
  update: (userId, data) => API.put(`/admin/users/${userId}`, data),
  delete: (userId) => API.delete(`/admin/users/${userId}`),
};

// Flow Management System
export const fms = {
  dashboard:       (p)    => API.get('/fms/dashboard', { params: p }),
  createFlow:      (d)    => API.post('/fms/flows', d),
  listFlows:       (p)    => API.get('/fms/flows', { params: p }),
  getFlow:         (id)   => API.get(`/fms/flows/${id}`),
  completeStage:   (id,d) => API.post(`/fms/stages/${id}/complete`, d),
  approveStage:    (id)   => API.post(`/fms/stages/${id}/approve`, {}),
  rejectStage:     (id,d) => API.post(`/fms/stages/${id}/reject`, d),
  submitQC:        (d)    => API.post('/fms/qc', d),
  getChecklist:    (fid)  => API.get(`/fms/checklist/${fid}`),
  submitChecklist: (d)    => API.post('/fms/checklist', d),
  getPayments:     (fid)  => API.get(`/fms/payments/${fid}`),
  addPayment:      (d)    => API.post('/fms/payments', d),
  scores:          ()     => API.get('/fms/reports/scores'),
  settings:        ()     => API.get('/fms/settings'),
  updateSettings:  (d)    => API.put('/fms/settings', d),
  calendar:        (p)    => API.get('/fms/calendar', { params: p }),
  pauseStage:      (id,d) => API.post(`/fms/stages/${id}/pause`, d),
  resumeStage:     (id)   => API.post(`/fms/stages/${id}/resume`, {}),
  getFlowLogs:     (fid)  => API.get(`/fms/flows/${fid}/logs`),
  templates: {
    list:   ()     => API.get('/fms/templates'),
    create: (d)    => API.post('/fms/templates', d),
    update: (id,d) => API.put(`/fms/templates/${id}`, d),
    delete: (id)   => API.delete(`/fms/templates/${id}`),
  },
};

// Certificates Pipeline
export const certsApi = {
  listTemplates:    ()              => API.get('/certs/templates'),
  uploadBackground: (formData)      => API.post('/certs/templates/background', formData, { headers: { 'Content-Type': 'multipart/form-data' } }),
  uploadPdfPreview: (formData)      => API.post('/certs/templates/pdf-preview', formData, { headers: { 'Content-Type': 'multipart/form-data' } }),
  listFonts:        ()              => API.get('/certs/fonts'),
  createTemplate:   (body)          => API.post('/certs/templates', body),
  updateTemplate:   (id, body)      => API.put(`/certs/templates/${id}`, body),
  deleteTemplate:   (id)            => API.delete(`/certs/templates/${id}`),
  listBatches:      ()              => API.get('/certs/batches'),
  getBatch:         (id)            => API.get(`/certs/batches/${id}`),
  createBatch:      (body)          => API.post('/certs/batches', body),
  addAttendees:     (id, attendees) => API.post(`/certs/batches/${id}/attendees`, { attendees }),
  generate:         (id)            => API.post(`/certs/batches/${id}/generate`, {}),
  send:             (id)            => API.post(`/certs/batches/${id}/send`, {}),
  stop:             (id)            => API.post(`/certs/batches/${id}/stop`, {}),
  previewUrl:       (itemId)        => `${API.defaults.baseURL}/certs/items/${itemId}/preview`,
  downloadUrl:      (batchId)       => `${API.defaults.baseURL}/certs/batches/${batchId}/download`,
  zoomConfigGet:    ()              => API.get('/certs/zoom/config'),
  zoomConfigSave:   (body)          => API.post('/certs/zoom/config', body),
  zoomParticipants: (meetingId)     => API.get('/certs/zoom/participants', { params: { meeting_id: meetingId } }),
};

// Zoom -> CRM mapping import (shares Zoom creds with certsApi.zoomConfig*)
export const crmZoom = {
  fetch:   (meetingId) => API.get('/crm-zoom/fetch', { params: { meeting_id: meetingId } }),
  suggest: (rows)      => API.post('/crm-zoom/suggest', { rows }),
  import:  (body)      => API.post('/crm-zoom/import', body),
};

// Delegation System
export const delegation = {
  departments: {
    list:   ()       => API.get('/delegation/departments'),
    create: (data)   => API.post('/delegation/departments', data),
    update: (id, d)  => API.put(`/delegation/departments/${id}`, d),
    delete: (id)     => API.delete(`/delegation/departments/${id}`),
  },
  employees: {
    list:   ()       => API.get('/delegation/employees'),
    create: (data)   => API.post('/delegation/employees', data),
    update: (id, d)  => API.put(`/delegation/employees/${id}`, d),
    delete: (id)     => API.delete(`/delegation/employees/${id}`),
  },
  syncUsers:   ()    => API.post('/delegation/sync-users', {}),
  teamSummary: ()    => API.get('/delegation/team-summary'),
  tasks: {
    list:       (p)    => API.get('/delegation/tasks', { params: p }),
    create:     (data) => API.post('/delegation/tasks', data),
    bulkCreate: (arr)  => API.post('/delegation/tasks/bulk', arr),
    update:     (id,d) => API.put(`/delegation/tasks/${id}`, d),
    delete:     (id,data) => API.delete(`/delegation/tasks/${id}`, { data }),
  },
  taskDeletions: () => API.get('/delegation/task-deletions'),
  instances: {
    list:             (p)    => API.get('/delegation/instances', { params: p }),
    patch:            (id,d) => API.patch(`/delegation/instances/${id}`, d),
    complete:         (id,d) => API.post(`/delegation/instances/${id}/complete`, d),
    completeWithImage:(id,fd)=> API.post(`/delegation/instances/${id}/complete-with-image`, fd),
    verify:           (id)   => API.post(`/delegation/instances/${id}/verify`, {}),
    reopen:           (id)   => API.post(`/delegation/instances/${id}/reopen`, {}),
    bulkComplete:     (data) => API.post('/delegation/instances/bulk-complete', data),
    team:             (id)   => API.get(`/delegation/instances/${id}/team`),
    reassignRequest:  (id,d) => API.post(`/delegation/instances/${id}/reassign-request`, d),
  },
  reassignRequests: {
    list:   (p)    => API.get('/delegation/reassign-requests', { params: p }),
    decide: (id,d) => API.post(`/delegation/reassign-requests/${id}/decide`, d),
  },
  notifications: {
    list:    (p)  => API.get('/delegation/notifications', { params: p }),
    read:    (id) => API.post(`/delegation/notifications/${id}/read`, {}),
    readAll: ()   => API.post('/delegation/notifications/read-all', {}),
  },
  calendar:   (p)  => API.get('/delegation/calendar', { params: p }),
  agenda:     (p)  => API.get('/delegation/agenda', { params: p }),
  planBlocks: {
    list:   (p)    => API.get('/delegation/plan-blocks', { params: p }),
    create: (d)    => API.post('/delegation/plan-blocks', d),
    update: (id,d) => API.patch(`/delegation/plan-blocks/${id}`, d),
    delete: (id)   => API.delete(`/delegation/plan-blocks/${id}`),
  },
  events: {
    create:  (d)    => API.post('/delegation/events', d),
    update:  (id,d) => API.patch(`/delegation/events/${id}`, d),
    delete:  (id)   => API.delete(`/delegation/events/${id}`),
    respond: (id,d) => API.post(`/delegation/events/${id}/respond`, d),
    invite:  (id,kind='request') => API.post(`/delegation/events/${id}/invite`, { kind }),
  },
  calendarFeed:       ()  => API.get('/delegation/calendar-feed'),
  rotateCalendarFeed: ()  => API.post('/delegation/calendar-feed/rotate', {}),
  calendarSettings:     () => API.get('/delegation/calendar-settings'),
  saveCalendarSettings: (d) => API.put('/delegation/calendar-settings', d),
  reminders: {
    list:   ()      => API.get('/delegation/reminders'),
    create: (d)     => API.post('/delegation/reminders', d),
    bulk:   (rows)  => API.post('/delegation/reminders/bulk', { rows }),
    update: (id, d) => API.patch(`/delegation/reminders/${id}`, d),
    pause:  (id)    => API.post(`/delegation/reminders/${id}/pause`, {}),
    resume: (id)    => API.post(`/delegation/reminders/${id}/resume`, {}),
    delete: (id)    => API.delete(`/delegation/reminders/${id}`),
  },
  dashboard:  (p)  => API.get('/delegation/dashboard', { params: p }),
  reports:    (p)  => API.get('/delegation/reports', { params: p }),
  myContext:  ()   => API.get('/delegation/my-context'),
};

// Export (CSV download)
export const exportData = {
  download: (type) => {
    const url = `${process.env.REACT_APP_BACKEND_URL}/api/export/${type}`;
    const a = document.createElement('a');
    a.href = url;
    a.download = `${type}_export.csv`;
    // Use fetch to handle cookies
    fetch(url, { credentials: 'include' })
      .then(res => res.blob())
      .then(blob => {
        const blobUrl = URL.createObjectURL(blob);
        a.href = blobUrl;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(blobUrl);
      });
  },
};

// Upload
export const upload = async (file) => {
  const formData = new FormData();
  formData.append('file', file);
  const response = await axios.post(`${process.env.REACT_APP_BACKEND_URL}/api/upload`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    withCredentials: true,
  });
  return response.data;
};

// WhatsApp Templates + Send (FMS Phase 4)
export const whatsappTemplates = {
  getAll: (params) => API.get('/whatsapp-templates', { params }),
  create: (data) => API.post('/whatsapp-templates', data),
  update: (id, data) => API.put(`/whatsapp-templates/${id}`, data),
  delete: (id) => API.delete(`/whatsapp-templates/${id}`),
};

export const whatsappSend = {
  render: (data) => API.post('/whatsapp/render-template', data),
  sendVia: (data) => API.post('/whatsapp/send-via-template', data),
  logs: (params) => API.get('/whatsapp/logs', { params }),
};

// WhatsApp Scheduler
export const whatsappScheduled = {
  getAll: (params = {}) => API.get('/whatsapp/schedule', { params }),
  create: (data) => API.post('/whatsapp/schedule', data),
  cancel: (id) => API.delete(`/whatsapp/schedule/${id}`),
};

// Physical Dispatches (admin-level all-dispatches view)
export const physicalDispatches = {
  getAll: (params = {}) => API.get('/physical-dispatches', { params }),
  update: (id, data) => API.put(`/physical-dispatches/${id}`, data),
  delete: (id) => API.delete(`/physical-dispatches/${id}`),
};

// Broadcast Campaigns
export const broadcastApi = {
  byTag: (data) => API.post('/whatsapp/broadcast-by-tag', data),
  emailByTag: (data) => API.post('/email/broadcast-by-tag', data),
};

// Admin — Security & System
export const adminApi = {
  getLockouts: () => API.get('/admin/lockouts'),
  revokeLockout: (email) => API.delete(`/admin/lockouts/${encodeURIComponent(email)}`),
  clearCache: (categories) => API.post('/admin/cache/clear', { categories }),
  backfillSchools: () => API.post('/admin/backfill-schools'),
  dbIntegrity: () => API.post('/admin/db-integrity'),
};

// In-app notifications
export const notificationsApi = {
  getAll: () => API.get('/notifications'),
  markAllRead: () => API.put('/notifications/read-all'),
  markOneRead: (id) => API.put(`/notifications/${id}/read`),
};

// ── Procurement ────────────────────────────────────────────────────────────
const uploadCfg = { headers: { 'Content-Type': 'multipart/form-data' } };
const fileForm = (file) => { const fd = new FormData(); fd.append('file', file); return fd; };

export const procurement = {
  // Vendor Master
  vendors: {
    getAll: (includeInactive) => API.get('/vendors', { params: includeInactive ? { include_inactive: true } : {} }),
    get: (id) => API.get(`/vendors/${id}`),
    create: (data) => API.post('/vendors', data),
    update: (id, data) => API.put(`/vendors/${id}`, data),
    delete: (id) => API.delete(`/vendors/${id}`),
    uploadLogo: (id, file) => API.post(`/vendors/${id}/upload-logo`, fileForm(file), uploadCfg),
  },
  // Purchase Item Master (raw materials / supplies)
  purchaseItems: {
    getAll: (includeInactive) => API.get('/purchase-items', { params: includeInactive ? { include_inactive: true } : {} }),
    create: (data) => API.post('/purchase-items', data),
    update: (id, data) => API.put(`/purchase-items/${id}`, data),
    delete: (id) => API.delete(`/purchase-items/${id}`),
    uploadImage: (id, file) => API.post(`/purchase-items/${id}/upload-image`, fileForm(file), uploadCfg),
  },
  // Unified item catalog (dies + purchase_items) for the image picker
  itemCatalog: (params = {}) => API.get('/procurement/item-catalog', { params }),
  // Dashboard KPIs
  summary: () => API.get('/procurement/summary'),
  poReport: (onlyOpen = true) => API.get('/procurement/po-report', { params: { only_open: onlyOpen } }),
  demand: (shortfallOnly = false) => API.get('/procurement/demand', { params: { shortfall_only: shortfallOnly } }),
  // Vendor price list
  vendorItems: {
    getAll: (params = {}) => API.get('/vendor-items', { params }),
    create: (data) => API.post('/vendor-items', data),
    update: (id, data) => API.put(`/vendor-items/${id}`, data),
    delete: (id) => API.delete(`/vendor-items/${id}`),
  },
  // QC checklist templates
  qcTemplates: {
    getAll: () => API.get('/qc-templates'),
    create: (data) => API.post('/qc-templates', data),
    update: (id, data) => API.put(`/qc-templates/${id}`, data),
    delete: (id) => API.delete(`/qc-templates/${id}`),
  },
  // Requisitions (Path A: request -> approve -> PO)
  requisitions: {
    getAll: (status) => API.get('/requisitions', { params: status ? { status } : {} }),
    get: (id) => API.get(`/requisitions/${id}`),
    create: (data) => API.post('/requisitions', data),
    update: (id, data) => API.put(`/requisitions/${id}`, data),
    submit: (id) => API.post(`/requisitions/${id}/submit`),
    approve: (id, remark) => API.post(`/requisitions/${id}/approve`, { remark }),
    reject: (id, remark) => API.post(`/requisitions/${id}/reject`, { remark }),
    convertToPo: (id, data) => API.post(`/requisitions/${id}/convert-to-po`, data),
  },
  // Purchase Orders (Path B: Direct Order Planning -> PO immediately)
  purchaseOrders: {
    getAll: (params = {}) => API.get('/purchase-orders', { params }),
    get: (id) => API.get(`/purchase-orders/${id}`),
    create: (data) => API.post('/purchase-orders', data),
    update: (id, data) => API.put(`/purchase-orders/${id}`, data),
    approve: (id) => API.post(`/purchase-orders/${id}/approve`),
    send: (id) => API.post(`/purchase-orders/${id}/send`),
    cancel: (id) => API.post(`/purchase-orders/${id}/cancel`),
    close: (id) => API.post(`/purchase-orders/${id}/close`),
    pdfUrl: (id) => `${process.env.REACT_APP_BACKEND_URL}/api/purchase-orders/${id}/pdf`,
    downloadPdf: (id, poNo) => downloadFile(`/purchase-orders/${id}/pdf`, `${poNo || 'PO'}.pdf`),
    downloadPackingList: (id, poNo) => downloadFile(`/purchase-orders/${id}/packing-list-pdf`, `${poNo || 'PO'}-packing-list.pdf`),
    receive: (id) => API.post(`/purchase-orders/${id}/receive`),
  },
  // Goods Receipts (verification) + QC checklist
  goodsReceipts: {
    getAll: (params = {}) => API.get('/goods-receipts', { params }),
    get: (id) => API.get(`/goods-receipts/${id}`),
    update: (id, data) => API.put(`/goods-receipts/${id}`, data),
    submitQc: (id, data) => API.post(`/goods-receipts/${id}/qc`, data),
    createReturn: (id) => API.post(`/goods-receipts/${id}/create-return`),
  },
  // Vendor returns / debit notes
  vendorReturns: {
    getAll: (params = {}) => API.get('/vendor-returns', { params }),
    downloadPdf: (id, retNo) => downloadFile(`/vendor-returns/${id}/pdf`, `${retNo || 'RETURN'}.pdf`),
  },
  challans: {
    getAll: (params = {}) => API.get('/challans', { params }),
    get: (id) => API.get(`/challans/${id}`),
    create: (data) => API.post('/challans', data),
    recordReturn: (id, lines) => API.post(`/challans/${id}/record-return`, { lines }),
    fromVendorReturn: (returnId) => API.post(`/vendor-returns/${returnId}/challan`),
    downloadPdf: (id, no) => downloadFile(`/challans/${id}/pdf`, `${no || 'challan'}.pdf`),
  },
};

// Authenticated file download helper (blob) — used for PO / return PDFs.
// Routed through the axios instance so a 401 triggers the same refresh/redirect
// flow as every other request (a raw fetch would bypass it).
function downloadFile(path, filename) {
  return API.get(path, { responseType: 'blob', params: { t: Date.now() } })
    .then(res => {
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url; a.download = filename; document.body.appendChild(a); a.click();
      a.remove(); URL.revokeObjectURL(url);
    });
}

// Web Push (PWA)
export const pushApi = {
  getPublicKey: () => API.get('/push/public-key'),
  subscribe: (subscription) => API.post('/push/subscribe', { subscription }),
  unsubscribe: (endpoint) => API.delete('/push/unsubscribe', { data: { endpoint } }),
  test: () => API.post('/push/test'),
};

export default API;
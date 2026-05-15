import axios from 'axios';

const API = axios.create({
  baseURL: `${process.env.REACT_APP_BACKEND_URL}/api`,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
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
  uploadImage: (id, file) => {
    const formData = new FormData();
    formData.append('file', file);
    return API.post(`/dies/${id}/upload-image`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
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

// Auth location update (post-login geo ping)
export const authLocationUpdate = (lat, lng) => API.post('/auth/login-location', { lat, lng });

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
    fetch(`${process.env.REACT_APP_BACKEND_URL}/api/quotations/${id}/pdf`, { credentials: 'include' })
      .then(r => r.blob())
      .then(blob => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `Quotation_${id}.pdf`; document.body.appendChild(a); a.click(); document.body.removeChild(a); });
  },
};

// Schools
export const schools = {
  getAll: () => API.get('/schools'),
  create: (data) => API.post('/schools', data),
  update: (id, data) => API.put(`/schools/${id}`, data),
  delete: (id) => API.delete(`/schools/${id}`),
  getProfile: (id) => API.get(`/schools/${id}/profile`),
};

// Contacts
export const contacts = {
  getAll: () => API.get('/contacts'),
  create: (data) => API.post('/contacts', data),
  update: (id, data) => API.put(`/contacts/${id}`, data),
  delete: (id) => API.delete(`/contacts/${id}`),
  convertToLead: (id, data) => API.post(`/contacts/${id}/convert-to-lead`, data),
  importCsv: (file) => {
    const fd = new FormData();
    fd.append('file', file);
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
  autoAssign: (leadIds) => API.post('/leads/auto-assign', leadIds ? { lead_ids: leadIds } : {}),
  reassign: (data) => API.post('/leads/reassign', data),
  bulkAssign: (data) => API.post('/leads/bulk-assign', data),
  lock: (id, isLocked) => API.post(`/leads/${id}/lock`, { is_locked: isLocked }),
  importCsv: (file) => {
    const fd = new FormData();
    fd.append('file', file);
    return API.post('/leads/import', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
  },
};

// Follow-ups
export const followups = {
  getAll: (leadId) => API.get('/followups', { params: { lead_id: leadId } }),
  create: (data) => API.post('/followups', data),
  update: (id, data) => API.put(`/followups/${id}`, data),
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
  getDashboard: () => API.get('/analytics/dashboard'),
  getCharts: () => API.get('/analytics/charts'),
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
};

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

export default API;
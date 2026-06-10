import { useState, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import {
  settingsApi, whatsappApi, emailApi, whatsappTemplates,
  whatsappScheduled, officeSettings, deviceApi,
  integrationsApi, sheetsApi, notifPrefsApi,
} from '../lib/api';

export default function useAppSettings() {
  const [activeTab, setActiveTab] = useState('company');
  const [loading, setLoading] = useState(true);
  const logoRef = useRef(null);

  // Field / Office
  const [officeLocation, setOfficeLocation] = useState({ office_lat: '', office_lng: '', office_address: '', office_radius_m: 300 });
  const [officeLocating, setOfficeLocating] = useState(false);
  const [officeSaving, setOfficeSaving] = useState(false);
  const [saving, setSaving] = useState(false);

  // Company
  const [company, setCompany] = useState({
    company_name: 'Divine Computer Pvt Ltd',
    address: '1st Floor 601, Sector 16A Road, Nearby Rama Palace',
    phone: '', email: '', gst_number: '06AABCD6116E1Z5', pan: '', website: '',
    contact_person: '', city: 'Faridabad', state: 'Haryana', pincode: '121002',
    industry: '', logo_url: '', bank_details: '', terms_conditions: '',
  });
  const [logoUploading, setLogoUploading] = useState(false);

  // Email
  const [emailSettings, setEmailSettings] = useState({ sender_name: 'SmartShape Pro', sender_email: '', gmail_app_password: '', enabled: false });
  const [showAppPwd, setShowAppPwd] = useState(false);
  const [testEmail, setTestEmail] = useState('');
  const [testEmailSending, setTestEmailSending] = useState(false);

  // WhatsApp
  const [wa, setWa] = useState({ username: '', password: '', enabled: false });
  const [showWaPwd, setShowWaPwd] = useState(false);
  const [testPhone, setTestPhone] = useState('');
  const [testMessage, setTestMessage] = useState('Hello from SmartShape Pro! This is a test message.');
  const [testWaSending, setTestWaSending] = useState(false);

  // WhatsApp Template Master
  const [waTemplates, setWaTemplates] = useState([]);
  const [tplForm, setTplForm] = useState({ template_id: '', name: '', module: 'general', category: 'custom', body: '', is_active: true });
  const [tplEditing, setTplEditing] = useState(false);

  // Scheduled WhatsApp
  const [scheduledMsgs, setScheduledMsgs] = useState([]);
  const [schedFilter, setSchedFilter] = useState('');
  const [schedFormOpen, setSchedFormOpen] = useState(false);
  const [schedForm, setSchedForm] = useState({ phone: '', contact_name: '', message: '', scheduled_at: '' });

  // AI — Gemini
  const [aiKey, setAiKey] = useState('');
  const [aiKeySet, setAiKeySet] = useState(false);
  const [aiKeyMasked, setAiKeyMasked] = useState('');
  const [aiSaving, setAiSaving] = useState(false);
  const [showAiKey, setShowAiKey] = useState(false);

  // AI Dialler
  const _diallerDefault = {
    enabled: false, vapi_api_key: '', caller_phone: '',
    vapi_key_set: false, vapi_key_masked: '',
    modules: {
      fms:             { enabled: false, trigger_minutes: 30,  escalation_minutes: 120 },
      delegation:      { enabled: false, trigger_minutes: 30,  escalation_minutes: 120, high_priority_only: false },
      task_management: { enabled: false, trigger_minutes: 60,  escalation_minutes: 180 },
    },
    customer_calls: { enabled: false, payment_overdue_days: 3, quotation_followup_days: 2 },
  };
  const [dialler, setDialler] = useState(_diallerDefault);
  const [diallerSaving, setDiallerSaving] = useState(false);
  const [showVapiKey, setShowVapiKey] = useState(false);

  // Trusted Devices
  const [devices, setDevices] = useState([]);
  const [deviceCounts, setDeviceCounts] = useState({ pending: 0, approved: 0, revoked: 0, total: 0 });
  const [deviceFilter, setDeviceFilter] = useState('all');
  const [devicePolicy, setDevicePolicy] = useState({ enforcement_enabled: false, max_devices_per_user: 3, auto_approve_admin: true });
  const [devicePolicySaving, setDevicePolicySaving] = useState(false);
  const [deviceLoading, setDeviceLoading] = useState(false);
  const [deviceActioning, setDeviceActioning] = useState('');

  // Integrations hub
  const [integrationStatus, setIntegrationStatus] = useState({});
  const [sheets, setSheets] = useState({ client_id: '', client_secret: '', enabled: false });
  const [notifPrefs, setNotifPrefs] = useState({});

  // ── Initial load ───────────────────────────────────────────
  useEffect(() => {
    const load = async () => {
      try {
        const [c, e, w, ol, ai, dl] = await Promise.all([
          settingsApi.getCompany(), settingsApi.getEmail(), settingsApi.getWhatsApp(),
          officeSettings.get(), settingsApi.getAI(), settingsApi.getDialler(),
        ]);
        setCompany(c.data);
        setEmailSettings(e.data);
        setWa(w.data);
        if (ol.data) setOfficeLocation({
          office_lat:      ol.data.office_lat      || '',
          office_lng:      ol.data.office_lng      || '',
          office_address:  ol.data.office_address  || '',
          office_radius_m: ol.data.office_radius_m || 300,
        });
        setAiKeySet(ai.data.gemini_api_key_set);
        setAiKeyMasked(ai.data.gemini_api_key_masked || '');
        if (dl.data) setDialler(prev => ({ ...prev, ...dl.data }));
      } catch {}
      // Integrations (best-effort; don't block the page on any single failure)
      try { const st = await integrationsApi.status(); setIntegrationStatus(st.data || {}); } catch {}
      try { const sh = await sheetsApi.get(); setSheets(sh.data); } catch {}
      try { const np = await notifPrefsApi.get(); setNotifPrefs(np.data); } catch {}
      setLoading(false);
    };
    load();
  }, []);

  const refreshStatus = async () => {
    try { const r = await integrationsApi.status(); setIntegrationStatus(r.data || {}); } catch {}
  };
  const saveSheets = async () => {
    try { await sheetsApi.save(sheets); toast.success('Sheets settings saved'); refreshStatus(); }
    catch { toast.error('Failed to save'); }
  };
  const saveNotifPrefs = async () => {
    try { await notifPrefsApi.save(notifPrefs); toast.success('Notification settings saved'); }
    catch { toast.error('Failed to save'); }
  };

  // ── Devices tab ────────────────────────────────────────────
  const loadDevices = async (filter) => {
    const f = filter !== undefined ? filter : deviceFilter;
    setDeviceLoading(true);
    try {
      const r = await deviceApi.list(f);
      setDevices(r.data.devices || []);
      setDeviceCounts(r.data.counts || {});
    } catch { setDevices([]); }
    setDeviceLoading(false);
  };

  const loadDevicePolicy = async () => {
    try { const r = await deviceApi.getPolicy(); setDevicePolicy(r.data); } catch {}
  };

  useEffect(() => {
    if (activeTab === 'devices') { loadDevices(); loadDevicePolicy(); }
  }, [activeTab]); // eslint-disable-line

  const approveDevice = async (id) => {
    setDeviceActioning(id);
    try { await deviceApi.approve(id); toast.success('Device approved'); loadDevices(); } catch { toast.error('Failed'); }
    setDeviceActioning('');
  };

  const revokeDevice = async (id) => {
    if (!window.confirm('Revoke this device? The user will be blocked on next login.')) return;
    setDeviceActioning(id);
    try { await deviceApi.revoke(id); toast.success('Device revoked'); loadDevices(); } catch { toast.error('Failed'); }
    setDeviceActioning('');
  };

  const removeDevice = async (id) => {
    if (!window.confirm('Remove this device record permanently?')) return;
    setDeviceActioning(id);
    try { await deviceApi.remove(id); toast.success('Device removed'); loadDevices(); } catch { toast.error('Failed'); }
    setDeviceActioning('');
  };

  const saveDevicePolicy = async () => {
    setDevicePolicySaving(true);
    try { await deviceApi.savePolicy(devicePolicy); toast.success('Device policy saved'); } catch { toast.error('Failed to save'); }
    setDevicePolicySaving(false);
  };

  // ── WA Templates ───────────────────────────────────────────
  const loadTemplates = async () => {
    try { const r = await whatsappTemplates.getAll(); setWaTemplates(r.data || []); } catch { setWaTemplates([]); }
  };

  useEffect(() => { if (activeTab === 'whatsapp') loadTemplates(); }, [activeTab]); // eslint-disable-line

  const startNewTpl = () => {
    setTplForm({ template_id: '', name: '', module: 'lead', category: 'thankyou', body: '', is_active: true });
    setTplEditing(true);
  };

  const editTpl = (t) => { setTplForm({ ...t }); setTplEditing(true); };

  const saveTpl = async () => {
    if (!tplForm.name || !tplForm.body) { toast.error('Name and body required'); return; }
    try {
      if (tplForm.template_id) await whatsappTemplates.update(tplForm.template_id, tplForm);
      else await whatsappTemplates.create(tplForm);
      toast.success('Template saved');
      setTplEditing(false);
      loadTemplates();
    } catch { toast.error('Save failed'); }
  };

  const deleteTpl = async (id) => {
    if (!window.confirm('Delete this template?')) return;
    try { await whatsappTemplates.delete(id); toast.success('Deleted'); loadTemplates(); }
    catch { toast.error('Delete failed (admin only)'); }
  };

  // ── Scheduled WA ───────────────────────────────────────────
  const loadScheduled = async () => {
    try {
      const params = schedFilter ? { status: schedFilter } : {};
      const r = await whatsappScheduled.getAll(params);
      setScheduledMsgs(r.data || []);
    } catch { setScheduledMsgs([]); }
  };

  useEffect(() => { if (activeTab === 'scheduled') loadScheduled(); }, [activeTab, schedFilter]); // eslint-disable-line

  const saveSchedMsg = async () => {
    if (!schedForm.phone || !schedForm.message || !schedForm.scheduled_at) {
      toast.error('Phone, message, and scheduled time are required'); return;
    }
    try {
      await whatsappScheduled.create(schedForm);
      toast.success('Message scheduled');
      setSchedFormOpen(false);
      setSchedForm({ phone: '', contact_name: '', message: '', scheduled_at: '' });
      loadScheduled();
    } catch (err) { toast.error(err.response?.data?.detail || 'Failed to schedule'); }
  };

  const cancelSchedMsg = async (id) => {
    if (!window.confirm('Cancel this scheduled message?')) return;
    try { await whatsappScheduled.cancel(id); toast.success('Cancelled'); loadScheduled(); }
    catch { toast.error('Cancel failed'); }
  };

  // ── Field / Office ─────────────────────────────────────────
  const captureOfficeLocation = () => {
    if (!navigator.geolocation) { toast.error('GPS not supported'); return; }
    setOfficeLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        try {
          const r = await fetch(
            `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`,
            { headers: { 'User-Agent': 'SmartShapePro/1.0' } }
          );
          const d = await r.json();
          setOfficeLocation(p => ({ ...p, office_lat: lat, office_lng: lng, office_address: d.display_name || `${lat}, ${lng}` }));
          toast.success('Office location captured');
        } catch {
          setOfficeLocation(p => ({ ...p, office_lat: lat, office_lng: lng }));
        }
        setOfficeLocating(false);
      },
      () => { toast.error('GPS access denied'); setOfficeLocating(false); },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const saveOfficeLocation = async () => {
    if (!officeLocation.office_lat || !officeLocation.office_lng) {
      toast.error('Latitude and Longitude are required'); return;
    }
    setOfficeSaving(true);
    try {
      await officeSettings.save({
        ...officeLocation,
        office_lat:      parseFloat(officeLocation.office_lat),
        office_lng:      parseFloat(officeLocation.office_lng),
        office_radius_m: parseInt(officeLocation.office_radius_m) || 300,
      });
      toast.success('Office location saved');
    } catch { toast.error('Failed to save'); }
    setOfficeSaving(false);
  };

  // ── Company ────────────────────────────────────────────────
  const saveCompany = async () => {
    setSaving(true);
    try { await settingsApi.saveCompany(company); toast.success('Company profile saved'); }
    catch { toast.error('Failed'); }
    setSaving(false);
  };

  const handleLogoUpload = async (file) => {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { toast.error('Logo must be under 5MB'); return; }
    setLogoUploading(true);
    try {
      const res = await settingsApi.uploadLogo(file);
      setCompany(prev => ({ ...prev, logo_url: res.data.logo_url }));
      toast.success('Logo uploaded');
    } catch { toast.error('Upload failed'); }
    setLogoUploading(false);
  };

  // ── Email ──────────────────────────────────────────────────
  const saveEmail = async () => {
    setSaving(true);
    try { await settingsApi.saveEmail(emailSettings); toast.success('Email settings saved'); }
    catch { toast.error('Failed'); }
    setSaving(false);
  };

  const handleTestEmail = async () => {
    if (!testEmail) { toast.error('Enter test email'); return; }
    setTestEmailSending(true);
    try {
      const res = await emailApi.send({
        to: testEmail,
        subject: 'SmartShape Pro — Test Email',
        body: `<p>This is a test email from SmartShape Pro sent at ${new Date().toLocaleString()}.</p><p>If you received this, your Gmail integration is working correctly.</p>`,
      });
      if (res.data.success) toast.success(`Test email sent to ${testEmail}`);
      else toast.error(res.data.error || 'Failed to send');
    } catch (err) { toast.error(err.response?.data?.detail || 'Failed'); }
    setTestEmailSending(false);
  };

  // ── WhatsApp ───────────────────────────────────────────────
  const saveWa = async () => {
    setSaving(true);
    try { await settingsApi.saveWhatsApp(wa); toast.success('WhatsApp settings saved'); }
    catch { toast.error('Failed'); }
    setSaving(false);
  };

  const handleTestWa = async () => {
    if (!testPhone || !testMessage) { toast.error('Enter phone and message'); return; }
    setTestWaSending(true);
    try {
      const res = await whatsappApi.send({ phone: testPhone, message: testMessage });
      if (res.data.success) toast.success('WhatsApp message sent!');
      else toast.error(res.data.error || 'Failed to send');
    } catch (err) { toast.error(err.response?.data?.detail || 'Failed'); }
    setTestWaSending(false);
  };

  // ── AI — Gemini ────────────────────────────────────────────
  const saveAiKey = async () => {
    if (!aiKey.trim()) { toast.error('Please enter a Gemini API key'); return; }
    setAiSaving(true);
    try {
      await settingsApi.saveAI({ gemini_api_key: aiKey.trim() });
      toast.success('Gemini API key saved! Card scanning is now active.');
      setAiKeySet(true);
      setAiKeyMasked('*'.repeat(Math.max(0, aiKey.length - 6)) + aiKey.slice(-6));
      setAiKey('');
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to save API key');
    } finally { setAiSaving(false); }
  };

  // ── AI Dialler ─────────────────────────────────────────────
  const saveDialler = async () => {
    setDiallerSaving(true);
    try {
      await settingsApi.saveDialler({
        enabled:        dialler.enabled,
        vapi_api_key:   dialler.vapi_api_key,
        caller_phone:   dialler.caller_phone,
        modules:        dialler.modules,
        customer_calls: dialler.customer_calls,
      });
      toast.success('AI Dialler settings saved');
      const r = await settingsApi.getDialler();
      setDialler(prev => ({ ...prev, ...r.data }));
    } catch (err) { toast.error(err.response?.data?.detail || 'Failed to save'); }
    finally { setDiallerSaving(false); }
  };

  return {
    // Tab
    activeTab, setActiveTab,
    loading,
    logoRef,

    // Office / Field
    officeLocation, setOfficeLocation,
    officeLocating, officeSaving,
    captureOfficeLocation, saveOfficeLocation,

    // Company
    company, setCompany,
    logoUploading,
    saving,
    saveCompany, handleLogoUpload,

    // Email
    emailSettings, setEmailSettings,
    showAppPwd, setShowAppPwd,
    testEmail, setTestEmail,
    testEmailSending,
    saveEmail, handleTestEmail,

    // WhatsApp
    wa, setWa,
    showWaPwd, setShowWaPwd,
    testPhone, setTestPhone,
    testMessage, setTestMessage,
    testWaSending,
    saveWa, handleTestWa,

    // WA Templates
    waTemplates, tplForm, setTplForm, tplEditing, setTplEditing,
    startNewTpl, editTpl, saveTpl, deleteTpl,

    // Scheduled WA
    scheduledMsgs, schedFilter, setSchedFilter,
    schedFormOpen, setSchedFormOpen,
    schedForm, setSchedForm,
    saveSchedMsg, cancelSchedMsg,

    // AI
    aiKey, setAiKey, aiKeySet, aiKeyMasked,
    aiSaving, showAiKey, setShowAiKey,
    saveAiKey,

    // AI Dialler
    dialler, setDialler,
    diallerSaving, showVapiKey, setShowVapiKey,
    saveDialler,

    // Devices
    devices, deviceCounts,
    deviceFilter, setDeviceFilter,
    devicePolicy, setDevicePolicy,
    devicePolicySaving, deviceLoading, deviceActioning,
    loadDevices, approveDevice, revokeDevice, removeDevice, saveDevicePolicy,

    // Integrations hub
    integrationStatus, refreshStatus,
    sheets, setSheets, saveSheets,
    notifPrefs, setNotifPrefs, saveNotifPrefs,
  };
}

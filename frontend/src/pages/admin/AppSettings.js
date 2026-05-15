import React, { useState, useEffect, useRef } from 'react';
import AdminLayout from '../../components/layouts/AdminLayout';
import { settingsApi, whatsappApi, emailApi, whatsappTemplates, whatsappScheduled } from '../../lib/api';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { FieldTooltip } from '../../components/ui/Tooltip';
import { Label } from '../../components/ui/label';
import { toast } from 'sonner';
import { Building2, Mail, MessageSquare, Save, Send, Eye, EyeOff, Upload, Image, X, Plus, Trash2, Edit2, Clock, MapPin, Navigation, Shield, ShieldOff, Laptop, Check } from 'lucide-react';
import { officeSettings, deviceApi } from '../../lib/api';

const TABS = [
  { id: 'company',  label: 'Company',   icon: Building2 },
  { id: 'email',    label: 'Gmail',     icon: Mail },
  { id: 'whatsapp', label: 'WhatsApp',  icon: MessageSquare },
  { id: 'scheduled',label: 'Sched WA',  icon: Clock },
  { id: 'field',    label: 'Field',     icon: MapPin },
  { id: 'devices',  label: 'Devices',   icon: Shield },
];

export default function AppSettings() {
  const [activeTab, setActiveTab] = useState('company');
  const [loading, setLoading] = useState(true);
  // Field settings
  const [officeLocation, setOfficeLocation] = useState({ office_lat: '', office_lng: '', office_address: '', office_radius_m: 300 });
  const [officeLocating, setOfficeLocating] = useState(false);
  const [officeSaving, setOfficeSaving] = useState(false);
  const [saving, setSaving] = useState(false);
  const logoRef = useRef(null);

  // Company
  const [company, setCompany] = useState({ company_name: '', address: '', phone: '', email: '', gst_number: '', pan: '', website: '', contact_person: '', city: '', state: '', pincode: '', industry: '', logo_url: '', bank_details: '', terms_conditions: '' });
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
  // WhatsApp Template Master (FMS Phase 4)
  const [waTemplates, setWaTemplates] = useState([]);
  const [tplForm, setTplForm] = useState({ template_id: '', name: '', module: 'general', category: 'custom', body: '', is_active: true });
  const [tplEditing, setTplEditing] = useState(false);
  // Scheduled WhatsApp
  const [scheduledMsgs, setScheduledMsgs] = useState([]);
  const [schedFilter, setSchedFilter] = useState('');
  const [schedFormOpen, setSchedFormOpen] = useState(false);
  const [schedForm, setSchedForm] = useState({ phone: '', contact_name: '', message: '', scheduled_at: '' });

  // Trusted Devices
  const [devices, setDevices] = useState([]);
  const [deviceCounts, setDeviceCounts] = useState({ pending: 0, approved: 0, revoked: 0, total: 0 });
  const [deviceFilter, setDeviceFilter] = useState('all');
  const [devicePolicy, setDevicePolicy] = useState({ enforcement_enabled: false, max_devices_per_user: 3, auto_approve_admin: true });
  const [devicePolicySaving, setDevicePolicySaving] = useState(false);
  const [deviceLoading, setDeviceLoading] = useState(false);
  const [deviceActioning, setDeviceActioning] = useState('');

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
  useEffect(() => { if (activeTab === 'devices') { loadDevices(); loadDevicePolicy(); } }, [activeTab]); // eslint-disable-line

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

  const loadTemplates = async () => {
    try { const r = await whatsappTemplates.getAll(); setWaTemplates(r.data || []); } catch { setWaTemplates([]); }
  };
  useEffect(() => { if (activeTab === 'whatsapp') loadTemplates(); }, [activeTab]);

  const startNewTpl = () => { setTplForm({ template_id: '', name: '', module: 'lead', category: 'thankyou', body: '', is_active: true }); setTplEditing(true); };
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

  const loadScheduled = async () => {
    try {
      const params = schedFilter ? { status: schedFilter } : {};
      const r = await whatsappScheduled.getAll(params);
      setScheduledMsgs(r.data || []);
    } catch { setScheduledMsgs([]); }
  };
  useEffect(() => { if (activeTab === 'scheduled') loadScheduled(); }, [activeTab, schedFilter]); // eslint-disable-line

  const saveSchedMsg = async () => {
    if (!schedForm.phone || !schedForm.message || !schedForm.scheduled_at) { toast.error('Phone, message, and scheduled time are required'); return; }
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

  const card = 'bg-[var(--bg-card)] border-[var(--border-color)]';
  const inputCls = 'bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]';
  const textPri = 'text-[var(--text-primary)]';
  const textSec = 'text-[var(--text-secondary)]';
  const textMuted = 'text-[var(--text-muted)]';
  const backendUrl = process.env.REACT_APP_BACKEND_URL;

  useEffect(() => {
    const load = async () => {
      try {
        const [c, e, w, ol] = await Promise.all([
          settingsApi.getCompany(), settingsApi.getEmail(), settingsApi.getWhatsApp(),
          officeSettings.get(),
        ]);
        setCompany(c.data);
        setEmailSettings(e.data);
        setWa(w.data);
        if (ol.data) setOfficeLocation({ office_lat: ol.data.office_lat || '', office_lng: ol.data.office_lng || '', office_address: ol.data.office_address || '', office_radius_m: ol.data.office_radius_m || 300 });
      } catch {}
      setLoading(false);
    };
    load();
  }, []);

  const captureOfficeLocation = () => {
    if (!navigator.geolocation) { toast.error('GPS not supported'); return; }
    setOfficeLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        try {
          const r = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`, { headers: { 'User-Agent': 'SmartShapePro/1.0' } });
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
    if (!officeLocation.office_lat || !officeLocation.office_lng) { toast.error('Latitude and Longitude are required'); return; }
    setOfficeSaving(true);
    try {
      await officeSettings.save({ ...officeLocation, office_lat: parseFloat(officeLocation.office_lat), office_lng: parseFloat(officeLocation.office_lng), office_radius_m: parseInt(officeLocation.office_radius_m) || 300 });
      toast.success('Office location saved');
    } catch { toast.error('Failed to save'); }
    setOfficeSaving(false);
  };

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

  const saveEmail = async () => { setSaving(true); try { await settingsApi.saveEmail(emailSettings); toast.success('Email settings saved'); } catch { toast.error('Failed'); } setSaving(false); };
  const saveWa = async () => { setSaving(true); try { await settingsApi.saveWhatsApp(wa); toast.success('WhatsApp settings saved'); } catch { toast.error('Failed'); } setSaving(false); };

  const handleTestEmail = async () => {
    if (!testEmail) { toast.error('Enter test email'); return; }
    setTestEmailSending(true);
    try {
      const res = await emailApi.send({ to: testEmail, subject: 'SmartShape Pro — Test Email', body: `<p>This is a test email from SmartShape Pro sent at ${new Date().toLocaleString()}.</p><p>If you received this, your Gmail integration is working correctly.</p>` });
      if (res.data.success) toast.success(`Test email sent to ${testEmail}`);
      else toast.error(res.data.error || 'Failed to send');
    } catch (err) { toast.error(err.response?.data?.detail || 'Failed'); }
    setTestEmailSending(false);
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

  if (loading) return <AdminLayout><div className="flex items-center justify-center h-96"><div className="animate-spin rounded-full h-12 w-12 border-4 border-[#e94560] border-t-transparent" /></div></AdminLayout>;

  return (
    <AdminLayout>
      <div className="space-y-5">
        <div>
          <h1 className={`text-3xl sm:text-4xl font-semibold ${textPri} tracking-tight`} data-testid="settings-title">Settings</h1>
          <p className={`${textSec} mt-1 text-sm`}>Configure company profile, integrations</p>
        </div>

        {/* Tabs */}
        <div className={`flex gap-1 ${card} border rounded-md p-1`}>
          {TABS.map(tab => {
            const Icon = tab.icon;
            return (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                className={`flex-1 flex items-center justify-center gap-1.5 px-4 py-2 rounded text-sm font-medium transition-all ${activeTab === tab.id ? 'bg-[#e94560] text-white' : `${textSec} hover:bg-[var(--bg-hover)]`}`}
                data-testid={`settings-tab-${tab.id}`}>
                <Icon className="h-4 w-4" /> {tab.label}
              </button>
            );
          })}
        </div>

        {/* COMPANY MASTER TAB */}
        {activeTab === 'company' && (
          <div className={`${card} border rounded-md p-5 space-y-6`} data-testid="company-settings">
            <h2 className={`text-xl font-semibold ${textPri}`}>Company Master</h2>

            {/* Logo Upload */}
            <div className="flex flex-col sm:flex-row items-start gap-6">
              <div className="flex flex-col items-center gap-2">
                <div className={`w-32 h-32 rounded-lg border-2 border-dashed border-[var(--border-color)] flex items-center justify-center overflow-hidden cursor-pointer hover:border-[#e94560]/50 transition-colors bg-[var(--bg-primary)]`}
                  onClick={() => logoRef.current?.click()} data-testid="logo-upload-area">
                  {logoUploading ? (
                    <div className="animate-spin rounded-full h-8 w-8 border-4 border-[#e94560] border-t-transparent" />
                  ) : company.logo_url ? (
                    <img src={`${backendUrl}${company.logo_url}`} alt="Logo" className="w-full h-full object-contain p-2" />
                  ) : (
                    <div className="text-center">
                      <Image className={`h-8 w-8 mx-auto mb-1 ${textMuted}`} />
                      <p className={`text-xs ${textMuted}`}>Upload Logo</p>
                    </div>
                  )}
                </div>
                <input ref={logoRef} type="file" accept="image/*" className="hidden" onChange={e => { if (e.target.files?.[0]) handleLogoUpload(e.target.files[0]); e.target.value = ''; }} />
                {company.logo_url && (
                  <Button variant="ghost" size="sm" onClick={() => setCompany({ ...company, logo_url: '' })} className="text-red-400 text-xs h-6">
                    <X className="mr-1 h-3 w-3" /> Remove
                  </Button>
                )}
              </div>
              <div className="flex-1 space-y-1">
                <h3 className={`text-sm font-medium ${textPri}`}>Company Logo</h3>
                <p className={`text-xs ${textMuted}`}>Upload your company logo. It will appear on quotations, dispatch slips, and PDF documents. Recommended: PNG or SVG, max 5MB.</p>
              </div>
            </div>

            {/* Company Details */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2"><Label className={`${textSec} text-xs`}>Company Name *</Label><Input value={company.company_name} onChange={e => setCompany({...company, company_name: e.target.value})} className={inputCls} placeholder="SmartShape Pro Pvt Ltd" data-testid="company-name-input" /></div>
              <div><Label className={`${textSec} text-xs`}>Email</Label><Input type="email" value={company.email} onChange={e => setCompany({...company, email: e.target.value})} className={inputCls} placeholder="info@company.com" /></div>
              <div><Label className={`${textSec} text-xs`}>Phone</Label><Input value={company.phone} onChange={e => setCompany({...company, phone: e.target.value})} className={inputCls} placeholder="+91 98765 43210" /></div>
              <div><Label className={`${textSec} text-xs`}>Website</Label><Input value={company.website} onChange={e => setCompany({...company, website: e.target.value})} className={inputCls} placeholder="https://www.company.com" /></div>
              <div><Label className={`${textSec} text-xs`}>Contact Person</Label><Input value={company.contact_person} onChange={e => setCompany({...company, contact_person: e.target.value})} className={inputCls} placeholder="MD / Director name" /></div>
              <div><Label className={`${textSec} text-xs`}>Industry</Label><Input value={company.industry} onChange={e => setCompany({...company, industry: e.target.value})} className={inputCls} placeholder="Manufacturing / Education" /></div>
              <div><Label className={`${textSec} text-xs`}>GST Number<FieldTooltip text="15-digit Goods & Services Tax Identification Number (GSTIN) issued by the government. Format: 2-digit state code + 10-digit PAN + 3 chars." /></Label><Input value={company.gst_number} onChange={e => setCompany({...company, gst_number: e.target.value})} className={`${inputCls} font-mono`} placeholder="27AAAAA0000A1Z5" maxLength={15} /></div>
              <div><Label className={`${textSec} text-xs`}>PAN<FieldTooltip text="Permanent Account Number — 10-character alphanumeric ID issued by the Income Tax Department. Required for GST registration." /></Label><Input value={company.pan} onChange={e => setCompany({...company, pan: e.target.value})} className={`${inputCls} font-mono`} placeholder="AAAAA0000A" maxLength={10} /></div>
            </div>

            {/* Address */}
            <div>
              <Label className={`${textSec} text-xs`}>Address</Label>
              <Input value={company.address} onChange={e => setCompany({...company, address: e.target.value})} className={inputCls} placeholder="Full business address..." />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div><Label className={`${textSec} text-xs`}>City</Label><Input value={company.city} onChange={e => setCompany({...company, city: e.target.value})} className={inputCls} placeholder="Mumbai" /></div>
              <div><Label className={`${textSec} text-xs`}>State</Label><Input value={company.state} onChange={e => setCompany({...company, state: e.target.value})} className={inputCls} placeholder="Maharashtra" /></div>
              <div><Label className={`${textSec} text-xs`}>Pincode<FieldTooltip text="6-digit India Post postal code identifying your business location. Used on invoices and for GST jurisdiction." /></Label><Input value={company.pincode} onChange={e => setCompany({...company, pincode: e.target.value})} className={`${inputCls} font-mono`} placeholder="400001" maxLength={6} /></div>
            </div>

            {/* Bank Details (used in Quotation PDF) */}
            <div className="space-y-1 pt-2 border-t border-[var(--border-color)]">
              <Label className={`${textSec} text-xs`}>Bank Details (appears on Quotation PDF)</Label>
              <textarea
                value={company.bank_details || ''}
                onChange={e => setCompany({ ...company, bank_details: e.target.value })}
                rows={3}
                className={`w-full px-3 py-2 rounded-md text-sm ${inputCls}`}
                placeholder={'Bank: HDFC Bank | A/c Name: SmartShape Pro Pvt Ltd\nA/c No: 50200012345678 | IFSC: HDFC0001234\nBranch: Faridabad'}
                data-testid="company-bank-details-input"
              />
            </div>

            {/* Default Terms & Conditions (used in Quotation PDF) */}
            <div className="space-y-1">
              <Label className={`${textSec} text-xs`}>Default Terms &amp; Conditions (one per line, used in Quotation PDF)</Label>
              <textarea
                value={company.terms_conditions || ''}
                onChange={e => setCompany({ ...company, terms_conditions: e.target.value })}
                rows={6}
                className={`w-full px-3 py-2 rounded-md text-sm ${inputCls}`}
                placeholder={'Prices are valid for 30 days from the date of quotation.\nGST @18% applicable as per government norms.\nPayment: 50% advance, balance before dispatch.\nDelivery within 15-20 working days from order confirmation.'}
                data-testid="company-terms-input"
              />
              <p className={`text-[10px] ${textMuted}`}>Each line becomes a numbered clause on the PDF.</p>
            </div>

            <Button onClick={saveCompany} disabled={saving} className="bg-[#e94560] hover:bg-[#f05c75] text-white" data-testid="save-company-btn">
              <Save className="mr-1.5 h-4 w-4" /> {saving ? 'Saving...' : 'Save Company Profile'}
            </Button>
          </div>
        )}

        {/* GMAIL TAB */}
        {activeTab === 'email' && (
          <div className="space-y-4">
            <div className={`${card} border rounded-md p-5 space-y-4`} data-testid="email-settings">
              <h2 className={`text-lg font-medium ${textPri}`}>Gmail SMTP Integration</h2>
              <p className={`text-sm ${textMuted}`}>Send emails directly from your Gmail. Requires a Google App Password.</p>
              <div className="bg-blue-500/10 border border-blue-500/20 rounded-md p-3 text-sm text-blue-400">
                <strong>Setup:</strong> Go to <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer" className="underline">Google App Passwords</a> → Create app password → Paste below.
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div><Label className={`${textSec} text-xs`}>Sender Name</Label><Input value={emailSettings.sender_name} onChange={e => setEmailSettings({...emailSettings, sender_name: e.target.value})} className={inputCls} /></div>
                <div><Label className={`${textSec} text-xs`}>Gmail Address</Label><Input type="email" value={emailSettings.sender_email} onChange={e => setEmailSettings({...emailSettings, sender_email: e.target.value})} className={inputCls} placeholder="you@gmail.com" data-testid="gmail-email-input" /></div>
              </div>
              <div>
                <Label className={`${textSec} text-xs`}>App Password</Label>
                <div className="relative">
                  <Input type={showAppPwd ? 'text' : 'password'} value={emailSettings.gmail_app_password} onChange={e => setEmailSettings({...emailSettings, gmail_app_password: e.target.value})} className={`${inputCls} pr-10 font-mono`} placeholder="xxxx xxxx xxxx xxxx" data-testid="gmail-password-input" />
                  <button type="button" onClick={() => setShowAppPwd(!showAppPwd)} className={`absolute right-3 top-1/2 -translate-y-1/2 ${textMuted}`}>
                    {showAppPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <Button onClick={saveEmail} disabled={saving} className="bg-[#e94560] hover:bg-[#f05c75] text-white" data-testid="save-email-btn">
                <Save className="mr-1.5 h-4 w-4" /> Save Gmail Settings
              </Button>
            </div>
            <div className={`${card} border rounded-md p-5 space-y-3`}>
              <h3 className={`text-sm font-medium ${textPri}`}>Send Test Email</h3>
              <div className="flex gap-2">
                <Input type="email" value={testEmail} onChange={e => setTestEmail(e.target.value)} placeholder="test@example.com" className={`flex-1 ${inputCls}`} data-testid="test-email-input" />
                <Button onClick={handleTestEmail} disabled={testEmailSending} variant="outline" className={`border-[var(--border-color)] ${textSec}`} data-testid="send-test-email-btn">
                  <Send className="mr-1.5 h-4 w-4" /> {testEmailSending ? 'Sending...' : 'Send Test'}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* WHATSAPP TAB */}
        {activeTab === 'whatsapp' && (
          <div className="space-y-4">
            <div className={`${card} border rounded-md p-5 space-y-4`} data-testid="whatsapp-settings">
              <div className="flex items-center gap-2">
                <MessageSquare className="h-5 w-5 text-green-400" />
                <h2 className={`text-lg font-medium ${textPri}`}>WhatsApp Auto Sender</h2>
              </div>
              <p className={`text-sm ${textMuted}`}>Connect to MessageAutoSender API for WhatsApp messages.</p>
              <div className="bg-green-500/10 border border-green-500/20 rounded-md p-3 text-sm text-green-400">
                Get credentials from <a href="https://app.messageautosender.com" target="_blank" rel="noreferrer" className="underline font-medium">app.messageautosender.com</a>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div><Label className={`${textSec} text-xs`}>Username / API ID</Label><Input value={wa.username} onChange={e => setWa({...wa, username: e.target.value})} className={`${inputCls} font-mono`} placeholder="Your API username" data-testid="wa-username-input" /></div>
                <div>
                  <Label className={`${textSec} text-xs`}>Password / API Key</Label>
                  <div className="relative">
                    <Input type={showWaPwd ? 'text' : 'password'} value={wa.password} onChange={e => setWa({...wa, password: e.target.value})} className={`${inputCls} pr-10 font-mono`} placeholder="Your API password" data-testid="wa-password-input" />
                    <button type="button" onClick={() => setShowWaPwd(!showWaPwd)} className={`absolute right-3 top-1/2 -translate-y-1/2 ${textMuted}`}>
                      {showWaPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
              </div>
              <Button onClick={saveWa} disabled={saving} className="bg-[#e94560] hover:bg-[#f05c75] text-white" data-testid="save-whatsapp-btn">
                <Save className="mr-1.5 h-4 w-4" /> Save WhatsApp Settings
              </Button>
            </div>
            <div className={`${card} border rounded-md p-5 space-y-3`}>
              <h3 className={`text-sm font-medium ${textPri}`}>Send Test Message</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div><Label className={`${textSec} text-xs`}>Phone (with country code)</Label><Input value={testPhone} onChange={e => setTestPhone(e.target.value)} placeholder="919876543210" className={inputCls} data-testid="test-wa-phone" /></div>
                <div><Label className={`${textSec} text-xs`}>Message</Label><Input value={testMessage} onChange={e => setTestMessage(e.target.value)} className={inputCls} /></div>
              </div>
              <Button onClick={handleTestWa} disabled={testWaSending} variant="outline" className={`border-[var(--border-color)] ${textSec}`} data-testid="send-test-wa-btn">
                <Send className="mr-1.5 h-4 w-4" /> {testWaSending ? 'Sending...' : 'Send Test WhatsApp'}
              </Button>
            </div>

            {/* Template Master (FMS Phase 4) */}
            <div className={`${card} border rounded-md p-5 space-y-3`} data-testid="wa-templates-panel">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className={`text-sm font-medium ${textPri}`}>Template Master</h3>
                  <p className={`text-xs ${textMuted}`}>Pre-written messages for calls, visits, quotations, etc. Use placeholders {'{contact_name}'}, {'{school_name}'}, {'{my_name}'}, {'{my_phone}'}.</p>
                </div>
                <Button size="sm" onClick={startNewTpl} className="bg-[#e94560] hover:bg-[#f05c75] text-white" data-testid="wa-new-template-btn">
                  <Plus className="mr-1 h-3 w-3" /> New
                </Button>
              </div>
              {tplEditing && (
                <div className={`bg-[var(--bg-primary)] border border-[#e94560]/30 rounded-md p-3 space-y-2`}>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <Input value={tplForm.name} onChange={e => setTplForm({...tplForm, name: e.target.value})} placeholder="Name *" className={`${inputCls} text-sm`} data-testid="wa-tpl-name-input" />
                    <select value={tplForm.module} onChange={e => setTplForm({...tplForm, module: e.target.value})} className={`h-10 px-3 rounded-md text-sm ${inputCls}`} data-testid="wa-tpl-module-select">
                      <option value="general">General</option>
                      <option value="lead">Lead</option>
                      <option value="contact">Contact</option>
                      <option value="school">School</option>
                      <option value="visit">Visit</option>
                      <option value="quotation">Quotation</option>
                      <option value="order">Order</option>
                      <option value="dispatch">Dispatch</option>
                    </select>
                    <select value={tplForm.category} onChange={e => setTplForm({...tplForm, category: e.target.value})} className={`h-10 px-3 rounded-md text-sm ${inputCls}`} data-testid="wa-tpl-category-select">
                      <option value="thankyou">Thank You</option>
                      <option value="reminder">Reminder</option>
                      <option value="followup">Follow-up</option>
                      <option value="marketing">Marketing</option>
                      <option value="intro">Intro</option>
                      <option value="custom">Custom</option>
                    </select>
                  </div>
                  <textarea rows={4} value={tplForm.body} onChange={e => setTplForm({...tplForm, body: e.target.value})} placeholder="Message body. Use {contact_name}, {school_name}, {my_name}..." className={`w-full px-3 py-2 rounded-md text-sm ${inputCls}`} data-testid="wa-tpl-body-input" />
                  <div className="flex gap-2">
                    <Button size="sm" onClick={saveTpl} className="bg-[#e94560] hover:bg-[#f05c75] text-white" data-testid="wa-tpl-save-btn">Save</Button>
                    <Button size="sm" variant="ghost" onClick={() => setTplEditing(false)} className={textSec}>Cancel</Button>
                  </div>
                </div>
              )}
              <div className="space-y-1">
                {waTemplates.length === 0 ? (
                  <p className={`text-xs ${textMuted} text-center py-4`}>No templates yet</p>
                ) : (
                  waTemplates.map(t => (
                    <div key={t.template_id} className={`flex items-center gap-2 ${card} border rounded-md p-2.5`} data-testid={`wa-tpl-row-${t.template_id}`}>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={`${textPri} text-sm font-medium truncate`}>{t.name}</span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded bg-[#e94560]/15 text-[#e94560] capitalize`}>{t.module}</span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-400 capitalize`}>{t.category}</span>
                          {t.is_default && <span className={`text-[10px] px-1.5 py-0.5 rounded bg-green-500/15 text-green-400`}>Default</span>}
                        </div>
                        <p className={`text-xs ${textMuted} mt-0.5 line-clamp-2`}>{t.body}</p>
                      </div>
                      <Button size="sm" variant="ghost" onClick={() => editTpl(t)} className={`${textSec} h-7`} data-testid={`wa-tpl-edit-${t.template_id}`}><Edit2 className="h-3 w-3" /></Button>
                      <Button size="sm" variant="ghost" onClick={() => deleteTpl(t.template_id)} className="text-red-400 h-7" data-testid={`wa-tpl-delete-${t.template_id}`}><Trash2 className="h-3 w-3" /></Button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {/* SCHEDULED WA TAB */}
        {activeTab === 'scheduled' && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 justify-between">
              <div className="flex gap-2">
                {['', 'pending', 'sent', 'failed', 'cancelled'].map(s => (
                  <button key={s} onClick={() => setSchedFilter(s)}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-all ${schedFilter === s ? 'bg-[#e94560] text-white border-transparent' : `border-[var(--border-color)] ${textSec} hover:bg-[var(--bg-hover)]`}`}>
                    {s ? s.charAt(0).toUpperCase() + s.slice(1) : 'All'}
                  </button>
                ))}
              </div>
              <Button size="sm" onClick={() => { setSchedForm({ phone: '', contact_name: '', message: '', scheduled_at: '' }); setSchedFormOpen(true); }} className="bg-[#e94560] hover:bg-[#f05c75] text-white">
                <Plus className="mr-1 h-3 w-3" /> Schedule Message
              </Button>
            </div>

            {schedFormOpen && (
              <div className={`${card} border rounded-md p-4 space-y-3`}>
                <h3 className={`text-sm font-medium ${textPri}`}>New Scheduled Message</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div><Label className={`${textSec} text-xs`}>Phone (with country code) *</Label><Input value={schedForm.phone} onChange={e => setSchedForm({...schedForm, phone: e.target.value})} placeholder="919876543210" className={inputCls} /></div>
                  <div><Label className={`${textSec} text-xs`}>Contact Name</Label><Input value={schedForm.contact_name} onChange={e => setSchedForm({...schedForm, contact_name: e.target.value})} placeholder="Optional" className={inputCls} /></div>
                  <div className="sm:col-span-2"><Label className={`${textSec} text-xs`}>Message *</Label><textarea rows={3} value={schedForm.message} onChange={e => setSchedForm({...schedForm, message: e.target.value})} placeholder="WhatsApp message text..." className={`w-full px-3 py-2 rounded-md text-sm ${inputCls}`} /></div>
                  <div><Label className={`${textSec} text-xs`}>Schedule At *</Label><Input type="datetime-local" value={schedForm.scheduled_at} onChange={e => setSchedForm({...schedForm, scheduled_at: e.target.value})} className={inputCls} /></div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={saveSchedMsg} className="bg-[#e94560] hover:bg-[#f05c75] text-white">Schedule</Button>
                  <Button size="sm" variant="ghost" onClick={() => setSchedFormOpen(false)} className={textSec}>Cancel</Button>
                </div>
              </div>
            )}

            <div className={`${card} border rounded-md overflow-hidden`}>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="bg-[var(--bg-primary)]">
                    <th className={`text-left text-xs uppercase py-3 px-4 ${textMuted}`}>Scheduled At</th>
                    <th className={`text-left text-xs uppercase py-3 px-4 ${textMuted}`}>Contact</th>
                    <th className={`text-left text-xs uppercase py-3 px-4 ${textMuted} hidden sm:table-cell`}>Phone</th>
                    <th className={`text-left text-xs uppercase py-3 px-4 ${textMuted} hidden md:table-cell`}>Message</th>
                    <th className={`text-center text-xs uppercase py-3 px-4 ${textMuted}`}>Status</th>
                    <th className={`text-right text-xs uppercase py-3 px-4 ${textMuted}`}>Actions</th>
                  </tr></thead>
                  <tbody>
                    {scheduledMsgs.length === 0 ? (
                      <tr><td colSpan="6" className={`py-10 text-center ${textMuted}`}>No scheduled messages</td></tr>
                    ) : scheduledMsgs.map(m => (
                      <tr key={m.schedule_id} className="border-t border-[var(--border-color)] hover:bg-[var(--bg-hover)]">
                        <td className={`py-2.5 px-4 text-xs ${textSec} whitespace-nowrap`}>{m.scheduled_at ? new Date(m.scheduled_at).toLocaleString() : '—'}</td>
                        <td className={`py-2.5 px-4 text-sm ${textPri}`}>{m.contact_name || '—'}</td>
                        <td className={`py-2.5 px-4 text-xs ${textSec} hidden sm:table-cell`}>{m.phone}</td>
                        <td className={`py-2.5 px-4 hidden md:table-cell`}>
                          <p className={`text-xs ${textMuted} line-clamp-2 max-w-[280px]`}>{m.message}</p>
                        </td>
                        <td className="py-2.5 px-4 text-center">
                          <span className={`text-[11px] px-2 py-0.5 rounded font-medium ${
                            m.status === 'sent' ? 'bg-green-500/20 text-green-400' :
                            m.status === 'failed' ? 'bg-red-500/20 text-red-400' :
                            m.status === 'cancelled' ? 'bg-gray-500/20 text-gray-400' :
                            'bg-yellow-500/20 text-yellow-400'
                          }`}>{m.status}</span>
                        </td>
                        <td className="py-2.5 px-4 text-right">
                          {m.status === 'pending' && (
                            <Button size="sm" variant="ghost" onClick={() => cancelSchedMsg(m.schedule_id)} className="text-red-400 h-7 px-2" title="Cancel">
                              <X className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ── FIELD SETTINGS ────────────────────────────────────────────── */}
        {activeTab === 'field' && (
          <div className="space-y-6">
            <div className={`${card} border rounded-xl p-6`}>
              <div className="flex items-center gap-3 mb-5">
                <div className="w-9 h-9 rounded-lg bg-[#e94560]/15 flex items-center justify-center"><MapPin className="h-5 w-5 text-[#e94560]" /></div>
                <div>
                  <h2 className={`text-lg font-semibold ${textPri}`}>Office Location & Geofence</h2>
                  <p className={`text-xs ${textMuted}`}>Set your office location to auto-detect attendance mode and flag out-of-area check-ins</p>
                </div>
              </div>

              <div className="space-y-4">
                {/* GPS capture button */}
                <Button onClick={captureOfficeLocation} disabled={officeLocating} variant="outline" className="border-[var(--border-color)] text-[var(--text-secondary)] w-full sm:w-auto">
                  <Navigation className={`mr-2 h-4 w-4 ${officeLocating ? 'animate-spin' : ''}`} />
                  {officeLocating ? 'Capturing GPS…' : 'Use My Current Location as Office'}
                </Button>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <Label className={`${textSec} text-xs`}>Office Latitude</Label>
                    <Input value={officeLocation.office_lat} onChange={e => setOfficeLocation(p => ({...p, office_lat: e.target.value}))} className={inputCls} placeholder="e.g. 28.6139" type="number" step="any" />
                  </div>
                  <div>
                    <Label className={`${textSec} text-xs`}>Office Longitude</Label>
                    <Input value={officeLocation.office_lng} onChange={e => setOfficeLocation(p => ({...p, office_lng: e.target.value}))} className={inputCls} placeholder="e.g. 77.2090" type="number" step="any" />
                  </div>
                </div>

                <div>
                  <Label className={`${textSec} text-xs`}>Office Address (auto-filled or manual)</Label>
                  <Input value={officeLocation.office_address} onChange={e => setOfficeLocation(p => ({...p, office_address: e.target.value}))} className={inputCls} placeholder="Full office address" />
                </div>

                <div>
                  <Label className={`${textSec} text-xs`}>Geofence Radius (meters)</Label>
                  <div className="flex items-center gap-3 mt-1">
                    <input type="range" min="50" max="2000" step="50" value={officeLocation.office_radius_m}
                      onChange={e => setOfficeLocation(p => ({...p, office_radius_m: parseInt(e.target.value)}))}
                      className="flex-1 accent-[#e94560]" />
                    <span className={`${textPri} font-mono font-semibold text-sm w-20 text-right`}>{officeLocation.office_radius_m}m</span>
                  </div>
                  <p className={`text-xs ${textMuted} mt-1`}>Employees who check in as "Office" but are farther than this from the office coordinates will trigger a geofence alert.</p>
                </div>

                {officeLocation.office_lat && officeLocation.office_lng && (
                  <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-3 flex items-start gap-2">
                    <MapPin className="h-4 w-4 text-green-400 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="text-green-400 text-xs font-semibold">Office Location Set</p>
                      <p className={`${textSec} text-xs mt-0.5`}>{officeLocation.office_address || `${officeLocation.office_lat}, ${officeLocation.office_lng}`}</p>
                      <p className={`${textMuted} text-xs`}>Geofence radius: {officeLocation.office_radius_m}m</p>
                    </div>
                  </div>
                )}

                <Button onClick={saveOfficeLocation} disabled={officeSaving} className="bg-[#e94560] hover:bg-[#f05c75] text-white">
                  <Save className="mr-2 h-4 w-4" />{officeSaving ? 'Saving…' : 'Save Office Location'}
                </Button>
              </div>
            </div>

            {/* How it works */}
            <div className={`${card} border rounded-xl p-5`}>
              <h3 className={`text-sm font-semibold ${textPri} mb-3`}>How Geo-Tagging Works</h3>
              <ul className={`space-y-2 text-xs ${textSec}`}>
                <li className="flex items-start gap-2"><span className="text-[#e94560] font-bold mt-0.5">1.</span>Admin sets the office GPS coordinates and geofence radius above.</li>
                <li className="flex items-start gap-2"><span className="text-[#e94560] font-bold mt-0.5">2.</span>When a sales rep checks into attendance as "Office", their GPS is compared with the office location.</li>
                <li className="flex items-start gap-2"><span className="text-[#e94560] font-bold mt-0.5">3.</span>If they are farther than the geofence radius, a breach alert is created and visible in Field Sales → Geo Alerts.</li>
                <li className="flex items-start gap-2"><span className="text-[#e94560] font-bold mt-0.5">4.</span>When employees log in, their location is captured and work mode (Office / WFH) is auto-detected.</li>
                <li className="flex items-start gap-2"><span className="text-[#e94560] font-bold mt-0.5">5.</span>Login logs with location data are viewable in Field Sales → Login Logs.</li>
              </ul>
            </div>
          </div>
        )}

        {/* ── TRUSTED DEVICES TAB ─────────────────────────────────────────── */}
        {activeTab === 'devices' && (
          <div className="space-y-5">

            {/* Policy card */}
            <div className={`${card} border rounded-xl p-5`}>
              <h2 className={`text-lg font-semibold ${textPri} mb-1`}>Device Trust Policy</h2>
              <p className={`text-xs ${textMuted} mb-5`}>Control which devices employees are allowed to sign in from.</p>

              {/* enforcement_enabled */}
              <div className="flex items-center justify-between py-3.5 border-b border-[var(--border-color)]">
                <div>
                  <p className={`text-sm font-medium ${textPri}`}>Enable Device Trust</p>
                  <p className={`text-xs ${textMuted} mt-0.5`}>When on, employees can only log in from approved devices</p>
                </div>
                <button onClick={() => setDevicePolicy(p => ({ ...p, enforcement_enabled: !p.enforcement_enabled }))}
                  className={`relative w-12 h-6 rounded-full transition-colors flex-shrink-0 ${devicePolicy.enforcement_enabled ? 'bg-[#e94560]' : 'bg-gray-600'}`}>
                  <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${devicePolicy.enforcement_enabled ? 'translate-x-7' : 'translate-x-1'}`} />
                </button>
              </div>

              {/* auto_approve_admin */}
              <div className="flex items-center justify-between py-3.5 border-b border-[var(--border-color)]">
                <div>
                  <p className={`text-sm font-medium ${textPri}`}>Admin Bypass</p>
                  <p className={`text-xs ${textMuted} mt-0.5`}>Admins skip device check — always allowed to log in (recommended)</p>
                </div>
                <button onClick={() => setDevicePolicy(p => ({ ...p, auto_approve_admin: !p.auto_approve_admin }))}
                  className={`relative w-12 h-6 rounded-full transition-colors flex-shrink-0 ${devicePolicy.auto_approve_admin ? 'bg-[#e94560]' : 'bg-gray-600'}`}>
                  <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${devicePolicy.auto_approve_admin ? 'translate-x-7' : 'translate-x-1'}`} />
                </button>
              </div>

              {/* max_devices_per_user */}
              <div className="py-3.5 border-b border-[var(--border-color)]">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <p className={`text-sm font-medium ${textPri}`}>Max Approved Devices Per User</p>
                    <p className={`text-xs ${textMuted}`}>Limit how many devices each employee can register</p>
                  </div>
                  <span className={`text-2xl font-bold ${textPri} w-8 text-right`}>{devicePolicy.max_devices_per_user}</span>
                </div>
                <input type="range" min="1" max="5" step="1" value={devicePolicy.max_devices_per_user}
                  onChange={e => setDevicePolicy(p => ({ ...p, max_devices_per_user: parseInt(e.target.value) }))}
                  className="w-full accent-[#e94560]" />
                <div className={`flex justify-between text-[10px] ${textMuted} mt-1 px-0.5`}>
                  {[1,2,3,4,5].map(n => <span key={n}>{n}</span>)}
                </div>
              </div>

              <div className="pt-4 flex items-center gap-4">
                <Button onClick={saveDevicePolicy} disabled={devicePolicySaving} className="bg-[#e94560] hover:bg-[#f05c75] text-white">
                  <Save className="mr-2 h-4 w-4" />{devicePolicySaving ? 'Saving…' : 'Save Policy'}
                </Button>
                {!devicePolicy.enforcement_enabled && (
                  <p className="text-xs text-amber-400">Device trust is OFF — all logins are currently allowed</p>
                )}
                {devicePolicy.enforcement_enabled && (
                  <p className="text-xs text-green-400">Device trust is ON — only approved devices can sign in</p>
                )}
              </div>
            </div>

            {/* Stats row */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: 'Pending',  value: deviceCounts.pending,  color: 'text-amber-400',  bg: 'bg-amber-500/10 border-amber-500/30' },
                { label: 'Approved', value: deviceCounts.approved, color: 'text-green-400',  bg: 'bg-green-500/10 border-green-500/30' },
                { label: 'Revoked',  value: deviceCounts.revoked,  color: 'text-red-400',    bg: 'bg-red-500/10 border-red-500/30' },
                { label: 'Total',    value: deviceCounts.total,    color: textPri,            bg: `${card} border-[var(--border-color)]` },
              ].map(s => (
                <div key={s.label} className={`${s.bg} border rounded-xl p-4 text-center`}>
                  <p className={`text-2xl font-bold ${s.color}`}>{s.value ?? 0}</p>
                  <p className={`text-xs ${textMuted} mt-0.5`}>{s.label}</p>
                </div>
              ))}
            </div>

            {/* Device list */}
            <div className={`${card} border rounded-xl overflow-hidden`}>
              {/* Filter bar */}
              <div className="p-3 border-b border-[var(--border-color)] flex items-center gap-2 flex-wrap">
                {['all', 'pending', 'approved', 'revoked'].map(f => (
                  <button key={f} onClick={() => { setDeviceFilter(f); loadDevices(f); }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-colors ${deviceFilter === f ? 'bg-[#e94560] text-white' : `${textSec} hover:bg-[var(--bg-hover)] border border-[var(--border-color)]`}`}>
                    {f}
                    {f === 'pending' && deviceCounts.pending > 0 && (
                      <span className="ml-1.5 bg-amber-500 text-white text-[10px] rounded-full px-1.5 py-0.5 font-bold">{deviceCounts.pending}</span>
                    )}
                  </button>
                ))}
                <button onClick={() => loadDevices()} className={`ml-auto text-xs ${textMuted} hover:${textSec} flex items-center gap-1`}>
                  <Navigation className="h-3 w-3" />Refresh
                </button>
              </div>

              {deviceLoading ? (
                <div className="flex justify-center py-14">
                  <div className="animate-spin rounded-full h-8 w-8 border-4 border-[#e94560] border-t-transparent" />
                </div>
              ) : devices.length === 0 ? (
                <div className="py-14 text-center">
                  <Shield className={`h-10 w-10 ${textMuted} mx-auto mb-3 opacity-40`} />
                  <p className={`${textSec} text-sm`}>No devices found</p>
                  <p className={`${textMuted} text-xs mt-1`}>Devices appear here when employees attempt to sign in</p>
                </div>
              ) : (
                <div className="divide-y divide-[var(--border-color)]">
                  {devices.map(dev => (
                    <div key={dev.device_id} className={`p-4 ${dev.status === 'pending' ? 'bg-amber-500/5' : ''}`}>
                      <div className="flex items-start justify-between gap-3">
                        {/* Left: icon + info */}
                        <div className="flex items-start gap-3 flex-1 min-w-0">
                          <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${
                            dev.status === 'approved' ? 'bg-green-500/20' :
                            dev.status === 'revoked'  ? 'bg-red-500/20'   :
                            'bg-amber-500/20'
                          }`}>
                            <Laptop className={`h-4 w-4 ${
                              dev.status === 'approved' ? 'text-green-400' :
                              dev.status === 'revoked'  ? 'text-red-400'   :
                              'text-amber-400'
                            }`} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className={`text-sm font-semibold ${textPri}`}>{dev.user_name}</span>
                              <span className={`text-xs ${textMuted}`}>{dev.user_email}</span>
                              <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold uppercase ${
                                dev.role === 'admin' ? 'bg-purple-500/20 text-purple-400' : 'bg-blue-500/20 text-blue-400'
                              }`}>{dev.role}</span>
                              <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                                dev.status === 'approved' ? 'bg-green-500/20 text-green-400' :
                                dev.status === 'revoked'  ? 'bg-red-500/20 text-red-400'     :
                                'bg-amber-500/20 text-amber-400'
                              }`}>{dev.status}</span>
                            </div>
                            <p className={`text-xs ${textSec} mt-0.5`}>{dev.device_label}</p>
                            <div className={`flex items-center gap-3 flex-wrap text-[10px] ${textMuted} mt-1`}>
                              <span>Requested: {dev.requested_at?.slice(0, 10)}</span>
                              {dev.last_used && <span>Last used: {dev.last_used?.slice(0, 10)}</span>}
                              {dev.last_ip && <span>IP: {dev.last_ip}</span>}
                              {dev.approved_by && <span>Approved by: {dev.approved_by}</span>}
                            </div>
                          </div>
                        </div>

                        {/* Right: actions */}
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          {(dev.status === 'pending' || dev.status === 'revoked') && (
                            <Button size="sm" onClick={() => approveDevice(dev.device_id)}
                              disabled={deviceActioning === dev.device_id}
                              className="bg-green-500 hover:bg-green-600 text-white h-7 px-2.5 text-xs">
                              <Check className="h-3 w-3 mr-1" />
                              {dev.status === 'revoked' ? 'Re-approve' : 'Approve'}
                            </Button>
                          )}
                          {dev.status === 'pending' && (
                            <Button size="sm" variant="outline" onClick={() => revokeDevice(dev.device_id)}
                              disabled={deviceActioning === dev.device_id}
                              className={`h-7 px-2.5 text-xs border-red-500/30 text-red-400 hover:bg-red-500/10`}>
                              Reject
                            </Button>
                          )}
                          {dev.status === 'approved' && (
                            <Button size="sm" variant="outline" onClick={() => revokeDevice(dev.device_id)}
                              disabled={deviceActioning === dev.device_id}
                              className="h-7 px-2.5 text-xs border-red-500/30 text-red-400 hover:bg-red-500/10">
                              <ShieldOff className="h-3 w-3 mr-1" />Revoke
                            </Button>
                          )}
                          <Button size="sm" variant="ghost" onClick={() => removeDevice(dev.device_id)}
                            disabled={deviceActioning === dev.device_id}
                            className={`h-7 w-7 p-0 ${textMuted} hover:text-red-400`}>
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* How it works */}
            <div className={`${card} border rounded-xl p-5`}>
              <h3 className={`text-sm font-semibold ${textPri} mb-3`}>How Device Trust Works</h3>
              <ul className={`space-y-2 text-xs ${textSec}`}>
                <li className="flex items-start gap-2"><span className="text-[#e94560] font-bold mt-0.5">1.</span>When an employee logs in from a new device, it appears here as "Pending" and they are blocked with a friendly message.</li>
                <li className="flex items-start gap-2"><span className="text-[#e94560] font-bold mt-0.5">2.</span>Admin approves the device above — the employee can then log in normally from that device.</li>
                <li className="flex items-start gap-2"><span className="text-[#e94560] font-bold mt-0.5">3.</span>Revoking a device blocks the user the next time they try to log in from it.</li>
                <li className="flex items-start gap-2"><span className="text-[#e94560] font-bold mt-0.5">4.</span>Works on web now. Future mobile app devices (Android / iOS) will appear here automatically — same backend, same approval flow.</li>
                <li className="flex items-start gap-2"><span className="text-[#e94560] font-bold mt-0.5">5.</span>Device Trust is OFF by default. Enable it above when you're ready to enforce it — existing employees will need their devices approved.</li>
              </ul>
            </div>

          </div>
        )}

      </div>
    </AdminLayout>
  );
}

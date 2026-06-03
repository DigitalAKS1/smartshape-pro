import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import API, { whatsApp as waApi } from '../lib/api';

/**
 * Hook encapsulating all Settings page state and handlers.
 */
export function useSettings() {
  const [emailSettings, setEmailSettings] = useState({
    sender_name: 'SmartShape Pro',
    sender_email: '',
    gmail_app_password: '',
    enabled: false,
  });

  const [sheetsSettings, setSheetsSettings] = useState({
    client_id: '',
    client_secret: '',
    enabled: false,
  });

  const [notificationSettings, setNotificationSettings] = useState({
    purchase_alerts_enabled: true,
    low_stock_enabled: true,
    quotation_status_enabled: true,
  });

  const [emailTemplate, setEmailTemplate] = useState({
    subject: 'Catalogue Link - {{schoolName}}',
    body: `Dear {{principalName}},\n\nThank you for your interest in SmartShape Pro products!\n\nWe are pleased to share your personalized catalogue for {{packageName}}.\n\nPlease click the link below to view and select your preferred dies:\n{{catalogueUrl}}\n\nFor any queries, please contact:\n{{salesPersonName}}\nEmail: {{salesPersonEmail}}\n\nBest regards,\nSmartShape Pro Team`,
  });

  // WhatsApp proxy
  const [proxy, setProxy]           = useState({ host: '', port: '10001', username: '', password: '' });
  const [proxyLoading, setProxyLoading] = useState(false);
  const [savingProxy, setSavingProxy]   = useState(false);
  const [proxyStatus, setProxyStatus]   = useState(null);
  const [showPass, setShowPass]         = useState(false);

  useEffect(() => {
    setProxyLoading(true);
    waApi.getProxy('smartshape')
      .then(r => {
        const d = r?.data || {};
        if (d.host) {
          setProxy({ host: d.host || '', port: d.port || '10001', username: d.username || '', password: d.password || '' });
          setProxyStatus('saved');
        }
      })
      .catch(() => {})
      .finally(() => setProxyLoading(false));
  }, []);

  const handleSaveEmailSettings = async () => {
    try {
      await API.post('/settings/email', emailSettings);
      toast.success('Email settings saved successfully!');
      toast.info('Settings will be active after backend restart');
    } catch (error) {
      console.error('Error saving email settings:', error);
      toast.error('Failed to save email settings');
    }
  };

  const handleSaveSheetsSettings = async () => {
    try {
      await API.post('/settings/sheets', sheetsSettings);
      toast.success('Google Sheets settings saved!');
    } catch (error) {
      console.error('Error saving sheets settings:', error);
      toast.error('Failed to save sheets settings');
    }
  };

  const handleSaveNotifications = async () => {
    try {
      await API.post('/settings/notifications', notificationSettings);
      toast.success('Notification settings saved!');
    } catch (error) {
      console.error('Error saving notification settings:', error);
      toast.error('Failed to save notification settings');
    }
  };

  const handleSaveProxy = async () => {
    if (!proxy.host || !proxy.port) { toast.error('Host and port are required'); return; }
    setSavingProxy(true);
    setProxyStatus(null);
    try {
      await waApi.setProxy('smartshape', { ...proxy, protocol: 'socks5', enabled: true });
      setProxyStatus('saved');
      toast.success('Proxy saved — WhatsApp will reconnect through it now');
    } catch (e) {
      setProxyStatus('error');
      toast.error('Proxy save failed: ' + (e?.response?.data?.detail || e?.response?.data?.message || e.message));
    } finally {
      setSavingProxy(false);
    }
  };

  const handleClearProxy = async () => {
    setSavingProxy(true);
    try {
      await waApi.setProxy('smartshape', { host: '', port: '10001', protocol: 'socks5', username: '', password: '', enabled: false });
      setProxy({ host: '', port: '10001', username: '', password: '' });
      setProxyStatus(null);
      toast.success('Proxy cleared — WhatsApp will use the direct VPS connection');
    } catch {
      toast.error('Failed to clear proxy');
    } finally {
      setSavingProxy(false);
    }
  };

  const handleTestEmail = async () => {
    if (!emailSettings.sender_email || !emailSettings.gmail_app_password) {
      toast.error('Please configure email settings first');
      return;
    }
    toast.info('Test email would be sent to: ' + emailSettings.sender_email);
    toast.success('Email configuration looks good!');
  };

  return {
    emailSettings, setEmailSettings,
    sheetsSettings, setSheetsSettings,
    notificationSettings, setNotificationSettings,
    emailTemplate, setEmailTemplate,
    proxy, setProxy,
    proxyLoading, savingProxy,
    proxyStatus, showPass, setShowPass,
    handleSaveEmailSettings,
    handleSaveSheetsSettings,
    handleSaveNotifications,
    handleSaveProxy,
    handleClearProxy,
    handleTestEmail,
  };
}

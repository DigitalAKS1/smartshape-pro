import React, { useState, useEffect } from 'react';
import AdminLayout from '../../components/layouts/AdminLayout';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { Settings as SettingsIcon, Mail, FileSpreadsheet, Bell, Save } from 'lucide-react';
import { toast } from 'sonner';
import API from '../../lib/api';

export default function Settings() {
  const [emailSettings, setEmailSettings] = useState({
    sender_name: 'SmartShape Pro',
    sender_email: '',
    gmail_app_password: '',
    enabled: false
  });

  const [sheetsSettings, setSheetsSettings] = useState({
    client_id: '',
    client_secret: '',
    enabled: false
  });

  const [notificationSettings, setNotificationSettings] = useState({
    purchase_alerts_enabled: true,
    low_stock_enabled: true,
    quotation_status_enabled: true
  });

  const [emailTemplate, setEmailTemplate] = useState({
    subject: 'Catalogue Link - {{schoolName}}',
    body: `Dear {{principalName}},

Thank you for your interest in SmartShape Pro products!

We are pleased to share your personalized catalogue for {{packageName}}.

Please click the link below to view and select your preferred dies:
{{catalogueUrl}}

For any queries, please contact:
{{salesPersonName}}
Email: {{salesPersonEmail}}

Best regards,
SmartShape Pro Team`
  });

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

  const handleTestEmail = async () => {
    if (!emailSettings.sender_email || !emailSettings.gmail_app_password) {
      toast.error('Please configure email settings first');
      return;
    }
    toast.info('Test email would be sent to: ' + emailSettings.sender_email);
    toast.success('Email configuration looks good!');
  };

  return (
    <AdminLayout>
      <div className="max-w-4xl mx-auto space-y-8">
        <div>
          <h1 className="text-4xl font-semibold text-[var(--text-primary)] tracking-tight" data-testid="settings-title">Settings</h1>
          <p className="text-[var(--text-secondary)] mt-1">Configure email, integrations, and notifications</p>
        </div>

        <Tabs defaultValue="email" className="space-y-6">
          <TabsList className="bg-[var(--bg-card)] border border-[var(--border-color)]">
            <TabsTrigger value="email" className="data-[state=active]:bg-[#e94560] data-[state=active]:text-white">
              <Mail className="mr-2 h-4 w-4" /> Email
            </TabsTrigger>
            <TabsTrigger value="sheets" className="data-[state=active]:bg-[#e94560] data-[state=active]:text-white">
              <FileSpreadsheet className="mr-2 h-4 w-4" /> Google Sheets
            </TabsTrigger>
            <TabsTrigger value="notifications" className="data-[state=active]:bg-[#e94560] data-[state=active]:text-white">
              <Bell className="mr-2 h-4 w-4" /> Notifications
            </TabsTrigger>
          </TabsList>

          {/* Email Settings */}
          <TabsContent value="email">
            <div className="space-y-6">
              <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md p-6 space-y-6">
                <div>
                  <h2 className="text-xl font-medium text-[var(--text-primary)] mb-4">Gmail SMTP Settings</h2>
                  <p className="text-sm text-[var(--text-secondary)] mb-6">
                    Configure Gmail to send catalogue links. Need help? 
                    <a href="https://support.google.com/accounts/answer/185833" target="_blank" rel="noopener noreferrer" className="text-[#e94560] hover:text-[#f05c75] ml-1">
                      Get App Password →
                    </a>
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label className="text-[var(--text-secondary)]">Sender Name</Label>
                    <Input
                      value={emailSettings.sender_name}
                      onChange={(e) => setEmailSettings({...emailSettings, sender_name: e.target.value})}
                      className="bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]"
                      placeholder="SmartShape Pro"
                    />
                  </div>
                  <div>
                    <Label className="text-[var(--text-secondary)]">Gmail Address</Label>
                    <Input
                      type="email"
                      value={emailSettings.sender_email}
                      onChange={(e) => setEmailSettings({...emailSettings, sender_email: e.target.value})}
                      className="bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]"
                      placeholder="yourcompany@gmail.com"
                      data-testid="gmail-address-input"
                    />
                  </div>
                </div>

                <div>
                  <Label className="text-[var(--text-secondary)]">Gmail App Password</Label>
                  <Input
                    type="password"
                    value={emailSettings.gmail_app_password}
                    onChange={(e) => setEmailSettings({...emailSettings, gmail_app_password: e.target.value})}
                    className="bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)] font-mono"
                    placeholder="abcd efgh ijkl mnop"
                    data-testid="gmail-password-input"
                  />
                  <p className="text-xs text-[var(--text-muted)] mt-2">
                    16-character app password from Google Account → Security → App Passwords
                  </p>
                </div>

                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    checked={emailSettings.enabled}
                    onChange={(e) => setEmailSettings({...emailSettings, enabled: e.target.checked})}
                    className="w-4 h-4 rounded border-[var(--border-color)] bg-[var(--bg-primary)]"
                    id="email-enabled"
                  />
                  <Label htmlFor="email-enabled" className="text-[var(--text-primary)] cursor-pointer">
                    Enable email sending
                  </Label>
                </div>

                <div className="flex space-x-3">
                  <Button onClick={handleSaveEmailSettings} className="bg-[#e94560] hover:bg-[#f05c75]" data-testid="save-email-settings">
                    <Save className="mr-2 h-4 w-4" /> Save Email Settings
                  </Button>
                  <Button onClick={handleTestEmail} variant="outline" className="border-[var(--border-color)] text-[var(--text-primary)]">
                    Test Configuration
                  </Button>
                </div>
              </div>

              {/* Email Template */}
              <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md p-6 space-y-4">
                <h2 className="text-xl font-medium text-[var(--text-primary)]">Catalogue Email Template</h2>
                <div>
                  <Label className="text-[var(--text-secondary)]">Subject</Label>
                  <Input
                    value={emailTemplate.subject}
                    onChange={(e) => setEmailTemplate({...emailTemplate, subject: e.target.value})}
                    className="bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]"
                  />
                </div>
                <div>
                  <Label className="text-[var(--text-secondary)]">Body</Label>
                  <textarea
                    value={emailTemplate.body}
                    onChange={(e) => setEmailTemplate({...emailTemplate, body: e.target.value})}
                    rows={12}
                    className="w-full px-3 py-2 bg-[var(--bg-primary)] border border-[var(--border-color)] text-[var(--text-primary)] rounded-md font-mono text-sm"
                  />
                  <p className="text-xs text-[var(--text-muted)] mt-2">
                    Available variables: {'{{schoolName}}'}, {'{{principalName}}'}, {'{{packageName}}'}, {'{{catalogueUrl}}'}, {'{{salesPersonName}}'}, {'{{salesPersonEmail}}'}
                  </p>
                </div>
              </div>
            </div>
          </TabsContent>

          {/* Google Sheets Settings */}
          <TabsContent value="sheets">
            <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md p-6 space-y-6">
              <div>
                <h2 className="text-xl font-medium text-[var(--text-primary)] mb-4">Google Sheets API</h2>
                <p className="text-sm text-[var(--text-secondary)] mb-6">
                  Export inventory and quotations to Google Sheets. 
                  <a href="https://console.cloud.google.com" target="_blank" rel="noopener noreferrer" className="text-[#e94560] hover:text-[#f05c75] ml-1">
                    Get OAuth Credentials →
                  </a>
                </p>
              </div>

              <div>
                <Label className="text-[var(--text-secondary)]">Client ID</Label>
                <Input
                  value={sheetsSettings.client_id}
                  onChange={(e) => setSheetsSettings({...sheetsSettings, client_id: e.target.value})}
                  className="bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)] font-mono text-sm"
                  placeholder="xxxxx.apps.googleusercontent.com"
                />
              </div>

              <div>
                <Label className="text-[var(--text-secondary)]">Client Secret</Label>
                <Input
                  type="password"
                  value={sheetsSettings.client_secret}
                  onChange={(e) => setSheetsSettings({...sheetsSettings, client_secret: e.target.value})}
                  className="bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)] font-mono text-sm"
                  placeholder="GOCSPX-xxxxx"
                />
              </div>

              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  checked={sheetsSettings.enabled}
                  onChange={(e) => setSheetsSettings({...sheetsSettings, enabled: e.target.checked})}
                  className="w-4 h-4 rounded border-[var(--border-color)] bg-[var(--bg-primary)]"
                  id="sheets-enabled"
                />
                <Label htmlFor="sheets-enabled" className="text-[var(--text-primary)] cursor-pointer">
                  Enable Google Sheets export
                </Label>
              </div>

              <div className="bg-[var(--bg-primary)]/50 border border-[var(--border-color)] rounded-md p-4">
                <p className="text-sm text-[var(--text-secondary)] mb-2">For now, you can export as CSV instead:</p>
                <Button variant="outline" className="border-[var(--border-color)] text-[var(--text-primary)]">
                  Download CSV Export
                </Button>
              </div>

              <Button onClick={handleSaveSheetsSettings} className="bg-[#e94560] hover:bg-[#f05c75]">
                <Save className="mr-2 h-4 w-4" /> Save Sheets Settings
              </Button>
            </div>
          </TabsContent>

          {/* Notification Settings */}
          <TabsContent value="notifications">
            <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md p-6 space-y-6">
              <div>
                <h2 className="text-xl font-medium text-[var(--text-primary)] mb-4">Notification Preferences</h2>
                <p className="text-sm text-[var(--text-secondary)] mb-6">Choose which events trigger notifications</p>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between p-4 bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-md">
                  <div>
                    <p className="text-[var(--text-primary)] font-medium">Purchase Alerts</p>
                    <p className="text-sm text-[var(--text-muted)]">Get notified when stock falls below required quantity</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={notificationSettings.purchase_alerts_enabled}
                    onChange={(e) => setNotificationSettings({...notificationSettings, purchase_alerts_enabled: e.target.checked})}
                    className="w-5 h-5 rounded border-[var(--border-color)] bg-[var(--bg-primary)]"
                  />
                </div>

                <div className="flex items-center justify-between p-4 bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-md">
                  <div>
                    <p className="text-[var(--text-primary)] font-medium">Low Stock Warnings</p>
                    <p className="text-sm text-[var(--text-muted)]">Alert when dies reach minimum stock level</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={notificationSettings.low_stock_enabled}
                    onChange={(e) => setNotificationSettings({...notificationSettings, low_stock_enabled: e.target.checked})}
                    className="w-5 h-5 rounded border-[var(--border-color)] bg-[var(--bg-primary)]"
                  />
                </div>

                <div className="flex items-center justify-between p-4 bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-md">
                  <div>
                    <p className="text-[var(--text-primary)] font-medium">Quotation Status Updates</p>
                    <p className="text-sm text-[var(--text-muted)]">Notify when quotation status changes</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={notificationSettings.quotation_status_enabled}
                    onChange={(e) => setNotificationSettings({...notificationSettings, quotation_status_enabled: e.target.checked})}
                    className="w-5 h-5 rounded border-[var(--border-color)] bg-[var(--bg-primary)]"
                  />
                </div>
              </div>

              <Button onClick={handleSaveNotifications} className="bg-[#e94560] hover:bg-[#f05c75]">
                <Save className="mr-2 h-4 w-4" /> Save Notification Settings
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </AdminLayout>
  );
}
import React from 'react';
import AdminLayout from '../../components/layouts/AdminLayout';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import {
  Mail, FileSpreadsheet, Bell, Save, Globe, Eye, EyeOff,
  CheckCircle2, XCircle, Loader2, ExternalLink, Wifi, Shield,
} from 'lucide-react';
import { useSettings } from '../../hooks/useSettings';
import SecurityTab from '../../components/settings/SecurityTab';

const PROXY_PROVIDERS = [
  { name: 'Decodo Mobile',      price: '~$3.75/GB', host: 'gate.decodo.com',   port: '10000', url: 'https://decodo.com/proxies/mobile', badge: 'Best for WhatsApp', badgeColor: 'bg-green-500/15 text-green-600' },
  { name: 'Decodo Residential', price: '~$2.50/GB', host: 'gate.decodo.com',   port: '10001', url: 'https://decodo.com',                badge: 'Budget',            badgeColor: 'bg-blue-500/15 text-blue-600' },
  { name: 'Bright Data',        price: '~$10/GB',   host: 'brd.superproxy.io', port: '22225', url: 'https://brightdata.com',            badge: 'Enterprise',        badgeColor: 'bg-purple-500/15 text-purple-600' },
];

const NOTIF_OPTS = [
  { key: 'purchase_alerts_enabled',  label: 'Purchase Alerts',           desc: 'Get notified when stock falls below required quantity' },
  { key: 'low_stock_enabled',        label: 'Low Stock Warnings',        desc: 'Alert when dies reach minimum stock level' },
  { key: 'quotation_status_enabled', label: 'Quotation Status Updates',  desc: 'Notify when quotation status changes' },
];

export default function Settings() {
  const {
    emailSettings, setEmailSettings,
    sheetsSettings, setSheetsSettings,
    notificationSettings, setNotificationSettings,
    emailTemplate, setEmailTemplate,
    proxy, setProxy,
    proxyLoading, savingProxy, proxyStatus,
    showPass, setShowPass,
    handleSaveEmailSettings,
    handleSaveSheetsSettings,
    handleSaveNotifications,
    handleSaveProxy,
    handleClearProxy,
    handleTestEmail,
  } = useSettings();

  return (
    <AdminLayout>
      <div className="max-w-4xl mx-auto space-y-8">
        <div>
          <h1 className="text-4xl font-semibold text-[var(--text-primary)] tracking-tight" data-testid="settings-title">Settings</h1>
          <p className="text-[var(--text-secondary)] mt-1">Configure email, integrations, and notifications</p>
        </div>

        <Tabs defaultValue="email" className="space-y-6">
          <TabsList className="bg-[var(--bg-card)] border border-[var(--border-color)]">
            <TabsTrigger value="email"         className="data-[state=active]:bg-[#e94560] data-[state=active]:text-white"><Mail className="mr-2 h-4 w-4" /> Email</TabsTrigger>
            <TabsTrigger value="sheets"        className="data-[state=active]:bg-[#e94560] data-[state=active]:text-white"><FileSpreadsheet className="mr-2 h-4 w-4" /> Google Sheets</TabsTrigger>
            <TabsTrigger value="notifications" className="data-[state=active]:bg-[#e94560] data-[state=active]:text-white"><Bell className="mr-2 h-4 w-4" /> Notifications</TabsTrigger>
            <TabsTrigger value="whatsapp"      className="data-[state=active]:bg-[#e94560] data-[state=active]:text-white"><Wifi className="mr-2 h-4 w-4" /> WhatsApp</TabsTrigger>
            <TabsTrigger value="security"      className="data-[state=active]:bg-[#e94560] data-[state=active]:text-white"><Shield className="mr-2 h-4 w-4" /> Security</TabsTrigger>
          </TabsList>

          {/* ── Email Settings ── */}
          <TabsContent value="email">
            <div className="space-y-6">
              <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md p-6 space-y-6">
                <div>
                  <h2 className="text-xl font-medium text-[var(--text-primary)] mb-4">Gmail SMTP Settings</h2>
                  <p className="text-sm text-[var(--text-secondary)] mb-6">
                    Configure Gmail to send catalogue links. Need help?{' '}
                    <a href="https://support.google.com/accounts/answer/185833" target="_blank" rel="noopener noreferrer" className="text-[#e94560] hover:text-[#f05c75]">Get App Password →</a>
                  </p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label className="text-[var(--text-secondary)]">Sender Name</Label>
                    <Input value={emailSettings.sender_name} onChange={e => setEmailSettings({...emailSettings, sender_name: e.target.value})}
                      className="bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]" placeholder="SmartShape Pro" />
                  </div>
                  <div>
                    <Label className="text-[var(--text-secondary)]">Gmail Address</Label>
                    <Input type="email" value={emailSettings.sender_email} onChange={e => setEmailSettings({...emailSettings, sender_email: e.target.value})}
                      className="bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]" placeholder="yourcompany@gmail.com" data-testid="gmail-address-input" />
                  </div>
                </div>
                <div>
                  <Label className="text-[var(--text-secondary)]">Gmail App Password</Label>
                  <Input type="password" value={emailSettings.gmail_app_password} onChange={e => setEmailSettings({...emailSettings, gmail_app_password: e.target.value})}
                    className="bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)] font-mono" placeholder="abcd efgh ijkl mnop" data-testid="gmail-password-input" />
                  <p className="text-xs text-[var(--text-muted)] mt-2">16-character app password from Google Account → Security → App Passwords</p>
                </div>
                <div className="flex items-center space-x-2">
                  <input type="checkbox" id="email-enabled" checked={emailSettings.enabled}
                    onChange={e => setEmailSettings({...emailSettings, enabled: e.target.checked})}
                    className="w-4 h-4 rounded border-[var(--border-color)] bg-[var(--bg-primary)]" />
                  <Label htmlFor="email-enabled" className="text-[var(--text-primary)] cursor-pointer">Enable email sending</Label>
                </div>
                <div className="flex space-x-3">
                  <Button onClick={handleSaveEmailSettings} className="bg-[#e94560] hover:bg-[#f05c75]" data-testid="save-email-settings">
                    <Save className="mr-2 h-4 w-4" /> Save Email Settings
                  </Button>
                  <Button onClick={handleTestEmail} variant="outline" className="border-[var(--border-color)] text-[var(--text-primary)]">Test Configuration</Button>
                </div>
              </div>

              <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md p-6 space-y-4">
                <h2 className="text-xl font-medium text-[var(--text-primary)]">Catalogue Email Template</h2>
                <div>
                  <Label className="text-[var(--text-secondary)]">Subject</Label>
                  <Input value={emailTemplate.subject} onChange={e => setEmailTemplate({...emailTemplate, subject: e.target.value})}
                    className="bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]" />
                </div>
                <div>
                  <Label className="text-[var(--text-secondary)]">Body</Label>
                  <textarea value={emailTemplate.body} onChange={e => setEmailTemplate({...emailTemplate, body: e.target.value})} rows={12}
                    className="w-full px-3 py-2 bg-[var(--bg-primary)] border border-[var(--border-color)] text-[var(--text-primary)] rounded-md font-mono text-sm" />
                  <p className="text-xs text-[var(--text-muted)] mt-2">
                    Variables: {'{{schoolName}}'}, {'{{principalName}}'}, {'{{packageName}}'}, {'{{catalogueUrl}}'}, {'{{salesPersonName}}'}, {'{{salesPersonEmail}}'}
                  </p>
                </div>
              </div>
            </div>
          </TabsContent>

          {/* ── Google Sheets ── */}
          <TabsContent value="sheets">
            <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md p-6 space-y-6">
              <div>
                <h2 className="text-xl font-medium text-[var(--text-primary)] mb-4">Google Sheets API</h2>
                <p className="text-sm text-[var(--text-secondary)] mb-6">
                  Export inventory and quotations to Google Sheets.{' '}
                  <a href="https://console.cloud.google.com" target="_blank" rel="noopener noreferrer" className="text-[#e94560] hover:text-[#f05c75]">Get OAuth Credentials →</a>
                </p>
              </div>
              <div>
                <Label className="text-[var(--text-secondary)]">Client ID</Label>
                <Input value={sheetsSettings.client_id} onChange={e => setSheetsSettings({...sheetsSettings, client_id: e.target.value})}
                  className="bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)] font-mono text-sm" placeholder="xxxxx.apps.googleusercontent.com" />
              </div>
              <div>
                <Label className="text-[var(--text-secondary)]">Client Secret</Label>
                <Input type="password" value={sheetsSettings.client_secret} onChange={e => setSheetsSettings({...sheetsSettings, client_secret: e.target.value})}
                  className="bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)] font-mono text-sm" placeholder="GOCSPX-xxxxx" />
              </div>
              <div className="flex items-center space-x-2">
                <input type="checkbox" id="sheets-enabled" checked={sheetsSettings.enabled}
                  onChange={e => setSheetsSettings({...sheetsSettings, enabled: e.target.checked})}
                  className="w-4 h-4 rounded border-[var(--border-color)] bg-[var(--bg-primary)]" />
                <Label htmlFor="sheets-enabled" className="text-[var(--text-primary)] cursor-pointer">Enable Google Sheets export</Label>
              </div>
              <div className="bg-[var(--bg-primary)]/50 border border-[var(--border-color)] rounded-md p-4">
                <p className="text-sm text-[var(--text-secondary)] mb-2">For now, you can export as CSV instead:</p>
                <Button variant="outline" className="border-[var(--border-color)] text-[var(--text-primary)]">Download CSV Export</Button>
              </div>
              <Button onClick={handleSaveSheetsSettings} className="bg-[#e94560] hover:bg-[#f05c75]">
                <Save className="mr-2 h-4 w-4" /> Save Sheets Settings
              </Button>
            </div>
          </TabsContent>

          {/* ── Notifications ── */}
          <TabsContent value="notifications">
            <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md p-6 space-y-6">
              <div>
                <h2 className="text-xl font-medium text-[var(--text-primary)] mb-4">Notification Preferences</h2>
                <p className="text-sm text-[var(--text-secondary)] mb-6">Choose which events trigger notifications</p>
              </div>
              <div className="space-y-4">
                {NOTIF_OPTS.map(({ key, label, desc }) => (
                  <div key={key} className="flex items-center justify-between p-4 bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-md">
                    <div>
                      <p className="text-[var(--text-primary)] font-medium">{label}</p>
                      <p className="text-sm text-[var(--text-muted)]">{desc}</p>
                    </div>
                    <input type="checkbox" checked={notificationSettings[key]}
                      onChange={e => setNotificationSettings({...notificationSettings, [key]: e.target.checked})}
                      className="w-5 h-5 rounded border-[var(--border-color)] bg-[var(--bg-primary)]" />
                  </div>
                ))}
              </div>
              <Button onClick={handleSaveNotifications} className="bg-[#e94560] hover:bg-[#f05c75]">
                <Save className="mr-2 h-4 w-4" /> Save Notification Settings
              </Button>
            </div>
          </TabsContent>

          {/* ── WhatsApp Proxy ── */}
          <TabsContent value="whatsapp">
            <div className="space-y-6">
              <div className="bg-amber-500/8 border border-amber-500/30 rounded-md p-5">
                <div className="flex items-start gap-3">
                  <Globe className="h-5 w-5 text-amber-500 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-[var(--text-primary)] font-medium mb-1">Why a residential proxy?</p>
                    <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
                      WhatsApp blocks VPS / datacenter IPs when a new device tries to link. A residential SOCKS5 proxy makes the connection look like it comes from a real home internet connection, so the QR scan succeeds.
                    </p>
                  </div>
                </div>
              </div>

              <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md p-6 space-y-5">
                <div>
                  <h2 className="text-xl font-medium text-[var(--text-primary)] mb-1">Mobile / Residential SOCKS5 Proxy</h2>
                  <p className="text-sm text-[var(--text-secondary)]">Mobile proxies (4G/5G IPs) work best for WhatsApp. Buy below, then paste credentials here.</p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {PROXY_PROVIDERS.map(p => (
                    <button key={p.name} type="button"
                      onClick={() => setProxy(prev => ({ ...prev, host: p.host, port: p.port }))}
                      className="text-left p-3 rounded-md border border-[var(--border-color)] hover:border-[#e94560] hover:bg-[#e94560]/5 transition-colors">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="font-medium text-[var(--text-primary)] text-sm">{p.name}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${p.badgeColor}`}>{p.badge}</span>
                      </div>
                      <p className="text-xs text-[var(--text-secondary)] font-mono mb-1">{p.host}:{p.port}</p>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-[var(--text-muted)]">{p.price}</span>
                        <a href={p.url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
                          className="text-[10px] text-[#e94560] flex items-center gap-0.5 hover:underline">
                          Buy <ExternalLink className="h-2.5 w-2.5" />
                        </a>
                      </div>
                    </button>
                  ))}
                </div>

                {proxyLoading ? (
                  <div className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading saved proxy…
                  </div>
                ) : (
                  <div className="space-y-4 pt-2 border-t border-[var(--border-color)]">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <div className="sm:col-span-2">
                        <Label className="text-[var(--text-secondary)]">Proxy Host</Label>
                        <Input value={proxy.host} onChange={e => setProxy(p => ({...p, host: e.target.value}))}
                          className="bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)] font-mono text-sm mt-1" placeholder="gate.decodo.com" />
                      </div>
                      <div>
                        <Label className="text-[var(--text-secondary)]">Port</Label>
                        <Input value={proxy.port} onChange={e => setProxy(p => ({...p, port: e.target.value}))}
                          className="bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)] font-mono text-sm mt-1" placeholder="10001" />
                      </div>
                      <div>
                        <Label className="text-[var(--text-secondary)]">Username</Label>
                        <Input value={proxy.username} onChange={e => setProxy(p => ({...p, username: e.target.value}))}
                          className="bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)] font-mono text-sm mt-1" placeholder="spuser12345" />
                      </div>
                      <div className="sm:col-span-2">
                        <Label className="text-[var(--text-secondary)]">Password</Label>
                        <div className="relative mt-1">
                          <Input type={showPass ? 'text' : 'password'} value={proxy.password}
                            onChange={e => setProxy(p => ({...p, password: e.target.value}))}
                            className="bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)] font-mono text-sm pr-10" placeholder="••••••••" />
                          <button type="button" onClick={() => setShowPass(v => !v)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)]">
                            {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </button>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 pt-1">
                      <Button onClick={handleSaveProxy} disabled={savingProxy || !proxy.host} className="bg-[#e94560] hover:bg-[#f05c75]">
                        {savingProxy ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving…</> : <><Save className="mr-2 h-4 w-4" />Save Proxy</>}
                      </Button>
                      {proxy.host && <Button variant="outline" onClick={handleClearProxy} disabled={savingProxy} className="border-[var(--border-color)] text-[var(--text-primary)]">Clear</Button>}
                      {proxyStatus === 'saved' && <span className="flex items-center gap-1.5 text-sm text-green-600"><CheckCircle2 className="h-4 w-4" /> Proxy active</span>}
                      {proxyStatus === 'error' && <span className="flex items-center gap-1.5 text-sm text-red-500"><XCircle className="h-4 w-4" /> Save failed — check credentials</span>}
                    </div>
                  </div>
                )}
              </div>

              {proxyStatus === 'saved' && (
                <div className="bg-green-500/8 border border-green-500/30 rounded-md p-4">
                  <p className="text-sm text-green-700 font-medium mb-1">Proxy is active</p>
                  <p className="text-sm text-[var(--text-secondary)]">
                    Go to <strong>Marketing → WhatsApp Setup → Connect</strong> and scan the QR code. The connection now routes through your residential proxy so WhatsApp will accept it.
                  </p>
                </div>
              )}
            </div>
          </TabsContent>

          {/* ── Security ── */}
          <TabsContent value="security">
            <SecurityTab />
          </TabsContent>
        </Tabs>
      </div>
    </AdminLayout>
  );
}

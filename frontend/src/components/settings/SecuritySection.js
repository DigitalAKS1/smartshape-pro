import React from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Save, Eye, EyeOff, Send, MessageSquare, Plus, Edit2, Trash2, X, Clock } from 'lucide-react';

/**
 * SecuritySection — Gmail SMTP, WhatsApp auto-sender, WhatsApp templates,
 * and Scheduled WhatsApp messages.
 *
 * These were the 'email', 'whatsapp', and 'scheduled' tabs in the original file.
 * The component renders the section content for whichever activeTab is passed.
 */
export default function SecuritySection({
  activeTab,
  // Email
  emailSettings, setEmailSettings, showAppPwd, setShowAppPwd,
  testEmail, setTestEmail, testEmailSending, saving, saveEmail, handleTestEmail,
  // WhatsApp
  wa, setWa, showWaPwd, setShowWaPwd,
  testPhone, setTestPhone, testMessage, setTestMessage, testWaSending,
  saveWa, handleTestWa,
  // WA Templates
  waTemplates, tplForm, setTplForm, tplEditing, setTplEditing,
  startNewTpl, editTpl, saveTpl, deleteTpl,
  // Scheduled
  scheduledMsgs, schedFilter, setSchedFilter,
  schedFormOpen, setSchedFormOpen, schedForm, setSchedForm,
  saveSchedMsg, cancelSchedMsg,
}) {
  const card      = 'bg-[var(--bg-card)] border-[var(--border-color)]';
  const inputCls  = 'bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]';
  const textPri   = 'text-[var(--text-primary)]';
  const textSec   = 'text-[var(--text-secondary)]';
  const textMuted = 'text-[var(--text-muted)]';

  if (activeTab === 'email') return (
    <div className="space-y-4">
      <div className={`${card} border rounded-md p-5 space-y-4`} data-testid="email-settings">
        <h2 className={`text-lg font-medium ${textPri}`}>Gmail SMTP Integration</h2>
        <p className={`text-sm ${textMuted}`}>Send emails directly from your Gmail. Requires a Google App Password.</p>
        <div className="bg-blue-500/10 border border-blue-500/20 rounded-md p-3 text-sm text-blue-400">
          <strong>Setup:</strong> Go to{' '}
          <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer" className="underline">
            Google App Passwords
          </a>{' '}
          → Create app password → Paste below.
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <Label className={`${textSec} text-xs`}>Sender Name</Label>
            <Input value={emailSettings.sender_name} onChange={e => setEmailSettings({...emailSettings, sender_name: e.target.value})} className={inputCls} />
          </div>
          <div>
            <Label className={`${textSec} text-xs`}>Gmail Address</Label>
            <Input type="email" value={emailSettings.sender_email} onChange={e => setEmailSettings({...emailSettings, sender_email: e.target.value})} className={inputCls} placeholder="you@gmail.com" data-testid="gmail-email-input" />
          </div>
        </div>
        <div>
          <Label className={`${textSec} text-xs`}>App Password</Label>
          <div className="relative">
            <Input type={showAppPwd ? 'text' : 'password'} value={emailSettings.gmail_app_password}
              onChange={e => setEmailSettings({...emailSettings, gmail_app_password: e.target.value})}
              className={`${inputCls} pr-10 font-mono`} placeholder="xxxx xxxx xxxx xxxx" data-testid="gmail-password-input" />
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
  );

  if (activeTab === 'whatsapp') return (
    <div className="space-y-4">
      {/* Credentials */}
      <div className={`${card} border rounded-md p-5 space-y-4`} data-testid="whatsapp-settings">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-5 w-5 text-green-400" />
          <h2 className={`text-lg font-medium ${textPri}`}>WhatsApp Auto Sender</h2>
        </div>
        <p className={`text-sm ${textMuted}`}>Connect to MessageAutoSender API for WhatsApp messages.</p>
        <div className="bg-green-500/10 border border-green-500/20 rounded-md p-3 text-sm text-green-400">
          Get credentials from{' '}
          <a href="https://app.messageautosender.com" target="_blank" rel="noreferrer" className="underline font-medium">
            app.messageautosender.com
          </a>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <Label className={`${textSec} text-xs`}>Username / API ID</Label>
            <Input value={wa.username} onChange={e => setWa({...wa, username: e.target.value})} className={`${inputCls} font-mono`} placeholder="Your API username" data-testid="wa-username-input" />
          </div>
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

      {/* Test message */}
      <div className={`${card} border rounded-md p-5 space-y-3`}>
        <h3 className={`text-sm font-medium ${textPri}`}>Send Test Message</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <Label className={`${textSec} text-xs`}>Phone (with country code)</Label>
            <Input value={testPhone} onChange={e => setTestPhone(e.target.value)} placeholder="919876543210" className={inputCls} data-testid="test-wa-phone" />
          </div>
          <div>
            <Label className={`${textSec} text-xs`}>Message</Label>
            <Input value={testMessage} onChange={e => setTestMessage(e.target.value)} className={inputCls} />
          </div>
        </div>
        <Button onClick={handleTestWa} disabled={testWaSending} variant="outline" className={`border-[var(--border-color)] ${textSec}`} data-testid="send-test-wa-btn">
          <Send className="mr-1.5 h-4 w-4" /> {testWaSending ? 'Sending...' : 'Send Test WhatsApp'}
        </Button>
      </div>

      {/* Template Master */}
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
          <div className="bg-[var(--bg-primary)] border border-[#e94560]/30 rounded-md p-3 space-y-2">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <Input value={tplForm.name} onChange={e => setTplForm({...tplForm, name: e.target.value})} placeholder="Name *" className={`${inputCls} text-sm`} data-testid="wa-tpl-name-input" />
              <select value={tplForm.module} onChange={e => setTplForm({...tplForm, module: e.target.value})} className={`h-10 px-3 rounded-md text-sm ${inputCls}`} data-testid="wa-tpl-module-select">
                {['general','lead','contact','school','visit','quotation','order','dispatch'].map(m => (
                  <option key={m} value={m}>{m.charAt(0).toUpperCase()+m.slice(1)}</option>
                ))}
              </select>
              <select value={tplForm.category} onChange={e => setTplForm({...tplForm, category: e.target.value})} className={`h-10 px-3 rounded-md text-sm ${inputCls}`} data-testid="wa-tpl-category-select">
                {[['thankyou','Thank You'],['reminder','Reminder'],['followup','Follow-up'],['marketing','Marketing'],['intro','Intro'],['custom','Custom']].map(([v,l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </div>
            <textarea rows={4} value={tplForm.body} onChange={e => setTplForm({...tplForm, body: e.target.value})}
              placeholder="Message body. Use {contact_name}, {school_name}, {my_name}..."
              className={`w-full px-3 py-2 rounded-md text-sm ${inputCls}`} data-testid="wa-tpl-body-input" />
            <div className="flex gap-2">
              <Button size="sm" onClick={saveTpl} className="bg-[#e94560] hover:bg-[#f05c75] text-white" data-testid="wa-tpl-save-btn">Save</Button>
              <Button size="sm" variant="ghost" onClick={() => setTplEditing(false)} className={textSec}>Cancel</Button>
            </div>
          </div>
        )}

        <div className="space-y-1">
          {waTemplates.length === 0 ? (
            <p className={`text-xs ${textMuted} text-center py-4`}>No templates yet</p>
          ) : waTemplates.map(t => (
            <div key={t.template_id} className={`flex items-center gap-2 ${card} border rounded-md p-2.5`} data-testid={`wa-tpl-row-${t.template_id}`}>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`${textPri} text-sm font-medium truncate`}>{t.name}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#e94560]/15 text-[#e94560] capitalize">{t.module}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-400 capitalize">{t.category}</span>
                  {t.is_default && <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/15 text-green-400">Default</span>}
                </div>
                <p className={`text-xs ${textMuted} mt-0.5 line-clamp-2`}>{t.body}</p>
              </div>
              <Button size="sm" variant="ghost" onClick={() => editTpl(t)} className={`${textSec} h-7`} data-testid={`wa-tpl-edit-${t.template_id}`}><Edit2 className="h-3 w-3" /></Button>
              <Button size="sm" variant="ghost" onClick={() => deleteTpl(t.template_id)} className="text-red-400 h-7" data-testid={`wa-tpl-delete-${t.template_id}`}><Trash2 className="h-3 w-3" /></Button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  if (activeTab === 'scheduled') return (
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
        <Button size="sm"
          onClick={() => { setSchedForm({ phone: '', contact_name: '', message: '', scheduled_at: '' }); setSchedFormOpen(true); }}
          className="bg-[#e94560] hover:bg-[#f05c75] text-white">
          <Plus className="mr-1 h-3 w-3" /> Schedule Message
        </Button>
      </div>

      {schedFormOpen && (
        <div className={`${card} border rounded-md p-4 space-y-3`}>
          <h3 className={`text-sm font-medium ${textPri}`}>New Scheduled Message</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label className={`${textSec} text-xs`}>Phone (with country code) *</Label>
              <Input value={schedForm.phone} onChange={e => setSchedForm({...schedForm, phone: e.target.value})} placeholder="919876543210" className={inputCls} />
            </div>
            <div>
              <Label className={`${textSec} text-xs`}>Contact Name</Label>
              <Input value={schedForm.contact_name} onChange={e => setSchedForm({...schedForm, contact_name: e.target.value})} placeholder="Optional" className={inputCls} />
            </div>
            <div className="sm:col-span-2">
              <Label className={`${textSec} text-xs`}>Message *</Label>
              <textarea rows={3} value={schedForm.message} onChange={e => setSchedForm({...schedForm, message: e.target.value})}
                placeholder="WhatsApp message text..." className={`w-full px-3 py-2 rounded-md text-sm ${inputCls}`} />
            </div>
            <div>
              <Label className={`${textSec} text-xs`}>Schedule At *</Label>
              <Input type="datetime-local" value={schedForm.scheduled_at} onChange={e => setSchedForm({...schedForm, scheduled_at: e.target.value})} className={inputCls} />
            </div>
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
            <thead>
              <tr className="bg-[var(--bg-primary)]">
                <th className={`text-left text-xs uppercase py-3 px-4 ${textMuted}`}>Scheduled At</th>
                <th className={`text-left text-xs uppercase py-3 px-4 ${textMuted}`}>Contact</th>
                <th className={`text-left text-xs uppercase py-3 px-4 ${textMuted} hidden sm:table-cell`}>Phone</th>
                <th className={`text-left text-xs uppercase py-3 px-4 ${textMuted} hidden md:table-cell`}>Message</th>
                <th className={`text-center text-xs uppercase py-3 px-4 ${textMuted}`}>Status</th>
                <th className={`text-right text-xs uppercase py-3 px-4 ${textMuted}`}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {scheduledMsgs.length === 0 ? (
                <tr><td colSpan="6" className={`py-10 text-center ${textMuted}`}>No scheduled messages</td></tr>
              ) : scheduledMsgs.map(m => (
                <tr key={m.schedule_id} className="border-t border-[var(--border-color)] hover:bg-[var(--bg-hover)]">
                  <td className={`py-2.5 px-4 text-xs ${textSec} whitespace-nowrap`}>{m.scheduled_at ? new Date(m.scheduled_at).toLocaleString() : '—'}</td>
                  <td className={`py-2.5 px-4 text-sm ${textPri}`}>{m.contact_name || '—'}</td>
                  <td className={`py-2.5 px-4 text-xs ${textSec} hidden sm:table-cell`}>{m.phone}</td>
                  <td className="py-2.5 px-4 hidden md:table-cell">
                    <p className={`text-xs ${textMuted} line-clamp-2 max-w-[280px]`}>{m.message}</p>
                  </td>
                  <td className="py-2.5 px-4 text-center">
                    <span className={`text-[11px] px-2 py-0.5 rounded font-medium ${
                      m.status === 'sent'      ? 'bg-green-500/20 text-green-400' :
                      m.status === 'failed'    ? 'bg-red-500/20 text-red-400'     :
                      m.status === 'cancelled' ? 'bg-gray-500/20 text-gray-400'   :
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
  );

  return null;
}

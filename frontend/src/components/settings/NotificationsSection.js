import React from 'react';
import { Button } from '../ui/button';
import { Save } from 'lucide-react';

const NOTIF_OPTS = [
  { key: 'purchase_alerts_enabled',  label: 'Purchase Alerts',          desc: 'Get notified when stock falls below required quantity' },
  { key: 'low_stock_enabled',        label: 'Low Stock Warnings',       desc: 'Alert when dies reach minimum stock level' },
  { key: 'quotation_status_enabled', label: 'Quotation Status Updates', desc: 'Notify when quotation status changes' },
];

const AUTOMATION_OPTS = [
  { key: 'auto_create_so_on_submit', label: 'Auto-create Sales Order on catalogue submit',
    desc: 'When a school submits its product selection, automatically generate the Sales Order and start production. Turn off to require a manual "Create Sales Order" step.' },
];

export default function NotificationsSection({ prefs, setPrefs, save }) {
  return (
    <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md p-6 space-y-6">
      <h2 className="text-xl font-medium text-[var(--text-primary)]">Notification Preferences</h2>
      <div className="space-y-4">
        {NOTIF_OPTS.map(({ key, label, desc }) => (
          <div key={key} className="flex items-center justify-between p-4 bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-md">
            <div>
              <p className="text-[var(--text-primary)] font-medium">{label}</p>
              <p className="text-sm text-[var(--text-muted)]">{desc}</p>
            </div>
            <input type="checkbox" checked={!!prefs[key]}
              onChange={e => setPrefs({ ...prefs, [key]: e.target.checked })}
              className="w-5 h-5 rounded border-[var(--border-color)] bg-[var(--bg-primary)]" />
          </div>
        ))}
      </div>

      <h2 className="text-xl font-medium text-[var(--text-primary)] pt-2">Automation</h2>
      <div className="space-y-4">
        {AUTOMATION_OPTS.map(({ key, label, desc }) => (
          <div key={key} className="flex items-center justify-between p-4 bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-md">
            <div className="pr-4">
              <p className="text-[var(--text-primary)] font-medium">{label}</p>
              <p className="text-sm text-[var(--text-muted)]">{desc}</p>
            </div>
            <input type="checkbox" checked={prefs[key] !== false}
              onChange={e => setPrefs({ ...prefs, [key]: e.target.checked })}
              className="w-5 h-5 rounded border-[var(--border-color)] bg-[var(--bg-primary)] flex-shrink-0" />
          </div>
        ))}
      </div>
      <Button onClick={save} className="bg-[#e94560] hover:bg-[#f05c75]">
        <Save className="mr-2 h-4 w-4" /> Save Notification Settings
      </Button>
    </div>
  );
}

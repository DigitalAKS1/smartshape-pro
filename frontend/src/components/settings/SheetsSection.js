import React from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Save, FileSpreadsheet } from 'lucide-react';
import IntegrationStatusChip from './IntegrationStatusChip';

export default function SheetsSection({ sheets, setSheets, save, configured }) {
  return (
    <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-medium text-[var(--text-primary)] flex items-center gap-2">
          <FileSpreadsheet className="h-5 w-5" /> Google Sheets API
        </h2>
        <IntegrationStatusChip configured={configured} />
      </div>
      <p className="text-sm text-[var(--text-secondary)]">Export inventory and quotations to Google Sheets.</p>
      <div>
        <Label className="text-[var(--text-secondary)]">Client ID</Label>
        <Input value={sheets.client_id} onChange={e => setSheets({ ...sheets, client_id: e.target.value })}
          className="bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)] font-mono text-sm"
          placeholder="xxxxx.apps.googleusercontent.com" />
      </div>
      <div>
        <Label className="text-[var(--text-secondary)]">Client Secret</Label>
        <Input type="password" value={sheets.client_secret} onChange={e => setSheets({ ...sheets, client_secret: e.target.value })}
          className="bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)] font-mono text-sm"
          placeholder="GOCSPX-xxxxx" />
      </div>
      <Button onClick={save} className="bg-[#e94560] hover:bg-[#f05c75]">
        <Save className="mr-2 h-4 w-4" /> Save Sheets Settings
      </Button>
    </div>
  );
}

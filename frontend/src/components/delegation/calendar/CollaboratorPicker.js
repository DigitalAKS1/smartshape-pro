import React, { useState } from 'react';
import { X, Plus } from 'lucide-react';

const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

/**
 * Pick teammates (from options) + add external email chips.
 * value = { emp_ids: string[], emails: string[] }; onChange(value).
 */
export default function CollaboratorPicker({ value, onChange, teamOptions = [], textPri, textSec, textMuted, inputCls }) {
  const { emp_ids = [], emails = [] } = value || {};
  const [emailInput, setEmailInput] = useState('');

  const toggleEmp = (id) =>
    onChange({ emp_ids: emp_ids.includes(id) ? emp_ids.filter(x => x !== id) : [...emp_ids, id], emails });

  const addEmail = () => {
    const e = emailInput.trim();
    if (e && isEmail(e) && !emails.includes(e)) onChange({ emp_ids, emails: [...emails, e] });
    setEmailInput('');
  };
  const removeEmail = (e) => onChange({ emp_ids, emails: emails.filter(x => x !== e) });

  const lbl = `block text-[11px] font-semibold uppercase tracking-wide mb-1 ${textMuted}`;

  return (
    <div className="space-y-2">
      <label className={lbl}>Collaborators</label>
      {teamOptions.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {teamOptions.map(o => {
            const on = emp_ids.includes(o.emp_id);
            return (
              <button key={o.emp_id} type="button" onClick={() => toggleEmp(o.emp_id)}
                className={`px-2.5 h-8 rounded-full text-xs border transition-colors ${on ? 'text-white border-transparent' : `${textSec} border-[var(--border-color)]`}`}
                style={on ? { background: '#0ea5e9' } : {}}>
                {o.name}
              </button>
            );
          })}
        </div>
      )}
      <div className="flex gap-2">
        <input value={emailInput} onChange={e => setEmailInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addEmail(); } }}
          placeholder="Add external email…"
          className={`flex-1 h-9 px-2.5 text-sm rounded border border-[var(--border-color)] ${inputCls}`} />
        <button type="button" onClick={addEmail} disabled={!isEmail(emailInput.trim())}
          className="h-9 px-3 rounded-lg text-sm border border-[var(--border-color)]" style={{ color: '#0ea5e9' }}>
          <Plus className="h-4 w-4" />
        </button>
      </div>
      {emails.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {emails.map(e => (
            <span key={e} className={`flex items-center gap-1 pl-2.5 pr-1.5 h-7 rounded-full text-xs border border-[var(--border-color)] ${textSec}`}>
              {e}
              <button type="button" onClick={() => removeEmail(e)} className="p-0.5 rounded hover:bg-[var(--bg-hover)]">
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

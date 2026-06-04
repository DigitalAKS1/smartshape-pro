import React from 'react';
import { Plus, Camera, Check, X } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';

const PINK = '#e94560';
const TODAY = new Date().toISOString().slice(0, 10);

function empColor(id = '') {
  const n = id.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  return `hsl(${(n * 47) % 360}, 55%, 42%)`;
}
function empInitials(name = '') {
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() || '?';
}

export default function DelegationTaskForm({
  rows, setRows, updateRow, saveAllRows, newRow,
  saving, activeRole, myEmp, assignableEmployees, delegators, teamSummary = [],
  card, textPri, textSec, textMuted, inputCls,
}) {
  // workload visibility — open (pending) load per assignable person, so a
  // delegator can see who is already heavy before piling on more.
  const loadById = {};
  (teamSummary || []).forEach(e => { loadById[e.emp_id] = e.pending || 0; });
  const loads = assignableEmployees.map(e => ({ ...e, open: loadById[e.emp_id] || 0 }));
  const maxLoad = Math.max(1, ...loads.map(l => l.open));

  return (
    <div className={`${card} border rounded-xl overflow-hidden`}>
      <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-color)]">
        <div>
          <h2 className={`text-base font-semibold ${textPri}`}>Bulk Task Assignment</h2>
          <p className={`text-xs ${textMuted} mt-0.5`}>One row per assignment — save all at once</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline"
            onClick={() => setRows(r => [...r, newRow(myEmp?.emp_id || '')])}
            className={`border-[var(--border-color)] ${textSec} h-8`}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Add Row
          </Button>
          <Button size="sm" onClick={saveAllRows} disabled={saving}
            className="h-8 text-white font-semibold" style={{ background: PINK }}>
            {saving ? 'Saving…' : `Save All (${rows.filter(r => r.title && r.assignee_id).length})`}
          </Button>
        </div>
      </div>

      {myEmp && (activeRole === 'delegator' || activeRole === 'boss') && (
        <div className="flex items-center gap-3 px-5 py-2.5 border-b border-[var(--border-color)]"
          style={{ background: PINK + '10' }}>
          <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0"
            style={{ background: empColor(myEmp.emp_id) }}>
            {empInitials(myEmp.name)}
          </div>
          <p className="text-xs" style={{ color: PINK }}>
            <strong>Assigning as:</strong> {myEmp.name} · All tasks below will be tagged to you as the {activeRole}
          </p>
        </div>
      )}

      {loads.length > 0 && (
        <div className="px-5 py-3 border-b border-[var(--border-color)]">
          <p className={`text-[10px] font-semibold uppercase tracking-wider ${textMuted} mb-2`}>Current team load · open tasks</p>
          <div className="flex flex-wrap gap-2">
            {loads.map(l => {
              const heavy = l.open >= 8;
              const ratio = Math.round((l.open / maxLoad) * 100);
              return (
                <div key={l.emp_id}
                  className="flex items-center gap-2 pl-1.5 pr-2.5 py-1 rounded-full border"
                  style={{ borderColor: heavy ? PINK + '55' : 'var(--border-color)',
                           background: heavy ? PINK + '10' : 'transparent' }}
                  title={`${l.name}: ${l.open} open task${l.open === 1 ? '' : 's'}${heavy ? ' — already heavy' : ''}`}>
                  <div className="w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-bold text-white flex-shrink-0"
                    style={{ background: empColor(l.emp_id) }}>{empInitials(l.name)}</div>
                  <span className={`text-[11px] ${textSec}`}>{l.name.split(' ')[0]}</span>
                  <span className="text-[11px] font-bold font-mono" style={{ color: heavy ? PINK : 'var(--text-muted)' }}>{l.open}</span>
                  <div className="w-10 h-1 rounded-full bg-[var(--bg-hover)] overflow-hidden hidden sm:block">
                    <div className="h-full rounded-full" style={{ width: `${ratio}%`, background: heavy ? PINK : '#10b981' }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-[var(--bg-primary)] border-b border-[var(--border-color)]">
              {['#', 'Task Title', 'Assign To', 'Buddy', 'Delegator', 'Priority', 'Type', 'Date / Range', '📷', '✓', ''].map((h, i) => (
                <th key={i} className={`py-2.5 px-3 text-left text-[10px] font-semibold uppercase tracking-wider ${textMuted} whitespace-nowrap`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr key={row._id} className={`border-b border-[var(--border-color)] ${idx % 2 === 0 ? 'bg-[var(--bg-card)]' : 'bg-[var(--bg-primary)]'}`}>
                <td className={`px-3 py-2 text-xs ${textMuted} font-mono w-8`}>{idx + 1}</td>
                <td className="px-2 py-1.5 min-w-[200px]">
                  <Input value={row.title} onChange={e => updateRow(row._id, 'title', e.target.value)}
                    placeholder="Task description…"
                    className={`h-8 text-xs ${inputCls} border-0 bg-transparent focus:bg-[var(--bg-hover)] px-2`} />
                </td>
                <td className="px-2 py-1.5 min-w-[160px]">
                  <select value={row.assignee_id} onChange={e => updateRow(row._id, 'assignee_id', e.target.value)}
                    className={`w-full h-8 px-2 rounded text-xs ${inputCls} border border-[var(--border-color)]`}>
                    <option value="">— Select person —</option>
                    {assignableEmployees.map(e => (
                      <option key={e.emp_id} value={e.emp_id}>
                        {e.name}{e.department_name ? ` (${e.department_name})` : ''}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-2 py-1.5 min-w-[150px]">
                  <select value={row.buddy_emp_id || ''} onChange={e => updateRow(row._id, 'buddy_emp_id', e.target.value)}
                    className={`w-full h-8 px-2 rounded text-xs ${inputCls} border border-[var(--border-color)]`}>
                    <option value="">— No buddy —</option>
                    {assignableEmployees.filter(e => e.emp_id !== row.assignee_id).map(e => (
                      <option key={e.emp_id} value={e.emp_id}>{e.name}</option>
                    ))}
                  </select>
                </td>
                <td className="px-2 py-1.5 min-w-[140px]">
                  {(activeRole === 'delegator' || activeRole === 'boss') && myEmp ? (
                    <div className={`h-8 px-2 flex items-center gap-1.5 rounded border border-[var(--border-color)] bg-[var(--bg-primary)] text-xs`}
                      style={{ color: PINK }}>
                      <div className="w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold text-white flex-shrink-0"
                        style={{ background: empColor(myEmp.emp_id) }}>
                        {empInitials(myEmp.name)}
                      </div>
                      <span className="truncate font-semibold">{myEmp.name}</span>
                    </div>
                  ) : (
                    <select value={row.delegator_id} onChange={e => updateRow(row._id, 'delegator_id', e.target.value)}
                      className={`w-full h-8 px-2 rounded text-xs ${inputCls} border border-[var(--border-color)]`}>
                      <option value="">— Assigner —</option>
                      {delegators.map(e => <option key={e.emp_id} value={e.emp_id}>{e.name}</option>)}
                    </select>
                  )}
                </td>
                <td className="px-2 py-1.5 w-28">
                  <select value={row.priority} onChange={e => updateRow(row._id, 'priority', e.target.value)}
                    className={`w-full h-8 px-2 rounded text-xs ${inputCls} border border-[var(--border-color)]`}>
                    <option value="high">🔴 High</option>
                    <option value="medium">🟡 Medium</option>
                    <option value="low">🟢 Low</option>
                  </select>
                </td>
                <td className="px-2 py-1.5 w-28">
                  <select value={row.task_type} onChange={e => updateRow(row._id, 'task_type', e.target.value)}
                    className={`w-full h-8 px-2 rounded text-xs ${inputCls} border border-[var(--border-color)]`}>
                    <option value="onetime">One-time</option>
                    <option value="recurring">Recurring</option>
                  </select>
                  {row.task_type === 'recurring' && (
                    <select value={row.frequency} onChange={e => updateRow(row._id, 'frequency', e.target.value)}
                      className={`w-full h-7 px-2 rounded text-[10px] mt-1 ${inputCls} border border-[var(--border-color)]`}>
                      <option value="daily">Daily</option>
                      <option value="weekly">Weekly</option>
                      <option value="monthly">Monthly</option>
                    </select>
                  )}
                </td>
                <td className="px-2 py-1.5 min-w-[140px]">
                  {row.task_type === 'onetime' ? (
                    <input type="date" value={row.target_date} onChange={e => updateRow(row._id, 'target_date', e.target.value)}
                      className={`w-full h-8 px-2 rounded text-xs ${inputCls} border border-[var(--border-color)]`} />
                  ) : (
                    <div className="space-y-1">
                      <input type="date" value={row.start_date} onChange={e => updateRow(row._id, 'start_date', e.target.value)}
                        className={`w-full h-7 px-2 rounded text-[10px] ${inputCls} border border-[var(--border-color)]`} />
                      <input type="date" value={row.end_date} onChange={e => updateRow(row._id, 'end_date', e.target.value)}
                        className={`w-full h-7 px-2 rounded text-[10px] ${inputCls} border border-[var(--border-color)]`} />
                    </div>
                  )}
                </td>
                <td className="px-3 py-1.5 text-center w-10">
                  <button onClick={() => updateRow(row._id, 'requires_image', !row.requires_image)}
                    className={`w-7 h-7 rounded-lg flex items-center justify-center transition-colors ${row.requires_image ? 'text-white' : `${textMuted} hover:bg-[var(--bg-hover)]`}`}
                    style={row.requires_image ? { background: PINK } : {}}>
                    <Camera className="h-3.5 w-3.5" />
                  </button>
                </td>
                <td className="px-3 py-1.5 text-center w-10">
                  <button onClick={() => updateRow(row._id, 'require_verification', !row.require_verification)}
                    className={`w-7 h-7 rounded-lg flex items-center justify-center transition-colors ${row.require_verification ? 'text-white' : `${textMuted} hover:bg-[var(--bg-hover)]`}`}
                    style={row.require_verification ? { background: '#10b981' } : {}}>
                    <Check className="h-3.5 w-3.5" />
                  </button>
                </td>
                <td className="px-2 py-1.5 w-8">
                  {rows.length > 1 && (
                    <button onClick={() => setRows(rs => rs.filter(r => r._id !== row._id))}
                      className="w-7 h-7 rounded-lg hover:bg-red-500/10 text-red-400 flex items-center justify-center">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className={`px-5 py-3 border-t border-[var(--border-color)] flex items-center gap-5 text-[10px] ${textMuted}`}>
        <span className="flex items-center gap-1.5"><Camera className="h-3 w-3" style={{ color: PINK }} /> = Photo proof required</span>
        <span className="flex items-center gap-1.5"><Check className="h-3 w-3 text-green-500" /> = Needs sign-off</span>
      </div>
    </div>
  );
}

import React from 'react';
import { Target, Save } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';

/**
 * Monthly sales targets setting tab.
 * Props: targetMonth, setTargetMonth, salesReps, targetRows, setTargetRows, savingTarget, saveTarget
 */
export default function SalesTargetsTab({ targetMonth, setTargetMonth, salesReps, targetRows, setTargetRows, savingTarget, saveTarget }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-[var(--text-primary)] flex items-center gap-2">
            <Target className="h-5 w-5 text-[#e94560]" /> Monthly Visit Targets
          </h2>
          <p className="text-sm text-[var(--text-secondary)] mt-0.5">Set monthly visit / lead / demo quotas per sales rep.</p>
        </div>
        <Input
          type="month"
          value={targetMonth}
          onChange={e => setTargetMonth(e.target.value)}
          className="w-44 bg-[var(--bg-card)] border-[var(--border-color)] text-[var(--text-primary)]"
        />
      </div>

      {salesReps.length === 0 ? (
        <div className="text-center py-16 text-[var(--text-muted)]">
          No sales reps found. Add users with the "sales" role in User Management.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border border-[var(--border-color)]">
          <table className="w-full text-sm">
            <thead className="bg-[var(--bg-card)] border-b border-[var(--border-color)]">
              <tr>
                {['Rep', 'Visits Target', 'Demos Target', 'Leads Target', ''].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-[var(--text-muted)] uppercase">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {salesReps.map(rep => {
                const row    = targetRows[rep.email] || {};
                const setRow = (k, v) => setTargetRows(prev => ({ ...prev, [rep.email]: { ...(prev[rep.email] || {}), [k]: Number(v) || 0 } }));
                return (
                  <tr key={rep.email} className="border-b border-[var(--border-color)] hover:bg-[var(--bg-hover)]">
                    <td className="px-4 py-3">
                      <p className="font-medium text-[var(--text-primary)]">{rep.name}</p>
                      <p className="text-xs text-[var(--text-muted)]">{rep.email}</p>
                    </td>
                    <td className="px-4 py-3">
                      <Input type="number" min={0} value={row.visits_target || ''} placeholder="0"
                        onChange={e => setRow('visits_target', e.target.value)}
                        className="w-24 bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)] h-8 text-sm" />
                    </td>
                    <td className="px-4 py-3">
                      <Input type="number" min={0} value={row.demos_target || ''} placeholder="0"
                        onChange={e => setRow('demos_target', e.target.value)}
                        className="w-24 bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)] h-8 text-sm" />
                    </td>
                    <td className="px-4 py-3">
                      <Input type="number" min={0} value={row.leads_target || ''} placeholder="0"
                        onChange={e => setRow('leads_target', e.target.value)}
                        className="w-24 bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)] h-8 text-sm" />
                    </td>
                    <td className="px-4 py-3">
                      <Button size="sm" onClick={() => saveTarget(rep)} disabled={savingTarget === rep.email}
                        className="bg-[#e94560] hover:bg-[#d03050] text-white text-xs h-8">
                        <Save className="h-3 w-3 mr-1" />
                        {savingTarget === rep.email ? 'Saving…' : 'Save'}
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

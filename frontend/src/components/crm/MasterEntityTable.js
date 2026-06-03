import React from 'react';
import { Button } from '../ui/button';
import { Edit2, Trash2 } from 'lucide-react';

const textMuted = 'text-[var(--text-muted)]';
const textPri   = 'text-[var(--text-primary)]';
const textSec   = 'text-[var(--text-secondary)]';

/**
 * MasterEntityTable — generic table for simple master-data entities.
 *
 * Props:
 *   columns   — array of { key, label, hidden?, render? }
 *               hidden: 'md' | 'sm' (applies hidden sm:table-cell etc.)
 *               render: (row) => ReactNode  — custom cell renderer
 *   data      — array of row objects
 *   rowKey    — string, the unique id field name (e.g. 'source_id')
 *   onEdit    — (row) => void
 *   onDelete  — (row) => void
 *   emptyMsg  — string, shown when data is empty
 *   testIdPrefix — optional string prefix for data-testid attrs
 */
export default function MasterEntityTable({
  columns,
  data,
  rowKey,
  onEdit,
  onDelete,
  emptyMsg = 'No records yet',
  testIdPrefix = '',
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-[var(--bg-primary)]">
            {columns.map(col => (
              <th
                key={col.key}
                className={`text-left text-xs uppercase py-2.5 px-3 ${textMuted} ${
                  col.hidden === 'md' ? 'hidden md:table-cell' :
                  col.hidden === 'sm' ? 'hidden sm:table-cell' : ''
                }`}
              >
                {col.label}
              </th>
            ))}
            <th className={`text-right text-xs uppercase py-2.5 px-3 ${textMuted}`}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {data.map(row => (
            <tr
              key={row[rowKey]}
              className="border-t border-[var(--border-color)] hover:bg-[var(--bg-hover)]"
              data-testid={testIdPrefix ? `${testIdPrefix}-row-${row[rowKey]}` : undefined}
            >
              {columns.map(col => (
                <td
                  key={col.key}
                  className={`py-2.5 px-3 ${
                    col.hidden === 'md' ? 'hidden md:table-cell' :
                    col.hidden === 'sm' ? 'hidden sm:table-cell' : ''
                  } ${col.primary ? `${textPri} font-medium` : col.mono ? `${textMuted} font-mono text-xs` : `${textSec}`}`}
                >
                  {col.render ? col.render(row) : (row[col.key] ?? '—')}
                </td>
              ))}
              <td className="py-2.5 px-3 text-right whitespace-nowrap">
                <Button
                  size="sm" variant="ghost"
                  onClick={() => onEdit(row)}
                  className={`${textSec} h-7 px-1.5`}
                  data-testid={testIdPrefix ? `edit-${testIdPrefix.replace('-', '')}-${row[rowKey]}` : undefined}
                >
                  <Edit2 className="h-3 w-3" />
                </Button>
                <Button
                  size="sm" variant="ghost"
                  onClick={() => onDelete(row)}
                  className="text-red-400 h-7 px-1.5"
                  data-testid={testIdPrefix ? `delete-${testIdPrefix.replace('-', '')}-${row[rowKey]}` : undefined}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </td>
            </tr>
          ))}
          {data.length === 0 && (
            <tr>
              <td colSpan={columns.length + 1} className={`py-12 text-center ${textMuted}`}>
                {emptyMsg}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

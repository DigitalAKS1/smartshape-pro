import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { useTheme } from '../../contexts/ThemeContext';
import { AlertTriangle, CheckCircle } from 'lucide-react';
import EmptyState, { EMPTY_STATES } from '../ui/EmptyState';

export default function TasksTab({
  tasksList,
  taskDialogOpen, setTaskDialogOpen,
  taskForm, setTaskForm,
  spList,
  saveTask,
  updateTaskStatus,
}) {
  const { isDark } = useTheme();

  const card = isDark ? 'bg-[var(--bg-card)] border-[var(--border-color)]' : 'bg-white border-[var(--border-color)]';
  const inputCls = 'bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]';
  const textPri = 'text-[var(--text-primary)]';
  const textSec = 'text-[var(--text-secondary)]';
  const textMuted = 'text-[var(--text-muted)]';
  const dlgCls = isDark ? 'bg-[var(--bg-card)] border-[var(--border-color)] text-[var(--text-primary)]' : 'bg-white border-[var(--border-color)] text-[var(--text-primary)]';

  return (
    <>
      {/* Tasks list */}
      <div className="space-y-2" data-testid="tasks-list">
        {tasksList.length === 0 ? (
          <EmptyState {...EMPTY_STATES.tasks} action={{ label: '+ Add Task', onClick: () => setTaskDialogOpen(true) }} />
        ) : tasksList.map(task => {
          const isOverdue = task.status === 'pending' && task.due_date && new Date(task.due_date) < new Date();
          return (
            <div key={task.task_id} className={`${card} border rounded-md p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 ${isOverdue ? '!border-red-500/40' : ''}`}>
              <div className="flex items-center gap-3 flex-1">
                <button
                  onClick={() => updateTaskStatus(task.task_id, task.status === 'done' ? 'pending' : 'done')}
                  className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${task.status === 'done' ? 'bg-green-500 border-green-500' : isOverdue ? 'border-red-400' : isDark ? 'border-[#6b6b80]' : 'border-[#ccc]'}`}>
                  {task.status === 'done' && <CheckCircle className="h-3 w-3 text-[var(--text-primary)]" />}
                </button>
                <div>
                  <p className={`font-medium text-sm ${task.status === 'done' ? `line-through ${textMuted}` : textPri}`}>{task.title}</p>
                  <p className={`text-xs ${textMuted}`}>{task.lead_name} | {task.assigned_name} | {task.due_date}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {isOverdue && <span className="text-red-400 text-xs flex items-center gap-1"><AlertTriangle className="h-3 w-3" />Overdue</span>}
                <span className={`px-2 py-0.5 rounded text-xs border ${task.priority === 'high' ? 'border-red-500/30 text-red-400' : task.priority === 'low' ? 'border-green-500/30 text-green-400' : 'border-yellow-500/30 text-yellow-400'}`}>{task.priority}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Task creation dialog */}
      <Dialog open={taskDialogOpen} onOpenChange={setTaskDialogOpen}>
        <DialogContent className={`${dlgCls} w-[calc(100vw-1rem)] sm:max-w-md`}>
          <DialogHeader><DialogTitle className={textPri}>New Task</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label className={`${textSec} text-xs`}>Title *</Label>
              <Input value={taskForm.title} onChange={e => setTaskForm({...taskForm, title: e.target.value})} className={inputCls} data-testid="task-title-input" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label className={`${textSec} text-xs`}>Due Date *</Label>
                <Input type="date" value={taskForm.due_date} onChange={e => setTaskForm({...taskForm, due_date: e.target.value})} className={inputCls} />
              </div>
              <div>
                <Label className={`${textSec} text-xs`}>Assign To</Label>
                <select value={taskForm.assigned_to} onChange={e => { const sp = spList.find(s => s.email === e.target.value); setTaskForm({...taskForm, assigned_to: e.target.value, assigned_name: sp?.name || ''}); }} className={`w-full h-10 px-3 rounded-md text-sm ${inputCls}`}>
                  <option value="">Select</option>{spList.map(sp => <option key={sp.email} value={sp.email}>{sp.name}</option>)}
                </select>
              </div>
            </div>
            {taskForm.lead_name && <p className={`text-xs ${textMuted}`}>Lead: {taskForm.lead_name}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTaskDialogOpen(false)} className="border-[var(--border-color)] text-[var(--text-secondary)]">Cancel</Button>
            <Button onClick={saveTask} className="bg-[#e94560] hover:bg-[#f05c75]" data-testid="save-task-button">Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

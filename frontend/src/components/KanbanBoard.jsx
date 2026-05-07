import React from 'react';
import { DndContext, closestCorners, PointerSensor, useSensor, useSensors, DragOverlay } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useDroppable } from '@dnd-kit/core';
import { AlertTriangle, Clock, GripVertical } from 'lucide-react';

/**
 * Generic Kanban board.
 * Props:
 *  - columns: [{ id, label, color? }]
 *  - items: array of cards
 *  - getItemColumnId: (item) => stageId
 *  - getItemId: (item) => unique id string
 *  - onMove: ({ itemId, from, to, item }) => Promise<boolean|void>
 *  - renderCard: (item, extra) => ReactNode
 *  - emptyText?: string
 */
export default function KanbanBoard({ columns, items, getItemColumnId, getItemId, onMove, renderCard, emptyText = 'No items' }) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const [activeId, setActiveId] = React.useState(null);

  const byColumn = React.useMemo(() => {
    const m = {};
    columns.forEach(c => { m[c.id] = []; });
    items.forEach(it => {
      const col = getItemColumnId(it);
      if (!m[col]) m[col] = [];
      m[col].push(it);
    });
    return m;
  }, [items, columns, getItemColumnId]);

  const findItem = (id) => items.find(it => getItemId(it) === id);

  const handleDragStart = (e) => setActiveId(e.active.id);
  const handleDragEnd = async (e) => {
    setActiveId(null);
    const { active, over } = e;
    if (!over) return;
    const item = findItem(active.id);
    if (!item) return;
    const from = getItemColumnId(item);
    // Dropping over a column id OR over another card — infer column of target
    let to = over.id;
    if (!columns.some(c => c.id === to)) {
      const overItem = findItem(over.id);
      if (overItem) to = getItemColumnId(overItem);
    }
    if (!to || to === from) return;
    await onMove({ itemId: active.id, from, to, item });
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="flex gap-3 overflow-x-auto pb-2" data-testid="kanban-board">
        {columns.map((col) => (
          <KanbanColumn key={col.id} column={col} items={byColumn[col.id] || []} getItemId={getItemId} renderCard={renderCard} emptyText={emptyText} />
        ))}
      </div>
      <DragOverlay>
        {activeId ? <div className="bg-[var(--bg-card)] border border-[#e94560] rounded-md p-2 shadow-xl opacity-90 min-w-[240px]">Moving...</div> : null}
      </DragOverlay>
    </DndContext>
  );
}

function KanbanColumn({ column, items, getItemId, renderCard, emptyText }) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id });
  return (
    <div
      ref={setNodeRef}
      data-testid={`kanban-col-${column.id}`}
      className={`flex-shrink-0 w-72 rounded-md border ${column.color || 'border-[var(--border-color)]'} ${isOver ? 'bg-[#e94560]/5 border-[#e94560]/40' : 'bg-[var(--bg-card)]'} p-2 transition-colors`}
    >
      <div className="flex items-center justify-between px-1 pb-2">
        <h3 className="text-xs font-semibold text-[var(--text-primary)] uppercase tracking-wider">{column.label}</h3>
        <span className="text-[10px] text-[var(--text-muted)] bg-[var(--bg-primary)] px-2 py-0.5 rounded-full">{items.length}</span>
      </div>
      <SortableContext items={items.map(getItemId)} strategy={verticalListSortingStrategy}>
        <div className="space-y-2 min-h-[120px]">
          {items.length === 0 && <p className="text-[10px] text-[var(--text-muted)] text-center py-6">{emptyText}</p>}
          {items.map((it) => (
            <SortableCard key={getItemId(it)} id={getItemId(it)}>
              {renderCard(it, { columnId: column.id })}
            </SortableCard>
          ))}
        </div>
      </SortableContext>
    </div>
  );
}

function SortableCard({ id, children }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };
  return (
    <div ref={setNodeRef} style={style} className="group relative">
      <div {...attributes} {...listeners} className="absolute top-1 right-1 z-10 cursor-grab active:cursor-grabbing text-[var(--text-muted)] hover:text-[#e94560] opacity-0 group-hover:opacity-100 transition-opacity p-1" data-testid={`kanban-drag-handle-${id}`}>
        <GripVertical className="h-3.5 w-3.5" />
      </div>
      {children}
    </div>
  );
}

/**
 * Age-based color for lead cards.
 * daysSinceActivity: number of days since last_activity_date
 * Returns classes for the card border.
 */
export function ageColor(daysSinceActivity, followupDate) {
  if (!daysSinceActivity && daysSinceActivity !== 0) return 'border-[var(--border-color)]';
  if (followupDate) {
    const fu = new Date(followupDate);
    const diff = Math.ceil((fu - new Date()) / (1000 * 60 * 60 * 24));
    if (diff >= 0 && diff <= 1) return 'border-yellow-500/50';
  }
  if (daysSinceActivity >= 7) return 'border-red-500/50';
  return 'border-green-500/40';
}

export function AgeBadge({ daysSinceActivity, followupDate }) {
  let content = null;
  if (followupDate) {
    const fu = new Date(followupDate);
    const diff = Math.ceil((fu - new Date()) / (1000 * 60 * 60 * 24));
    if (diff < 0) content = { icon: AlertTriangle, text: `Follow-up overdue by ${Math.abs(diff)}d`, cls: 'bg-red-500/15 text-red-400' };
    else if (diff <= 1) content = { icon: Clock, text: `Follow-up ${diff === 0 ? 'today' : 'tomorrow'}`, cls: 'bg-yellow-500/15 text-yellow-400' };
  }
  if (!content && daysSinceActivity >= 7) {
    content = { icon: AlertTriangle, text: `Stuck ${daysSinceActivity}d`, cls: 'bg-red-500/15 text-red-400' };
  }
  if (!content) return null;
  const Icon = content.icon;
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded ${content.cls}`}>
      <Icon className="h-2.5 w-2.5" /> {content.text}
    </span>
  );
}

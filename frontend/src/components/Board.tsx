import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  pointerWithin,
  rectIntersection,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import type { Announcements, CollisionDetection, DragEndEvent, DragStartEvent } from '@dnd-kit/core'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { STATUSES } from '../api'
import type { Application, ApplicationStatus } from '../api'
import { formatDate, localToday } from '../dates'
import { columnByColumn } from '../boardKeyboard'
import { isOverdue } from '../overdue'
import { statusLabel, statusText } from '../status'
import { roleLine } from '../workMode'
import { FollowUp } from './Ledger'
import StageMeter from './StageMeter'
import PostingLink from './PostingLink'
import StatusSelect from './StatusSelect'

interface Props {
  items: Application[]
  moving: ReadonlySet<number> // applications whose move is still being saved
  onMove: (app: Application, status: ApplicationStatus) => void
}

const cardId = (a: Application | number) => `app:${typeof a === 'number' ? a : a.id}`
const columnId = (s: ApplicationStatus) => `column:${s}`

// Pointer position decides the column while dragging with a mouse or finger; when
// dragging with the keyboard there is no pointer, so fall back to overlap.
const collisionDetection: CollisionDetection = (args) => {
  const hits = pointerWithin(args)
  return hits.length > 0 ? hits : rectIntersection(args)
}

function CardSummary({ app, today }: { app: Application; today: string }) {
  return (
    <>
      <p className="truncate font-semibold">{app.company}</p>
      <p className="truncate text-sm text-ink-soft">{roleLine(app)}</p>
      <p className="figure mt-2 text-ink-soft">{formatDate(app.date_applied)}</p>
      {app.follow_up_date && (
        <p className="figure mt-1">
          <span className="mr-1 font-sans text-xs text-ink-soft">Follow up</span>
          <FollowUp text={formatDate(app.follow_up_date)} overdue={isOverdue(app, today)} />
        </p>
      )}
    </>
  )
}

function BoardCard({ app, today, busy, onMove }: { app: Application; today: string; busy: boolean; onMove: Props['onMove'] }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useDraggable({ id: cardId(app), disabled: busy })
  return (
    // The whole card can be dragged with a mouse or a long press. The grip button is what keyboard and
    // screen-reader users focus: Space picks the card up, arrows move it between columns, Space drops it.
    <li ref={setNodeRef} {...listeners} aria-busy={busy} className={`sheet p-3 ${isDragging ? 'opacity-40' : ''} ${busy ? 'opacity-70' : ''}`}>
      <div className="flex items-start justify-between gap-2">
        <Link to={`/applications/${app.id}`} className="group min-w-0 flex-1 hover:[&_p:first-child]:underline">
          <CardSummary app={app} today={today} />
        </Link>
        <button
          ref={setActivatorNodeRef}
          {...attributes}
          type="button"
          aria-label={`Move ${app.company}`}
          className="-mr-1 -mt-1 shrink-0 cursor-grab rounded-field p-1 text-pencil hover:text-ink"
        >
          <svg aria-hidden width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
            {[3, 7, 11].flatMap((y) => [4, 10].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.3" />))}
          </svg>
        </button>
      </div>
      <PostingLink url={app.job_url} company={app.company} className="mt-2 inline-block" />
      {/* A plain control for changing status, so moving a card never depends on being able to drag. */}
      <div className="mt-3">
        <StatusSelect value={app.status} label={`Status for ${app.company}`} disabled={busy} onChange={(next) => onMove(app, next)} />
      </div>
    </li>
  )
}

function Column({ status, apps, today, moving, onMove }: { status: ApplicationStatus; apps: Application[] } & Pick<Props, 'moving' | 'onMove'> & { today: string }) {
  const { setNodeRef, isOver } = useDroppable({ id: columnId(status) })
  return (
    <section
      ref={setNodeRef}
      aria-label={`${statusLabel(status)}, ${apps.length}`}
      // A heavy outline marks where the card will land.
      className={`min-w-[12.5rem] flex-1 rounded-field p-2 ${isOver ? 'bg-pine/5 outline-2 outline-pine' : ''}`}
    >
      <h3 className="mb-3 flex items-center justify-between border-t-2 border-ink pt-2 text-lg">
        <span className="flex items-center gap-2">
          <StageMeter status={status} />
          <span className={statusText[status]}>{statusLabel(status)}</span>
        </span>
        <span className="figure text-ink-soft">{apps.length}</span>
      </h3>
      {apps.length === 0 ? (
        <p className="py-4 text-sm text-ink-soft">Nothing here.</p>
      ) : (
        <ul className="space-y-3">
          {apps.map((a) => (
            <BoardCard key={a.id} app={a} today={today} busy={moving.has(a.id)} onMove={onMove} />
          ))}
        </ul>
      )}
    </section>
  )
}

export default function Board({ items, moving, onMove }: Props) {
  const [activeId, setActiveId] = useState<string | null>(null)
  const today = localToday()

  const sensors = useSensors(
    // A few pixels of movement before a drag starts, so clicking a card's link still opens it.
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    // A short press before a drag starts on touch screens, so swiping still scrolls the board.
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: columnByColumn }),
  )

  const byId = new Map(items.map((a) => [cardId(a), a]))
  const nameOf = (id: string | number) => byId.get(String(id))?.company ?? 'Card'
  const columnName = (id: string | number) => statusLabel(String(id).replace('column:', '') as ApplicationStatus)

  // Read aloud by screen readers as a drag happens.
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${nameOf(active.id)}, currently in ${statusLabel(byId.get(String(active.id))!.status)}.`,
    onDragOver: ({ active, over }) => (over ? `${nameOf(active.id)} is over ${columnName(over.id)}.` : `${nameOf(active.id)} is not over a column.`),
    onDragEnd: ({ active, over }) => (over ? `${nameOf(active.id)} was dropped in ${columnName(over.id)}.` : `${nameOf(active.id)} was dropped. Nothing changed.`),
    onDragCancel: ({ active }) => `Moving ${nameOf(active.id)} was cancelled. Nothing changed.`,
  }

  function handleDragEnd({ active, over }: DragEndEvent) {
    setActiveId(null)
    const app = byId.get(String(active.id))
    if (!app || !over || !String(over.id).startsWith('column:')) return
    const target = String(over.id).slice('column:'.length) as ApplicationStatus
    if (target !== app.status) onMove(app, target)
  }

  const activeApp = activeId ? byId.get(activeId) : undefined

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      accessibility={{ announcements }}
      onDragStart={({ active }: DragStartEvent) => setActiveId(String(active.id))}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      <div className="flex gap-4 overflow-x-auto pb-4">
        {STATUSES.map((status) => (
          <Column key={status} status={status} apps={items.filter((a) => a.status === status)} today={today} moving={moving} onMove={onMove} />
        ))}
      </div>
      <DragOverlay dropAnimation={null}>
        {activeApp && (
          <div className="sheet cursor-grabbing p-3 outline-2 outline-ink">
            <CardSummary app={activeApp} today={today} />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  )
}

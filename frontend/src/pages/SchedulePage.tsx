import { useEffect, useRef, useState } from 'react'
import { Pencil, Plus, Trash2, X } from 'lucide-react'
import { scheduleApi } from '../api/schedule'
import { setCache, useQuery } from '../hooks/useApi'
import type { ScheduleSlot, ScheduleSlotInput } from '../types/schedule'
import './schedule.css'

const DAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
const TYPES = { busy: '固定占用', free: '固定空闲' }
const CACHE_KEY = 'weekly-schedule'
const HOUR_HEIGHT = 72

function minutes(time: string) {
  const [hours, mins] = time.split(':').map(Number)
  return hours * 60 + mins
}

function timeLabel(value: number) {
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`
}

const TIME_OPTIONS = Array.from({ length: 289 }, (_, index) => timeLabel(index * 5))

function durationLabel(value: number) {
  const hours = Math.floor(value / 60)
  const mins = value % 60
  return [hours ? `${hours} 小时` : '', mins ? `${mins} 分钟` : ''].filter(Boolean).join(' ') || '0 分钟'
}

function errorMessage(error: unknown) {
  return (error as { message?: string })?.message || '操作失败，请检查网络后重试'
}

function SlotForm({ slot, onSave, onDelete, onClose }: {
  slot?: ScheduleSlot
  onSave: (body: ScheduleSlotInput) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onClose: () => void
}) {
  const [form, setForm] = useState<ScheduleSlotInput>({
    title: slot?.title ?? '', type: slot?.type ?? 'busy', weekdays: slot?.weekdays ?? [1],
    startTime: slot?.startTime ?? '08:00', endTime: slot?.endTime ?? '09:35',
  })
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const titleRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const dialog = dialogRef.current
    const previousFocus = document.activeElement
    dialog?.showModal()
    titleRef.current?.focus({ preventScroll: true })
    return () => {
      dialog?.close()
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
        previousFocus.focus({ preventScroll: true })
      }
    }
  }, [])

  const change = <K extends keyof ScheduleSlotInput>(key: K, value: ScheduleSlotInput[K]) => {
    setForm(current => ({ ...current, [key]: value }))
    setError('')
    setConfirmDelete(false)
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setError('')
    if (!form.weekdays.length) { setError('请至少选择一个星期'); return }
    if (minutes(form.endTime) <= minutes(form.startTime)) {
      setError('结束时间必须晚于开始时间；跨午夜的安排请拆成两段')
      return
    }
    setPending(true)
    try { await onSave({ ...form, title: form.title.trim() }) }
    catch (err) { setError(errorMessage(err)) }
    finally { setPending(false) }
  }

  async function remove() {
    if (!slot) return
    setError('')
    setPending(true)
    try { await onDelete(slot.id) }
    catch (err) { setError(errorMessage(err)) }
    finally { setPending(false) }
  }

  return (
    <dialog ref={dialogRef} className="schedule-dialog" aria-labelledby="schedule-dialog-title"
      onCancel={event => { event.preventDefault(); if (!pending) onClose() }}
      onClick={event => {
        if (event.target !== event.currentTarget || pending) return
        const bounds = event.currentTarget.getBoundingClientRect()
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose()
      }}>
      <div className="flex items-center justify-between mb-5">
        <h2 id="schedule-dialog-title" className="font-semibold text-slate-800">{slot ? '编辑时间段' : '新增时间段'}</h2>
        <button type="button" onClick={onClose} disabled={pending} className="schedule-icon-button" aria-label="关闭编辑">
          <X size={18} />
        </button>
      </div>
      <form onSubmit={submit}>
        <fieldset disabled={pending} className="space-y-5">
          <div>
            <label htmlFor="schedule-title" className="schedule-label">名称</label>
            <input ref={titleRef} id="schedule-title" className="schedule-input" value={form.title} maxLength={100}
              required pattern=".*\S.*" onChange={event => change('title', event.target.value)} />
          </div>
          <fieldset>
            <legend className="schedule-label">时间类型</legend>
            <div className="flex gap-2">
              {(['busy', 'free'] as const).map(type => (
                <label key={type} className={`schedule-type-choice ${form.type === type ? `schedule-${type}` : ''}`}>
                  <input type="radio" name="schedule-type" value={type} checked={form.type === type}
                    onChange={() => change('type', type)} />
                  {TYPES[type]}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className="schedule-label">每周重复</legend>
            <div className="grid grid-cols-4 gap-2">
              {DAYS.map((day, index) => (
                <label key={day} className={`schedule-day-choice ${form.weekdays.includes(index + 1) ? 'selected' : ''}`}>
                  <input type="checkbox" checked={form.weekdays.includes(index + 1)} onChange={event =>
                    change('weekdays', event.target.checked ? [...form.weekdays, index + 1].sort((a, b) => a - b) : form.weekdays.filter(value => value !== index + 1))} />
                  {day}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="schedule-start" className="schedule-label">开始时间</label>
              <select id="schedule-start" className="schedule-input" value={form.startTime} onChange={event => change('startTime', event.target.value)}>
                {TIME_OPTIONS.slice(0, -1).map(time => <option key={time}>{time}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="schedule-end" className="schedule-label">结束时间</label>
              <select id="schedule-end" className="schedule-input" value={form.endTime} onChange={event => change('endTime', event.target.value)}>
                {TIME_OPTIONS.slice(1).map(time => <option key={time}>{time}</option>)}
              </select>
            </div>
          </div>
          {error && <p role="alert" className="schedule-error">{error}</p>}
          <div className="flex gap-2">
            <button type="submit" className="schedule-primary flex-1" disabled={!form.title.trim()}>
              {pending ? '保存中…' : slot ? '保存修改' : '添加时间段'}
            </button>
            <button type="button" className="schedule-secondary" onClick={onClose}>取消</button>
          </div>
          {slot && (
            <div className="pt-4 border-t border-slate-200">
              {confirmDelete ? (
                <div className="flex gap-3">
                  <button type="button" className="schedule-delete" onClick={remove}>确认删除</button>
                  <button type="button" className="schedule-secondary" onClick={() => setConfirmDelete(false)}>保留</button>
                </div>
              ) : (
                <button type="button" className="flex items-center gap-2 text-sm text-red-600 hover:underline" onClick={() => setConfirmDelete(true)}>
                  <Trash2 size={15} /> 删除时间段
                </button>
              )}
            </div>
          )}
        </fieldset>
      </form>
    </dialog>
  )
}

function Timetable({ slots, day, selectedId, onEdit, disabled }: {
  slots: ScheduleSlot[]
  day: number | null
  selectedId?: string
  onEdit: (slot: ScheduleSlot) => void
  disabled: boolean
}) {
  const visibleDays = day ? [day] : [1, 2, 3, 4, 5, 6, 7]
  const visibleSlots = slots.filter(slot => visibleDays.some(value => slot.weekdays.includes(value)))
  const startHour = Math.floor(Math.min(7 * 60, ...visibleSlots.map(slot => minutes(slot.startTime))) / 60)
  const endHour = Math.ceil(Math.max(22 * 60, ...visibleSlots.map(slot => minutes(slot.endTime))) / 60)
  const height = (endHour - startHour) * HOUR_HEIGHT
  const columns = `52px repeat(${visibleDays.length}, minmax(0, 1fr))`

  return (
    <div className="schedule-board-scroll" tabIndex={0} role="region" aria-label="可视化日程表，时间轴可滚动">
      <div className={`schedule-board ${day ? 'single-day' : ''}`}>
        <div className="schedule-board-header" style={{ gridTemplateColumns: columns }}>
          <span className="text-xs text-slate-400">时间</span>
          {visibleDays.map(value => <span key={value}>{DAYS[value - 1]}</span>)}
        </div>
        <div className="grid" style={{ gridTemplateColumns: columns }}>
          <div className="schedule-time-axis" style={{ height }}>
            {Array.from({ length: endHour - startHour + 1 }, (_, index) => (
              <span key={index} style={{ top: index * HOUR_HEIGHT }}>{timeLabel((startHour + index) * 60)}</span>
            ))}
          </div>
          {visibleDays.map(value => (
            <div key={value} className="schedule-day-column" style={{ height }} aria-label={DAYS[value - 1]}>
              {visibleSlots.filter(slot => slot.weekdays.includes(value)).map(slot => {
                const duration = minutes(slot.endTime) - minutes(slot.startTime)
                const label = `${DAYS[value - 1]} ${slot.startTime}–${slot.endTime}，${TYPES[slot.type]}：${slot.title}`
                return (
                  <button key={slot.id} type="button" className={`schedule-block schedule-${slot.type} ${selectedId === slot.id ? 'is-selected' : ''}`}
                    data-slot-id={slot.id} data-slot-type={slot.type} title={label} aria-label={`编辑 ${label}`}
                    style={{ top: (minutes(slot.startTime) - startHour * 60) * HOUR_HEIGHT / 60, height: duration * HOUR_HEIGHT / 60 }}
                    disabled={disabled} onClick={() => onEdit(slot)}>
                    {duration >= 15 && <span className="block truncate font-medium">{slot.title}</span>}
                    {duration >= 35 && <span className="block truncate">{slot.startTime}–{slot.endTime}</span>}
                    {duration >= 55 && <span className="block truncate opacity-80">{TYPES[slot.type]}</span>}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default function SchedulePage() {
  const { data: slots = [], loading, error, refetch } = useQuery(CACHE_KEY, scheduleApi.list)
  const [editor, setEditor] = useState<{ slot?: ScheduleSlot } | null>(null)
  const [view, setView] = useState<'week' | 'day'>(() => window.matchMedia('(max-width: 767px)').matches ? 'day' : 'week')
  const [day, setDay] = useState(1)
  const [notice, setNotice] = useState('')
  const [mutating, setMutating] = useState(false)

  function edit(slot?: ScheduleSlot) {
    if (mutating) return
    setNotice('')
    setEditor({ slot })
  }

  async function save(body: ScheduleSlotInput) {
    setMutating(true)
    try {
      const item = editor?.slot ? await scheduleApi.update(editor.slot.id, body) : await scheduleApi.create(body)
      setCache(CACHE_KEY, [...slots.filter(slot => slot.id !== item.id), item])
      setNotice(editor?.slot ? '时间段已更新' : '时间段已添加')
      setEditor(null)
    } finally { setMutating(false) }
  }

  async function remove(id: string) {
    setMutating(true)
    try {
      await scheduleApi.delete(id)
      setCache(CACHE_KEY, slots.filter(slot => slot.id !== id))
      setNotice('时间段已删除')
      setEditor(null)
    } finally { setMutating(false) }
  }

  return (
    <div className="schedule-page p-4 md:p-6 max-w-[1600px] mx-auto">
      <header className="flex items-start justify-between gap-3 mb-6">
        <h1 className="text-xl font-semibold text-slate-800">日程表</h1>
        <button className="schedule-primary shrink-0 flex items-center gap-1.5" onClick={() => edit()} disabled={loading || !!error || mutating}>
          <Plus size={16} /> 新增时间段
        </button>
      </header>

      <p className="sr-only" role="status">{notice}</p>
      {error ? (
        <div role="alert" className="schedule-error flex items-center justify-between gap-3">
          <span>日程加载失败：{errorMessage(error)}</span>
          <button className="schedule-secondary" onClick={() => refetch()}>重新加载</button>
        </div>
      ) : loading ? (
        <div className="schedule-loading" role="status">正在加载日程表…</div>
      ) : (
        <div>
          {editor && <SlotForm key={editor.slot?.id ?? 'new'} slot={editor.slot} onSave={save} onDelete={remove} onClose={() => setEditor(null)} />}
          <section className="min-w-0" aria-label="每周日程">
            <div className="schedule-toolbar">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-600" aria-label="颜色图例">
                <span className="flex items-center gap-1.5"><i className="schedule-swatch schedule-busy" />固定占用</span>
                <span className="flex items-center gap-1.5"><i className="schedule-swatch schedule-free" />固定空闲</span>
              </div>
              <div className="flex gap-1" aria-label="日程视图">
                <button className={`schedule-view-button ${view === 'week' ? 'active' : ''}`} aria-pressed={view === 'week'} onClick={() => setView('week')}>整周</button>
                <button className={`schedule-view-button ${view === 'day' ? 'active' : ''}`} aria-pressed={view === 'day'} onClick={() => setView('day')}>单日</button>
              </div>
            </div>
            {view === 'day' && (
              <div className="flex gap-1 overflow-x-auto py-2 mb-2" aria-label="选择星期">
                {DAYS.map((label, index) => <button key={label} className={`schedule-view-button flex-1 whitespace-nowrap ${day === index + 1 ? 'active' : ''}`}
                  aria-pressed={day === index + 1} onClick={() => setDay(index + 1)}>{label}</button>)}
              </div>
            )}
            <Timetable slots={slots} day={view === 'day' ? day : null} selectedId={editor?.slot?.id} onEdit={edit} disabled={mutating} />
            <section className="mt-6" aria-labelledby="schedule-list-title">
              <h2 id="schedule-list-title" className="text-sm font-semibold text-slate-700 mb-3">已设置的时间段 <span className="font-normal text-slate-400">{slots.length}</span></h2>
              <ul className="divide-y divide-slate-200">
                {[...slots].sort((a, b) => a.weekdays[0] - b.weekdays[0] || a.startTime.localeCompare(b.startTime)).map(slot => (
                  <li key={slot.id}>
                    <button className="schedule-list-row" disabled={mutating} onClick={() => edit(slot)} aria-label={`编辑时间段 ${slot.title}`}>
                      <span className={`schedule-type-tag schedule-${slot.type}`}>{TYPES[slot.type]}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium text-slate-700 break-words">{slot.title}</span>
                        <span className="block text-xs text-slate-500 mt-1">{slot.weekdays.map(value => DAYS[value - 1]).join('、')} · {slot.startTime}–{slot.endTime} · {durationLabel(minutes(slot.endTime) - minutes(slot.startTime))}</span>
                      </span>
                      <Pencil size={15} className="text-slate-400 shrink-0" />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          </section>
        </div>
      )}
    </div>
  )
}

/**
 * 桌面：壁纸 + 组件网格 + 窗口层 + 小组件中心。
 *
 * 两种摆放形态共用一份布局数据：
 *   · 紧凑（默认）：CSS Grid dense，HTML5 DnD 拖的是**顺序**
 *   · 自由摆放：每个组件带 x/y 网格坐标，pointer 拖动吸附到格（设置页可开）
 *
 * 尺寸用 `gridOf(size, columns)` 收敛到当前可用列数，窄屏不会让 4 列组件溢出。
 * 点组件非按钮区域会打开对应应用（HIG：widget 的主交互是 deep link）；内部按钮
 * 用 `closest()` 排除，避免「点重试却开了窗口」。
 */
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { AppBody } from '../apps'
import { cx } from '../components/ui'
import { useShell } from './state'
import {
  gridOf,
  useWidgetLayout,
  WIDGET_DEFS,
  type LayoutItem,
  type WidgetId,
  type WidgetSize,
} from './useWidgetLayout'
import { WidgetBody, WidgetUpdatedAt } from './widgets'
import { GALLERY_DND_MIME, WidgetGallery } from './WidgetGallery'
import { WindowFrame } from './Window'
import { useWidgetGeometry } from './useWidgetGeometry'
import { syncWindowPresence } from './widgetAppearance'

const I_MINUS = (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M4 8h8" />
  </svg>
)

const I_RESIZE = (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
    <path d="M13 6.5 6.5 13" />
    <path d="M13 10.5 10.5 13" />
  </svg>
)

/** 点组件空白区时打开的应用：每类组件都必须有去处，不做点了没反应的卡片 */
const WIDGET_APP: Record<WidgetId, string> = {
  clock: 'about',
  count: 'gateway',
  enabled: 'gateway',
  apps: 'settings',
  nodes: 'gateway',
  releases: 'gateway',
  unpushed: 'gateway',
  attention: 'gateway',
}

interface DragState {
  id: WidgetId
  startX: number
  startY: number
  baseX: number
  baseY: number
}

interface ResizeState {
  id: WidgetId
  startX: number
  startY: number
  index: number
  moved: boolean
}

export function Desktop() {
  const shell = useShell()
  const { layout, free, add, remove, setSize, cycleSize, reorder, move, setFree, reset, rest } =
    useWidgetLayout()
  const [dragId, setDragId] = useState<WidgetId | null>(null)
  const [galleryOpen, setGalleryOpen] = useState(false)
  const [dropHint, setDropHint] = useState<{ x: number; y: number } | null>(null)
  const [metrics, setMetrics] = useState({ unit: 168, gap: 16, columns: 4 })
  const [pointerPos, setPointerPos] = useState<{ id: WidgetId; x: number; y: number } | null>(null)
  const pointerRef = useRef<DragState | null>(null)
  const pointerPosRef = useRef<{ id: WidgetId; x: number; y: number } | null>(null)
  const resizeRef = useRef<ResizeState | null>(null)
  const suppressClick = useRef(false)
  const widgetsRef = useRef<HTMLDivElement>(null)

  const layoutKey = useMemo(
    () =>
      `${free ? 'free' : 'dense'}:${layout
        .map((it) => `${it.id}.${it.size}.${it.x ?? ''}.${it.y ?? ''}`)
        .join('|')}`,
    [layout, free],
  )
  useWidgetGeometry(widgetsRef, layoutKey, shell.editing)

  // 「调暗桌面小组件 = 自动」：有窗口盖住桌面时组件转单色
  useEffect(() => {
    syncWindowPresence(shell.wins.length > 0)
  }, [shell.wins.length])

  // 单元尺寸来自 CSS 变量，读一次即可；列数随容器宽度变化
  useEffect(() => {
    const el = widgetsRef.current
    if (!el) return
    const compute = () => {
      const cs = getComputedStyle(el)
      const unit = parseFloat(cs.getPropertyValue('--wg-unit')) || 168
      const gap = parseFloat(cs.getPropertyValue('--wg-gap')) || 16
      const columns = Math.max(1, Math.floor((el.clientWidth + gap) / (unit + gap)))
      setMetrics({ unit, gap, columns })
    }
    compute()
    const ro = new ResizeObserver(compute)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    document.body.classList.toggle('editing', shell.editing)
    return () => document.body.classList.remove('editing')
  }, [shell.editing])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (galleryOpen) {
        setGalleryOpen(false)
        return
      }
      shell.setLaunchpad(false)
      if (shell.editing) shell.setEditing(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [shell, galleryOpen])

  useEffect(() => {
    const onReset = () => reset()
    const onSetFree = (e: Event) => setFree((e as CustomEvent<boolean>).detail)
    window.addEventListener('uiam-reset-desktop', onReset)
    window.addEventListener('uiam-set-free', onSetFree)
    return () => {
      window.removeEventListener('uiam-reset-desktop', onReset)
      window.removeEventListener('uiam-set-free', onSetFree)
    }
  }, [reset, setFree])

  useEffect(() => {
    if (!shell.editing) setGalleryOpen(false)
  }, [shell.editing])

  // 拖出画廊后无论落在哪、或中途取消，都要收掉落点预览
  useEffect(() => {
    const clear = () => setDropHint(null)
    window.addEventListener('dragend', clear)
    window.addEventListener('drop', clear)
    return () => {
      window.removeEventListener('dragend', clear)
      window.removeEventListener('drop', clear)
    }
  }, [])

  /* ---------- 紧凑模式：HTML5 拖动排序 ---------- */
  const onDragStart = (e: DragEvent<HTMLDivElement>, id: WidgetId) => {
    if (!shell.editing || free) return
    setDragId(id)
    e.dataTransfer.effectAllowed = 'move'
    try {
      e.dataTransfer.setData('text/plain', id)
    } catch {
      // Safari 在 dragstart 里 setData 偶尔抛，不影响 effectAllowed
    }
  }

  const onDragOver = (e: DragEvent<HTMLDivElement>, id: WidgetId) => {
    if (!dragId || free) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (dragId === id) return
    const rect = e.currentTarget.getBoundingClientRect()
    // 用指针在目标左半/右半判断，比较数组下标会在换位后来回翻转
    reorder(dragId, id, e.clientX - rect.left > rect.width / 2)
  }

  /* ---------- 小组件中心 → 桌面：拖到哪就放在哪 ---------- */
  const gridPointOf = (e: DragEvent<HTMLDivElement>) => {
    const el = widgetsRef.current
    if (!el) return { x: 0, y: 0 }
    const rect = el.getBoundingClientRect()
    const cell = metrics.unit + metrics.gap
    return {
      x: Math.max(0, Math.floor((e.clientX - rect.left + el.scrollLeft) / cell)),
      y: Math.max(0, Math.floor((e.clientY - rect.top + el.scrollTop) / cell)),
    }
  }

  const onGalleryDragOver = (e: DragEvent<HTMLDivElement>) => {
    // dragover 阶段读不到 getData，只能靠 types 判断是不是画廊拖出来的
    if (!Array.from(e.dataTransfer.types ?? []).includes(GALLERY_DND_MIME)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    const p = gridPointOf(e)
    setDropHint((prev) => (prev?.x === p.x && prev?.y === p.y ? prev : p))
  }

  const onGalleryDrop = (e: DragEvent<HTMLDivElement>) => {
    setDropHint(null)
    let payload: { id: WidgetId; size: WidgetSize }
    try {
      payload = JSON.parse(e.dataTransfer.getData(GALLERY_DND_MIME))
    } catch {
      // 自定义 MIME 被浏览器丢掉时用 text/plain 兜底，尺寸回落到默认值
      const id = e.dataTransfer.getData('text/plain') as WidgetId
      if (!WIDGET_DEFS[id]) return
      payload = { id, size: WIDGET_DEFS[id].size }
    }
    // 只接受「还没在桌面上」的组件：内部排序拖拽的 text/plain 会在这里被挡掉
    if (!WIDGET_DEFS[payload.id] || !rest.includes(payload.id)) return
    e.preventDefault()

    const p = gridPointOf(e)
    const g = gridOf(payload.size, metrics.columns)
    const hit = document
      .elementFromPoint(e.clientX, e.clientY)
      ?.closest<HTMLElement>('.widget')?.dataset.id as WidgetId | undefined
    add(payload.id, payload.size, {
      x: Math.min(p.x, Math.max(0, metrics.columns - g.w)),
      y: p.y,
      beforeId: !free && hit && hit !== payload.id ? hit : null,
    })
  }

  /* ---------- 自由摆放：pointer 拖动 + 网格吸附 ---------- */
  const onWidgetPointerDown = (e: ReactPointerEvent<HTMLDivElement>, it: LayoutItem) => {
    if (!shell.editing || !free) return
    if ((e.target as HTMLElement).closest('button, a, input')) return
    const cell = metrics.unit + metrics.gap
    pointerRef.current = {
      id: it.id,
      startX: e.clientX,
      startY: e.clientY,
      baseX: it.x ?? Math.round(e.currentTarget.offsetLeft / cell),
      baseY: it.y ?? Math.round(e.currentTarget.offsetTop / cell),
    }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }

  const onWidgetPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = pointerRef.current
    if (!d) return
    const cell = metrics.unit + metrics.gap
    const x = Math.max(0, d.baseX + Math.round((e.clientX - d.startX) / cell))
    const y = Math.max(0, d.baseY + Math.round((e.clientY - d.startY) / cell))
    const next = { id: d.id, x, y }
    pointerPosRef.current = next
    setPointerPos(next)
  }

  const onWidgetPointerUp = () => {
    const d = pointerRef.current
    if (!d) return
    const pos = pointerPosRef.current
    if (pos && pos.id === d.id) move(d.id, pos.x, pos.y)
    pointerRef.current = null
    pointerPosRef.current = null
    setPointerPos(null)
  }

  /* ---------- 尺寸手柄：拖过一格升一档，点一下循环一档 ---------- */
  const onResizeDown = (e: ReactPointerEvent<HTMLButtonElement>, it: LayoutItem) => {
    e.stopPropagation()
    resizeRef.current = {
      id: it.id,
      startX: e.clientX,
      startY: e.clientY,
      index: WIDGET_DEFS[it.id].sizes.indexOf(it.size),
      moved: false,
    }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }

  const onResizeMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const r = resizeRef.current
    if (!r) return
    const delta = Math.max(Math.abs(e.clientX - r.startX), Math.abs(e.clientY - r.startY))
    if (delta < 8) return
    r.moved = true
    const sizes = WIDGET_DEFS[r.id].sizes
    const step = Math.round(delta / (metrics.unit + metrics.gap))
    const next = sizes[Math.max(0, Math.min(sizes.length - 1, r.index + step))]
    if (next) setSize(r.id, next)
  }

  const onResizeUp = () => {
    const r = resizeRef.current
    if (!r) return
    resizeRef.current = null
    if (r.moved) {
      suppressClick.current = true
      window.setTimeout(() => {
        suppressClick.current = false
      }, 0)
    }
  }

  const openWidget = (id: WidgetId) => shell.openApp(WIDGET_APP[id])

  const onActivate = (e: ReactMouseEvent<HTMLDivElement>, id: WidgetId) => {
    if (shell.editing) return
    if ((e.target as HTMLElement).closest('button, a, input, [role="switch"]')) return
    openWidget(id)
  }

  const onContextMenu = (e: ReactMouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('.widget, .window, .dock, .menubar, .gallery')) return
    e.preventDefault()
    shell.setEditing(true)
    setGalleryOpen(true)
  }

  const clampX = (x: number, w: number) =>
    Math.max(0, Math.min(x, Math.max(0, metrics.columns - w)))

  return (
    <>
      <div className="desktop" onContextMenu={onContextMenu}>
        <div
          className={cx('widgets', shell.editing && 'editing', free && 'free')}
          ref={widgetsRef}
          onDragOver={onGalleryDragOver}
          onDrop={onGalleryDrop}
        >
          {layout.length === 0 && (
            <div className="wg-empty">桌面是空的 —— 点「添加组件」放一个上来</div>
          )}
          {layout.map((it, i) => {
            const def = WIDGET_DEFS[it.id]
            const g = gridOf(it.size, metrics.columns)
            const pos = pointerPos?.id === it.id ? pointerPos : null
            const x = clampX(pos?.x ?? it.x ?? 0, g.w)
            const y = Math.max(0, pos?.y ?? it.y ?? 0)
            const style = {
              ['--w' as string]: g.w,
              ['--h' as string]: g.h,
              ['--i' as string]: i,
              ...(free ? { ['--col' as string]: x + 1, ['--row' as string]: y + 1 } : {}),
            } as CSSProperties

            return (
              <div
                key={it.id}
                className={cx('widget', dragId === it.id && 'dragging')}
                data-id={it.id}
                style={style}
                role="button"
                tabIndex={0}
                aria-label={`${def.name}，按回车打开${WIDGET_APP[it.id] === 'gateway' ? '网关配置' : '对应应用'}`}
                draggable={shell.editing && !free}
                onDragStart={(e) => onDragStart(e, it.id)}
                onDragOver={(e) => onDragOver(e, it.id)}
                onDragEnd={() => setDragId(null)}
                onDrop={(e) => {
                  e.preventDefault()
                  setDragId(null)
                }}
                onPointerDown={(e) => onWidgetPointerDown(e, it)}
                onPointerMove={onWidgetPointerMove}
                onPointerUp={onWidgetPointerUp}
                onPointerCancel={onWidgetPointerUp}
                onClick={(e) => onActivate(e, it.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    if (!shell.editing) openWidget(it.id)
                  }
                }}
              >
                {shell.editing && (
                  <>
                    <button
                      className="wg-remove"
                      onClick={(e) => {
                        e.stopPropagation()
                        remove(it.id)
                      }}
                      title={`移除${def.name}`}
                      aria-label={`移除${def.name}`}
                    >
                      {I_MINUS}
                    </button>
                    <button
                      className="wg-resize"
                      onPointerDown={(e) => onResizeDown(e, it)}
                      onPointerMove={onResizeMove}
                      onPointerUp={onResizeUp}
                      onPointerCancel={onResizeUp}
                      onClick={(e) => {
                        e.stopPropagation()
                        if (!suppressClick.current) cycleSize(it.id)
                      }}
                      title="拖动或点击切换尺寸"
                      aria-label={`切换${def.name}尺寸，当前${it.size}`}
                    >
                      {I_RESIZE}
                    </button>
                  </>
                )}
                <WidgetBody id={it.id} size={it.size} />
                {(it.size === 'large' || it.size === 'xl') && <WidgetUpdatedAt />}
              </div>
            )
          })}
          {dropHint && (
            <div
              className="wg-drop-hint"
              style={
                {
                  ['--dh-x' as string]: dropHint.x,
                  ['--dh-y' as string]: dropHint.y,
                } as CSSProperties
              }
              aria-hidden="true"
            />
          )}
        </div>

        <div className="windows">
          {shell.wins.map((w) => (
            <WindowFrame key={w.id} win={w}>
              <AppBody id={w.id} />
            </WindowFrame>
          ))}
        </div>
      </div>

      {shell.editing && (
        <button
          className="wg-add"
          onClick={() => setGalleryOpen((v) => !v)}
          aria-expanded={galleryOpen}
        >
          {galleryOpen ? '收起小组件中心' : '添加组件'}
          <span className="plus">+</span>
        </button>
      )}

      {galleryOpen && (
        <WidgetGallery
          rest={rest}
          onAdd={(id, size) => add(id, size)}
          onClose={() => {
            setGalleryOpen(false)
            shell.setEditing(false)
          }}
        />
      )}
    </>
  )
}

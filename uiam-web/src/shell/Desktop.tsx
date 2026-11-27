/**
 * 桌面：壁纸 + 自由摆放的组件 + 窗口层 + 小组件中心。
 *
 * 只有编辑态能拖组件；非编辑态点组件打开对应应用。拖动时组件先跟指针走，
 * 只有落在网格线或容器边缘 8px 内才吸附；否则松手就停在该像素位置，
 * 允许和其他组件重叠。内部按钮用 `closest()` 排除，避免「点重试却开了窗口」。
 */
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { cx } from '../components/ui'
import { useShell } from './state'
import {
  gridOf,
  SIZE_FAMILY,
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
/** 只有网关类卡片才显示「更新于…」；生活类卡片显示自己的数据时间 */
const OPS_WIDGETS = new Set<WidgetId>([
  'count', 'enabled', 'nodes', 'releases', 'unpushed', 'attention',
])

const WIDGET_APP: Record<WidgetId, string> = {
  clock: 'life',
  'clock-digital': 'life',
  weather: 'life',
  calendar: 'life',
  count: 'gateway',
  enabled: 'gateway',
  apps: 'settings',
  nodes: 'gateway',
  releases: 'gateway',
  unpushed: 'gateway',
  attention: 'gateway',
}

interface Metrics {
  unit: number
  gap: number
  columns: number
  width: number
  height: number
}

const DEFAULT_METRICS: Metrics = { unit: 168, gap: 16, columns: 4, width: 0, height: 0 }
/** 距网格线/容器边缘多少像素内开始吸附 */
const SNAP_PX = 8

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(v, max))

/** n 格组件的实际像素宽度 */
function spanPx(n: number, unit: number, gap: number) {
  return n * unit + (n - 1) * gap
}

/** 右边界按容器像素宽算，允许进最后一列右边的留白（顶点坐标，单位 = pitch） */
function maxXFor(w: number, m: Metrics) {
  const pitch = m.unit + m.gap
  return Math.max(0, (m.width - spanPx(w, m.unit, m.gap)) / pitch)
}

/**
 * 吸附：x/y 各自独立判断。先找网格线，再看容器边（left/top=0，right/bottom
 * = 组件贴住容器边距时的坐标）；都不够近就原样返回，交给自由落点。
 * x 始终钳在容器内；y 不封顶，用户可以往下摆再滚动过去。
 */
function snapPoint(rawX: number, rawY: number, w: number, h: number, m: Metrics, el: HTMLElement) {
  const pitch = m.unit + m.gap
  const maxX = maxXFor(w, m)
  const maxY = (el.scrollTop + m.height - spanPx(h, m.unit, m.gap)) / pitch
  const snap = (v: number, targets: number[], upper?: number) => {
    const px = v * pitch
    for (const t of targets) {
      if (t >= 0 && Math.abs(px - t * pitch) <= SNAP_PX) return t
    }
    return upper === undefined ? Math.max(0, v) : clamp(v, 0, upper)
  }
  return {
    x: snap(rawX, [0, Math.round(rawX), maxX], maxX),
    y: snap(rawY, [0, Math.round(rawY), maxY]),
  }
}

interface DragState {
  id: WidgetId
  startX: number
  startY: number
  baseX: number
  baseY: number
  w: number
  h: number
  /** 按下瞬间量到的容器尺寸，避免拖动过程中因为别的状态变化换算法 */
  metrics: Metrics
  maxX: number
  /** 是否已经越过 4px 阈值，决定松手算拖拽还是点击 */
  moved: boolean
}

interface ResizeState {
  id: WidgetId
  startX: number
  startY: number
  /** 按下时的尺寸档位，整个拖动过程保持不动，便于来回拖动可逆 */
  index: number
  /** 已经应用到的档位，避免同一档反复写库 */
  applied: number
  columns: number
  metrics: Metrics
  moved: boolean
}

interface DesktopWidgetProps {
  item: LayoutItem
  index: number
  metrics: Metrics
  editing: boolean
  /** 仅正在拖动的那个组件有值；其它组件保持 null，memo 才有意义 */
  pos: { x: number; y: number } | null
  onPointerDown: (e: ReactPointerEvent<HTMLDivElement>, item: LayoutItem) => void
  onPointerMove: (e: ReactPointerEvent<HTMLDivElement>) => void
  onPointerUp: () => void
  onActivate: (e: ReactMouseEvent<HTMLDivElement>, id: WidgetId) => void
  onOpen: (id: WidgetId) => void
  onRemove: (id: WidgetId) => void
  onSetSize: (id: WidgetId, size: WidgetSize) => void
  onCycleSize: (id: WidgetId, size: WidgetSize) => void
  onResizeDown: (e: ReactPointerEvent<HTMLButtonElement>, item: LayoutItem) => void
  onResizeMove: (e: ReactPointerEvent<HTMLButtonElement>) => void
  onResizeUp: () => void
}

/**
 * 单个桌面组件。
 *
 * 拆成 memo 组件是因为：窗口拖动、开窗/聚焦、其它组件拖动都会让 `Desktop` 重渲染，
 * 但一个组件自己的数据没变时不该重新算一遍（日历要换算 42 个农历日、时钟要生成
 * 60 条刻度）。回调和 metrics 都是外层稳定引用，只有真正变化的那张卡会重渲染。
 */
const DesktopWidget = memo(function DesktopWidget({
  item,
  index,
  metrics,
  editing,
  pos,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onActivate,
  onOpen,
  onRemove,
  onSetSize,
  onCycleSize,
  onResizeDown,
  onResizeMove,
  onResizeUp,
}: DesktopWidgetProps) {
  const def = WIDGET_DEFS[item.id]
  const g = gridOf(item.size, metrics.columns)
  const x = clamp(pos?.x ?? item.x, 0, maxXFor(g.w, metrics))
  const y = Math.max(0, pos?.y ?? item.y)
  const style = {
    ['--w' as string]: g.w,
    ['--h' as string]: g.h,
    ['--i' as string]: index,
    ['--x' as string]: x,
    ['--y' as string]: y,
  } as CSSProperties

  return (
    <div
      className={cx('widget', pos && 'dragging')}
      data-id={item.id}
      style={style}
      role="button"
      tabIndex={0}
      aria-label={`${def.name}，按回车打开${WIDGET_APP[item.id] === 'gateway' ? '网关配置' : WIDGET_APP[item.id] === 'life' ? '生活应用' : '对应应用'}`}
      onPointerDown={(e) => onPointerDown(e, item)}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onClick={(e) => onActivate(e, item.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          if (!editing) onOpen(item.id)
        }
      }}
    >
      {editing && (
        <>
          <span className="wg-size-tag" data-wg-no-drag title="当前尺寸">
            {SIZE_FAMILY[item.size].label} · {g.w}×{g.h}
          </span>
          <button
            className="wg-remove"
            onClick={(e) => {
              e.stopPropagation()
              onRemove(item.id)
            }}
            title={`移除${def.name}`}
            aria-label={`移除${def.name}`}
          >
            {I_MINUS}
          </button>
          <div className="wg-tools" data-wg-no-drag role="group" aria-label={`${def.name}尺寸`}>
            {def.sizes.map((s) => (
              <button
                key={s}
                className={cx('wg-tool-size', item.size === s && 'on')}
                onClick={(e) => {
                  e.stopPropagation()
                  onSetSize(item.id, s)
                }}
                title={`${SIZE_FAMILY[s].label} · ${SIZE_FAMILY[s].w}×${SIZE_FAMILY[s].h}`}
                aria-label={`把${def.name}改成${SIZE_FAMILY[s].label} ${SIZE_FAMILY[s].w}乘${SIZE_FAMILY[s].h}`}
              >
                {SIZE_FAMILY[s].w}×{SIZE_FAMILY[s].h}
              </button>
            ))}
          </div>
          <button
            className="wg-resize"
            onPointerDown={(e) => onResizeDown(e, item)}
            onPointerMove={onResizeMove}
            onPointerUp={onResizeUp}
            onPointerCancel={onResizeUp}
            onClick={(e) => {
              e.stopPropagation()
              onCycleSize(item.id, item.size)
            }}
            title="拖动或点击切换尺寸"
            aria-label={`切换${def.name}尺寸，当前${item.size}`}
          >
            {I_RESIZE}
          </button>
        </>
      )}
      <WidgetBody id={item.id} size={item.size} />
      {OPS_WIDGETS.has(item.id) && (item.size === 'large' || item.size === 'xl') && (
        <WidgetUpdatedAt />
      )}
    </div>
  )
})

export function Desktop() {
  const shell = useShell()
  const { layout, add, addAt, remove, setSize, cycleSize, move, reset, rest } = useWidgetLayout()
  const [galleryOpen, setGalleryOpen] = useState(false)
  const [dropHint, setDropHint] = useState<{
    x: number
    y: number
    w: number
    h: number
  } | null>(null)
  const [dropSize, setDropSize] = useState<WidgetSize | null>(null)
  const [metrics, setMetrics] = useState<Metrics>(DEFAULT_METRICS)
  const [pointerPos, setPointerPos] = useState<{ id: WidgetId; x: number; y: number } | null>(null)
  const pointerRef = useRef<DragState | null>(null)
  const pointerPosRef = useRef<{ id: WidgetId; x: number; y: number } | null>(null)
  const resizeRef = useRef<ResizeState | null>(null)
  const suppressClick = useRef(false)
  const widgetsRef = useRef<HTMLDivElement>(null)

  const layoutKey = useMemo(
    () => layout.map((it) => `${it.id}.${it.size}.${it.x}.${it.y}`).join('|'),
    [layout],
  )
  useWidgetGeometry(widgetsRef, layoutKey, shell.editing)

  const hasVisibleWindow = shell.wins.some((w) => !w.min)

  // 「调暗桌面小组件 = 自动」：有窗口盖住桌面时组件转单色。收起来的窗口不算盖住。
  // 依赖布尔值而不是 wins 数组：拖窗口时 wins 每帧都变，但「有没有窗口」没变。
  useEffect(() => {
    syncWindowPresence(hasVisibleWindow)
  }, [hasVisibleWindow])

  // 单元尺寸来自 CSS 变量，列数/可用宽度随容器变化；按下指针时也会现量一次
  const readMetrics = useCallback((): Metrics => {
    const el = widgetsRef.current
    if (!el) return DEFAULT_METRICS
    const cs = getComputedStyle(el)
    const unit = parseFloat(cs.getPropertyValue('--wg-unit')) || 168
    const gap = parseFloat(cs.getPropertyValue('--wg-gap')) || 16
    const pitch = unit + gap
    return {
      unit,
      gap,
      columns: Math.max(1, Math.floor((el.clientWidth + gap) / pitch)),
      width: el.clientWidth,
      height: el.clientHeight,
    }
  }, [])
  const refreshMetrics = useCallback(() => {
    const next = readMetrics()
    setMetrics((prev) =>
      prev.unit === next.unit &&
      prev.gap === next.gap &&
      prev.columns === next.columns &&
      prev.width === next.width &&
      prev.height === next.height
        ? prev
        : next,
    )
    return next
  }, [readMetrics])
  useEffect(() => {
    const el = widgetsRef.current
    if (!el) return
    refreshMetrics()
    const ro = new ResizeObserver(refreshMetrics)
    ro.observe(el)
    return () => ro.disconnect()
  }, [refreshMetrics])

  useEffect(() => {
    document.body.classList.toggle('editing', shell.editing)
    return () => document.body.classList.remove('editing')
  }, [shell.editing])

  const { editing, setEditing, setLaunchpad } = shell
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (galleryOpen) {
        setGalleryOpen(false)
        return
      }
      setLaunchpad(false)
      if (editing) setEditing(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editing, setEditing, setLaunchpad, galleryOpen])

  useEffect(() => {
    const onReset = () => reset()
    window.addEventListener('uiam-reset-desktop', onReset)
    return () => window.removeEventListener('uiam-reset-desktop', onReset)
  }, [reset])

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

  /* ---------- 小组件中心 → 桌面：拖到哪就放在哪 ---------- */
  const pointFromDrag = (e: DragEvent<HTMLDivElement>, w: number, h: number, m: Metrics) => {
    const el = widgetsRef.current
    if (!el) return { x: 0, y: 0 }
    const rect = el.getBoundingClientRect()
    const pitch = m.unit + m.gap
    // clientX 是视口坐标；容器内容坐标还要加回滚出去的 scrollLeft/scrollTop
    const rawX = (e.clientX - rect.left + el.scrollLeft) / pitch
    const rawY = (e.clientY - rect.top + el.scrollTop) / pitch
    return snapPoint(rawX, rawY, w, h, m, el)
  }

  const onGalleryDragOver = (e: DragEvent<HTMLDivElement>) => {
    // dragover 阶段读不到 getData，只能靠 types 判断是不是画廊拖出来的
    if (!Array.from(e.dataTransfer.types ?? []).includes(GALLERY_DND_MIME)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    const m = refreshMetrics()
    const g = gridOf(dropSize ?? 'medium', m.columns)
    const p = pointFromDrag(e, g.w, g.h, m)
    setDropHint((prev) =>
      prev?.x === p.x && prev?.y === p.y && prev?.w === g.w && prev?.h === g.h
        ? prev
        : { ...p, w: g.w, h: g.h },
    )
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

    const m = refreshMetrics()
    const g = gridOf(payload.size, m.columns)
    const p = pointFromDrag(e, g.w, g.h, m)
    addAt(payload.id, payload.size, p, maxXFor(g.w, m))
  }

  /* ---------- 自由摆放：仅编辑态，近格/靠边才吸附 ---------- */
  const onWidgetPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>, it: LayoutItem) => {
      // 非编辑态组件只是入口：点开应用，不进入拖动
      if (!editing) return
      if ((e.target as HTMLElement).closest('button, a, input, select, [role="switch"], [data-wg-no-drag]')) return
      const m = refreshMetrics()
      const g = gridOf(it.size, m.columns)
      pointerRef.current = {
        id: it.id,
        startX: e.clientX,
        startY: e.clientY,
        baseX: it.x,
        baseY: it.y,
        w: g.w,
        h: g.h,
        metrics: m,
        maxX: maxXFor(g.w, m),
        moved: false,
      }
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    },
    [editing, refreshMetrics],
  )

  const onWidgetPointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const d = pointerRef.current
    if (!d) return
    const dx = e.clientX - d.startX
    const dy = e.clientY - d.startY
    // 先过阈值再进入拖拽，否则编辑态里点一下会变成「挪了一格」
    if (!d.moved && Math.hypot(dx, dy) < 4) return
    // 进入拖拽后阻止默认行为，避免拖动时选到卡片里的文字
    e.preventDefault()
    d.moved = true
    const pitch = d.metrics.unit + d.metrics.gap
    const rawX = d.baseX + dx / pitch
    const rawY = d.baseY + dy / pitch
    const el = widgetsRef.current
    const p = el
      ? snapPoint(rawX, rawY, d.w, d.h, d.metrics, el)
      : { x: clamp(rawX, 0, d.maxX), y: Math.max(0, rawY) }
    const next = { id: d.id, ...p }
    pointerPosRef.current = next
    setPointerPos(next)
  }, [])

  const onWidgetPointerUp = useCallback(() => {
    const d = pointerRef.current
    if (!d) return
    if (d.moved) {
      const pos = pointerPosRef.current
      if (pos && pos.id === d.id) move(d.id, pos.x, pos.y, d.maxX)
      // 拖完这一次 click 不再触发卡片动作
      suppressClick.current = true
      window.setTimeout(() => {
        suppressClick.current = false
      }, 0)
    }
    pointerRef.current = null
    pointerPosRef.current = null
    setPointerPos(null)
  }, [move])

  /* ---------- 尺寸手柄：拖过一格升一档，点一下循环一档 ---------- */
  const onResizeDown = useCallback(
    (e: ReactPointerEvent<HTMLButtonElement>, it: LayoutItem) => {
      e.stopPropagation()
      const m = refreshMetrics()
      resizeRef.current = {
        id: it.id,
        startX: e.clientX,
        startY: e.clientY,
        index: WIDGET_DEFS[it.id].sizes.indexOf(it.size),
        applied: WIDGET_DEFS[it.id].sizes.indexOf(it.size),
        columns: m.columns,
        metrics: m,
        moved: false,
      }
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    },
    [refreshMetrics],
  )

  const onResizeMove = useCallback(
    (e: ReactPointerEvent<HTMLButtonElement>) => {
      const r = resizeRef.current
      if (!r) return
      const dx = e.clientX - r.startX
      const dy = e.clientY - r.startY
      // 有符号位移：往右/下变大，往左/上变小
      const delta = Math.abs(dx) >= Math.abs(dy) ? dx : dy
      if (Math.abs(delta) < 8) return
      r.moved = true
      const pitch = r.metrics.unit + r.metrics.gap
      const step = delta >= 0 ? Math.floor(delta / pitch) : Math.ceil(delta / pitch)
      const sizes = WIDGET_DEFS[r.id].sizes
      const target = Math.max(0, Math.min(sizes.length - 1, r.index + step))
      if (target === r.applied) return
      r.applied = target
      const g = gridOf(sizes[target], r.columns)
      setSize(r.id, sizes[target], r.columns, maxXFor(g.w, r.metrics))
    },
    [setSize],
  )

  const onResizeUp = useCallback(() => {
    const r = resizeRef.current
    if (!r) return
    resizeRef.current = null
    if (r.moved) {
      suppressClick.current = true
      window.setTimeout(() => {
        suppressClick.current = false
      }, 0)
    }
  }, [])

  /** 直接点尺寸档位：换算一次当前容器列数再落盘 */
  const onSetWidgetSize = useCallback(
    (id: WidgetId, size: WidgetSize) => {
      const m = refreshMetrics()
      const g = gridOf(size, m.columns)
      setSize(id, size, m.columns, maxXFor(g.w, m))
    },
    [refreshMetrics, setSize],
  )

  /** 尺寸手柄点一下：在当前组件允许的尺寸里循环 */
  const onCycleWidgetSize = useCallback(
    (id: WidgetId, size: WidgetSize) => {
      if (suppressClick.current) return
      const m = refreshMetrics()
      const sizes = WIDGET_DEFS[id].sizes
      const next = sizes[(sizes.indexOf(size) + 1) % sizes.length]
      cycleSize(id, m.columns, maxXFor(gridOf(next, m.columns).w, m))
    },
    [refreshMetrics, cycleSize],
  )

  const openWidget = useCallback((id: WidgetId) => shell.openApp(WIDGET_APP[id]), [shell.openApp])

  const onActivate = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>, id: WidgetId) => {
      if (suppressClick.current) return
      if (editing) return
      if ((e.target as HTMLElement).closest('button, a, input, select, [role="switch"], [data-wg-no-drag]')) return
      openWidget(id)
    },
    [editing, openWidget],
  )

  const onContextMenu = (e: ReactMouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('.widget, .window, .dock, .menubar, .gallery')) return
    e.preventDefault()
    shell.setEditing(true)
    setGalleryOpen(true)
  }

  return (
    <>
      <div className="desktop" onContextMenu={onContextMenu}>
        <div
          className={cx('widgets', shell.editing && 'editing')}
          ref={widgetsRef}
          onDragOver={onGalleryDragOver}
          onDrop={onGalleryDrop}
        >
          {layout.length === 0 && (
            <div className="wg-empty">桌面是空的 —— 点「添加组件」放一个上来</div>
          )}
          {layout.map((it, i) => (
            <DesktopWidget
              key={it.id}
              item={it}
              index={i}
              metrics={metrics}
              editing={shell.editing}
              pos={pointerPos?.id === it.id ? pointerPos : null}
              onPointerDown={onWidgetPointerDown}
              onPointerMove={onWidgetPointerMove}
              onPointerUp={onWidgetPointerUp}
              onActivate={onActivate}
              onOpen={openWidget}
              onRemove={remove}
              onSetSize={onSetWidgetSize}
              onCycleSize={onCycleWidgetSize}
              onResizeDown={onResizeDown}
              onResizeMove={onResizeMove}
              onResizeUp={onResizeUp}
            />
          ))}
          {dropHint && (
            <div
              className="wg-drop-hint"
              style={
                {
                  ['--dh-x' as string]: dropHint.x,
                  ['--dh-y' as string]: dropHint.y,
                  ['--dh-w' as string]: dropHint.w,
                  ['--dh-h' as string]: dropHint.h,
                } as CSSProperties
              }
              aria-hidden="true"
            />
          )}
        </div>

        <div className="windows">
          {shell.wins.map((w) => (
            <WindowFrame
              key={w.id}
              win={w}
              focused={shell.focusId === w.id}
              title={shell.titles[w.id]}
              path={shell.paths[w.id]}
            />
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
          onDragSize={setDropSize}
          onClose={() => {
            setGalleryOpen(false)
            shell.setEditing(false)
          }}
        />
      )}
    </>
  )
}

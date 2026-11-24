/**
 * 窗口框：交通灯 + 可拖拽标题栏 + 八向改大小 + 内容区。
 *
 * 拖动用 Pointer Events 而不是 mousemove：指针捕获之后即使鼠标划过 iframe 或
 * 窗口外也不会丢事件，这是原型的 `makeDraggable` 想做但做不到的事。起始位置在
 * `pointerdown` 时冻结在 ref 里，所以拖动过程中 `win.x` 一直在变也不会自乘。
 *
 * 拖动只写 `transform`，不写 `left/top`：
 *   · 改 left/top 每帧都要重新布局，窗口那两层 100px 的阴影还要整块重画；
 *   · transform 只走合成器，阴影是同一块位图平移，不重绘。
 * 松手时才把最终坐标提交回 shell（落盘一次），拖拽期间连 `wins` 都不更新，
 * 因此桌面组件、其它窗口、所有已打开的联邦应用都不会跟着重渲染。
 *
 * 改大小同理，但多一件事：**钳制要按方向做**。往左拖时宽度变小、x 要跟着右移；
 * 碰到最小宽度后 x 就不能再动，否则窗口会「一边缩小一边往右跑」。所以下限判断
 * 在这里做，`resizeWin` 只负责落值。
 *
 * 内容区在组件内部渲染并 memo 化：父级（桌面）因为窗口开关/聚焦重渲染时，
 * 已经打开的应用不会跟着重渲染整棵树。
 */
import { memo, useRef, useState } from 'react'
import { AppBody } from '../apps'
import { APP_MAP } from '../apps/meta'
import { AppIcon } from '../apps/AppIcon'
import { useShellActions, type WinState } from './state'
import { cx } from '../components/ui'

const MIN_W = 460
const MIN_H = 280
/** 标题栏不能钻到菜单栏底下 */
const MIN_Y = 26
/** 和 state.tsx 的 moveWin 保持一致：窗口至少留 120px 在视口里 */
const KEEP_X = 120
const KEEP_Y = 60

type Dir = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'
const DIRS: Dir[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']

const TL_CLOSE = (
  <svg viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
    <path d="M2.2 2.2 5.8 5.8M5.8 2.2 2.2 5.8" />
  </svg>
)
const TL_MIN = (
  <svg viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
    <path d="M2 4h4" />
  </svg>
)
const TL_MAX = (
  <svg viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
    <path d="M2.2 5.8V2.2h3.6M5.8 2.2v3.6H2.2" />
  </svg>
)

interface WindowFrameProps {
  win: WinState
  /** 由桌面算好传进来，窗口自己不订阅 shell 状态，memo 才不会失效 */
  focused: boolean
  /** 子应用回报的动态标题；没有时用 meta 里的名字 */
  title?: string
}

export const WindowFrame = memo(function WindowFrame({ win, focused, title }: WindowFrameProps) {
  const { focusWin, closeWin, minimizeWin, toggleMax, moveWin, resizeWin } = useShellActions()
  const app = APP_MAP[win.id]
  /**
   * 拖动 / 改大小的过程中要关掉几何过渡（`.live`）。开着过渡的话，每帧新坐标都
   * 被 0.24s 的缓动追着走，窗口会像拖着一根橡皮筋——拖拽必须是 1:1 跟手。
   */
  const [live, setLive] = useState(false)
  /** 拖拽期间的位移，只用于 transform 预览；松手后清零并一次性提交坐标 */
  const [dragOffset, setDragOffset] = useState<{ dx: number; dy: number } | null>(null)
  const drag = useRef<{
    sx: number
    sy: number
    x: number
    y: number
    /** 钳制后的最新目标位置 */
    lastX: number
    lastY: number
    moved: boolean
  } | null>(null)
  /** pointermove 可能比屏幕刷新快，攒到下一帧再更新一次状态 */
  const frame = useRef(0)

  const onBarPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    // 交通灯上的点击不要被拖拽逻辑吞掉
    if ((e.target as HTMLElement).closest('.tl')) return
    focusWin(win.id)
    if (win.max) return
    setLive(true)
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = {
      sx: e.clientX,
      sy: e.clientY,
      x: win.x,
      y: win.y,
      lastX: win.x,
      lastY: win.y,
      moved: false,
    }
  }

  const onBarPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d) return
    const nx = Math.min(
      Math.max(d.x + e.clientX - d.sx, KEEP_X - win.w),
      window.innerWidth - KEEP_X,
    )
    const ny = Math.min(
      Math.max(d.y + e.clientY - d.sy, MIN_Y),
      window.innerHeight - KEEP_Y,
    )
    d.lastX = nx
    d.lastY = ny
    if (nx === d.x && ny === d.y) return
    d.moved = true
    if (frame.current) return
    frame.current = requestAnimationFrame(() => {
      frame.current = 0
      const cur = drag.current
      if (!cur) return
      setDragOffset({ dx: cur.lastX - cur.x, dy: cur.lastY - cur.y })
    })
  }

  const onBarPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (frame.current) {
      cancelAnimationFrame(frame.current)
      frame.current = 0
    }
    const d = drag.current
    drag.current = null
    if (d?.moved) {
      // 提交和清预览在同一次事件里批处理：新 left/top 与「去掉 transform」同帧生效
      moveWin(win.id, d.lastX, d.lastY)
      setDragOffset(null)
      // 多留一帧再恢复几何过渡，否则 left/top 会从旧值再补一段 0.24s 的动画
      requestAnimationFrame(() => setLive(false))
    } else {
      setDragOffset(null)
      setLive(false)
    }
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
  }

  const resize = useRef<{
    dir: Dir
    sx: number
    sy: number
    x: number
    y: number
    w: number
    h: number
  } | null>(null)

  const onResizeDown = (dir: Dir) => (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    // 别让把手上的按下冒泡到窗口 / 标题栏，否则会顺手触发一次拖动或聚焦抬升
    e.stopPropagation()
    e.preventDefault()
    if (win.max) return
    focusWin(win.id)
    setLive(true)
    e.currentTarget.setPointerCapture(e.pointerId)
    resize.current = { dir, sx: e.clientX, sy: e.clientY, x: win.x, y: win.y, w: win.w, h: win.h }
  }

  const onResizeMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = resize.current
    if (!r) return
    const dx = e.clientX - r.sx
    const dy = e.clientY - r.sy
    let { x, y, w, h } = r
    if (r.dir.includes('e')) w = Math.max(MIN_W, r.w + dx)
    if (r.dir.includes('s')) h = Math.max(MIN_H, r.h + dy)
    // 往左/上拖：先按新宽度反推 x，再钳制；顺序反了窗口会一边缩小一边漂
    if (r.dir.includes('w')) {
      w = Math.max(MIN_W, r.w - dx)
      x = r.x + r.w - w
    }
    if (r.dir.includes('n')) {
      h = Math.max(MIN_H, r.h - dy)
      y = r.y + r.h - h
      if (y < MIN_Y) {
        h -= MIN_Y - y
        y = MIN_Y
      }
    }
    resizeWin(win.id, { x, y, w, h })
  }

  const onResizeUp = (e: React.PointerEvent<HTMLDivElement>) => {
    setLive(false)
    if (!resize.current) return
    resize.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
  }

  return (
    <div
      className={cx(
        'window open',
        focused && 'focus',
        win.max && 'max',
        live && 'live',
        win.anim && `anim-${win.anim}`,
      )}
      style={{
        left: win.x,
        top: win.y,
        width: win.w,
        height: win.h,
        zIndex: win.z,
        display: win.min ? 'none' : undefined,
        transform: dragOffset
          ? `translate3d(${dragOffset.dx}px, ${dragOffset.dy}px, 0)`
          : undefined,
      }}
      onPointerDown={() => {
        if (!focused) focusWin(win.id)
      }}
      role="region"
      aria-label={app?.name ?? win.id}
    >
      <div
        className="win-bar mac"
        onPointerDown={onBarPointerDown}
        onPointerMove={onBarPointerMove}
        onPointerUp={onBarPointerUp}
        onPointerCancel={onBarPointerUp}
        onDoubleClick={() => toggleMax(win.id)}
      >
        <div className="traffic">
          <button
            className="tl c"
            title="关闭"
            aria-label="关闭窗口"
            onClick={() => closeWin(win.id)}
          >
            {TL_CLOSE}
          </button>
          <button
            className="tl m"
            title="最小化"
            aria-label="最小化窗口"
            onClick={() => minimizeWin(win.id)}
          >
            {TL_MIN}
          </button>
          <button
            className="tl z"
            title="缩放"
            aria-label="最大化窗口"
            onClick={() => toggleMax(win.id)}
          >
            {TL_MAX}
          </button>
        </div>
        <div className="win-title">
          {app && (
            <span className="mini" style={{ ['--c1' as string]: app.c1, ['--c2' as string]: app.c2 }}>
              <AppIcon id={app.id} />
            </span>
          )}
          {title ?? app?.name ?? win.id}
        </div>
        <div className="win-bar-extra" />
      </div>
      <div className="win-body">
        <AppBody id={win.id} />
      </div>

      {/* 八个把手贴着窗口边缘，最外 6px 是热区；最大化时不给，和 macOS 一致 */}
      {!win.max &&
        DIRS.map((dir) => (
          <div
            key={dir}
            className={`rz rz-${dir}`}
            onPointerDown={onResizeDown(dir)}
            onPointerMove={onResizeMove}
            onPointerUp={onResizeUp}
            onPointerCancel={onResizeUp}
            aria-hidden="true"
          />
        ))}
    </div>
  )
})

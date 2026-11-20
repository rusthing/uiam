/**
 * 窗口框：交通灯 + 可拖拽标题栏 + 八向改大小 + 内容区。
 *
 * 拖动用 Pointer Events 而不是 mousemove：指针捕获之后即使鼠标划过 iframe 或
 * 窗口外也不会丢事件，这是原型的 `makeDraggable` 想做但做不到的事。起始位置在
 * `pointerdown` 时冻结在 ref 里，所以拖动过程中 `win.x` 一直在变也不会自乘。
 *
 * 改大小同理，但多一件事：**钳制要按方向做**。往左拖时宽度变小、x 要跟着右移；
 * 碰到最小宽度后 x 就不能再动，否则窗口会「一边缩小一边往右跑」。所以下限判断
 * 在这里做，`resizeWin` 只负责落值。
 */
import { useRef, type ReactNode } from 'react'
import { APP_MAP } from '../apps/meta'
import { AppIcon } from '../apps/AppIcon'
import { useShell, type WinState } from './state'
import { cx } from '../components/ui'

const MIN_W = 460
const MIN_H = 280
/** 标题栏不能钻到菜单栏底下 */
const MIN_Y = 26

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

export function WindowFrame({ win, children }: { win: WinState; children: ReactNode }) {
  const shell = useShell()
  const app = APP_MAP[win.id]
  const focused = shell.focusId === win.id
  const drag = useRef<{ sx: number; sy: number; x: number; y: number } | null>(null)

  const onBarPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    // 交通灯上的点击不要被拖拽逻辑吞掉
    if ((e.target as HTMLElement).closest('.tl')) return
    shell.focusWin(win.id)
    if (win.max) return
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { sx: e.clientX, sy: e.clientY, x: win.x, y: win.y }
  }

  const onBarPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d) return
    shell.moveWin(win.id, d.x + e.clientX - d.sx, d.y + e.clientY - d.sy)
  }

  const onBarPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return
    drag.current = null
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
    shell.focusWin(win.id)
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
    shell.resizeWin(win.id, { x, y, w, h })
  }

  const onResizeUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!resize.current) return
    resize.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
  }

  return (
    <div
      className={cx('window open', focused && 'focus', win.max && 'max')}
      style={{
        left: win.x,
        top: win.y,
        width: win.w,
        height: win.h,
        zIndex: win.z,
        display: win.min ? 'none' : undefined,
      }}
      onPointerDown={() => {
        if (!focused) shell.focusWin(win.id)
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
        onDoubleClick={() => shell.toggleMax(win.id)}
      >
        <div className="traffic">
          <button
            className="tl c"
            title="关闭"
            aria-label="关闭窗口"
            onClick={() => shell.closeWin(win.id)}
          >
            {TL_CLOSE}
          </button>
          <button
            className="tl m"
            title="最小化"
            aria-label="最小化窗口"
            onClick={() => shell.minimizeWin(win.id)}
          >
            {TL_MIN}
          </button>
          <button
            className="tl z"
            title="缩放"
            aria-label="最大化窗口"
            onClick={() => shell.toggleMax(win.id)}
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
          {shell.titles[win.id] ?? app?.name ?? win.id}
        </div>
        <div className="win-bar-extra" />
      </div>
      <div className="win-body">{children}</div>

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
}

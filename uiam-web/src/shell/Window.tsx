/**
 * 窗口框：交通灯 + 可拖拽标题栏 + 内容区。
 *
 * 拖动用 Pointer Events 而不是 mousemove：指针捕获之后即使鼠标划过 iframe 或
 * 窗口外也不会丢事件，这是原型的 `makeDraggable` 想做但做不到的事。起始位置在
 * `pointerdown` 时冻结在 ref 里，所以拖动过程中 `win.x` 一直在变也不会自乘。
 */
import { useRef, type ReactNode } from 'react'
import { APP_MAP } from '../apps/meta'
import { AppIcon } from '../apps/AppIcon'
import { useShell, type WinState } from './state'
import { cx } from '../components/ui'

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
          {app?.name ?? win.id}
        </div>
        <div className="win-bar-extra" />
      </div>
      <div className="win-body">{children}</div>
    </div>
  )
}

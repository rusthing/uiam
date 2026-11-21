/**
 * Dock：启动台 + 固定栏 + 临时栏 + 回到桌面。
 *
 * 「固定」是用户的意图（右键可改，存 localStorage），「临时」是当前开着但没固定的
 * 应用，外加最近关掉还没被挤掉的那几个——关窗不等于从 Dock 上消失，但也不会无限
 * 堆积：临时栏最多留住 3 个已关闭的应用，第 4 个关掉时最早关的那个被挤出去。
 * 运行点（`.run`）沿用原型的两级语义：开着 = 小圆点，在最前面 = 长条；已经关掉、
 * 只是还留在栏里的项没有点，点它等于重新拉起。
 *
 * 「回到桌面」是系统动作，不是应用：放到最右边，用一条分隔线和应用区分开，
 * 位置固定，不参与固定栏的拖拽重排。
 */
import { useEffect, useState } from 'react'
import { APPS, APP_MAP } from '../apps/meta'
import { AppTile } from '../apps/AppTile'
import { useToast } from '../components/Toast'
import { cx } from '../components/ui'
import { useShell } from './state'

const LAUNCH_ICON = (
  <svg viewBox="0 0 24 24" fill="#fff">
    <rect x="3" y="3" width="5.2" height="5.2" rx="1.5" />
    <rect x="9.4" y="3" width="5.2" height="5.2" rx="1.5" />
    <rect x="15.8" y="3" width="5.2" height="5.2" rx="1.5" />
    <rect x="3" y="9.4" width="5.2" height="5.2" rx="1.5" />
    <rect x="9.4" y="9.4" width="5.2" height="5.2" rx="1.5" />
    <rect x="15.8" y="9.4" width="5.2" height="5.2" rx="1.5" />
    <rect x="3" y="15.8" width="5.2" height="5.2" rx="1.5" />
    <rect x="9.4" y="15.8" width="5.2" height="5.2" rx="1.5" />
    <rect x="15.8" y="15.8" width="5.2" height="5.2" rx="1.5" />
  </svg>
)

const DESK_ICON = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="#fff"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="3" y="3.8" width="18" height="12.4" rx="2" />
    <rect x="8.8" y="11.4" width="6.4" height="2.4" rx="1.2" />
    <path d="M12 16.2v3.4M8.4 19.6h7.2" />
  </svg>
)


export function Dock() {
  const shell = useShell()
  const toast = useToast()
  const [ctx, setCtx] = useState<{ id: string; x: number; y: number } | null>(null)
  /** 正在被拖的固定项。拖拽过程中经过别的图标就即时换位，松手不用再算落点 */
  const [dragId, setDragId] = useState<string | null>(null)

  useEffect(() => {
    if (!ctx) return
    const close = () => setCtx(null)
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [ctx])

  const temp = shell.temp
  const isRunning = (id: string) => shell.wins.some((w) => w.id === id)
  const isActive = (id: string) =>
    shell.focusId === id && shell.wins.some((w) => w.id === id && !w.min)
  /** 桌面上一个窗口都没露出来（全收着或本来就没开），按钮就变成「还原」 */
  const deskShown = !shell.wins.some((w) => !w.min) && shell.wins.length > 0

  /**
   * `pinIdx` 只有固定栏的图标才给：它既是「可拖」的开关，也是落点位置。
   * 临时栏不参与重排（顺序跟开窗/关闭的先后绑定，拖了也没有语义）。
   */
  const item = (id: string, pinIdx?: number) => {
    const app = APP_MAP[id]
    if (!app) return null
    const sortable = pinIdx !== undefined
    return (
      <button
        key={id}
        className={cx(
          'dock-item',
          sortable && 'pinned',
          isRunning(id) && 'running',
          isActive(id) && 'active',
          dragId === id && 'dragging',
        )}
        data-id={id}
        draggable={sortable}
        onClick={() => shell.openApp(id)}
        onDragStart={(e) => {
          if (!sortable) return
          e.dataTransfer.effectAllowed = 'move'
          // Firefox 不写 data 就不会真正开始拖拽
          e.dataTransfer.setData('text/plain', id)
          setDragId(id)
        }}
        onDragEnter={() => {
          if (dragId && sortable && dragId !== id) shell.movePin(dragId, pinIdx)
        }}
        onDragOver={(e) => {
          if (dragId) e.preventDefault()
        }}
        onDragEnd={() => setDragId(null)}
        onDrop={(e) => {
          if (dragId) e.preventDefault()
          setDragId(null)
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          setCtx({
            id,
            x: Math.min(e.clientX, window.innerWidth - 190),
            y: Math.min(e.clientY, window.innerHeight - 120),
          })
        }}
        aria-label={app.name}
      >
        <AppTile id={id} />
        <div className="tip">{app.name}</div>
        <div className="run" />
      </button>
    )
  }

  return (
    <>
      <div className={cx('dock', dragId && 'sorting')}>
        <button
          className="dock-item"
          onClick={() => shell.setLaunchpad(!shell.launchpad)}
          aria-label="启动台"
        >
          <div className="tile" style={{ ['--c1' as string]: '#a1a1a6', ['--c2' as string]: '#63636a' }}>
            {LAUNCH_ICON}
          </div>
          <div className="tip">启动台</div>
        </button>
        <div className="dock-sep" />
        <div className="dock-group">{shell.pinned.map((id, i) => item(id, i))}</div>
        {temp.length > 0 && <div className="dock-sep" />}
        <div className="dock-group">{temp.map((t) => item(t.id))}</div>
        {/* 系统动作与业务应用分开：最右边隔一条线，和原型里「下载 / 废纸篓」同一档 */}
        <div className="dock-sep" />
        <button
          className={cx('dock-item', deskShown && 'toggled')}
          onClick={() => shell.toggleDesktop()}
          aria-label={deskShown ? '还原窗口' : '回到桌面'}
        >
          <div className="tile" style={{ ['--c1' as string]: '#7ab6ff', ['--c2' as string]: '#2b5cd9' }}>
            {DESK_ICON}
          </div>
          <div className="tip">{deskShown ? '还原窗口' : '回到桌面'}</div>
        </button>
      </div>

      <div
        className={cx('ctx', ctx && 'show')}
        style={{ left: ctx?.x ?? 0, top: ctx?.y ?? 0 }}
        onClick={(e) => e.stopPropagation()}
      >
        {ctx && (
          <>
            <button
              className="ctx-item"
              onClick={() => {
                shell.togglePin(ctx.id)
                setCtx(null)
              }}
            >
              {shell.pinned.includes(ctx.id) ? '从 Dock 中移除' : '在 Dock 中保留'}
            </button>
            {isRunning(ctx.id) && (
              <button
                className="ctx-item"
                onClick={() => {
                  shell.closeWin(ctx.id)
                  setCtx(null)
                }}
              >
                关闭窗口
              </button>
            )}
            <div className="ctx-sep" />
            <button
              className="ctx-item"
              onClick={() => {
                toast.info(`「${APP_MAP[ctx.id]?.name ?? ctx.id}」共 ${APPS.length} 个应用，可在启动台查看全部`)
                setCtx(null)
              }}
            >
              应用信息…
            </button>
          </>
        )}
      </div>
    </>
  )
}

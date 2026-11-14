/**
 * Dock：启动台 + 固定栏 + 临时栏 + 废纸篓。
 *
 * 「固定」是用户的意图（右键可改，存 localStorage），「临时」是当前开着但没固定的
 * 应用——这两栏分开，关掉窗口后临时栏自然清空，不会在 Dock 上留下一条永久的垃圾。
 * 运行点（`.run`）和活动点（加宽）沿用原型的两级语义：开着 = 小圆点，在最前面 = 长条。
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

export function Dock() {
  const shell = useShell()
  const toast = useToast()
  const [ctx, setCtx] = useState<{ id: string; x: number; y: number } | null>(null)

  useEffect(() => {
    if (!ctx) return
    const close = () => setCtx(null)
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [ctx])

  const temp = shell.wins.map((w) => w.id).filter((id) => !shell.pinned.includes(id))
  const isRunning = (id: string) => shell.wins.some((w) => w.id === id)
  const isActive = (id: string) =>
    shell.focusId === id && shell.wins.some((w) => w.id === id && !w.min)

  const item = (id: string) => {
    const app = APP_MAP[id]
    if (!app) return null
    return (
      <button
        key={id}
        className={cx(
          'dock-item',
          isRunning(id) && 'running',
          isActive(id) && 'active',
        )}
        data-id={id}
        onClick={() => shell.openApp(id)}
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
      <div className="dock">
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
        <div className="dock-group">{shell.pinned.map(item)}</div>
        {temp.length > 0 && <div className="dock-sep" />}
        <div className="dock-group">{temp.map(item)}</div>
        <div className="dock-sep" />
        <button
          className="dock-item"
          onClick={() => toast.info('废纸篓是空的——删掉的网关实例在库里就被删了，没有回收站')}
          aria-label="废纸篓"
        >
          <div className="tile" style={{ ['--c1' as string]: '#dedee2', ['--c2' as string]: '#b4b4ba' }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="#5f5f66" strokeWidth="1.5" strokeLinecap="round">
              <path d="M5 7h14M9.5 7V5.2c0-.7.5-1.2 1.2-1.2h2.6c.7 0 1.2.5 1.2 1.2V7M6.5 7l.9 12.1c0 .8.7 1.4 1.5 1.4h6.2c.8 0 1.5-.6 1.5-1.4L17.5 7" />
            </svg>
          </div>
          <div className="tip">废纸篓</div>
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

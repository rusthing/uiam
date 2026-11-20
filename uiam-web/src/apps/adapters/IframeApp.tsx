/**
 * iframe 适配器：把外部控制台当成窗口里的一个文档。
 *
 * 这里的职责只有四件事：拼 URL、收发桥接消息、把子应用回报的标题写到窗口标题栏、
 * 把通知转发到宿主 Toast。业务数据一律不碰，避免宿主变成第二个网关。
 */
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { useToast } from '../../components/Toast'
import { SESSION_EXPIRED_EVENT } from '../../lib/session'
import { currentTheme, subscribeTheme } from '../../lib/theme'
import { useShell } from '../../shell/state'
import { envelope, isBridgeEnvelope, type HostMsgType } from '../bridge'
import type { AppMeta } from '../meta'
import { capsOf } from '../runtime'

/** 默认走同源前缀；需要跨机器联调时用 VITE_XXX_WEB_URL 覆盖 */
function buildUrl(app: AppMeta): string {
  const base = app.url ?? `/${app.id}/`
  let url: URL
  try {
    url = new URL(base, window.location.origin)
  } catch {
    return '/'
  }
  url.searchParams.set('embed', '1')
  url.searchParams.set('app', app.id)
  if (app.route) url.searchParams.set('route', app.route)
  return url.toString()
}

export function IframeApp({ app }: { app: AppMeta }) {
  const ref = useRef<HTMLIFrameElement>(null)
  const toast = useToast()
  const { setWinTitle } = useShell()
  const theme = useSyncExternalStore(subscribeTheme, currentTheme)
  const caps = useMemo(() => capsOf(app), [app])
  const src = useMemo(() => buildUrl(app), [app])
  const targetOrigin = useMemo(() => {
    try {
      return new URL(src).origin
    } catch {
      return window.location.origin
    }
  }, [src])

  const post = useCallback(
    (type: HostMsgType, payload?: Record<string, unknown>) => {
      const win = ref.current?.contentWindow
      if (!win) return
      win.postMessage(envelope(app.id, type, payload), targetOrigin)
    },
    [app.id, targetOrigin],
  )

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== targetOrigin) return
      if (!ref.current || event.source !== ref.current.contentWindow) return
      const msg = event.data
      if (!isBridgeEnvelope(msg) || msg.appId !== app.id) return

      switch (msg.type) {
        case 'ready':
          if (caps.theme) post('init', { theme: currentTheme(), route: app.route ?? null })
          break
        case 'title': {
          const title = msg.payload?.title
          if (caps.title && typeof title === 'string' && title) setWinTitle(app.id, title)
          break
        }
        case 'notify': {
          if (!caps.toast) break
          const text = msg.payload?.text
          if (typeof text !== 'string' || !text) break
          const level = msg.payload?.level
          if (level === 'success') toast.success(text)
          else if (level === 'error') toast.error(text)
          else toast.info(text)
          break
        }
        case 'session-expired':
          // 统一交给 SessionWatcher 弹提示，避免同源事件 + 桥接消息各弹一次
          window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT))
          break
        case 'route':
          // 路由回报留给后续做「跨应用跳转 / 面包屑」；当前窗口标题栏不展示路径
          break
        default:
          break
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [app.id, app.route, caps, post, setWinTitle, targetOrigin, toast])

  useEffect(() => {
    if (caps.theme) post('theme', { theme })
  }, [caps.theme, post, theme])

  return (
    <iframe
      ref={ref}
      className="embed-frame"
      src={src}
      title={app.name}
      referrerPolicy="same-origin"
      onLoad={() => {
        if (caps.theme) post('init', { theme: currentTheme(), route: app.route ?? null })
      }}
    />
  )
}

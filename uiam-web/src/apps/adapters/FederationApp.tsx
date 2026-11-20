/**
 * 联邦适配器（POC）：加载远端页面级模块，像内部应用一样活在桌面窗口里。
 *
 * 与 iframe 的差别：React 是单例，宿主直接把 theme / 初始路由 / 标题回调
 * 作为 props 交给远端组件，不再需要 postMessage 握手。代价是远端不可用会
 * 把错误抛到宿主的渲染树里，所以这里必须有 ErrorBoundary 和独立打开出口。
 */
import {
  Component,
  Suspense,
  lazy,
  useCallback,
  useSyncExternalStore,
  type ErrorInfo,
  type ReactNode,
} from 'react'
import { currentTheme, subscribeTheme, type Theme } from '../../lib/theme'
import { useShell } from '../../shell/state'
import type { AppMeta } from '../meta'

// 静态 specifier 让联邦插件在构建期把它们登记成远程模块；真正的代码运行时才取。
// 必须是字面量（不能 import(`./${name}`)），否则构建期扫描不到、运行时也解析不了。
const REMOTE_APPS: Record<string, ReturnType<typeof lazy>> = {
  syn: lazy(() => import('syn-web/syn-app')),
  msg: lazy(() => import('msg-web/msg-app')),
  alarm: lazy(() => import('alarm-web/alarm-app')),
  dbz: lazy(() => import('dbz-web/dbz-app')),
}

interface BoundaryState {
  error: Error | null
  retry: number
}

class FederationBoundary extends Component<
  { app: AppMeta; children: ReactNode },
  BoundaryState
> {
  state: BoundaryState = { error: null, retry: 0 }

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error, retry: 0 }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[federation] ${this.props.app.id} 加载失败`, error, info.componentStack)
  }

  render() {
    const { app, children } = this.props
    if (this.state.error) {
      return (
        <div className="pane">
          <div className="pane-title">{app.name} 暂时无法在桌面中打开</div>
          <div className="pane-desc">
            远程模块加载失败：{this.state.error.message}。可以先在新标签页继续使用。
          </div>
          <div className="federation-actions">
            <button
              className="btn btn-primary"
              type="button"
              onClick={() =>
                this.setState((prev) => ({ error: null, retry: prev.retry + 1 }))
              }
            >
              重试加载
            </button>
            {app.url && (
              <a className="btn" href={app.url} target="_blank" rel="noreferrer">
                独立打开
              </a>
            )}
          </div>
        </div>
      )
    }
    return <div key={this.state.retry}>{children}</div>
  }
}

export function FederationApp({ app }: { app: AppMeta }) {
  const theme = useSyncExternalStore<Theme>(subscribeTheme, currentTheme, () => 'light')
  const { setWinTitle } = useShell()
  const onRoute = useCallback(
    (_path: string, title: string) => setWinTitle(app.id, title || app.name),
    [app.id, app.name, setWinTitle],
  )

  const RemoteApp = REMOTE_APPS[app.id]
  if (!RemoteApp) {
    return (
      <div className="pane">
        <div className="pane-title">{app.name} 的联邦模块未登记</div>
        <div className="pane-desc">该应用尚未在联邦注册表里配置远程组件。</div>
      </div>
    )
  }

  return (
    <div className="federation-app">
      <FederationBoundary app={app}>
        <Suspense
          fallback={
            <div className="pane">
              <div className="pane-title">正在加载 {app.name}…</div>
              <div className="pane-desc">远程模块首次加载，失败会自动给出独立打开入口。</div>
            </div>
          }
        >
          <RemoteApp theme={theme} initialPath={app.route ?? '/'} onRoute={onRoute} />
        </Suspense>
      </FederationBoundary>
    </div>
  )
}

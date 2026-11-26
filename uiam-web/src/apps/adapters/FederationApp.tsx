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
  useMemo,
  useState,
  useSyncExternalStore,
  type ComponentType,
  type ErrorInfo,
  type ReactNode,
} from 'react'
import { currentTheme, subscribeTheme, type Theme } from '../../lib/theme'
import { useShell } from '../../shell/state'
import type { AppMeta } from '../meta'

// 静态 specifier 让联邦插件在构建期把它们登记成远程模块；真正的代码运行时才取。
// 必须是字面量（不能 import(`./${name}`)），否则构建期扫描不到、运行时也解析不了。
//
// 这里存的是「加载器」而不是 lazy 组件本身：React.lazy 会把首次 import 的结果
// （含失败）缓存进内部 payload，同一个 lazy 对象重试不会重新 import。真正的重试
// 必须由 FederationApp 在 retry 变化时重新 lazy(loader) 生成一个新对象。
const REMOTE_LOADERS: Record<string, () => Promise<{ default: ComponentType<any> }>> = {
  syn: () => import('syn-web/syn-app'),
  msg: () => import('msg-web/msg-app'),
  alarm: () => import('alarm-web/alarm-app'),
  dbz: () => import('dbz-web/dbz-app'),
  adm: () => import('adm-web/adm-app'),
  dtw: () => import('dtw-web/dtw-app'),
  jobx: () => import('jobx-web/jobx-app'),
}

interface BoundaryState {
  error: Error | null
}

class FederationBoundary extends Component<
  { app: AppMeta; onRetry: () => void; children: ReactNode },
  BoundaryState
> {
  state: BoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[federation] ${this.props.app.id} 加载失败`, error, info.componentStack)
  }

  render() {
    const { app, children, onRetry } = this.props
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
              onClick={() => {
                this.setState({ error: null })
                onRetry()
              }}
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
    return children
  }
}

export function FederationApp({ app }: { app: AppMeta }) {
  const theme = useSyncExternalStore<Theme>(subscribeTheme, currentTheme, () => 'light')
  const { setWinTitle, setWinPath, routes } = useShell()
  // openApp(id, route) 的覆盖（账户菜单「个人中心」跳 adm /profile）；没有则用 meta 默认。
  const initialPath = routes[app.id] ?? app.route ?? '/'
  const onRoute = useCallback(
    (path: string, title: string) => {
      setWinTitle(app.id, title || app.name)
      // 记下窗口内部路由：标题栏的「在新页面打开」要靠它把用户送到同一页，
      // 否则点一下就被丢回应用首页
      if (path) setWinPath(app.id, path)
    },
    [app.id, app.name, setWinTitle, setWinPath],
  )

  // retry 变化时重新 lazy()，生成 payload 干净的新组件：这样重试才会真正重新
  // import() 远程入口，而不是复用缓存了失败结果的旧 lazy 对象。
  const [retry, setRetry] = useState(0)
  const handleRetry = useCallback(() => setRetry((n) => n + 1), [])
  const RemoteApp = useMemo(() => {
    const loader = REMOTE_LOADERS[app.id]
    return loader ? lazy(loader) : null
  }, [app.id, retry])

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
      <FederationBoundary app={app} onRetry={handleRetry}>
        <Suspense
          fallback={
            <div className="pane">
              <div className="pane-title">正在加载 {app.name}…</div>
              <div className="pane-desc">远程模块首次加载，失败会自动给出独立打开入口。</div>
            </div>
          }
        >
          <RemoteApp theme={theme} initialPath={initialPath} onRoute={onRoute} />
        </Suspense>
      </FederationBoundary>
    </div>
  )
}

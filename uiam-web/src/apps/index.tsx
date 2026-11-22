/**
 * 窗口内容分发：id → 组件 / 适配器。
 *
 * 单独一层是为了让外壳（Dock / 启动台 / 窗口）只依赖 `meta.ts` 的元数据，
 * 不 import 任何业务组件——否则「打开 Dock 就要把网关页面的整棵依赖树拉进来」，
 * 分包和启动顺序都会变差。
 *
 * 内置应用仍走静态 import；外部应用只按 mode 选择适配器，真正的代码在各自站点里。
 */
import { AboutApp } from './AboutApp'
import { ApiApp } from './ApiApp'
import { GatewayApp } from './GatewayApp'
import { LifeApp } from './LifeApp'
import { SettingsApp } from './SettingsApp'
import { FederationApp } from './adapters/FederationApp'
import { IframeApp } from './adapters/IframeApp'
import { ExternalApp, PendingApp } from './adapters/SimpleApps'
import { APP_MAP } from './meta'
import type { AppMeta } from './meta'

function InternalBody({ id }: { id: string }) {
  switch (id) {
    case 'gateway':
      return <GatewayApp />
    case 'life':
      return <LifeApp />
    case 'api':
      return <ApiApp />
    case 'settings':
      return <SettingsApp />
    case 'about':
      return <AboutApp />
    default:
      return (
        <div className="pane">
          <div className="pane-title">未知应用</div>
          <div className="pane-desc">没有 id 为「{id}」的内置应用</div>
        </div>
      )
  }
}

function bodyFor(app: AppMeta) {
  switch (app.mode ?? 'internal') {
    case 'internal':
      return <InternalBody id={app.id} />
    case 'iframe':
      return <IframeApp app={app} />
    case 'federation':
      return <FederationApp app={app} />
    case 'external':
      return <ExternalApp app={app} />
    default:
      return <PendingApp app={app} />
  }
}

export function AppBody({ id }: { id: string }) {
  const app = APP_MAP[id]
  if (!app) {
    return (
      <div className="pane">
        <div className="pane-title">未知应用</div>
        <div className="pane-desc">没有 id 为「{id}」的应用</div>
      </div>
    )
  }
  return bodyFor(app)
}

/**
 * 窗口内容分发：id → 组件 / 适配器。
 *
 * 单独一层是为了让外壳（Dock / 启动台 / 窗口）只依赖 `meta.ts` 的元数据，
 * 不 import 任何业务组件——否则「打开 Dock 就要把网关页面的整棵依赖树拉进来」，
 * 分包和启动顺序都会变差。
 *
 * 内置应用按 id 懒加载：桌面与登录页不再为「网关配置」的表单、关系图、发布链路
 * 付首屏解析成本，第一次打开对应窗口时才取那一段 chunk。
 *
 * `AppBody` 是 memo 的：窗口开关、聚焦、拖动都只改外壳状态，已经打开的应用不该
 * 因此重新渲染整棵组件树（联邦远程应用尤其贵）。
 */
import { lazy, memo, Suspense } from 'react'
import { FederationApp } from './adapters/FederationApp'
import { IframeApp } from './adapters/IframeApp'
import { ExternalApp, PendingApp } from './adapters/SimpleApps'
import { APP_MAP } from './meta'
import type { AppMeta } from './meta'

const GatewayApp = lazy(() => import('./GatewayApp').then((m) => ({ default: m.GatewayApp })))
const LifeApp = lazy(() => import('./LifeApp').then((m) => ({ default: m.LifeApp })))
const ApiApp = lazy(() => import('./ApiApp').then((m) => ({ default: m.ApiApp })))
const SettingsApp = lazy(() => import('./SettingsApp').then((m) => ({ default: m.SettingsApp })))
const AboutApp = lazy(() => import('./AboutApp').then((m) => ({ default: m.AboutApp })))

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

export const AppBody = memo(function AppBody({ id }: { id: string }) {
  const app = APP_MAP[id]
  if (!app) {
    return (
      <div className="pane">
        <div className="pane-title">未知应用</div>
        <div className="pane-desc">没有 id 为「{id}」的应用</div>
      </div>
    )
  }
  return (
    <Suspense
      fallback={
        <div className="pane">
          <div className="pane-title">正在加载…</div>
        </div>
      }
    >
      {bodyFor(app)}
    </Suspense>
  )
})

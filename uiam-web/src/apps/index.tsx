/**
 * 窗口内容分发：id → 组件。
 *
 * 单独一层是为了让外壳（Dock / 启动台 / 窗口）只依赖 `meta.ts` 的元数据，
 * 不 import 任何业务组件——否则「打开 Dock 就要把网关页面的整棵依赖树拉进来」，
 * 分包和启动顺序都会变差。
 */
import { AboutApp } from './AboutApp'
import { ApiApp } from './ApiApp'
import { GatewayApp } from './GatewayApp'
import { SettingsApp } from './SettingsApp'

export function AppBody({ id }: { id: string }) {
  switch (id) {
    case 'gateway':
      return <GatewayApp />
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
          <div className="pane-desc">没有 id 为「{id}」的应用</div>
        </div>
      )
  }
}

/**
 * 非文档型模式的占位适配器。
 *
 * external 由 Shell 的 openApp 直接开新标签页，正常不会渲染到这里；这里只是兜底，
 * 保证即使用了历史 deep-link 误开窗口，用户也能看到明确出口而不是空白页。
 *
 * federation / sandbox / webcomponent 是后续阶段要接的模式，先把入口占住：清单里
 * 能登记、启动台能搜到，点了会说明「待接入」，而不是伪装成可用的空壳。
 */
import type { AppMeta } from '../meta'

export function ExternalApp({ app }: { app: AppMeta }) {
  const url = app.url ?? '/'
  return (
    <div className="pane">
      <div className="pane-title">{app.name}</div>
      <div className="pane-desc">这个应用按独立页面运行，点击下面链接在新标签页打开。</div>
      <div style={{ marginTop: 14 }}>
        <a className="btn btn-primary" href={url} target="_blank" rel="noreferrer">
          在新标签页打开
        </a>
      </div>
    </div>
  )
}

export function PendingApp({ app }: { app: AppMeta }) {
  return (
    <div className="pane">
      <div className="pane-title">{app.name}</div>
      <div className="pane-desc">
        该应用登记为「{app.mode}」模式，适配器尚未接入。当前请从启动台选择其它应用。
      </div>
    </div>
  )
}

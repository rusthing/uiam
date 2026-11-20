/**
 * 宿主与嵌入文档之间的消息信封。
 *
 * 只用同源 postMessage：targetOrigin 与 e.origin 都钉死在 window.location.origin，
 * 并同时校验 appId 和 event.source，避免多个窗口之间串话。协议刻意保持很薄——
 * 主题、标题、路由、通知、会话过期就够，业务数据仍走各子应用自己的接口层。
 */
export const EMBED_CHANNEL = 'rusthing-uiam-embed'

export type HostMsgType = 'init' | 'theme' | 'navigate' | 'refresh'
export type GuestMsgType = 'ready' | 'title' | 'route' | 'notify' | 'session-expired'

export interface BridgeEnvelope {
  channel: string
  appId: string
  type: string
  payload?: Record<string, unknown>
}

export function envelope(
  appId: string,
  type: HostMsgType | GuestMsgType,
  payload?: Record<string, unknown>,
): BridgeEnvelope {
  return { channel: EMBED_CHANNEL, appId, type, payload }
}

export function isBridgeEnvelope(value: unknown): value is BridgeEnvelope {
  if (!value || typeof value !== 'object') return false
  const v = value as Partial<BridgeEnvelope>
  return (
    v.channel === EMBED_CHANNEL &&
    typeof v.appId === 'string' &&
    typeof v.type === 'string' &&
    (v.payload === undefined ||
      (typeof v.payload === 'object' && v.payload !== null && !Array.isArray(v.payload)))
  )
}

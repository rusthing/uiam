/**
 * 接口层：一个 `request` + 一组按实体分好的端点。
 *
 * ## 为什么不用 axios / react-query
 *
 * 一共 6 个实体的 CRUD 加 3 个动作接口，请求逻辑不到 100 行；多一层依赖换来的是
 * 又一个要跟着版本升级的包。这里只把三件容易写错的事收口：
 *
 * 1. **`X-User-Id` 必带**——uiam 的写接口没有它会直接 400，而审计就落在这个 id 上；
 * 2. **`result !== 1` 也算失败**——HTTP 200 也可能是业务失败，只看 status 会静默吞错；
 * 3. **`msg` 是给人看的**——服务端把「为什么要重启」「哪个负载均衡器不存在」写在
 *    `msg` 里，直接抛给调用方展示，前端不要自己编一句「操作失败」盖掉它。
 */
import type {
  Balancer,
  BalancerPayload,
  Gateway,
  GatewayPayload,
  Listener,
  ListenerPayload,
  PublishResult,
  Release,
  RenderPreview,
  Ro,
  Route,
  RoutePayload,
} from './types'

const OPERATOR_KEY = 'uiam-operator-id'

/** 当前操作者 ID。一期没有登录，用一个人工填的数字顶替，落 localStorage。 */
export function getOperatorId(): string {
  return localStorage.getItem(OPERATOR_KEY) || '1'
}

export function setOperatorId(id: string) {
  localStorage.setItem(OPERATOR_KEY, id)
}

/** 接口错误：`status` 是 HTTP 状态，`detail` 是服务端 `detail` 字段（如果有） */
export class ApiError extends Error {
  status: number
  detail?: string

  constructor(message: string, status: number, detail?: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.detail = detail
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { 'X-User-Id': getOperatorId() }
  if (body !== undefined) headers['Content-Type'] = 'application/json'

  let res: Response
  try {
    res = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch (e) {
    throw new ApiError(`连不上 uiam-svr：${(e as Error).message}`, 0)
  }

  const text = await res.text()
  let payload: (Ro<T> & { detail?: string }) | undefined
  if (text) {
    try {
      payload = JSON.parse(text)
    } catch {
      // 非 JSON（比如网关返回的 404 页面）：把原文截一段带出去，比「未知错误」有用
      throw new ApiError(text.slice(0, 200) || `HTTP ${res.status}`, res.status)
    }
  }

  if (!res.ok) {
    throw new ApiError(payload?.msg || `HTTP ${res.status}`, res.status, payload?.detail)
  }
  if (payload && payload.result !== 1) {
    throw new ApiError(payload.msg || '操作失败', res.status, payload.detail)
  }
  return payload?.extra as T
}

/** 列表类接口返回的 `extra` 就是数组本身 */
function listOf<T>(path: string) {
  return request<T[] | null>('GET', path).then((data) => data ?? [])
}

/** 查询串：`?gatewayId=1&listenerId=2`，跳过空值 */
function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') sp.set(k, String(v))
  }
  const s = sp.toString()
  return s ? `?${s}` : ''
}

export const api = {
  gateway: {
    list: () => listOf<Gateway>('/uiam/gateway/list'),
    listEnabled: () => listOf<Gateway>('/uiam/gateway/list' + qs({ enabled: true })),
    get: (id: string) => request<Gateway>('GET', `/uiam/gateway/${id}`),
    add: (p: GatewayPayload) => request<Gateway>('POST', '/uiam/gateway', p),
    update: (p: GatewayPayload) => request<Gateway>('PUT', '/uiam/gateway', p),
    remove: (id: string) => request<unknown>('DELETE', `/uiam/gateway/${id}`),
  },
  listener: {
    listByGateway: (gatewayId: string) =>
      listOf<Listener>('/uiam/gateway-listener/list' + qs({ gatewayId })),
    add: (p: ListenerPayload) => request<Listener>('POST', '/uiam/gateway-listener', p),
    update: (p: ListenerPayload) => request<Listener>('PUT', '/uiam/gateway-listener', p),
    remove: (id: string) => request<unknown>('DELETE', `/uiam/gateway-listener/${id}`),
  },
  route: {
    listByListener: (listenerId: string) =>
      listOf<Route>('/uiam/gateway-route/list' + qs({ listenerId })),
    add: (p: RoutePayload) => request<Route>('POST', '/uiam/gateway-route', p),
    update: (p: RoutePayload) => request<Route>('PUT', '/uiam/gateway-route', p),
    remove: (id: string) => request<unknown>('DELETE', `/uiam/gateway-route/${id}`),
  },
  balancer: {
    listByGateway: (gatewayId: string) =>
      listOf<Balancer>('/uiam/gateway-balancer/list' + qs({ gatewayId })),
    add: (p: BalancerPayload) => request<Balancer>('POST', '/uiam/gateway-balancer', p),
    update: (p: BalancerPayload) => request<Balancer>('PUT', '/uiam/gateway-balancer', p),
    remove: (id: string) => request<unknown>('DELETE', `/uiam/gateway-balancer/${id}`),
  },
  release: {
    /** 历史版本：按版本号倒序（服务端不保证顺序，前端自己排） */
    listByGateway: async (gatewayId: string) => {
      const rows = await listOf<Release>('/uiam/gateway-release/list' + qs({ gatewayId }))
      return rows.sort((a, b) => b.version - a.version)
    },
    get: (id: string) => request<Release>('GET', `/uiam/gateway-release/${id}`),
  },
  publish: {
    preview: (gatewayId: string) =>
      request<RenderPreview>('GET', `/uiam/gateway/render-preview/${gatewayId}`),
    publish: (gatewayId: string, opts: { force: boolean; confirmRestart: boolean }) =>
      request<PublishResult>('POST', `/uiam/gateway/publish/${gatewayId}`, opts),
    rollback: (releaseId: string, opts: { confirmRestart: boolean }) =>
      request<PublishResult>('POST', `/uiam/gateway/rollback/${releaseId}`, opts),
  },
}

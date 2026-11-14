/**
 * 与 uiam-svr 的接口契约。
 *
 * 这里的字段名不是猜的：`#[crud_dto]` / `#[vo]` 统一按 camelCase 序列化，
 * `u64` 字段会被包成 `U64` 序列化成**字符串**（防 JS 精度丢失），
 * 所以 id / gatewayId / listenerId 一律是 `string`，不要当数字算。
 */

/** 统一响应信封：`result === 1` 才是成功 */
export interface Ro<T> {
  result: number
  msg: string
  timestamp: string
  extra?: T
}

/** 五个实体共有的审计字段 */
export interface Audit {
  id: string
  createrId: string
  createMs: string
  updaterId: string
  updateMs: string
}

/** 网关实例：一个实例 = Consul KV 里的一个 key */
export interface Gateway extends Audit {
  code: string
  name: string
  consulKey: string
  extraToml?: string | null
  opsJson?: string | null
  staticJson?: string | null
  upstreamErrorJson?: string | null
  remark?: string | null
  enabled: boolean
}

/** 监听器：kind 1=Http（渲染进 listeners）2=Tcp（渲染进 tcp-listeners） */
export interface Listener extends Audit {
  gatewayId: string
  kind: number
  sortNo: number
  addrsJson: string
  remark?: string | null
  enabled: boolean
}

/** 路由：顺序即语义，sort_no 小的先匹配 */
export interface Route extends Audit {
  listenerId: string
  sortNo: number
  name: string
  matcherJson: string
  toJson: string
  logJson?: string | null
  enabled: boolean
}

/** 负载均衡器：name 被路由的 `to.type = "LoadBalancer"` 按名字引用 */
export interface Balancer extends Audit {
  gatewayId: string
  name: string
  configJson: string
  remark?: string | null
  enabled: boolean
}

/** 发布版本：content 是渲染出的完整 TOML，回滚时原样重推 */
export interface Release extends Audit {
  gatewayId: string
  version: number
  content: string
  checksum: string
  pushed: boolean
  pushedMs?: number | null
}

/** 渲染预览：只渲染不落库、不推 KV */
export interface RenderPreview {
  gatewayId: string
  toml: string
  checksum: string
  httpListeners: number
  tcpListeners: number
  routes: number
  tcpRoutes: number
  balancers: number
  structuralChange: string | null
  warnings: string[]
}

/** 发布 / 回滚结果 */
export interface PublishResult {
  gatewayId: string
  releaseId: string
  version: number
  checksum: string
  pushed: boolean
  skipped: boolean
  consulKey: string
  modifyIndex: number | null
  structuralChange: string | null
  warnings: string[]
}

/** 监听地址：`{ addr, tls? }`，tls 里是证书路径（私钥不进库） */
export interface ListenerAddr {
  addr: string
  tls?: { cert?: string; key?: string } | null
}

/** 新建 / 修改网关时提交的载荷（id 为空表示新增） */
export interface GatewayPayload {
  id?: string
  code: string
  name: string
  consulKey: string
  extraToml?: string | null
  opsJson?: string | null
  staticJson?: string | null
  upstreamErrorJson?: string | null
  remark?: string | null
  enabled: boolean
}

export interface ListenerPayload {
  id?: string
  gatewayId: string
  kind: number
  sortNo: number
  addrsJson: string
  remark?: string | null
  enabled: boolean
}

export interface RoutePayload {
  id?: string
  listenerId: string
  sortNo: number
  name: string
  matcherJson: string
  toJson: string
  logJson?: string | null
  enabled: boolean
}

export interface BalancerPayload {
  id?: string
  gatewayId: string
  name: string
  configJson: string
  remark?: string | null
  enabled: boolean
}

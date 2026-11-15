/** 一堆与渲染无关的小工具：时间、JSON 解析、把 matcher/to 翻译成人话。 */

/** 把 `u64` 字符串或数字转成毫秒时间戳的本地时间文本 */
export function formatTime(ms?: string | number | null): string {
  if (ms === undefined || ms === null || ms === '') return '—'
  const n = typeof ms === 'string' ? Number(ms) : ms
  if (!Number.isFinite(n) || n <= 0) return '—'
  const d = new Date(n)
  const p = (v: number) => String(v).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/** 相对时间：列表里比绝对时间更容易扫 */
export function relativeTime(ms?: string | number | null): string {
  if (ms === undefined || ms === null || ms === '') return '—'
  const n = typeof ms === 'string' ? Number(ms) : ms
  if (!Number.isFinite(n) || n <= 0) return '—'
  const diff = Date.now() - n
  if (diff < 0) return '刚刚'
  const min = Math.floor(diff / 60000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  const hour = Math.floor(min / 60)
  if (hour < 24) return `${hour} 小时前`
  const day = Math.floor(hour / 24)
  if (day < 30) return `${day} 天前`
  return formatTime(n)
}

/** 摘要只显示前 8 位：全串在详情里看，列表里没必要占一行 */
export function shortChecksum(checksum?: string | null): string {
  if (!checksum) return '—'
  return checksum.slice(0, 8)
}

/** 宽松的 JSON 解析：失败返回 `undefined`，调用方决定怎么降级 */
export function parseJson(text?: string | null): unknown {
  if (!text || !text.trim()) return undefined
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/** 格式化 JSON；解析不了就原样返回（编辑中不该被强行改写） */
export function prettyJson(text?: string | null): string {
  const parsed = parseJson(text)
  if (parsed === undefined) return text ?? ''
  return JSON.stringify(parsed, null, 2)
}

export function isValidJson(text?: string | null): boolean {
  if (!text || !text.trim()) return true
  return parseJson(text) !== undefined
}

type Dict = Record<string, unknown>

function asDict(value: unknown): Dict | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Dict)
    : undefined
}

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  if (value === undefined || value === null) return []
  return [value]
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : value === undefined || value === null ? '' : String(value)
}

/** 监听地址摘要：`0.0.0.0:80 · 0.0.0.0:443 (tls)` */
export function describeAddrs(addrsJson?: string | null): string[] {
  const parsed = parseJson(addrsJson)
  return asArray(parsed).map((item) => {
    const d = asDict(item)
    if (!d) return str(item)
    const addr = str(d.addr)
    return d.tls ? `${addr} · tls` : addr
  })
}

/** 有几个地址绑了证书（证书路径本身不进库，也不该在图上展示） */
export function listenerTlsCount(addrsJson?: string | null): number {
  return asArray(parseJson(addrsJson)).filter((item) => Boolean(asDict(item)?.tls)).length
}

/** 匹配条件摘要：把 5 种变体压成一句中文 */
export function describeMatcher(matcherJson?: string | null): string {
  const d = asDict(parseJson(matcherJson))
  if (!d) return matcherJson?.trim() ? '（JSON 无法解析）' : '未配置'
  const type = str(d.type)
  const urn = asArray(d.urn ?? d.url)
    .map((u) => {
      const ud = asDict(u)
      if (!ud) return str(u)
      const method = str(ud.method)
      const url = str(ud.url)
      return method ? `${method} ${url}` : url
    })
    .filter(Boolean)
    .join(' ')

  switch (type) {
    case 'Host':
      return `Host = ${str(d.addr) || '（未填）'}`
    case 'Prefix':
      return `前缀 ${urn || '（未填）'}`
    case 'Exact':
      return `精确 ${urn || '（未填）'}`
    case 'Regex':
      return `正则 ${str(d.regex) || '（未填）'}`
    case 'Service': {
      const names = asArray(d['svc-name'] ?? d.svcName).map(str).join(', ')
      return `服务 ${names || '（未填）'}`
    }
    case 'Default':
      return '默认（兜底）'
    default:
      return type || '（未指定类型）'
  }
}

/**
 * 取 matcher 的类型与主路径（Prefix / Exact 的第一条 urn）。
 *
 * 单独抽出来是因为「遮蔽」判断需要路径本身，而不是 `前缀 /api` 这种给人看的字符串——
 * 拿字符串做前缀比较会把 `前缀 /api` 误判成 `精确 /health` 的遮蔽者。
 */
export function matcherShape(matcherJson?: string | null): { type: string; path?: string } {
  const d = asDict(parseJson(matcherJson))
  if (!d) return { type: '' }
  const type = str(d.type)
  if (type !== 'Prefix' && type !== 'Exact') return { type }
  const first = asArray(d.urn ?? d.url)[0]
  const fd = asDict(first)
  const path = fd ? str(fd.url) : str(first)
  return { type, path: path || undefined }
}

/**
 * 上一条是否会吃掉这一条。
 *
 * gatex 是 first-match-wins，所以真正危险的只有一种：**前一条是 Prefix，且它的前缀
 * 覆盖了当前这条的路径**。`Prefix /` 覆盖一切（含 Host / Service / Default），
 * 其余前缀只在当前这条也按路径匹配时才有意义。
 */
export function shadowedBy(prevMatcher?: string | null, currentMatcher?: string | null): boolean {
  const a = matcherShape(prevMatcher)
  const b = matcherShape(currentMatcher)
  if (a.type !== 'Prefix' || !a.path) return false
  if (a.path === '/') return true
  if (b.type !== 'Prefix' && b.type !== 'Exact') return false
  if (!b.path) return false
  const prefix = a.path.endsWith('/') ? a.path.slice(0, -1) : a.path
  return b.path === prefix || b.path.startsWith(`${prefix}/`)
}

/** 转发目标摘要 */
export function describeTo(toJson?: string | null): string {
  const d = asDict(parseJson(toJson))
  if (!d) return toJson?.trim() ? '（JSON 无法解析）' : '未配置'
  const type = str(d.type)
  switch (type) {
    case 'Host':
      return `Host → ${str(d.addr) || '（未填）'}`
    case 'LoadBalancer':
      return `LB → ${str(d.name) || '（未填）'}`
    case 'Static':
      return d.spa ? 'Static（SPA）' : 'Static'
    default:
      return type || '（未指定类型）'
  }
}

/**
 * 取 to 的关键字段。`describeTo` 只产出给人看的字符串，图形视图要拿这些字段
 * 去查负载均衡器、标 TLS/SPA 之类的状态，所以单开一个结构化版本。
 */
export function toShape(toJson?: string | null): {
  type: string
  addr?: string
  name?: string
  spa?: boolean
  /** 没写 = 用 gatex 的默认（透传）；false 才是显式改写 */
  preserveHost?: boolean
  /** URI 改写规则。Keep 是默认值，等于没改 */
  uriType?: string
  uriFrom?: string
  uriTo?: string
  uriPrefix?: string
  cors?: boolean
  cacheControl?: string
  upstreamTls?: boolean
} {
  const d = asDict(parseJson(toJson))
  if (!d) return { type: '' }
  const uri = asDict(d.uri)
  const ph = d['preserve-host'] ?? d.preserveHost
  return {
    type: str(d.type),
    addr: str(d.addr) || undefined,
    name: str(d.name) || undefined,
    spa: d.spa === true || undefined,
    preserveHost: ph === undefined || ph === null ? undefined : ph === true,
    uriType: uri ? str(uri.type) || undefined : undefined,
    uriFrom: uri ? str(uri.from) || undefined : undefined,
    uriTo: uri ? str(uri.to) || undefined : undefined,
    uriPrefix: uri ? str(uri.prefix) || undefined : undefined,
    cors: Boolean(d.cors),
    cacheControl: str(d['cache-control'] ?? d.cacheControl) || undefined,
    upstreamTls: Boolean(d.tls),
  }
}

/**
 * 路由卡片上的「行为」标记。
 *
 * 只标**偏离 gatex 默认值**的东西：默认 `uri = Keep`、`preserve-host = true`、
 * 无 CORS / 无缓存头 / 无上游 TLS / 默认日志。全都标出来等于什么都没标。
 */
export function routeFlags(toJson?: string | null, logJson?: string | null): string[] {
  const t = toShape(toJson)
  if (!t.type) return []
  const flags: string[] = []
  switch (t.uriType) {
    case 'StripPrefix':
      flags.push('去前缀')
      break
    case 'AddPrefix':
      flags.push(`加前缀 ${t.uriPrefix ?? ''}`.trim())
      break
    case 'Replace':
    case 'ReplacePrefix':
      flags.push(`路径替换 ${t.uriFrom ?? ''} → ${t.uriTo ?? ''}`)
      break
    case 'Keep':
      break
    default:
      if (t.uriType) flags.push(`改写 ${t.uriType}`)
  }
  if (t.preserveHost === false) flags.push('改写 Host')
  if (t.cors) flags.push('CORS')
  if (t.cacheControl) flags.push('缓存头')
  if (t.upstreamTls) flags.push('上游 TLS')
  if (logJson && logJson.trim() && logJson.trim() !== '{}') flags.push('独立日志')
  return flags
}

/**
 * `uri` 里 gatex 不认识的键。
 *
 * 真实例子：库里写了 `{"type":"StripPrefix","parts":2}`，但 gatex 的
 * `StripPrefix` 是 unit variant，`parts` 会被 serde 静默丢掉——渲染出来的
 * TOML 里只有 `type = "StripPrefix"`。界面必须把这件事说出来，否则用户以为
 * 自己配了两段前缀，线上其实只去了一段。
 */
export function unknownUriKeys(toJson?: string | null): string[] {
  const d = asDict(parseJson(toJson))
  const uri = asDict(d?.uri)
  if (!uri) return []
  const known: Record<string, string[]> = {
    Keep: ['type'],
    StripPrefix: ['type'],
    Replace: ['type', 'from', 'to'],
    AddPrefix: ['type', 'prefix'],
    ReplacePrefix: ['type', 'from', 'to'],
  }
  const allow = known[str(uri.type)]
  return allow ? Object.keys(uri).filter((k) => !allow.includes(k)) : []
}

/** 健康检查配置。`configured=false` 表示库里没写，渲染时由 gatex 补默认值 */
export interface HealthCheckInfo {
  configured: boolean
  kind?: string
  frequency?: string
  timeout?: string
  parallel?: boolean
  consecutiveSuccess?: number | string
  consecutiveFailure?: number | string
  httpPath?: string
  httpHost?: string
  raw: Record<string, unknown>
}

/** 负载均衡器摘要：类型 + 后端 + 算法 + 健康检查 + 更新频率 */
export function describeBalancer(configJson?: string | null): {
  type: string
  backends: string[]
  algorithm?: string
  updateFrequency?: string
  healthCheck: HealthCheckInfo
} {
  const d = asDict(parseJson(configJson)) ?? {}
  const type = str(d.type) || '未知'
  let backends: string[] = []
  if (type === 'Array') {
    backends = asArray(d.backends).map(str)
  } else if (type === 'SystemConfig') {
    backends = [`${str(d.host)}:${str(d.port)}`]
  } else if (type === 'DNS') {
    backends = [`${str(d['query-name'] ?? d.queryName)}:${str(d.port)}`]
  } else if (type === 'Consul' || type === 'Nacos') {
    backends = [str(d['service-name'] ?? d.serviceName) || '（未填服务名）']
  } else if (type === 'Swarm') {
    backends = [`${str(d['service-name'] ?? d.serviceName)}:${str(d.port)}`]
  }
  const hc = asDict(d['health-check'] ?? d.healthCheck) ?? {}
  const num = (v: unknown) => (typeof v === 'number' || typeof v === 'string' ? v : undefined)
  return {
    type,
    backends,
    algorithm: str(d['selection-algorithm'] ?? d.selectionAlgorithm) || undefined,
    updateFrequency: str(d['update-frequency'] ?? d.updateFrequency) || undefined,
    healthCheck: {
      configured: Object.keys(hc).length > 0,
      kind: str(hc.kind) || undefined,
      frequency: str(hc.frequency) || undefined,
      timeout: str(hc.timeout) || undefined,
      parallel: typeof hc.parallel === 'boolean' ? hc.parallel : undefined,
      consecutiveSuccess: num(hc['consecutive-success'] ?? hc.consecutiveSuccess),
      consecutiveFailure: num(hc['consecutive-failure'] ?? hc.consecutiveFailure),
      httpPath: str(hc['http-path'] ?? hc.httpPath) || undefined,
      httpHost: str(hc['http-host'] ?? hc.httpHost) || undefined,
      raw: hc,
    },
  }
}

/** 从路由的 to 里取出被引用的 LB 名（用于统计「谁在用这个 LB」） */
export function referencedBalancer(toJson?: string | null): string | undefined {
  const d = asDict(parseJson(toJson))
  if (!d || str(d.type) !== 'LoadBalancer') return undefined
  const name = str(d.name)
  return name || undefined
}

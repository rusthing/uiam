/**
 * 网关的「全局」配置：不挂在任何一条链路上，但对整个实例生效。
 *
 * 对照线上 KV 里的 TOML，除了 listeners / routes / balancers，还有四段顶层配置：
 * `[static]` / `[upstream-error]` / `[ops]` / `[pingora-conf]`（最后一段来自
 * `extra_toml`）。之前图只画了链路，这四段完全看不见——所以图的底部补一条
 * 「全局」带，每段一个可点的块，点开在右侧属性栏看全量字段。
 *
 * ## 为什么把 pingora-conf 从 extra_toml 里拆出来
 *
 * `extra_toml` 是给用户手写的高级 TOML，里面可能什么都有。但 `[pingora-conf]`
 * 是**结构性配置**：改它会要求重启网关（渲染器会报 `structuralChange`）。
 * 把它单独摆一块，用户改之前就能看见「这是进程级参数」。
 */
import { parseJson } from '../../lib/format'
import type { Gateway } from '../../lib/types'

export type GlobalKey = 'static' | 'upstream' | 'ops' | 'pingora' | 'extra'

export interface GlobalSection {
  key: GlobalKey
  title: string
  tone: 'brand' | 'warn' | 'ok' | 'neutral' | 'mute'
  /** 图上一行摘要 */
  sub: string
  rows: Array<{ k: string; v: string }>
  /** TOML 原文（pingora / extra 才有） */
  raw?: string
  /** 属性栏里的提示 */
  note?: string
  /** 库里写了但 gatex 不认识的键——渲染时会被静默忽略 */
  ignored?: string[]
}

const dict = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}

const s = (v: unknown): string =>
  typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v)

/** 把一段 JSON 摊成「键 → 值」行；数组拼成逗号分隔 */
function jsonRows(text?: string | null, allow?: string[]): { rows: Array<{ k: string; v: string }>; ignored: string[] } {
  const d = dict(parseJson(text))
  const rows = Object.entries(d).map(([k, v]) => ({
    k,
    v: Array.isArray(v) ? v.map(s).join(', ') : typeof v === 'object' ? JSON.stringify(v) : s(v),
  }))
  const ignored = allow ? rows.filter((r) => !allow.includes(r.k)).map((r) => r.k) : []
  return { rows, ignored }
}

/** 极简 TOML 分段：只认 `[name]` / `[[name]]` 与 `key = value` 行，够画这几段就行 */
function tomlSections(text?: string | null): Array<{ name: string; lines: string[] }> {
  const out: Array<{ name: string; lines: string[] }> = []
  let cur = { name: '(顶层)', lines: [] as string[] }
  out.push(cur)
  for (const line of (text ?? '').split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const head = /^\[{1,2}([^\]]+)\]{1,2}\s*$/.exec(t)
    if (head) {
      cur = { name: head[1], lines: [] }
      out.push(cur)
    } else {
      cur.lines.push(t)
    }
  }
  return out.filter((sec) => sec.lines.length > 0)
}

function tomlRows(sec: { lines: string[] }): Array<{ k: string; v: string }> {
  return sec.lines.flatMap((line) => {
    const m = /^([^=]+?)\s*=\s*(.+)$/.exec(line)
    if (!m) return []
    return [{ k: m[1].trim(), v: m[2].trim().replace(/^"(.*)"$/, '$1') }]
  })
}

export function globalSections(gateway: Gateway): GlobalSection[] {
  // ---- [static] ----
  const st = jsonRows(gateway.staticJson, ['root-dir', 'page-404-path'])
  const root = st.rows.find((r) => r.k === 'root-dir')?.v

  // ---- [upstream-error] ----
  // gatex 的 UpstreamErrorConfig 只有 enabled/status/expose-detail 三个字段，
  // 写了 content-type 之类不会报错，但也不会生效——必须在界面上说出来
  const ue = jsonRows(gateway.upstreamErrorJson, ['enabled', 'status', 'expose-detail'])
  const ueStatus = ue.rows.find((r) => r.k === 'status')?.v

  // ---- [ops] ----
  const op = jsonRows(gateway.opsJson, ['health-path', 'metrics-path', 'addrs'])
  const hp = op.rows.find((r) => r.k === 'health-path')?.v

  // ---- extra_toml 里的 [pingora-conf] 与其余段 ----
  const secs = tomlSections(gateway.extraToml)
  const pingora = secs.find((x) => x.name === 'pingora-conf')
  const others = secs.filter((x) => x.name !== 'pingora-conf')
  const threads = pingora ? tomlRows(pingora).find((r) => r.k === 'threads')?.v : undefined

  return [
    {
      key: 'static',
      title: '静态站点',
      tone: 'brand',
      sub: root ? `root-dir ${root}` : '未配置',
      rows: st.rows,
      ignored: st.ignored,
      note: '所有 type = Static 的路由共用这一个根目录；SPA 回退也在这里配。',
    },
    {
      key: 'upstream',
      title: '上游错误',
      tone: 'warn',
      sub: ueStatus ? `改写为 ${ueStatus}` : '默认 503',
      rows: ue.rows,
      ignored: ue.ignored,
      note: '只在「连不上上游」时生效。库里没写的字段由 gatex 补默认：enabled=true / status=503 / expose-detail=true。',
    },
    {
      key: 'ops',
      title: '运维接口',
      tone: 'ok',
      sub: hp ? `${hp} · metrics` : '未配置',
      rows: op.rows,
      ignored: op.ignored,
      note: '运维接口走独立端口（addrs），不占监听器的业务端口；addrs 为空表示不单独监听。',
    },
    {
      key: 'pingora',
      title: '进程参数',
      tone: 'neutral',
      sub: threads ? `${threads} 线程` : '未配置',
      rows: pingora ? tomlRows(pingora) : [],
      raw: pingora ? `[pingora-conf]\n${pingora.lines.join('\n')}` : undefined,
      note: 'ServerConf 只在 Server::bootstrap() 时生效，改这一段会要求重启网关。',
    },
    {
      key: 'extra',
      title: '附加 TOML',
      tone: 'mute',
      sub: others.length > 0 ? `${others.length} 段附加配置` : '无',
      rows: others.flatMap((sec) => tomlRows(sec).map((r) => ({ k: `${sec.name}.${r.k}`, v: r.v }))),
      raw: others.length > 0 ? others.map((x) => `[${x.name}]\n${x.lines.join('\n')}`).join('\n\n') : undefined,
      note: '只补渲染结果里**不存在的顶层键**；已有的 listeners / balancers / ops 等不会被它覆盖，被忽略的键会进发布告警。',
    },
  ]
}

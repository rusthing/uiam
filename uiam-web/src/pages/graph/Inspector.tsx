/**
 * 右侧属性栏：图里点中谁，这里就显示谁。
 *
 * 只做两件事：**看得清**（类型、关键字段、和谁有关系）和**改得动最常见的那个字段**
 * （名称）。地址 / matcher / to / config 这些结构性字段仍然走弹窗——它们是 JSON，
 * 在 260px 宽的栏里编辑只会互相折磨。启停也不在这里：它挂在卡片右上角。
 */
import { useEffect, useState } from 'react'
import {
  describeAddrs,
  describeBalancer,
  describeMatcher,
  describeTo,
  listenerTlsCount,
  prettyJson,
  referencedBalancer,
  relativeTime,
  routeFlags,
  toShape,
  unknownUriKeys,
} from '../../lib/format'
import type { Balancer, Gateway, Listener, Route } from '../../lib/types'
import { IconEdit, IconTrash } from '../../components/icons'
import { Badge, cx } from '../../components/ui'
import type { Selection } from './GatewayGraph'
import { globalSections } from './global'

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="ins-row">
      <span className="ins-k">{label}</span>
      <span className="ins-v">{children}</span>
    </div>
  )
}

/** 名称就地改：回车或失焦提交，Esc 撤销 */
function NameField({
  value,
  onCommit,
  mono,
}: {
  value: string
  onCommit: (next: string) => void
  mono?: boolean
}) {
  const [text, setText] = useState(value)
  useEffect(() => setText(value), [value])
  const commit = () => {
    const next = text.trim()
    if (!next || next === value) {
      setText(value)
      return
    }
    onCommit(next)
  }
  return (
    <input
      className={cx('input !h-8', mono && 'mono')}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') {
          setText(value)
          e.currentTarget.blur()
        }
      }}
    />
  )
}

export function Inspector({
  gateway,
  selection,
  listeners,
  routes,
  balancers,
  onSelect,
  onRename,
  onEdit,
  onDelete,
}: {
  gateway: Gateway
  selection: Selection | null
  listeners: Listener[]
  routes: Route[]
  balancers: Balancer[]
  onSelect: (sel: Selection) => void
  onRename: (sel: Selection, name: string) => void
  onEdit: (sel: Selection) => void
  onDelete: (sel: Selection) => void
}) {
  if (!selection) {
    return (
      <aside className="inspector">
        <div className="ins-empty">
          <p className="ins-empty-t">点一下图里的卡片</p>
          <p className="ins-empty-d">
            监听器、路由、负载均衡器、后端都能点。这里会显示它的字段、和谁有关系，
            以及最快的编辑入口。
          </p>
          <ul className="ins-legend">
            <li>
              <i className="lg lb" /> 负载均衡器：绿
            </li>
            <li>
              <i className="lg host" /> 直连 Host：琥珀
            </li>
            <li>
              <i className="lg static" /> 静态站点：蓝
            </li>
            <li>
              <i className="lg bad" /> 悬空引用：红
            </li>
          </ul>
        </div>
      </aside>
    )
  }

  /* ---- 全局段：[static] / [upstream-error] / [ops] / [pingora-conf] / extra_toml ---- */
  if (selection.kind === 'global') {
    const sec = globalSections(gateway).find((s) => s.key === selection.key)
    return (
      <aside className="inspector">
        <header className="ins-head">
          <div className="ins-kind">全局配置</div>
          <div className="ins-name">{sec?.title ?? selection.key}</div>
          <p className="ins-note">{sec?.note}</p>
        </header>

        <section className="ins-sec">
          <div className="ins-sec-t">字段（{sec?.rows.length ?? 0}）</div>
          {sec?.rows.length ? (
            sec.rows.map((r) => (
              <div key={r.k} className="ins-kv">
                <span>{r.k}</span>
                <b>{r.v || '—'}</b>
              </div>
            ))
          ) : (
            <p className="ins-mute">库里没有配置这一段，渲染时用 gatex 的默认值。</p>
          )}
          {sec?.ignored && sec.ignored.length > 0 && (
            <p className="ins-warn">
              {sec.ignored.join('、')} 不是 gatex 认识的字段，渲染时会被静默忽略。
            </p>
          )}
        </section>

        {sec?.raw && (
          <section className="ins-sec">
            <div className="ins-sec-t">原始 TOML</div>
            <div className="ins-code">{sec.raw}</div>
          </section>
        )}

        <footer className="ins-actions">
          <button className="btn btn-sm" onClick={() => onEdit(selection)}>
            <IconEdit size={12} /> 编辑实例高级配置
          </button>
        </footer>
      </aside>
    )
  }

  if (selection.kind === 'listener') {
    const listener = listeners.find((l) => l.id === selection.id)
    if (!listener) return <aside className="inspector" />
    const addrs = describeAddrs(listener.addrsJson)
    const own = routes.filter((r) => r.listenerId === listener.id)
    const tlsCount = listenerTlsCount(listener.addrsJson)
    return (
      <aside className="inspector">
        <header className="ins-head">
          <div className="ins-kind">
            {listener.kind === 1 ? 'HTTP' : 'TCP'} 监听器
            {listener.enabled ? <Badge tone="ok">启用</Badge> : <Badge tone="mute">停用</Badge>}
          </div>
          <div className="ins-name mono">{addrs.join('  ') || '未配置地址'}</div>
          <p className="ins-note">监听器没有名字，它由绑定地址标识；地址是启动时绑定的，改它等于要重启。</p>
        </header>

        <section className="ins-sec">
          <div className="ins-sec-t">监听地址</div>
          {addrs.length === 0 && <p className="ins-warn">未配置地址，渲染出的 listeners 里没有它</p>}
          {addrs.map((addr, i) => (
            <div key={i} className="ins-code">
              {addr}
            </div>
          ))}
        </section>

        <section className="ins-sec">
          <div className="ins-sec-t">字段</div>
          <Row label="顺序">{listener.sortNo}</Row>
          <Row label="TLS">{tlsCount > 0 ? `${tlsCount} 个地址绑证书` : '未启用'}</Row>
          <Row label="备注">{listener.remark || '—'}</Row>
          <Row label="路由">{own.length} 条</Row>
          <Row label="更新">{relativeTime(listener.updateMs)}</Row>
        </section>

        <section className="ins-sec">
          <div className="ins-sec-t">这个监听器下的路由</div>
          {own.length === 0 && <p className="ins-mute">还没有。点图里出线上的「+」加一条。</p>}
          {own.map((r, i) => (
            <button key={r.id} className="ins-link" onClick={() => onSelect({ kind: 'route', id: r.id })}>
              <span className="ins-link-n">{i + 1}</span>
              <span className="ins-link-t">{r.name}</span>
              <span className="ins-link-s mono">{describeMatcher(r.matcherJson)}</span>
            </button>
          ))}
        </section>

        <details className="ins-raw">
          <summary>原始 JSON（addrs_json）</summary>
          <div className="ins-code">{prettyJson(listener.addrsJson)}</div>
        </details>

        <footer className="ins-actions">
          <button className="btn btn-sm" onClick={() => onEdit(selection)}>
            <IconEdit size={12} /> 编辑
          </button>
          <button className="btn btn-sm btn-ghost ins-del" onClick={() => onDelete(selection)}>
            <IconTrash size={12} /> 删除
          </button>
        </footer>
      </aside>
    )
  }

  if (selection.kind === 'route') {
    const route = routes.find((r) => r.id === selection.id)
    if (!route) return <aside className="inspector" />
    const listener = listeners.find((l) => l.id === route.listenerId)
    const siblings = routes.filter((r) => r.listenerId === route.listenerId)
    const index = siblings.findIndex((r) => r.id === route.id)
    const lbName = referencedBalancer(route.toJson)
    const lb = lbName ? balancers.find((b) => b.name === lbName) : undefined
    const to = toShape(route.toJson)
    const ignoredUri = unknownUriKeys(route.toJson)
    const flags = routeFlags(route.toJson, route.logJson)
    return (
      <aside className="inspector">
        <header className="ins-head">
          <div className="ins-kind">
            路由
            {route.enabled ? <Badge tone="ok">启用</Badge> : <Badge tone="mute">停用</Badge>}
            {lbName && !lb && <Badge tone="danger">LB 不存在</Badge>}
          </div>
          <NameField value={route.name} onCommit={(next) => onRename(selection, next)} />
          <p className="ins-note">顺序 {index + 1} / {siblings.length}：前面的先匹配，命中即停。</p>
        </header>

        <section className="ins-sec">
          <div className="ins-sec-t">匹配条件</div>
          <div className="ins-code">{describeMatcher(route.matcherJson)}</div>
          <div className="ins-sec-t" style={{ marginTop: 10 }}>
            转发目标
          </div>
          <div className="ins-code">{describeTo(route.toJson)}</div>
          {lbName && !lb && (
            <p className="ins-warn">库里没有名为 {lbName} 的负载均衡器，发布会因此被拒。</p>
          )}
        </section>

        <section className="ins-sec">
          <div className="ins-sec-t">转发行为</div>
          <Row label="URI 改写">{to.uriType || 'Keep（不改）'}</Row>
          <Row label="Host">
            {to.preserveHost === false ? '改写为目标 Host' : '透传原 Host（默认）'}
          </Row>
          <Row label="CORS">{to.cors ? '已配置' : '未启用'}</Row>
          <Row label="缓存头">{to.cacheControl || '—'}</Row>
          <Row label="上游 TLS">{to.upstreamTls ? '已配置' : '未启用'}</Row>
          <Row label="日志">{route.logJson?.trim() && route.logJson.trim() !== '{}' ? '单独配置' : '默认'}</Row>
          {flags.length > 0 && (
            <div className="ins-tags">
              {flags.map((f) => (
                <span key={f} className="gnode-tag">
                  {f}
                </span>
              ))}
            </div>
          )}
          {ignoredUri.length > 0 && (
            <p className="ins-warn">
              uri 里的 {ignoredUri.join('、')} 不是 gatex 认识的字段，渲染时会被静默丢掉——
              线上生效的是「{to.uriType || 'Keep'}」，不是库里写的那个样子。
            </p>
          )}
        </section>

        <section className="ins-sec">
          <div className="ins-sec-t">字段</div>
          <Row label="所属监听器">
            {listener ? (
              <button
                className="ins-inline"
                onClick={() => onSelect({ kind: 'listener', id: listener.id })}
              >
                {listener.kind === 1 ? 'HTTP' : 'TCP'} · {describeAddrs(listener.addrsJson).join(' ') || '未配置'}
              </button>
            ) : (
              '—'
            )}
          </Row>
          <Row label="sort_no">{route.sortNo}</Row>
          <Row label="日志">{route.logJson ? '单独配置' : '默认'}</Row>
          <Row label="更新">{relativeTime(route.updateMs)}</Row>
        </section>

        <details className="ins-raw">
          <summary>原始 JSON（matcher / to / log）</summary>
          <div className="ins-code">matcher = {prettyJson(route.matcherJson)}</div>
          <div className="ins-code">to = {prettyJson(route.toJson)}</div>
          <div className="ins-code">log = {prettyJson(route.logJson) || '（未配置）'}</div>
        </details>

        <footer className="ins-actions">
          <button className="btn btn-sm" onClick={() => onEdit(selection)}>
            <IconEdit size={12} /> 编辑
          </button>
          <button className="btn btn-sm btn-ghost ins-del" onClick={() => onDelete(selection)}>
            <IconTrash size={12} /> 删除
          </button>
        </footer>
      </aside>
    )
  }

  if (selection.kind === 'balancer') {
    const balancer = balancers.find((b) => b.id === selection.id)
    if (!balancer) return <aside className="inspector" />
    const info = describeBalancer(balancer.configJson)
    const usedBy = routes.filter((r) => referencedBalancer(r.toJson) === balancer.name)
    const hc = info.healthCheck
    return (
      <aside className="inspector">
        <header className="ins-head">
          <div className="ins-kind">
            负载均衡器
            {balancer.enabled ? <Badge tone="ok">启用</Badge> : <Badge tone="mute">停用</Badge>}
          </div>
          <NameField value={balancer.name} mono onCommit={(next) => onRename(selection, next)} />
          <p className="ins-note">名字是被路由引用的键，改名后原来引用它的路由会变成悬空。</p>
        </header>

        <section className="ins-sec">
          <div className="ins-sec-t">配置</div>
          <Row label="类型">{info.type}</Row>
          <Row label="算法">{info.algorithm || 'RoundRobin（默认）'}</Row>
          <Row label="更新频率">{info.updateFrequency || '15s（默认）'}</Row>
          <Row label="备注">{balancer.remark || '—'}</Row>
        </section>

        <section className="ins-sec">
          <div className="ins-sec-t">健康检查{hc.configured ? '' : ' · 渲染默认'}</div>
          {hc.configured ? (
            <>
              <Row label="类型">{hc.kind || '—'}</Row>
              <Row label="频率">{hc.frequency || '—'}</Row>
              <Row label="超时">{hc.timeout || '—'}</Row>
              <Row label="成功/失败">
                {hc.consecutiveSuccess ?? '—'} / {hc.consecutiveFailure ?? '—'}
              </Row>
              <Row label="HTTP 路径">{hc.httpPath || '—'}</Row>
              <Row label="HTTP Host">{hc.httpHost || '—'}</Row>
              <Row label="并行">{hc.parallel === undefined ? '—' : hc.parallel ? '是' : '否'}</Row>
            </>
          ) : (
            <p className="ins-mute">
              库里没写 health-check；渲染时 gatex 会补默认检查（tcp / 每 5s / 超时 2s /
              连续 3 次成功或失败切换状态）。完整值见「渲染预览」。
            </p>
          )}
        </section>

        <section className="ins-sec">
          <div className="ins-sec-t">后端（{info.backends.length}）</div>
          {info.backends.length === 0 && <p className="ins-mute">没有可列出的后端地址</p>}
          {info.backends.map((addr, i) => (
            <div key={addr + i} className="ins-code">
              {addr}
            </div>
          ))}
        </section>

        <section className="ins-sec">
          <div className="ins-sec-t">被这些路由引用（{usedBy.length}）</div>
          {usedBy.length === 0 && (
            <p className="ins-warn">没有任何路由引用它，渲染时只会给告警。</p>
          )}
          {usedBy.map((r) => (
            <button key={r.id} className="ins-link" onClick={() => onSelect({ kind: 'route', id: r.id })}>
              <span className="ins-link-t">{r.name}</span>
              <span className="ins-link-s mono">{describeMatcher(r.matcherJson)}</span>
            </button>
          ))}
        </section>

        <details className="ins-raw">
          <summary>原始 JSON（config_json）</summary>
          <div className="ins-code">{prettyJson(balancer.configJson)}</div>
        </details>

        <footer className="ins-actions">
          <button className="btn btn-sm" onClick={() => onEdit(selection)}>
            <IconEdit size={12} /> 编辑
          </button>
          <button className="btn btn-sm btn-ghost ins-del" onClick={() => onDelete(selection)}>
            <IconTrash size={12} /> 删除
          </button>
        </footer>
      </aside>
    )
  }

  // backend
  const balancer = balancers.find((b) => b.id === selection.balancerId)
  const info = balancer ? describeBalancer(balancer.configJson) : undefined
  const addr = info?.backends[selection.index] ?? '—'
  return (
    <aside className="inspector">
      <header className="ins-head">
        <div className="ins-kind">后端</div>
        <div className="ins-name mono">{addr}</div>
        <p className="ins-note">后端是 LB 的 config_json 里的一个数组元素，没有独立启停。</p>
      </header>

      <section className="ins-sec">
        <div className="ins-sec-t">字段</div>
        <Row label="序号">{selection.index + 1}</Row>
        <Row label="类型">{info?.type || '—'}</Row>
        <Row label="算法">{info?.algorithm || '—'}</Row>
        <Row label="所属 LB">
          {balancer ? (
            <button
              className="ins-inline"
              onClick={() => onSelect({ kind: 'balancer', id: balancer.id })}
            >
              {balancer.name}
            </button>
          ) : (
            '—'
          )}
        </Row>
      </section>

      {balancer && (
        <section className="ins-sec">
          <div className="ins-sec-t">同组后端（{info?.backends.length ?? 0}）</div>
          {info?.backends.map((b, i) => (
            <div key={b + i} className={cx('ins-code', i === selection.index && 'on')}>
              {b}
            </div>
          ))}
        </section>
      )}

      <footer className="ins-actions">
        <button
          className="btn btn-sm"
          disabled={!balancer}
          onClick={() => balancer && onEdit({ kind: 'balancer', id: balancer.id })}
        >
          <IconEdit size={12} /> 编辑所属 LB
        </button>
      </footer>
    </aside>
  )
}

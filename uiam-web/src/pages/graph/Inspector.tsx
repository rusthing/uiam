/**
 * 右侧属性栏：图里点中谁，这里就显示谁。
 *
 * 只做两件事：**看得清**（类型、关键字段、和谁有关系）和**改得动最常见的那个字段**
 * （名称）。地址 / matcher / to / config 这些结构性字段仍然走弹窗——它们是 JSON，
 * 在 260px 宽的栏里编辑只会互相折磨。启停也不在这里：它挂在卡片右上角。
 */
import { useEffect, useState } from 'react'
import { describeAddrs, describeBalancer, describeMatcher, describeTo, referencedBalancer, relativeTime } from '../../lib/format'
import type { Balancer, Listener, Route } from '../../lib/types'
import { IconEdit, IconTrash } from '../../components/icons'
import { Badge, cx } from '../../components/ui'
import type { Selection } from './GatewayGraph'

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
  selection,
  listeners,
  routes,
  balancers,
  onSelect,
  onRename,
  onEdit,
  onDelete,
}: {
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

  if (selection.kind === 'listener') {
    const listener = listeners.find((l) => l.id === selection.id)
    if (!listener) return <aside className="inspector" />
    const addrs = describeAddrs(listener.addrsJson)
    const own = routes.filter((r) => r.listenerId === listener.id)
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
          <Row label="算法">{info.algorithm || '—'}</Row>
          <Row label="备注">{balancer.remark || '—'}</Row>
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

/**
 * 路由拓扑（方案 A · 泳道管道图）：入口 → 有序路由链 → 目标/后端。
 *
 * ## 为什么值得画出来
 *
 * gatex 的路由是 first-match-wins：同一监听器下 `sort_no` 小的先匹配，第一条命中就
 * 不再往下走。表格把这个语义藏在一列数字里——「3 比 1 大所以排在后面」得靠脑子翻译；
 * 图里它直接变成**纵向位置**，上下挪一格就是改一条线上流量的去向。这是表格做不到的
 * 那部分信息，也是选这个方案而不是「好看的卡片墙」的唯一理由。
 *
 * ## 拖动改序怎么落库
 *
 * `uiam_gateway_route` 上只有 `idx_uiam_gateway_route_listener ON (listener_id, sort_no)`
 * 这个普通索引，**sort_no 没有唯一约束**，所以中途出现重复值不会撞约束——可以按
 * 新顺序逐条 PUT 重排成 1..n。写入是顺序的（不是 Promise.all）：中途失败时日志能
 * 说清是第几条挂的，而且已写进去的行仍是「连续前缀」，不会留下跳跃的空洞。
 *
 * ## 为什么不把 matcher / to 拆成可视化条件构造器
 *
 * 见 RouteForm 的说明：那等于把 gatex 的 schema 复制一份到前端。
 */
import { useEffect, useMemo, useState } from 'react'
import { api, ApiError } from '../../lib/api'
import {
  describeAddrs,
  describeBalancer,
  describeMatcher,
  shadowedBy,
  toShape,
} from '../../lib/format'
import type { Balancer, Listener, Route, RoutePayload } from '../../lib/types'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { ListenerForm } from '../../components/ListenerForm'
import { RouteForm } from '../../components/RouteForm'
import { useToast } from '../../components/Toast'
import { Badge, Empty, Spinner, cx } from '../../components/ui'
import { IconAlert, IconEdit, IconPlus, IconTrash } from '../../components/icons'
import { RoutesTab } from './RoutesTab'

const bySort = (a: Route, b: Route) => a.sortNo - b.sortNo || a.id.localeCompare(b.id)

/** 改序时只换 sortNo，其余字段原样回写——PUT 是全量更新，漏字段等于清空 */
function payloadOf(route: Route, sortNo: number): RoutePayload {
  return {
    id: route.id,
    listenerId: route.listenerId,
    sortNo,
    name: route.name,
    matcherJson: route.matcherJson,
    toJson: route.toJson,
    logJson: route.logJson ?? null,
    enabled: route.enabled,
  }
}

/* ---------------------------------------------------------------- 目标节点 */

function TargetNode({ route, balancers }: { route: Route; balancers: Map<string, Balancer> }) {
  const target = toShape(route.toJson)

  if (target.type === 'LoadBalancer') {
    const lb = target.name ? balancers.get(target.name) : undefined
    if (!lb) {
      return (
        <div className="tnode bad">
          <div className="tnode-k">
            <span className="tnode-kind bad">LB</span>
            <span className="tnode-t mono">{target.name || '（未填名称）'}</span>
          </div>
          <div className="tnode-s">库里没有这个名字的负载均衡器，发布会失败</div>
        </div>
      )
    }
    const info = describeBalancer(lb.configJson)
    return (
      <div className={cx('tnode', !lb.enabled && 'off')}>
        <div className="tnode-k">
          <span className="tnode-kind">LB</span>
          <span className="tnode-t">{lb.name}</span>
          {!lb.enabled && <Badge tone="mute">停用</Badge>}
        </div>
        <div className="tnode-s">
          {info.type} · {info.backends.length} 个后端
          {info.algorithm ? ` · ${info.algorithm}` : ''}
        </div>
        {info.backends.length > 0 && (
          <div className="tnode-b">
            {info.backends.slice(0, 3).map((backend, i) => (
              <span key={`${backend}-${i}`} className="bk mono">
                {backend}
              </span>
            ))}
            {info.backends.length > 3 && (
              <span className="bk more">+{info.backends.length - 3}</span>
            )}
          </div>
        )}
      </div>
    )
  }

  if (target.type === 'Host') {
    return (
      <div className="tnode">
        <div className="tnode-k">
          <span className="tnode-kind">HOST</span>
          <span className="tnode-t mono">{target.addr || '（未填地址）'}</span>
        </div>
        <div className="tnode-s">
          直连，不经负载均衡{target.preserveHost ? ' · 透传原 Host' : ' · 改写 Host'}
        </div>
      </div>
    )
  }

  if (target.type === 'Static') {
    return (
      <div className="tnode">
        <div className="tnode-k">
          <span className="tnode-kind">STATIC</span>
          <span className="tnode-t">本地静态文件</span>
        </div>
        <div className="tnode-s">{target.spa ? 'SPA 模式：未命中的路径回落 index.html' : '按路径找文件'}</div>
      </div>
    )
  }

  return (
    <div className="tnode bad">
      <div className="tnode-k">
        <span className="tnode-kind bad">?</span>
        <span className="tnode-t">{target.type || '未配置目标'}</span>
      </div>
      <div className="tnode-s">to_json 解析不出 type，渲染时会报错</div>
    </div>
  )
}

/* ---------------------------------------------------------------- 泳道 */

interface DragState {
  id: string
  listenerId: string
}

function Lane({
  listener,
  rows,
  balancers,
  drag,
  drop,
  busy,
  onEditListener,
  onAddRoute,
  onEditRoute,
  onDeleteRoute,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
}: {
  listener: Listener
  rows: Route[]
  balancers: Map<string, Balancer>
  drag: DragState | null
  drop: { id: string; after: boolean } | null
  busy: boolean
  onEditListener: () => void
  onAddRoute: () => void
  onEditRoute: (route: Route) => void
  onDeleteRoute: (route: Route) => void
  onDragStart: (route: Route) => void
  onDragEnd: () => void
  onDragOver: (route: Route, after: boolean) => void
  onDrop: (route: Route, after: boolean) => void
}) {
  const addrs = describeAddrs(listener.addrsJson)

  return (
    <section className="lane">
      <header className="lane-head">
        <span className={cx('lane-kind', listener.kind === 1 ? 'http' : 'tcp')}>
          {listener.kind === 1 ? 'HTTP' : 'TCP'}
        </span>
        <span className="lane-addr mono">{addrs.join('  ·  ') || '未配置地址'}</span>
        {!listener.enabled && <Badge tone="mute">监听器停用</Badge>}
        {listener.remark && <span className="lane-remark">{listener.remark}</span>}
        <span className="lane-count">{rows.length} 条路由</span>
        <span className="lane-tools">
          <button className="btn btn-ghost btn-sm" onClick={onAddRoute} title="在该监听器下新建路由">
            <IconPlus size={12} /> 路由
          </button>
          <button className="btn btn-ghost btn-sm" onClick={onEditListener} title="编辑监听器">
            <IconEdit size={12} />
          </button>
        </span>
      </header>

      <div className="lane-flow">
        {rows.length === 0 && (
          <p className="lane-empty">还没有路由：该监听器收到的请求会全部落到 404。</p>
        )}

        {rows.map((route, i) => {
          const prev = i > 0 ? rows[i - 1] : undefined
          const shadowed = prev ? shadowedBy(prev.matcherJson, route.matcherJson) && prev.enabled && route.enabled : false
          const target = toShape(route.toJson)
          const broken =
            target.type === '' ||
            (target.type === 'LoadBalancer' && !(target.name && balancers.has(target.name)))
          const isDragging = drag?.id === route.id
          const dropHere =
            drop && drop.id === route.id && drag?.id !== route.id ? drop : null

          return (
            <div
              key={route.id}
              className={cx(
                'flow-row',
                !route.enabled && 'off',
                isDragging && 'dragging',
                dropHere && (dropHere.after ? 'drop-after' : 'drop-before'),
              )}
              draggable={!busy}
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = 'move'
                // Firefox 不设 data 就不给拖
                e.dataTransfer.setData('text/plain', route.id)
                onDragStart(route)
              }}
              onDragEnd={onDragEnd}
              onDragOver={(e) => {
                if (!drag || drag.listenerId !== route.listenerId) return
                e.preventDefault()
                const rect = e.currentTarget.getBoundingClientRect()
                onDragOver(route, e.clientY - rect.top > rect.height / 2)
              }}
              onDrop={(e) => {
                if (!drag || drag.listenerId !== route.listenerId) return
                e.preventDefault()
                const rect = e.currentTarget.getBoundingClientRect()
                onDrop(route, e.clientY - rect.top > rect.height / 2)
              }}
            >
              <span className="flow-n" title={`第 ${i + 1} 位匹配（sort_no 已重排为 ${i + 1}）`}>
                {i + 1}
              </span>

              <div className="rnode" onClick={() => onEditRoute(route)}>
                <div className="rnode-h">
                  <span className="rnode-t">{route.name}</span>
                  {!route.enabled && <Badge tone="mute">停用</Badge>}
                  <span className="rnode-tools">
                    <button
                      className="btn btn-ghost btn-sm"
                      title="编辑"
                      onClick={(e) => {
                        e.stopPropagation()
                        onEditRoute(route)
                      }}
                    >
                      <IconEdit size={12} />
                    </button>
                    <button
                      className="btn btn-ghost btn-sm danger"
                      title="删除"
                      onClick={(e) => {
                        e.stopPropagation()
                        onDeleteRoute(route)
                      }}
                    >
                      <IconTrash size={12} />
                    </button>
                  </span>
                </div>
                <div className="rnode-b">
                  <span className="rnode-k">匹配</span>
                  <span className="rnode-v mono">{describeMatcher(route.matcherJson)}</span>
                  {(route.logJson || route.sortNo !== i + 1) && (
                    <span className="rnode-meta">
                      {route.logJson && <span title="这条路由单独配了 log_json">记日志</span>}
                      {route.sortNo !== i + 1 && (
                        <span title="库里的 sort_no 与当前位置不一致，拖动一次会重排成 1…n">
                          sort_no={route.sortNo}
                        </span>
                      )}
                    </span>
                  )}
                </div>
                {shadowed && (
                  <div className="rnode-warn">
                    上一条 <b>{describeMatcher(prev?.matcherJson)}</b> 已经覆盖这个路径，这条永远命中不到
                  </div>
                )}
              </div>

              <svg
                className={cx('wire', broken && 'bad')}
                viewBox="0 0 28 8"
                width="28"
                height="8"
                aria-hidden="true"
              >
                <line x1="1" y1="4" x2="19" y2="4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                <path d="M19 1.2 26 4 19 6.8Z" fill="currentColor" />
              </svg>

              <TargetNode route={route} balancers={balancers} />
            </div>
          )
        })}
      </div>
    </section>
  )
}

/* ---------------------------------------------------------------- 主体 */

export function TopologyTab({
  gatewayId,
  listeners,
  routes,
  balancers,
  loading,
  onChanged,
}: {
  gatewayId: string
  listeners: Listener[]
  routes: Route[]
  balancers: Balancer[]
  loading: boolean
  onChanged: () => void
}) {
  const toast = useToast()
  const [view, setView] = useState<'graph' | 'table'>('graph')

  // 拖动中的乐观顺序：等服务端数据回来再交还控制权，否则卡片会先弹回原位再跳过去
  const [pending, setPending] = useState<{ listenerId: string; ids: string[] } | null>(null)
  const [drag, setDrag] = useState<DragState | null>(null)
  const [drop, setDrop] = useState<{ id: string; after: boolean } | null>(null)
  const [busy, setBusy] = useState(false)

  const [routeFormOpen, setRouteFormOpen] = useState(false)
  const [editingRoute, setEditingRoute] = useState<Route | null>(null)
  const [presetListenerId, setPresetListenerId] = useState<string | undefined>(undefined)
  const [removingRoute, setRemovingRoute] = useState<Route | null>(null)

  const [listenerFormOpen, setListenerFormOpen] = useState(false)
  const [editingListener, setEditingListener] = useState<Listener | null>(null)

  const lbByName = useMemo(
    () => new Map(balancers.map((b) => [b.name, b])),
    [balancers],
  )

  const lanes = useMemo(
    () =>
      listeners.map((listener) => {
        const rows = routes.filter((r) => r.listenerId === listener.id).sort(bySort)
        if (pending?.listenerId !== listener.id) return { listener, rows }
        const order = new Map(pending.ids.map((id, i) => [id, i]))
        return {
          listener,
          rows: [...rows].sort(
            (a, b) => (order.get(a.id) ?? 99) - (order.get(b.id) ?? 99),
          ),
        }
      }),
    [listeners, routes, pending],
  )

  // 服务端数据追上乐观顺序了就撤掉覆盖，避免两次渲染打架
  useEffect(() => {
    if (!pending) return
    const rows = routes.filter((r) => r.listenerId === pending.listenerId).sort(bySort)
    if (rows.map((r) => r.id).join(',') === pending.ids.join(',')) setPending(null)
  }, [routes, pending])

  const stats = useMemo(() => {
    let missing = 0
    let shadowed = 0
    let disabled = 0
    for (const { rows } of lanes) {
      rows.forEach((route, i) => {
        if (!route.enabled) disabled += 1
        const target = toShape(route.toJson)
        if (target.type === 'LoadBalancer' && !(target.name && lbByName.has(target.name))) missing += 1
        const prev = i > 0 ? rows[i - 1] : undefined
        if (prev && prev.enabled && route.enabled && shadowedBy(prev.matcherJson, route.matcherJson)) {
          shadowed += 1
        }
      })
    }
    return { missing, shadowed, disabled }
  }, [lanes, lbByName])

  const reorder = async (listenerId: string, fromId: string, toId: string, after: boolean) => {
    const lane = lanes.find((l) => l.listener.id === listenerId)?.rows ?? []
    const from = lane.findIndex((r) => r.id === fromId)
    const rest = lane.filter((r) => r.id !== fromId)
    const at = rest.findIndex((r) => r.id === toId)
    if (from < 0 || at < 0) return
    const cut = after ? at + 1 : at
    const next = [...rest.slice(0, cut), lane[from], ...rest.slice(cut)]
    if (next.every((r, i) => r.id === lane[i].id)) return

    setPending({ listenerId, ids: next.map((r) => r.id) })
    setBusy(true)
    try {
      for (let i = 0; i < next.length; i += 1) {
        if (next[i].sortNo === i + 1) continue
        await api.route.update(payloadOf(next[i], i + 1))
      }
      toast.success(`顺序已更新：${next.findIndex((r) => r.id === fromId) + 1} / ${next.length}`)
      onChanged()
    } catch (e) {
      setPending(null)
      toast.error((e as ApiError).message)
      // 部分写入已经生效，必须把真实状态拉回来
      onChanged()
    } finally {
      setBusy(false)
      setDrag(null)
      setDrop(null)
    }
  }

  const removeRoute = async () => {
    if (!removingRoute) return
    try {
      await api.route.remove(removingRoute.id)
      toast.success('路由已删除')
      setRemovingRoute(null)
      onChanged()
    } catch (e) {
      toast.error((e as ApiError).message)
    }
  }

  if (loading && listeners.length === 0) {
    return (
      <div className="flex items-center gap-2 px-1 py-10 text-[13px] text-ink-mute">
        <Spinner size={14} /> 加载中…
      </div>
    )
  }

  const bar = (
    <div className="topo-bar">
      <div className="topo-stats">
        <span>
          <b>{listeners.length}</b> 监听器
        </span>
        <span className="sep">·</span>
        <span>
          <b>{routes.length}</b> 条路由
        </span>
        <span className="sep">·</span>
        <span>
          <b>{balancers.length}</b> 个负载均衡器
        </span>
        {stats.missing > 0 && (
          <span className="warn">
            <IconAlert size={12} /> {stats.missing} 条指向不存在的 LB
          </span>
        )}
        {stats.shadowed > 0 && (
          <span className="warn">
            <IconAlert size={12} /> {stats.shadowed} 条被上一条前缀覆盖
          </span>
        )}
        {stats.disabled > 0 && <span className="mute">{stats.disabled} 条停用</span>}
      </div>
      <div className="seg topo-view">
        <button className={cx('seg-item', view === 'graph' && 'on')} onClick={() => setView('graph')}>
          图形
        </button>
        <button className={cx('seg-item', view === 'table' && 'on')} onClick={() => setView('table')}>
          表格
        </button>
      </div>
    </div>
  )

  if (view === 'table') {
    return (
      <div className="topo">
        {bar}
        <RoutesTab
          listeners={listeners}
          routes={routes}
          loading={loading}
          onChanged={onChanged}
        />
      </div>
    )
  }

  if (listeners.length === 0) {
    return (
      <div className="topo">
        {bar}
        <Empty
          title="先建监听器，才有可画的链路"
          description="链路的第一段是监听器：它决定网关在哪个地址上收请求，路由则决定收到之后往哪儿送。"
          action={
            <button
              className="btn btn-primary btn-sm"
              onClick={() => {
                setEditingListener(null)
                setListenerFormOpen(true)
              }}
            >
              <IconPlus size={13} /> 新建监听器
            </button>
          }
        />
      </div>
    )
  }

  return (
    <div className="topo">
      {bar}
      <p className="topo-hint">
        从左到右是一条请求的去向；同一泳道内<b>从上到下依次匹配，第一条命中即生效</b>。
        拖动卡片上下挪动就能改顺序{busy && <span className="busy"> · 保存中…</span>}
      </p>

      <div className="topo-lanes">
        {lanes.map(({ listener, rows }) => (
          <Lane
            key={listener.id}
            listener={listener}
            rows={rows}
            balancers={lbByName}
            drag={drag}
            drop={drop}
            busy={busy}
            onEditListener={() => {
              setEditingListener(listener)
              setListenerFormOpen(true)
            }}
            onAddRoute={() => {
              setEditingRoute(null)
              setPresetListenerId(listener.id)
              setRouteFormOpen(true)
            }}
            onEditRoute={(route) => {
              setEditingRoute(route)
              setPresetListenerId(undefined)
              setRouteFormOpen(true)
            }}
            onDeleteRoute={setRemovingRoute}
            onDragStart={(route) => setDrag({ id: route.id, listenerId: route.listenerId })}
            onDragEnd={() => {
              setDrag(null)
              setDrop(null)
            }}
            onDragOver={(route, after) => setDrop({ id: route.id, after })}
            onDrop={(route, after) => {
              if (drag) void reorder(route.listenerId, drag.id, route.id, after)
            }}
          />
        ))}
      </div>

      <p className="topo-legend">
        改序会把整条泳道重排成 1…n 并逐条保存；发一次发布才会真正影响线上。
      </p>

      <RouteForm
        open={routeFormOpen}
        listeners={listeners}
        routes={routes}
        route={editingRoute}
        presetListenerId={presetListenerId}
        onClose={() => setRouteFormOpen(false)}
        onSaved={onChanged}
      />

      <ListenerForm
        open={listenerFormOpen}
        gatewayId={gatewayId}
        listener={editingListener}
        nextSort={listeners.length + 1}
        onClose={() => setListenerFormOpen(false)}
        onSaved={onChanged}
      />

      <ConfirmDialog
        open={Boolean(removingRoute)}
        title="删除路由"
        danger
        confirmText="删除"
        description={
          <>
            将删除路由 <b>{removingRoute?.name}</b>。删除后需要重新发布才会影响线上。
          </>
        }
        onCancel={() => setRemovingRoute(null)}
        onConfirm={removeRoute}
      />
    </div>
  )
}

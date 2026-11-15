/**
 * 路由拓扑（方案 A · 泳道管道图）：入口 → 有序路由链 → 目标/后端。
 *
 * ## 这张图长什么样（定稿 `prototype` 之外的方案 A 图）
 *
 * ```
 *   入口              路由 · 按顺序匹配，命中即停              目标
 *  ┌──────┐          ┌────────────────────────┐          ┌──────────────┐
 *  │ http │          │ ① adm 后台接口          │  ──────▶ │ LB · adm-lb  │
 *  │ :80  │──┬──────▶│    前缀 /adm            │          │ 2 后端 · 轮询 │
 *  └──────┘  │       └────────────────────────┘          └──────────────┘
 *            │       ┌────────────────────────┐          ┌──────────────┐
 *            └──────▶│ ② dtw 接口              │  ──────▶ │ Host · …     │
 *                    └────────────────────────┘          └──────────────┘
 * ```
 *
 * 入口是**一个节点盒子**（垂直居中于该组路由），从它右侧出线接一条**竖总线**，
 * 再由总线横向分叉进每条路由——不是「每行左边一个序号徽标」那种列表。序号圆圈
 * 在路由卡片**内部**，因为它是卡片身份的一部分，不是外部装饰。
 *
 * ## 为什么值得画出来
 *
 * gatex 的路由是 first-match-wins：同一监听器下 `sort_no` 小的先匹配，第一条命中就
 * 不再往下走。表格把这个语义藏在一列数字里——「3 比 1 大所以排在后面」得靠脑子翻译；
 * 图里它直接变成**纵向位置**，上下挪一格就是改一条线上流量的去向。
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
import { Fragment, useEffect, useMemo, useState } from 'react'
import { api, ApiError } from '../../lib/api'
import { describeAddrs, describeBalancer, describeMatcher, shadowedBy, toShape } from '../../lib/format'
import type { Balancer, Listener, Route, RoutePayload } from '../../lib/types'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { ListenerForm } from '../../components/ListenerForm'
import { RouteForm } from '../../components/RouteForm'
import { useToast } from '../../components/Toast'
import { Empty, Spinner, cx } from '../../components/ui'
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

/** 目标类型决定卡片配色与箭头颜色，所以先判一次，渲染两处共用 */
type TargetKind = 'lb' | 'host' | 'static' | 'bad'

function targetKind(route: Route, balancers: Map<string, Balancer>): TargetKind {
  const t = toShape(route.toJson)
  if (t.type === 'LoadBalancer') return t.name && balancers.has(t.name) ? 'lb' : 'bad'
  if (t.type === 'Host') return 'host'
  if (t.type === 'Static') return 'static'
  return 'bad'
}

/* ---------------------------------------------------------------- 目标节点 */

function TargetNode({ route, balancers }: { route: Route; balancers: Map<string, Balancer> }) {
  const target = toShape(route.toJson)

  if (target.type === 'LoadBalancer') {
    const lb = target.name ? balancers.get(target.name) : undefined
    if (!lb) {
      return (
        <div className="tnode bad">
          <div className="tnode-t">LB · {target.name || '（未填名称）'}</div>
          <div className="tnode-s">库里没有这个 LB，发布会失败</div>
        </div>
      )
    }
    const info = describeBalancer(lb.configJson)
    return (
      <div className={cx('tnode lb', !lb.enabled && 'off')} title={info.backends.join('\n') || undefined}>
        <div className="tnode-t">LB · {lb.name}</div>
        <div className="tnode-s">
          {info.backends.length} 后端{info.algorithm ? ` · ${info.algorithm}` : ''}
          {!lb.enabled && ' · 已停用'}
        </div>
      </div>
    )
  }

  if (target.type === 'Host') {
    return (
      <div className="tnode host" title={target.preserveHost ? '透传原 Host' : '改写 Host'}>
        <div className="tnode-t">Host · {target.addr || '（未填地址）'}</div>
        <div className="tnode-s">直连，不经过 LB</div>
      </div>
    )
  }

  if (target.type === 'Static') {
    return (
      <div className="tnode static">
        <div className="tnode-t">Static · 本地文件</div>
        <div className="tnode-s">{target.spa ? 'SPA 回退 index.html' : '按路径找文件'}</div>
      </div>
    )
  }

  return (
    <div className="tnode bad">
      <div className="tnode-t">{target.type || '未配置目标'}</div>
      <div className="tnode-s">to_json 解析不出 type</div>
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
  const span = Math.max(rows.length, 1)

  return (
    <div className="lane" style={{ gridTemplateRows: `repeat(${span}, auto)` }}>
      {/* 入口：一个节点，垂直居中于它这一组路由 */}
      <div className="lane-entry" style={{ gridRow: `1 / span ${span}` }}>
        <div className="le-top">
          <span className={cx('lane-kind', listener.kind === 1 ? 'http' : 'tcp')}>
            {listener.kind === 1 ? 'http' : 'tcp'}
          </span>
          {!listener.enabled && <span className="le-off">停用</span>}
          <span className="le-tools">
            <button className="btn btn-ghost btn-sm" onClick={onAddRoute} title="在该监听器下新建路由">
              <IconPlus size={11} />
            </button>
            <button className="btn btn-ghost btn-sm" onClick={onEditListener} title="编辑监听器">
              <IconEdit size={11} />
            </button>
          </span>
        </div>
        <div className="le-addrs mono">{addrs.join('\n') || '未配置地址'}</div>
        {listener.remark && <div className="le-remark">{listener.remark}</div>}
      </div>

      {rows.length === 0 && (
        <p className="lane-empty">还没有路由：该监听器收到的请求会全部落到 404。</p>
      )}

      {rows.map((route, i) => {
        const prev = i > 0 ? rows[i - 1] : undefined
        const shadowed = Boolean(
          prev && prev.enabled && route.enabled && shadowedBy(prev.matcherJson, route.matcherJson),
        )
        const kind = targetKind(route, balancers)
        const isDragging = drag?.id === route.id
        const dropHere = drop && drop.id === route.id && drag?.id !== route.id ? drop : null

        return (
          <Fragment key={route.id}>
            {/* 总线上的一个节点：竖线（吃掉行距保持连续）+ 分叉进路由的箭头。
                这里的线是中性灰——只有「路由 → 目标」那段才按目标类型上色，
                否则一条路由的入口分支会跟着它的目标变绿，读起来像是两种语义。 */}
            <span
              className={cx('lane-stub', i === 0 && 'first', i === rows.length - 1 && 'last')}
              aria-hidden="true"
            >
              <svg viewBox="0 0 22 8" width="22" height="8" className="wire">
                <line x1="11" y1="4" x2="15" y2="4" stroke="currentColor" strokeWidth="1.1" />
                <path d="M15 1.2 21 4 15 6.8Z" fill="currentColor" />
              </svg>
            </span>

            <div
              className={cx(
                'rnode',
                i === 0 && 'first',
                !route.enabled && 'off',
                isDragging && 'dragging',
                dropHere && (dropHere.after ? 'drop-after' : 'drop-before'),
              )}
              draggable={!busy}
              onClick={() => onEditRoute(route)}
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
              <span className="rnode-n" title={`第 ${i + 1} 位匹配`}>
                {i + 1}
              </span>
              <div className="rnode-main">
                <div className="rnode-t">
                  <span className="rnode-name">{route.name}</span>
                  {!route.enabled && <span className="rnode-off">停用</span>}
                  {route.logJson && <span className="rnode-off" title="单独配了 log_json">记日志</span>}
                </div>
                <div className="rnode-m mono">{describeMatcher(route.matcherJson)}</div>
                {shadowed && (
                  <div className="rnode-warn">
                    上一条 <b>{describeMatcher(prev?.matcherJson)}</b> 已覆盖这个路径，永远命中不到
                  </div>
                )}
              </div>
              <span className="rnode-tools">
                <button
                  className="btn btn-ghost btn-sm"
                  title="编辑"
                  onClick={(e) => {
                    e.stopPropagation()
                    onEditRoute(route)
                  }}
                >
                  <IconEdit size={11} />
                </button>
                <button
                  className="btn btn-ghost btn-sm danger"
                  title="删除"
                  onClick={(e) => {
                    e.stopPropagation()
                    onDeleteRoute(route)
                  }}
                >
                  <IconTrash size={11} />
                </button>
              </span>
            </div>

            <svg className={cx('wire', kind)} viewBox="0 0 24 8" width="24" height="8" aria-hidden="true">
              <line x1="1" y1="4" x2="17" y2="4" stroke="currentColor" strokeWidth="1.1" />
              <path d="M17 1.2 23 4 17 6.8Z" fill="currentColor" />
            </svg>

            <TargetNode route={route} balancers={balancers} />
          </Fragment>
        )
      })}
    </div>
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

  const lbByName = useMemo(() => new Map(balancers.map((b) => [b.name, b])), [balancers])

  const lanes = useMemo(
    () =>
      listeners.map((listener) => {
        const rows = routes.filter((r) => r.listenerId === listener.id).sort(bySort)
        if (pending?.listenerId !== listener.id) return { listener, rows }
        const order = new Map(pending.ids.map((id, i) => [id, i]))
        return {
          listener,
          rows: [...rows].sort((a, b) => (order.get(a.id) ?? 99) - (order.get(b.id) ?? 99)),
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
        if (targetKind(route, lbByName) === 'bad') missing += 1
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
        <RoutesTab listeners={listeners} routes={routes} loading={loading} onChanged={onChanged} />
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

      <div className="topo-cols">
        <span className="c-entry">入口</span>
        <span className="c-route">路由 · 按顺序匹配，命中即停</span>
        <span className="c-target">目标</span>
      </div>

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
        拖动路由卡片 = 改 sort_no；第 1 条命中即停止，所以顺序是语义不是排版。
        改序会把整条泳道重排成 1…n 并逐条保存，发一次发布才会真正影响线上。
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

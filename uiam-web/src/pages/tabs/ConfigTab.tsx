/**
 * 网关配置：一张图看全链路，右上角切回表格。
 *
 * 这里只做编排——图怎么画在 `graph/`，表格还是原来那三个组件。两边共用同一份
 * 表单（ListenerForm / RouteForm / BalancerForm）和同一套启停开关，所以不会出现
 * 「图里能停用、表里停不了」。
 *
 * ## 动作都在卡片上
 *
 * 编辑 / 删除 / 连目标由卡片右上角的操作栏触发，`onEdit` / `onDelete` / `onAddTarget`
 * 一路传到 `GatewayGraph`。属性栏是只读的——它是「看清楚这是什么」的地方。
 *
 * ## 图区为什么要自己算高度
 *
 * 「题头钉住、全局带钉在下面」要求图区是一个**有确定高度**的滚动容器：只有滚动
 * 发生在图内部，`sticky` 才有参照物。窗口是可以在大屏里拖动缩放的，`vh` 算不出
 * 窗口自己的高度，所以从外层滚动容器 `.gw-main` 量一次，写进 `--cfg-h`。
 */
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { api, ApiError } from '../../lib/api'
import { toShape } from '../../lib/format'
import { asBalancerPayload, asListenerPayload, asRoutePayload } from '../../lib/payload'
import type { Balancer, Gateway, Listener, Route } from '../../lib/types'
import { BalancerForm } from '../../components/BalancerForm'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { ListenerForm } from '../../components/ListenerForm'
import { RouteForm } from '../../components/RouteForm'
import { TargetPicker } from '../../components/TargetPicker'
import { useToast } from '../../components/Toast'
import { cx } from '../../components/ui'
import { IconChevronLeft, IconChevronRight } from '../../components/icons'
import { GatewayGraph, type Selection } from '../graph/GatewayGraph'
import { GlobalBand } from '../graph/GlobalBand'
import { Inspector } from '../graph/Inspector'
import { BalancersTab } from './BalancersTab'
import { ListenersTab } from './ListenersTab'
import { RoutesTab } from './RoutesTab'

type View = 'graph' | 'table'

const INS_OPEN_KEY = 'uiam-inspector-open'

export function ConfigTab({
  gateway,
  gatewayId,
  listeners,
  routes,
  balancers,
  loading,
  onChanged,
  onEditGateway,
  published,
}: {
  gateway: Gateway
  gatewayId: string
  listeners: Listener[]
  routes: Route[]
  balancers: Balancer[]
  loading: boolean
  onChanged: () => void
  onEditGateway: () => void
  published?: { version: number; checksum: string }
}) {
  const toast = useToast()
  const [view, setView] = useState<View>('graph')
  const [selection, setSelection] = useState<Selection | null>(null)
  const [insOpen, setInsOpen] = useState(() => localStorage.getItem(INS_OPEN_KEY) !== '0')

  const [listenerForm, setListenerForm] = useState<{ open: boolean; editing: Listener | null }>({
    open: false,
    editing: null,
  })
  const [routeForm, setRouteForm] = useState<{
    open: boolean
    editing: Route | null
    preset?: string
  }>({ open: false, editing: null })
  const [balancerForm, setBalancerForm] = useState<{
    open: boolean
    editing: Balancer | null
    /** 新建完成后要连到哪条路由上（从路由卡片的「连目标」进来时才有） */
    linkTo?: Route
  }>({ open: false, editing: null })
  const [removing, setRemoving] = useState<Selection | null>(null)
  const [picker, setPicker] = useState<{ route: Route; at: { x: number; y: number } } | null>(null)

  const bodyRef = useRef<HTMLDivElement>(null)
  const empty = listeners.length === 0

  const stats = useMemo(() => {
    const disabled =
      listeners.filter((l) => !l.enabled).length +
      routes.filter((r) => !r.enabled).length +
      balancers.filter((b) => !b.enabled).length
    return { disabled }
  }, [listeners, routes, balancers])

  /* --------------------------------------------------- 图区高度（见文件头） */

  useLayoutEffect(() => {
    if (view !== 'graph') return
    const el = bodyRef.current
    if (!el) return
    const host = el.closest('.gw-main') as HTMLElement | null

    const apply = () => {
      const rect = el.getBoundingClientRect()
      // 减掉 host.scrollTop 是为了让结果与「外层滚到哪」无关，否则一边滚一边改高度
      const top = host
        ? rect.top - host.getBoundingClientRect().top + host.scrollTop
        : rect.top
      const bottom = host ? host.clientHeight : window.innerHeight
      el.style.setProperty('--cfg-h', `${Math.max(320, Math.round(bottom - top - 20))}px`)
    }

    apply()
    const ro = host ? new ResizeObserver(apply) : undefined
    if (host && ro) ro.observe(host)
    window.addEventListener('resize', apply)
    return () => {
      ro?.disconnect()
      window.removeEventListener('resize', apply)
    }
  }, [view, empty, insOpen])

  /* ------------------------------------------------------------ 启停 */

  const toggleListener = async (l: Listener) => {
    try {
      await api.listener.update({ ...asListenerPayload(l), enabled: !l.enabled })
      toast.success(l.enabled ? '监听器已停用' : '监听器已启用')
      onChanged()
    } catch (e) {
      toast.error((e as ApiError).message)
    }
  }

  const toggleRoute = async (r: Route) => {
    try {
      await api.route.update({ ...asRoutePayload(r), enabled: !r.enabled })
      toast.success(r.enabled ? '路由已停用' : '路由已启用')
      onChanged()
    } catch (e) {
      toast.error((e as ApiError).message)
    }
  }

  const toggleBalancer = async (b: Balancer) => {
    try {
      await api.balancer.update({ ...asBalancerPayload(b), enabled: !b.enabled })
      toast.success(b.enabled ? '负载均衡器已停用' : '负载均衡器已启用')
      onChanged()
    } catch (e) {
      toast.error((e as ApiError).message)
    }
  }

  /* ------------------------------------------------------------ 卡片动作 */

  const edit = (sel: Selection) => {
    if (sel.kind === 'global') {
      onEditGateway()
    } else if (sel.kind === 'listener') {
      const listener = listeners.find((l) => l.id === sel.id) ?? null
      setListenerForm({ open: true, editing: listener })
    } else if (sel.kind === 'route') {
      const route = routes.find((r) => r.id === sel.id) ?? null
      setRouteForm({ open: true, editing: route })
    } else if (sel.kind === 'balancer') {
      const balancer = balancers.find((b) => b.id === sel.id) ?? null
      setBalancerForm({ open: true, editing: balancer })
    } else {
      const balancer = balancers.find((b) => b.id === sel.balancerId) ?? null
      setBalancerForm({ open: true, editing: balancer })
    }
  }

  /** 把一条路由的转发目标改成某个负载均衡器（一次 PUT，不走弹窗） */
  const linkTarget = async (route: Route, balancer: Balancer) => {
    const prev = toShape(route.toJson)
    const to: Record<string, unknown> = { type: 'LoadBalancer', name: balancer.name }
    // preserve-host 是唯一与「目标类型」无关的转发行为，原样带过去
    if (prev.preserveHost !== undefined) to['preserve-host'] = prev.preserveHost
    try {
      await api.route.update({ ...asRoutePayload(route), toJson: JSON.stringify(to) })
      toast.success(`「${route.name}」已连到 ${balancer.name}`)
      setPicker(null)
      onChanged()
    } catch (e) {
      toast.error((e as ApiError).message)
    }
  }

  /**
   * 重排一个监听器下的路由顺序。
   *
   * 顺序就是匹配优先级（先命中先生效），所以这里落的是 `sort_no`。做法是
   * **尽量少改**：把这组现有的 sort_no 收集起来排序，按新顺序位置对位重新分配，
   * 只 PUT 值真的变了的那些。挪一格 → 2 个 PUT；sort_no 有重复或为 0（历史脏数据）
   * 就退回 1..n 全量重编号，否则「改了等于没改」。
   *
   * 服务端没有批量排序接口（`#[ctrl]` 只生成了标准 CRUD），所以是串行 PUT；
   * 中途失败会留下半套顺序，但 sort_no 只是排序键、不是唯一约束，下一次拖动
   * 会重新对齐，不会把数据搞坏。
   */
  const reorderRoutes = useCallback(
    async (listenerId: string, orderedIds: string[]) => {
      const rows = routes
        .filter((r) => r.listenerId === listenerId)
        .sort((a, b) => a.sortNo - b.sortNo || a.id.localeCompare(b.id))
      if (rows.length !== orderedIds.length) return
      const pool = rows.map((r) => r.sortNo)
      const clean = new Set(pool).size === pool.length
      const sortedPool = [...pool].sort((a, b) => a - b)
      const plan = orderedIds
        .map((id, i) => {
          const row = rows.find((r) => r.id === id)
          return row ? { row, next: clean ? sortedPool[i] : i + 1 } : null
        })
        .filter((x): x is { row: Route; next: number } => Boolean(x))
        .filter(({ row, next }) => row.sortNo !== next)
      if (plan.length === 0) return
      try {
        for (const { row, next } of plan) {
          await api.route.update({ ...asRoutePayload(row), sortNo: next })
        }
        onChanged()
      } catch (e) {
        toast.error((e as ApiError).message)
        onChanged()
      }
    },
    [routes, onChanged, toast],
  )

  /** 上移 / 下移一位：只换相邻两条的 sort_no */
  const moveRoute = useCallback(
    (route: Route, delta: -1 | 1) => {
      const rows = routes
        .filter((r) => r.listenerId === route.listenerId)
        .sort((a, b) => a.sortNo - b.sortNo || a.id.localeCompare(b.id))
      const i = rows.findIndex((r) => r.id === route.id)
      const j = i + delta
      if (i < 0 || j < 0 || j >= rows.length) return
      const ids = rows.map((r) => r.id)
      ;[ids[i], ids[j]] = [ids[j], ids[i]]
      void reorderRoutes(route.listenerId, ids)
    },
    [routes, reorderRoutes],
  )

  const confirmRemove = async () => {
    if (!removing) return
    try {
      if (removing.kind === 'listener') await api.listener.remove(removing.id)
      else if (removing.kind === 'route') await api.route.remove(removing.id)
      else if (removing.kind === 'balancer') await api.balancer.remove(removing.id)
      else return
      toast.success('已删除')
      setRemoving(null)
      setSelection(null)
      onChanged()
    } catch (e) {
      toast.error((e as ApiError).message)
    }
  }

  const removeText = (sel: Selection) => {
    if (sel.kind === 'global') {
      return <>全局配置属于实例本身，不能单独删除；要清空请点右上「编辑」改高级配置。</>
    }
    if (sel.kind === 'listener') {
      const l = listeners.find((x) => x.id === sel.id)
      const n = routes.filter((r) => r.listenerId === sel.id).length
      return (
        <>
          将删除该监听器（{l?.kind === 1 ? 'HTTP' : 'TCP'}），其下 <b>{n}</b> 条路由会一并删除。
          已推上去的 Consul 配置不会变，需要重新发布才影响线上。
        </>
      )
    }
    if (sel.kind === 'route') {
      const r = routes.find((x) => x.id === sel.id)
      return (
        <>
          将删除路由 <b>{r?.name}</b>。需要重新发布才影响线上。
        </>
      )
    }
    if (sel.kind === 'balancer') {
      const b = balancers.find((x) => x.id === sel.id)
      return (
        <>
          将删除负载均衡器 <b className="mono">{b?.name ?? ''}</b>。仍在引用它的路由会让发布被拒。
        </>
      )
    }
    return <>后端不是独立实体，删除请改它所属的负载均衡器配置。</>
  }

  const toggleIns = () => {
    const next = !insOpen
    setInsOpen(next)
    localStorage.setItem(INS_OPEN_KEY, next ? '1' : '0')
  }

  const bar = (
    <div className="cfg-bar">
      <div className="cfg-stats">
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
        {stats.disabled > 0 && <span className="mute">{stats.disabled} 个已停用</span>}
      </div>

      <div className="cfg-bar-r">
        <div className="seg cfg-view">
          <button
            className={cx('seg-item', view === 'graph' && 'on')}
            onClick={() => setView('graph')}
          >
            图形
          </button>
          <button
            className={cx('seg-item', view === 'table' && 'on')}
            onClick={() => setView('table')}
          >
            表格
          </button>
        </div>
      </div>
    </div>
  )

  return (
    <div className="cfg">
      {bar}

      {view === 'graph' ? (
        <div className="cfg-body" ref={bodyRef}>
          <div className="cfg-main">
            <div className="cfg-canvas">
              {empty && !loading ? (
                <div className="cfg-blank">
                  <p className="cfg-blank-t">还没有监听器，链路画不出来</p>
                  <p className="cfg-blank-d">
                    监听器决定网关在哪个地址上收请求；先建一个，再往上挂路由和负载均衡器。
                  </p>
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() => setListenerForm({ open: true, editing: null })}
                  >
                    新建监听器
                  </button>
                </div>
              ) : (
                <GatewayGraph
                  gateway={gateway}
                  listeners={listeners}
                  routes={routes}
                  balancers={balancers}
                  selected={selection}
                  onSelect={setSelection}
                  onToggleListener={toggleListener}
                  onToggleRoute={toggleRoute}
                  onToggleBalancer={toggleBalancer}
                  onEdit={edit}
                  onDelete={setRemoving}
                  onAddRoute={(listenerId) =>
                    setRouteForm({ open: true, editing: null, preset: listenerId })
                  }
                  onAddListener={() => setListenerForm({ open: true, editing: null })}
                  onAddBalancer={() => setBalancerForm({ open: true, editing: null })}
                  onAddTarget={(route, at) => setPicker({ route, at })}
                  onMoveRoute={moveRoute}
                  onReorderRoutes={reorderRoutes}
                />
              )}
            </div>

            {/* 全局段不属于任何一条链路，单独一条常驻带；空配置时也要能看见 */}
            <GlobalBand
              gateway={gateway}
              selected={selection}
              onSelect={setSelection}
              onEdit={onEditGateway}
              published={published}
            />
          </div>

          <aside className={cx('cfg-side', !insOpen && 'closed')}>
            <div className="cfg-side-h">
              {insOpen && <span className="cfg-side-t">属性</span>}
              <button
                className="cfg-side-btn"
                onClick={toggleIns}
                title={insOpen ? '收起属性栏' : '展开属性栏'}
                aria-label={insOpen ? '收起属性栏' : '展开属性栏'}
              >
                {insOpen ? <IconChevronRight size={12} /> : <IconChevronLeft size={12} />}
              </button>
            </div>
            {insOpen ? (
              <Inspector
                gateway={gateway}
                selection={selection}
                listeners={listeners}
                routes={routes}
                balancers={balancers}
                onSelect={setSelection}
              />
            ) : (
              <button className="cfg-side-v" onClick={toggleIns} title="展开属性栏">
                属性
              </button>
            )}
          </aside>
        </div>
      ) : (
        <div className="cfg-tables">
          <ListenersTab
            gatewayId={gatewayId}
            listeners={listeners}
            routes={routes}
            loading={loading}
            onChanged={onChanged}
          />
          <RoutesTab
            listeners={listeners}
            routes={routes}
            loading={loading}
            onChanged={onChanged}
          />
          <BalancersTab
            gatewayId={gatewayId}
            balancers={balancers}
            routes={routes}
            loading={loading}
            onChanged={onChanged}
          />
        </div>
      )}

      <TargetPicker
        open={Boolean(picker)}
        anchor={picker?.at ?? null}
        route={picker?.route ?? null}
        balancers={balancers}
        onClose={() => setPicker(null)}
        onPick={(b) => picker && linkTarget(picker.route, b)}
        onCreate={() => {
          if (!picker) return
          const route = picker.route
          setPicker(null)
          setBalancerForm({ open: true, editing: null, linkTo: route })
        }}
        onFullEdit={() => {
          if (!picker) return
          const route = picker.route
          setPicker(null)
          setRouteForm({ open: true, editing: route })
        }}
      />

      <ListenerForm
        open={listenerForm.open}
        gatewayId={gatewayId}
        listener={listenerForm.editing}
        nextSort={listeners.length + 1}
        onClose={() => setListenerForm({ open: false, editing: null })}
        onSaved={onChanged}
      />

      <RouteForm
        open={routeForm.open}
        listeners={listeners}
        routes={routes}
        route={routeForm.editing}
        presetListenerId={routeForm.preset}
        onClose={() => setRouteForm({ open: false, editing: null })}
        onSaved={onChanged}
      />

      <BalancerForm
        open={balancerForm.open}
        gatewayId={gatewayId}
        balancer={balancerForm.editing}
        onClose={() => setBalancerForm({ open: false, editing: null })}
        onSaved={(saved) => {
          onChanged()
          // 「新建并连上」：建完直接把这条路由的 to 指过去，省掉回来再找一遍
          if (balancerForm.linkTo && saved) void linkTarget(balancerForm.linkTo, saved)
        }}
      />

      <ConfirmDialog
        open={Boolean(removing)}
        title="删除配置"
        danger
        confirmText="删除"
        description={removing ? removeText(removing) : null}
        onCancel={() => setRemoving(null)}
        onConfirm={confirmRemove}
      />
    </div>
  )
}

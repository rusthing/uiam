/**
 * 网关配置：一张图看全链路，右上角切回表格。
 *
 * 这里只做编排——图怎么画在 `graph/`，表格还是原来那三个组件。两边共用同一份
 * 表单（ListenerForm / RouteForm / BalancerForm）和同一套启停开关，所以不会出现
 * 「图里能停用、表里停不了」。
 *
 * 启停不放在表单里：它是「现在参不参与渲染」的即时操作，点一下就该生效。
 */
import { useMemo, useState } from 'react'
import { api, ApiError } from '../../lib/api'
import { asBalancerPayload, asListenerPayload, asRoutePayload } from '../../lib/payload'
import type { Balancer, Gateway, Listener, Route } from '../../lib/types'
import { BalancerForm } from '../../components/BalancerForm'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { ListenerForm } from '../../components/ListenerForm'
import { RouteForm } from '../../components/RouteForm'
import { useToast } from '../../components/Toast'
import { cx } from '../../components/ui'
import { GatewayGraph, type Selection } from '../graph/GatewayGraph'
import { GlobalBand } from '../graph/GlobalBand'
import { Inspector } from '../graph/Inspector'
import { BalancersTab } from './BalancersTab'
import { ListenersTab } from './ListenersTab'
import { RoutesTab } from './RoutesTab'

type View = 'graph' | 'table'

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

  const [listenerForm, setListenerForm] = useState<{ open: boolean; editing: Listener | null }>({
    open: false,
    editing: null,
  })
  const [routeForm, setRouteForm] = useState<{
    open: boolean
    editing: Route | null
    preset?: string
  }>({ open: false, editing: null })
  const [balancerForm, setBalancerForm] = useState<{ open: boolean; editing: Balancer | null }>({
    open: false,
    editing: null,
  })
  const [removing, setRemoving] = useState<Selection | null>(null)

  const stats = useMemo(() => {
    const disabled =
      listeners.filter((l) => !l.enabled).length +
      routes.filter((r) => !r.enabled).length +
      balancers.filter((b) => !b.enabled).length
    return { disabled }
  }, [listeners, routes, balancers])

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

  /* ------------------------------------------------------------ 属性栏动作 */

  const rename = async (sel: Selection, name: string) => {
    try {
      if (sel.kind === 'route') {
        const route = routes.find((r) => r.id === sel.id)
        if (!route) return
        await api.route.update({ ...asRoutePayload(route), name })
      } else if (sel.kind === 'balancer') {
        const balancer = balancers.find((b) => b.id === sel.id)
        if (!balancer) return
        await api.balancer.update({ ...asBalancerPayload(balancer), name })
      } else {
        return
      }
      toast.success('名称已更新')
      onChanged()
    } catch (e) {
      toast.error((e as ApiError).message)
    }
  }

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
  )

  return (
    <div className="cfg">
      {bar}

      {view === 'graph' ? (
        <div className="cfg-body">
          <div className="cfg-canvas">
            {listeners.length === 0 && !loading ? (
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
                onAddRoute={(listenerId) =>
                  setRouteForm({ open: true, editing: null, preset: listenerId })
                }
                onAddListener={() => setListenerForm({ open: true, editing: null })}
                onAddBalancer={() => setBalancerForm({ open: true, editing: null })}
              />
            )}

            {/* 全局段不属于任何一条链路，单独一条带；空配置时也要能看见 */}
            <GlobalBand
              gateway={gateway}
              selected={selection}
              onSelect={setSelection}
              published={published}
            />
          </div>

          <Inspector
            gateway={gateway}
            selection={selection}
            listeners={listeners}
            routes={routes}
            balancers={balancers}
            onSelect={setSelection}
            onRename={rename}
            onEdit={edit}
            onDelete={setRemoving}
          />
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
        onSaved={onChanged}
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

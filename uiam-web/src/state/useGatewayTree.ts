/**
 * 一个网关实例的整棵子树：监听器 → 路由，加上负载均衡器与发布历史。
 *
 * 取数顺序有依赖（先有监听器才知道要查哪些路由），所以收在一个 hook 里一次取完，
 * 增删改之后统一 `reload()`——分四个 hook 各自 reload 很容易漏掉一个，
 * 表现是「改完路由后发布预览还是旧的」。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../lib/api'
import type { Balancer, Listener, Release, Route } from '../lib/types'

export interface GatewayTree {
  listeners: Listener[]
  routes: Route[]
  balancers: Balancer[]
  releases: Release[]
}

const EMPTY: GatewayTree = { listeners: [], routes: [], balancers: [], releases: [] }

export function useGatewayTree(gatewayId: string | undefined) {
  const [tree, setTree] = useState<GatewayTree>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | undefined>(undefined)
  const [tick, setTick] = useState(0)
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  useEffect(() => {
    if (!gatewayId) {
      setTree(EMPTY)
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    ;(async () => {
      const [listeners, balancers, releases] = await Promise.all([
        api.listener.listByGateway(gatewayId),
        api.balancer.listByGateway(gatewayId),
        api.release.listByGateway(gatewayId),
      ])
      const routeGroups = await Promise.all(
        listeners.map((l) => api.route.listByListener(l.id)),
      )
      const routes = routeGroups.flat()
      if (cancelled || !alive.current) return
      const bySort = <T extends { sortNo: number; id: string }>(a: T, b: T) =>
        a.sortNo - b.sortNo || a.id.localeCompare(b.id)
      setTree({
        listeners: [...listeners].sort(bySort),
        routes: [...routes].sort(bySort),
        balancers: [...balancers].sort((a, b) => a.name.localeCompare(b.name)),
        releases,
      })
      setError(undefined)
    })()
      .catch((e: Error) => {
        if (cancelled || !alive.current) return
        setError(e)
      })
      .finally(() => {
        if (cancelled || !alive.current) return
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [gatewayId, tick])

  const reload = useCallback(() => setTick((v) => v + 1), [])
  return useMemo(() => ({ ...tree, loading, error, reload }), [tree, loading, error, reload])
}

/**
 * 网关实例列表的共享状态。
 *
 * 侧边栏和主区都要用这份数据（前者列实例，后者校验当前 id 是否存在），
 * 提到 context 里只取一次；新建 / 删除后调 `reload()` 让两边同时刷新。
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { api } from '../lib/api'
import type { Gateway } from '../lib/types'

interface GatewayListState {
  gateways: Gateway[]
  loading: boolean
  error?: Error
  reload: () => void
}

const GatewayListContext = createContext<GatewayListState | null>(null)

export function GatewayListProvider({ children }: { children: ReactNode }) {
  const [gateways, setGateways] = useState<Gateway[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | undefined>(undefined)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    api.gateway
      .list()
      .then((rows) => {
        if (cancelled) return
        setGateways([...rows].sort((a, b) => a.code.localeCompare(b.code)))
        setError(undefined)
      })
      .catch((e: Error) => {
        if (cancelled) return
        setError(e)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [tick])

  const reload = useCallback(() => setTick((v) => v + 1), [])
  const value = useMemo(
    () => ({ gateways, loading, error, reload }),
    [gateways, loading, error, reload],
  )

  return <GatewayListContext.Provider value={value}>{children}</GatewayListContext.Provider>
}

export function useGatewayList(): GatewayListState {
  const ctx = useContext(GatewayListContext)
  if (!ctx) throw new Error('useGatewayList 必须在 GatewayListProvider 内使用')
  return ctx
}

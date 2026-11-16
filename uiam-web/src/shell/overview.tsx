/**
 * 桌面总览数据：一份「网关列表 + 最近发布」，供所有 widget 共用。
 *
 * 为什么放到 provider 里：8 个 widget 里有 5 个要看这两份数据，各自 `useEffect`
 * 就是 8 份重复请求。这里取一次、下面读 context。
 *
 * 发布历史只能按实例查（服务端没有全局列表接口），所以对每个实例取最近 3 条再
 * 合并排序；实例数量按 12 个封顶——桌面是「一眼看状态」的地方，不是报表，
 * 超过这个量级应该去网关窗口里翻。
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
import type { Gateway, Release } from '../lib/types'
import { useGatewayList } from '../state/GatewayList'

export interface ReleaseRow {
  gateway: Gateway
  release: Release
}

interface Overview {
  gateways: Gateway[]
  releases: ReleaseRow[]
  loading: boolean
  /** 最近一次成功拉到数据的时间；组件用它显示「更新于 …」 */
  updatedAt: number
  error?: Error
  reload: () => void
}

const Ctx = createContext<Overview | null>(null)
const MAX_GATEWAYS = 12

export function OverviewProvider({ children }: { children: ReactNode }) {
  const { gateways, loading, error, reload } = useGatewayList()
  const [rows, setRows] = useState<ReleaseRow[]>([])
  const [fetching, setFetching] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(0)
  const key = gateways.map((g) => g.id).join(',')

  useEffect(() => {
    if (!gateways.length) {
      setRows([])
      return
    }
    let cancelled = false
    setFetching(true)
    Promise.all(
      gateways.slice(0, MAX_GATEWAYS).map(async (g) => {
        try {
          const list = await api.release.listByGateway(g.id)
          return list.slice(0, 3).map((release) => ({ gateway: g, release }))
        } catch {
          // 单个实例查不到不影响其它 widget：把它当成「没有发布记录」
          return [] as ReleaseRow[]
        }
      }),
    )
      .then((lists) => {
        if (cancelled) return
        setRows(
          lists
            .flat()
            .sort((a, b) => Number(b.release.createMs) - Number(a.release.createMs)),
        )
        setUpdatedAt(Date.now())
      })
      .finally(() => {
        if (!cancelled) setFetching(false)
      })
    return () => {
      cancelled = true
    }
    // gateways 用 id 串当依赖：数组引用每次渲染都变，直接依赖会无限循环
  }, [key])

  const refresh = useCallback(() => reload(), [reload])

  const value = useMemo<Overview>(
    () => ({
      gateways,
      releases: rows,
      loading: loading || fetching,
      updatedAt,
      error,
      reload: refresh,
    }),
    [gateways, rows, loading, fetching, updatedAt, error, refresh],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useOverview(): Overview {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useOverview 必须在 OverviewProvider 内使用')
  return ctx
}

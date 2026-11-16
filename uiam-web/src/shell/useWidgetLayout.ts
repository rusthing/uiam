/**
 * 桌面组件布局：尺寸族、默认排布、持久化与旧数据迁移。
 *
 * 之前是「任意 w/h 格数」+ 4 列拉伸网格，1×1 会变成 336×132 的扁条；现在改成
 * Apple 的 system family：small(1×1 正方形) / medium(2×1) / large(2×2) /
 * extra large(4×2)，单元固定 `--wg-unit` 正方形，尺寸族只允许这四种组合。
 *
 * 布局默认仍是**有序数组**（CSS Grid dense 紧凑排布）；`free === true` 时组件带
 * `x/y` 网格坐标，走绝对定位 + 吸附。两种形态共用一份数据，旧数组格式自动迁移，
 * 用户摆好的桌面不会因为升级被清空。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { readPref, subscribePrefs, writePref } from '../lib/preferences'

export type WidgetId =
  | 'clock'
  | 'count'
  | 'enabled'
  | 'apps'
  | 'nodes'
  | 'releases'
  | 'unpushed'
  | 'attention'

export type WidgetSize = 'small' | 'medium' | 'large' | 'xl'

export const SIZE_FAMILY: Record<WidgetSize, { w: number; h: number; label: string }> = {
  small: { w: 1, h: 1, label: '小' },
  medium: { w: 2, h: 1, label: '中' },
  large: { w: 2, h: 2, label: '大' },
  xl: { w: 4, h: 2, label: '特大' },
}

export const SIZE_ORDER: WidgetSize[] = ['small', 'medium', 'large', 'xl']

export interface WidgetDef {
  id: WidgetId
  name: string
  /** 小组件中心里的描述：动词开头，不说「此组件显示…」 */
  desc: string
  category: '概览' | '发布' | '快捷'
  size: WidgetSize
  /** 这个组件允许的尺寸；大尺寸必须带来信息增量，不是把小卡拉大 */
  sizes: WidgetSize[]
}

export interface LayoutItem {
  id: WidgetId
  size: WidgetSize
  /** 自由摆放模式下的网格坐标（0 基） */
  x?: number
  y?: number
}

/** 小组件中心拖放落点：自由摆放读 x/y，紧凑排布读 beforeId（null = 追加末尾） */
export interface AddAt {
  x?: number
  y?: number
  beforeId?: WidgetId | null
}

interface LayoutState {
  version: 2
  free: boolean
  items: LayoutItem[]
}

export const WIDGET_DEFS: Record<WidgetId, WidgetDef> = {
  clock: {
    id: 'clock', name: '时钟', desc: '查看当前时间与日期', category: '概览',
    size: 'medium', sizes: ['small', 'medium'],
  },
  count: {
    id: 'count', name: '网关实例', desc: '查看网关实例总数', category: '概览',
    size: 'small', sizes: ['small', 'medium'],
  },
  enabled: {
    id: 'enabled', name: '启用中', desc: '掌握启用比例与停用数量', category: '概览',
    size: 'small', sizes: ['small', 'medium'],
  },
  apps: {
    id: 'apps', name: '快捷应用', desc: '一键打开常用管理应用', category: '快捷',
    size: 'large', sizes: ['medium', 'large'],
  },
  nodes: {
    id: 'nodes', name: '实例状态', desc: '扫一眼各实例的运行状态', category: '概览',
    size: 'large', sizes: ['medium', 'large', 'xl'],
  },
  releases: {
    id: 'releases', name: '最近发布', desc: '查看最近的发布与推送结果', category: '发布',
    size: 'medium', sizes: ['medium', 'large', 'xl'],
  },
  unpushed: {
    id: 'unpushed', name: '未推送', desc: '查看还差多少次配置推送', category: '发布',
    size: 'small', sizes: ['small', 'medium'],
  },
  attention: {
    id: 'attention', name: '待处理', desc: '处理从未发布或推送失败的实例', category: '发布',
    size: 'medium', sizes: ['medium', 'large', 'xl'],
  },
}

const DEFAULT_ITEMS: LayoutItem[] = [
  { id: 'clock', size: 'medium' },
  { id: 'count', size: 'small' },
  { id: 'enabled', size: 'small' },
  { id: 'releases', size: 'medium' },
  { id: 'unpushed', size: 'small' },
  { id: 'apps', size: 'large' },
  { id: 'nodes', size: 'large' },
  { id: 'attention', size: 'medium' },
]

const KEY = 'uiam-desktop' as const

/** 旧的 w/h 格数 → 新尺寸族。3×1、4×1 这类不存在的组合归到最接近的一档 */
function legacySize(w: number, h: number): WidgetSize {
  if (h >= 2 && w >= 4) return 'xl'
  if (h >= 2 || (w === 2 && h === 2)) return 'large'
  if (w >= 2) return 'medium'
  return 'small'
}

function normalizeState(raw: unknown): LayoutState {
  // v2：{ version, free, items }
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const state = raw as Partial<LayoutState>
    if (Array.isArray(state.items)) {
      const seen = new Set<string>()
      const items = state.items
        .filter((it): it is LayoutItem => Boolean(it && WIDGET_DEFS[it.id as WidgetId]))
        .map((it) => {
          const def = WIDGET_DEFS[it.id]
          return {
            id: it.id,
            size: def.sizes.includes(it.size) ? it.size : def.size,
            ...(Number.isInteger(it.x) && Number.isInteger(it.y)
              ? { x: Math.max(0, it.x!), y: Math.max(0, it.y!) }
              : {}),
          }
        })
        .filter((it) => {
          if (seen.has(it.id)) return false
          seen.add(it.id)
          return true
        })
      return { version: 2, free: state.free === true, items }
    }
  }
  // v1：纯数组 [{ id, w, h }]
  if (Array.isArray(raw)) {
    const seen = new Set<string>()
    const items = raw
      .filter((it) => it && WIDGET_DEFS[it.id as WidgetId])
      .map((it) => ({
        id: it.id as WidgetId,
        size: legacySize(Number(it.w) || 1, Number(it.h) || 1),
      }))
      .filter((it) => {
        if (seen.has(it.id)) return false
        seen.add(it.id)
        return true
      })
    if (items.length) return { version: 2, free: false, items }
  }
  return { version: 2, free: false, items: DEFAULT_ITEMS }
}

function load(): LayoutState {
  try {
    return normalizeState(readPref<unknown>(KEY, null))
  } catch {
    return { version: 2, free: false, items: DEFAULT_ITEMS }
  }
}

/** 尺寸族 → 实际格数；窄屏时把宽度收敛到可用列数，避免 4 列组件溢出容器 */
export function gridOf(size: WidgetSize, columns: number): { w: number; h: number } {
  const { w, h } = SIZE_FAMILY[size]
  return { w: Math.max(1, Math.min(w, Math.max(1, columns))), h }
}

export function useWidgetLayout() {
  const [state, setState] = useState<LayoutState>(load)

  const update = useCallback((next: LayoutState | ((prev: LayoutState) => LayoutState)) => {
    setState((prev) => {
      const value = typeof next === 'function' ? next(prev) : next
      writePref(KEY, value)
      return value
    })
  }, [])

  /**
   * 添加组件。`at` 来自小组件中心的拖放：自由摆放按 x/y 定位，紧凑排布按
   * beforeId 插入（缺省追加末尾）。一次 update 写完，避免 add + move 两次
   * setState 被批处理成只落地后者。
   */
  const add = useCallback((id: WidgetId, size?: WidgetSize, at?: AddAt) => {
    update((prev) => {
      if (prev.items.some((it) => it.id === id)) return prev
      const def = WIDGET_DEFS[id]
      const chosen = size && def.sizes.includes(size) ? size : def.size
      const item: LayoutItem = { id, size: chosen }
      if (prev.free && Number.isInteger(at?.x) && Number.isInteger(at?.y)) {
        item.x = Math.max(0, at!.x!)
        item.y = Math.max(0, at!.y!)
      }
      const items = [...prev.items]
      const idx = at?.beforeId ? items.findIndex((it) => it.id === at.beforeId) : -1
      if (idx >= 0) items.splice(idx, 0, item)
      else items.push(item)
      return { ...prev, items }
    })
  }, [update])

  const remove = useCallback((id: WidgetId) => {
    update((prev) => ({ ...prev, items: prev.items.filter((it) => it.id !== id) }))
  }, [update])

  const setSize = useCallback((id: WidgetId, size: WidgetSize) => {
    update((prev) => ({
      ...prev,
      items: prev.items.map((it) =>
        it.id === id && WIDGET_DEFS[id].sizes.includes(size) ? { ...it, size } : it,
      ),
    }))
  }, [update])

  /** 尺寸手柄：在该组件允许的尺寸里循环 */
  const cycleSize = useCallback((id: WidgetId) => {
    update((prev) => ({
      ...prev,
      items: prev.items.map((it) => {
        if (it.id !== id) return it
        const sizes = WIDGET_DEFS[id].sizes
        const next = sizes[(sizes.indexOf(it.size) + 1) % sizes.length]
        return { ...it, size: next }
      }),
    }))
  }, [update])

  const reorder = useCallback((from: WidgetId, to: WidgetId, after: boolean) => {
    update((prev) => {
      if (from === to) return prev
      const items = [...prev.items]
      const fromIdx = items.findIndex((it) => it.id === from)
      if (fromIdx < 0) return prev
      const [moved] = items.splice(fromIdx, 1)
      const toIdx = items.findIndex((it) => it.id === to)
      if (toIdx < 0) return prev
      items.splice(after ? toIdx + 1 : toIdx, 0, moved)
      return { ...prev, items }
    })
  }, [update])

  /** 自由摆放：记录吸附后的网格坐标 */
  const move = useCallback((id: WidgetId, x: number, y: number) => {
    update((prev) => ({
      ...prev,
      free: true,
      items: prev.items.map((it) => (it.id === id ? { ...it, x, y } : it)),
    }))
  }, [update])

  const setFree = useCallback((free: boolean) => {
    update((prev) => {
      if (prev.free === free) return prev
      // 从自由摆放退回紧凑网格时丢掉坐标，避免下次开启时落回旧位置
      return {
        version: 2,
        free,
        items: free ? prev.items : prev.items.map(({ x: _x, y: _y, ...it }) => it),
      }
    })
  }, [update])

  const reset = useCallback(() => update({ version: 2, free: false, items: DEFAULT_ITEMS }), [update])

  // 远端偏好 hydrate / 其它标签页改动后重读一次本地快照；
  // 值没变就返回原对象，不会因为 writePref 自己触发的通知形成循环
  useEffect(
    () =>
      subscribePrefs(() => {
        const next = load()
        setState((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next))
      }),
    [],
  )

  const rest = useMemo(
    () =>
      (Object.keys(WIDGET_DEFS) as WidgetId[]).filter(
        (id) => !state.items.some((it) => it.id === id),
      ),
    [state.items],
  )

  return {
    layout: state.items,
    free: state.free,
    add, remove, setSize, cycleSize, reorder, move, setFree, reset, rest,
  }
}

/**
 * 桌面组件布局：定义、默认排布、localStorage 存取。
 *
 * 布局是一个「有序数组」而不是网格坐标：macOS 的组件网格是自动紧凑排布的，
 * 用户拖动的其实是**顺序**，具体落在第几行第几列由 CSS Grid 的 `dense` 决定。
 * 这样换尺寸之后不会留下洞，也不用处理「坐标冲突」这种麻烦事。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'

export type WidgetId =
  | 'clock'
  | 'count'
  | 'enabled'
  | 'apps'
  | 'nodes'
  | 'releases'
  | 'unpushed'
  | 'attention'

export interface WidgetDef {
  id: WidgetId
  name: string
  /** 默认尺寸（格） */
  w: number
  h: number
}

export interface LayoutItem {
  id: WidgetId
  w: number
  h: number
}

export const WIDGET_DEFS: Record<WidgetId, WidgetDef> = {
  clock: { id: 'clock', name: '时钟', w: 2, h: 1 },
  count: { id: 'count', name: '网关实例', w: 1, h: 1 },
  enabled: { id: 'enabled', name: '启用中', w: 1, h: 1 },
  apps: { id: 'apps', name: '快捷应用', w: 2, h: 2 },
  nodes: { id: 'nodes', name: '实例状态', w: 2, h: 2 },
  releases: { id: 'releases', name: '最近发布', w: 3, h: 1 },
  unpushed: { id: 'unpushed', name: '未推送', w: 1, h: 1 },
  attention: { id: 'attention', name: '待处理', w: 4, h: 1 },
}

/** 切换尺寸时按这个顺序循环；只放「摆得下」的组合，避免出现 1×2 这种空壳 */
export const SIZE_STEPS: Array<[number, number]> = [
  [1, 1],
  [2, 1],
  [3, 1],
  [2, 2],
  [4, 1],
]

const DEFAULT_LAYOUT: LayoutItem[] = [
  { id: 'clock', w: 2, h: 1 },
  { id: 'count', w: 1, h: 1 },
  { id: 'enabled', w: 1, h: 1 },
  { id: 'apps', w: 2, h: 2 },
  { id: 'nodes', w: 2, h: 2 },
  { id: 'releases', w: 3, h: 1 },
  { id: 'unpushed', w: 1, h: 1 },
  { id: 'attention', w: 4, h: 1 },
]

const KEY = 'uiam-desktop'

function loadLayout(): LayoutItem[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const arr = JSON.parse(raw)
      if (Array.isArray(arr) && arr.length) {
        const seen = new Set<string>()
        const items = arr
          .filter((it) => it && WIDGET_DEFS[it.id as WidgetId] && !seen.has(it.id))
          .map((it) => {
            seen.add(it.id)
            const d = WIDGET_DEFS[it.id as WidgetId]
            return { id: it.id as WidgetId, w: Number(it.w) || d.w, h: Number(it.h) || d.h }
          })
        if (items.length) return items
      }
    }
  } catch {
    // 脏数据直接退回默认布局
  }
  return DEFAULT_LAYOUT
}

export function useWidgetLayout() {
  const [layout, setLayout] = useState<LayoutItem[]>(loadLayout)

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(layout))
    } catch {
      // 存不下就只在本页生效
    }
  }, [layout])

  const add = useCallback((id: WidgetId) => {
    setLayout((prev) => {
      if (prev.some((it) => it.id === id)) return prev
      const d = WIDGET_DEFS[id]
      return [...prev, { id, w: d.w, h: d.h }]
    })
  }, [])

  const remove = useCallback((id: WidgetId) => {
    setLayout((prev) => prev.filter((it) => it.id !== id))
  }, [])

  const cycleSize = useCallback((id: WidgetId) => {
    setLayout((prev) =>
      prev.map((it) => {
        if (it.id !== id) return it
        const cur = SIZE_STEPS.findIndex(([w, h]) => w === it.w && h === it.h)
        const [w, h] = SIZE_STEPS[(cur + 1) % SIZE_STEPS.length]
        return { ...it, w, h }
      }),
    )
  }, [])

  /** 拖动排序：把 from 挪到 to 的前/后，顺序即布局 */
  const reorder = useCallback((from: WidgetId, to: WidgetId, after: boolean) => {
    setLayout((prev) => {
      if (from === to) return prev
      const items = [...prev]
      const fromIdx = items.findIndex((it) => it.id === from)
      if (fromIdx < 0) return prev
      const [moved] = items.splice(fromIdx, 1)
      const toIdx = items.findIndex((it) => it.id === to)
      if (toIdx < 0) return prev
      items.splice(after ? toIdx + 1 : toIdx, 0, moved)
      return items
    })
  }, [])

  const reset = useCallback(() => setLayout(DEFAULT_LAYOUT), [])

  const rest = useMemo(
    () => (Object.keys(WIDGET_DEFS) as WidgetId[]).filter((id) => !layout.some((it) => it.id === id)),
    [layout],
  )

  return { layout, add, remove, cycleSize, reorder, reset, rest }
}

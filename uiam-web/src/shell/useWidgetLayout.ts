/**
 * 桌面组件布局：尺寸族、自由坐标、持久化与旧数据迁移。
 *
 * 桌面是 macOS 式的**自由摆放**：每个组件始终带 `x/y` 网格坐标，不再走
 * `grid-auto-flow` 自动铺满。拖动直接改坐标，位置存本地并（可选）同步到
 * uiam-svr。`packItems` 负责默认排布与新增组件的落位，`nearestFree` 负责
 * 拖动落点被占用时就近找空位——两者都保证组件不重叠。
 *
 * 旧数据（v1 纯数组 / v2 `{ free, items }`）自动迁移成 v3：顺序保留，已有的
 * `x/y` 保留，缺失的按顺序补坐标，用户摆好的桌面不会因为升级被清空。
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
  /** 自由摆放的网格坐标（0 基） */
  x: number
  y: number
}

/** 小组件中心拖放落点：拖到哪就放在哪附近 */
export interface AddAt {
  x?: number
  y?: number
}

interface LayoutState {
  version: 3
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

/** 默认顺序：只描述「放什么、多大」，坐标由 `packItems` 生成 */
const DEFAULT_ORDER: Array<Pick<LayoutItem, 'id' | 'size'>> = [
  { id: 'clock', size: 'medium' },
  { id: 'count', size: 'small' },
  { id: 'enabled', size: 'small' },
  { id: 'releases', size: 'medium' },
  { id: 'unpushed', size: 'small' },
  { id: 'apps', size: 'large' },
  { id: 'nodes', size: 'large' },
  { id: 'attention', size: 'medium' },
]

/** 默认按 4 列摆；实际列数更少时由渲染层裁剪 */
const DEFAULT_COLUMNS = 4

/**
 * 读取存档时允许的列数上限。宽屏可能排出 5 列以上，
 * 不能再用默认的 4 列把右边两列的位置裁掉。
 */
const STORED_COLUMNS = 12

const KEY = 'uiam-desktop' as const

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

function collides(a: Rect, b: Rect) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

function fits(occupied: Rect[], rect: Rect) {
  return !occupied.some((other) => collides(other, rect))
}

function clampX(x: number, w: number, columns: number) {
  return Math.max(0, Math.min(x, Math.max(0, columns - w)))
}

/** 尺寸 → 当前列数下的实际格数；窄屏不会让 4 列组件溢出容器 */
export function gridOf(size: WidgetSize, columns: number): { w: number; h: number } {
  const { w, h } = SIZE_FAMILY[size]
  return { w: Math.max(1, Math.min(w, Math.max(1, columns))), h }
}

/** row-major 找第一个能放下的位置；放不下就继续往下扩行 */
function firstFree(occupied: Rect[], w: number, h: number, columns: number) {
  const cols = Math.max(1, columns)
  const width = Math.min(w, cols)
  const limit = Math.max(occupied.length, 1) * 4 + 32
  for (let y = 0; y < limit; y += 1) {
    for (let x = 0; x <= cols - width; x += 1) {
      if (fits(occupied, { x, y, w: width, h })) return { x, y }
    }
  }
  return { x: 0, y: limit }
}

/**
 * 从落点向外按曼哈顿距离找最近的空位。
 * 落点本身可用时原样返回，拖动手感不会「一跳就到角落」。
 */
export function nearestFree(
  occupied: Rect[],
  w: number,
  h: number,
  x: number,
  y: number,
  columns: number,
): { x: number; y: number } {
  const cols = Math.max(1, columns)
  const width = Math.min(w, cols)
  const targetX = clampX(x, width, cols)
  const targetY = Math.max(0, y)
  if (fits(occupied, { x: targetX, y: targetY, w: width, h })) {
    return { x: targetX, y: targetY }
  }

  const maxY = Math.max(targetY, ...occupied.map((rect) => rect.y + rect.h)) + 24
  let best: { x: number; y: number } | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  for (let yy = 0; yy <= maxY; yy += 1) {
    for (let xx = 0; xx <= cols - width; xx += 1) {
      if (!fits(occupied, { x: xx, y: yy, w: width, h })) continue
      const distance = Math.abs(xx - targetX) + Math.abs(yy - targetY)
      if (distance < bestDistance) {
        best = { x: xx, y: yy }
        bestDistance = distance
      }
    }
  }
  return best ?? firstFree(occupied, width, h, cols)
}

function rectOf(item: LayoutItem, columns: number): Rect & { id: WidgetId } {
  const { w, h } = gridOf(item.size, columns)
  return { id: item.id, x: clampX(item.x, w, columns), y: Math.max(0, item.y), w, h }
}

/** 让某个组件落在不与别人重叠的位置：原位可用就不动，被占才就近挪 */
function settleItem(items: LayoutItem[], id: WidgetId, columns: number): LayoutItem[] {
  const target = items.find((it) => it.id === id)
  if (!target) return items
  const occupied = occupiedOf(items, id, columns)
  const { w, h } = gridOf(target.size, columns)
  const spot = nearestFree(occupied, w, h, target.x, target.y, columns)
  if (spot.x === target.x && spot.y === target.y) return items
  return items.map((it) => (it.id === id ? { ...it, x: spot.x, y: spot.y } : it))
}

/** 已有组件的占位矩形；`exceptId` 用于移动/改尺寸时排除自己 */
function occupiedOf(items: LayoutItem[], exceptId: WidgetId | null, columns: number): Rect[] {
  return items
    .filter((it) => it.id !== exceptId)
    .map((it) => {
      const { w, h } = gridOf(it.size, columns)
      return { x: clampX(it.x, w, columns), y: Math.max(0, it.y), w, h }
    })
}

/** 按数组顺序做 first-fit 排布；用于默认布局与新增组件 */
export function packItems(
  order: Array<Pick<LayoutItem, 'id' | 'size'>>,
  columns = DEFAULT_COLUMNS,
): LayoutItem[] {
  const occupied: Rect[] = []
  const placed: LayoutItem[] = []
  for (const item of order) {
    const { w, h } = gridOf(item.size, columns)
    const spot = firstFree(occupied, w, h, columns)
    placed.push({ id: item.id, size: item.size, x: spot.x, y: spot.y })
    occupied.push({ ...spot, w, h })
  }
  return placed
}

const DEFAULT_STATE: LayoutState = {
  version: 3,
  items: packItems(DEFAULT_ORDER, DEFAULT_COLUMNS),
}

/** 旧的 w/h 格数 → 新尺寸族。3×1、4×1 这类不存在的组合归到最接近的一档 */
function legacySize(w: number, h: number): WidgetSize {
  if (h >= 2 && w >= 4) return 'xl'
  if (h >= 2 || (w === 2 && h === 2)) return 'large'
  if (w >= 2) return 'medium'
  return 'small'
}

interface RawItem {
  id?: unknown
  size?: unknown
  x?: unknown
  y?: unknown
  w?: unknown
  h?: unknown
}

/**
 * 把任意来源的条目整理成合法布局：
 * 去重、修正尺寸、缺失/冲突的坐标按顺序补空位。
 */
function sanitizeItems(raw: unknown, keepCoords: boolean): LayoutItem[] | null {
  if (!Array.isArray(raw)) return null
  const seen = new Set<string>()
  const picked: LayoutItem[] = []
  for (const entry of raw as RawItem[]) {
    const id = entry?.id as WidgetId
    if (!WIDGET_DEFS[id] || seen.has(id)) continue
    seen.add(id)
    const def = WIDGET_DEFS[id]
    const size = def.sizes.includes(entry.size as WidgetSize)
      ? (entry.size as WidgetSize)
      : def.size
    const hasCoords =
      keepCoords && Number.isInteger(entry.x) && Number.isInteger(entry.y)
    picked.push({
      id,
      size,
      x: hasCoords ? Math.max(0, entry.x as number) : -1,
      y: hasCoords ? Math.max(0, entry.y as number) : -1,
    })
  }
  if (picked.length === 0) return null

  const occupied: Rect[] = []
  const items: LayoutItem[] = []
  for (const item of picked) {
    const { w, h } = gridOf(item.size, STORED_COLUMNS)
    const hasSpot =
      item.x >= 0 &&
      item.y >= 0 &&
      fits(occupied, { x: clampX(item.x, w, STORED_COLUMNS), y: item.y, w, h })
    const spot = hasSpot
      ? { x: clampX(item.x, w, STORED_COLUMNS), y: item.y }
      : firstFree(occupied, w, h, DEFAULT_COLUMNS)
    items.push({ ...item, ...spot })
    occupied.push({ ...spot, w, h })
  }
  return items
}

function normalizeState(raw: unknown): LayoutState {
  // v2/v3：{ version, free?, items }
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const state = raw as { version?: unknown; free?: unknown; items?: unknown }
    // v2 的 free:false 代表「紧凑顺序」，升级后按数组顺序重新排；free:true 保留坐标
    const keepCoords = state.free !== false
    const items = sanitizeItems(state.items, keepCoords)
    if (items) return { version: 3, items }
  }
  // v1：纯数组 [{ id, w, h }]
  if (Array.isArray(raw)) {
    const items = sanitizeItems(
      (raw as RawItem[]).map((entry) => ({
        id: entry?.id,
        size: legacySize(Number(entry?.w) || 1, Number(entry?.h) || 1),
      })),
      false,
    )
    if (items) return { version: 3, items }
  }
  return DEFAULT_STATE
}

function load(): LayoutState {
  try {
    return normalizeState(readPref<unknown>(KEY, null))
  } catch {
    return DEFAULT_STATE
  }
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
   * 添加组件。`at` 来自小组件中心的拖放：落到指针所在格，被占用时就近挪空位；
   * 没给落点就接在默认顺序后面。
   */
  const add = useCallback(
    (id: WidgetId, size?: WidgetSize, at?: AddAt, columns = DEFAULT_COLUMNS) => {
      update((prev) => {
        if (prev.items.some((it) => it.id === id)) return prev
        const def = WIDGET_DEFS[id]
        const chosen = size && def.sizes.includes(size) ? size : def.size
        const { w, h } = gridOf(chosen, columns)
        const occupied = occupiedOf(prev.items, null, columns)
        const spot =
          Number.isInteger(at?.x) && Number.isInteger(at?.y)
            ? nearestFree(occupied, w, h, at!.x!, at!.y!, columns)
            : firstFree(occupied, w, h, columns)
        return {
          version: 3,
          items: [...prev.items, { id, size: chosen, x: spot.x, y: spot.y }],
        }
      })
    },
    [update],
  )

  const remove = useCallback((id: WidgetId) => {
    update((prev) => ({ ...prev, items: prev.items.filter((it) => it.id !== id) }))
  }, [update])

  /** 尺寸变化后原地放不下就挪到最近空位 */
  const placeAtSize = useCallback(
    (items: LayoutItem[], id: WidgetId, size: WidgetSize, columns: number): LayoutItem[] => {
      const target = items.find((it) => it.id === id)
      if (!target) return items
      const occupied = occupiedOf(items, id, columns)
      const { w, h } = gridOf(size, columns)
      const spot = nearestFree(occupied, w, h, target.x, target.y, columns)
      return items.map((it) => (it.id === id ? { ...it, size, x: spot.x, y: spot.y } : it))
    },
    [],
  )

  const setSize = useCallback(
    (id: WidgetId, size: WidgetSize, columns = DEFAULT_COLUMNS) => {
      update((prev) => {
        if (!WIDGET_DEFS[id].sizes.includes(size)) return prev
        return { version: 3, items: placeAtSize(prev.items, id, size, columns) }
      })
    },
    [update, placeAtSize],
  )

  /** 尺寸手柄：在该组件允许的尺寸里循环 */
  const cycleSize = useCallback(
    (id: WidgetId, columns = DEFAULT_COLUMNS) => {
      update((prev) => {
        const item = prev.items.find((it) => it.id === id)
        if (!item) return prev
        const sizes = WIDGET_DEFS[id].sizes
        const next = sizes[(sizes.indexOf(item.size) + 1) % sizes.length]
        return { version: 3, items: placeAtSize(prev.items, id, next, columns) }
      })
    },
    [update, placeAtSize],
  )

  /**
   * 自由摆放：拖到哪就停在哪。
   * 落点压住的卡片会被**推开**到就近空位（通常是拖动者刚空出来的格子），
   * 拖动者本身始终钉在落点——不再「就近找空位」把自己弹到别处。
   */
  const move = useCallback(
    (id: WidgetId, x: number, y: number, columns = DEFAULT_COLUMNS) => {
      update((prev) => {
        const item = prev.items.find((it) => it.id === id)
        if (!item) return prev
        const mine = rectOf(item, columns)
        const target = { x: clampX(x, mine.w, columns), y: Math.max(0, y) }
        const dragged = { ...target, w: mine.w, h: mine.h }
        const hits = prev.items
          .filter((it) => it.id !== id)
          .map((it) => rectOf(it, columns))
          .filter((other) => collides(other, dragged))
          .sort(
            (a, b) =>
              Math.abs(a.x - target.x) +
              Math.abs(a.y - target.y) -
              (Math.abs(b.x - target.x) + Math.abs(b.y - target.y)),
          )

        // 先让卡片钉在落点，再按由近到远把压住的卡片逐个推到空位
        let next = prev.items.map((it) => (it.id === id ? { ...it, x: target.x, y: target.y } : it))
        for (const hit of hits) {
          const current = next.find((it) => it.id === hit.id)
          if (!current) continue
          if (!collides(rectOf(current, columns), dragged)) continue
          next = settleItem(next, hit.id, columns)
        }
        return { version: 3, items: next }
      })
    },
    [update],
  )

  const reset = useCallback(() => update(DEFAULT_STATE), [update])

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
    add, remove, setSize, cycleSize, move, reset, rest,
  }
}

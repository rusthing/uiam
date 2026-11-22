/**
 * 桌面组件布局：尺寸族、自由坐标、持久化与旧数据迁移。
 *
 * 桌面是 macOS 式的**自由摆放**：每个组件带 `x/y` 坐标（单位 = 网格 pitch），
 * 整数表示对齐网格，小数表示自由落点。拖动只在编辑态开启，吸附/边缘吸附由
 * `Desktop` 在指针层算好后把最终坐标传进来；这里只负责钳制到容器内、持久化，
 * 不再拆散/重排别的组件（自由落点允许重叠）。`packItems` 仅用于默认布局和
 * 「添加」按钮的自动落位，`nearestFree` 只服务于改尺寸时的避让。
 *
 * 旧数据（v1 纯数组 / v2 `{ free, items }`）自动迁移成 v3：顺序保留，已有的
 * `x/y` 保留，缺失的按顺序补坐标，用户摆好的桌面不会因为升级被清空。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { readPref, subscribePrefs, writePref } from '../lib/preferences'

export type WidgetId =
  | 'clock'
  | 'clock-digital'
  | 'weather'
  | 'calendar'
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
  category: '生活' | '概览' | '发布' | '快捷'
  size: WidgetSize
  /** 这个组件允许的尺寸；大尺寸必须带来信息增量，不是把小卡拉大 */
  sizes: WidgetSize[]
}

export interface LayoutItem {
  id: WidgetId
  size: WidgetSize
  /**
   * 自由坐标，单位是一个网格 pitch（`--wg-unit + --wg-gap`）。
   * 整数 = 对齐某条网格线；小数 = 用户没触发吸附时的自由落点。
   */
  x: number
  y: number
}

/** 小组件中心拖放落点：已经是最终坐标，不再自动找空位 */
export interface AddAt {
  x: number
  y: number
}

interface LayoutState {
  version: number
  items: LayoutItem[]
}

/**
 * 布局版本。v4 补新组件；v5/v6/v7 调过生活卡尺寸；v8 定为时钟/日历 1×1；
 * v9 加回数字时钟；v10 按反馈把数字时钟定为一格、天气定为两格（2×1），
 * 完整的 2×2 天气仍可在编辑态一键切换、生活窗口里常驻。
 * 用版本号而不是「每次缺了就补」，是为了让用户手动移除的卡片不会被反复加回来。
 */
const VERSION = 10
/** 从旧版本升级时一次性补进桌面的新组件 */
const INTRODUCED_IN_V4: WidgetId[] = ['weather', 'calendar']
const INTRODUCED_IN_V9: WidgetId[] = ['clock-digital']
/** v8 里调整尺寸的组件 */
const RESIZED_IN_V8: WidgetId[] = ['weather', 'clock', 'calendar']
/** v10 里调整尺寸的组件 */
const RESIZED_IN_V10: WidgetId[] = ['clock-digital', 'weather']

export const WIDGET_DEFS: Record<WidgetId, WidgetDef> = {
  clock: {
    id: 'clock', name: '时钟', desc: '一格方卡里的表盘与秒针', category: '生活',
    size: 'small', sizes: ['small', 'medium', 'large', 'xl'],
  },
  'clock-digital': {
    id: 'clock-digital', name: '数字时钟', desc: '一格方卡里的大号数字时间', category: '生活',
    size: 'small', sizes: ['small', 'medium'],
  },
  weather: {
    id: 'weather', name: '天气', desc: '实时天气、逐小时与未来几天预报', category: '生活',
    size: 'medium', sizes: ['small', 'medium', 'large', 'xl'],
  },
  calendar: {
    id: 'calendar', name: '日历', desc: '今天的日期与农历', category: '生活',
    size: 'small', sizes: ['small', 'medium', 'large', 'xl'],
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
  { id: 'weather', size: 'medium' },
  { id: 'clock', size: 'small' },
  { id: 'clock-digital', size: 'small' },
  { id: 'calendar', size: 'small' },
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
 * 读取存档时允许的最大列数。这里**不是**当前屏幕的列数——宽屏 2560px/75% 缩放
 * 已经有 13 列，写死 12 会把最右一列的 x 从 12 夹回 11：拖过去松手后
 * `writePref` 同步广播，`load()` 再读一次就把坐标改小，表现为「右边那格拖不过去」。
 * 运行时的真实列数由容器宽度算，渲染层再按当前列数 clamp；存档只拦明显的脏数据。
 */
const STORED_COLUMNS = 64

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

/** 用像素边界算出来的右边界钳制，允许小数坐标落到最后一列之外的容器留白 */
function clampTo(x: number, max: number) {
  return Math.max(0, Math.min(x, Math.max(0, max)))
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
  // 不再夹到 columns-w：自由落点可以进最后一列右侧的留白
  return {
    id: item.id,
    x: clampTo(item.x, STORED_COLUMNS),
    y: Math.max(0, item.y),
    w,
    h,
  }
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
      return {
        x: clampTo(it.x, STORED_COLUMNS),
        y: Math.max(0, it.y),
        w,
        h,
      }
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
  version: VERSION,
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
      keepCoords && Number.isFinite(entry.x) && Number.isFinite(entry.y)
    picked.push({
      id,
      size,
      x: hasCoords ? clampTo(entry.x as number, STORED_COLUMNS) : -1,
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
      fits(occupied, { x: clampTo(item.x, STORED_COLUMNS), y: item.y, w, h })
    const spot = hasSpot
      ? { x: clampTo(item.x, STORED_COLUMNS), y: item.y }
      : firstFree(occupied, w, h, DEFAULT_COLUMNS)
    items.push({ ...item, ...spot })
    occupied.push({ ...spot, w, h })
  }
  return items
}

/** 老布局升级时追加新卡片：已有卡片的位置一个都不动，新卡片找第一个空位 */
function appendNewItems(items: LayoutItem[], ids: WidgetId[]): LayoutItem[] {
  let next = items
  for (const id of ids) {
    if (next.some((it) => it.id === id)) continue
    const def = WIDGET_DEFS[id]
    const { w, h } = gridOf(def.size, DEFAULT_COLUMNS)
    const spot = firstFree(occupiedOf(next, null, DEFAULT_COLUMNS), w, h, DEFAULT_COLUMNS)
    next = [...next, { id, size: def.size, ...spot }]
  }
  return next
}

/** 老布局升级到 v8：时钟/日历缩成小方块、天气放大，就近避开原有卡片 */
function upgradeToV8(items: LayoutItem[]): LayoutItem[] {
  let next = items
  for (const id of RESIZED_IN_V8) {
    if (!next.some((it) => it.id === id)) continue
    next = next.map((it) =>
      it.id === id ? { ...it, size: WIDGET_DEFS[id].size } : it,
    )
    next = settleItem(next, id, DEFAULT_COLUMNS)
  }
  return next
}

/** 老布局升级到 v10：数字时钟缩成一格、天气改成两格，就近避开原有卡片 */
function upgradeToV10(items: LayoutItem[]): LayoutItem[] {
  let next = items
  for (const id of RESIZED_IN_V10) {
    if (!next.some((it) => it.id === id)) continue
    next = next.map((it) => (it.id === id ? { ...it, size: WIDGET_DEFS[id].size } : it))
    next = settleItem(next, id, DEFAULT_COLUMNS)
  }
  return next
}

function normalizeState(raw: unknown): LayoutState {
  // v2/v3/v4：{ version, free?, items }
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const state = raw as { version?: unknown; free?: unknown; items?: unknown }
    // v2 的 free:false 代表「紧凑顺序」，升级后按数组顺序重新排；free:true 保留坐标
    const keepCoords = state.free !== false
    const items = sanitizeItems(state.items, keepCoords)
    if (items) {
      if (state.version === VERSION) return { version: VERSION, items }
      // v7 的布局已被 v8 彻底重排，直接落回新默认
      if (state.version === 7) return DEFAULT_STATE
      // v8 桌面只缺新加回来的数字时钟，其余位置保持不动
      if (state.version === 8) {
        return {
          version: VERSION,
          items: upgradeToV10(appendNewItems(items, INTRODUCED_IN_V9)),
        }
      }
      // v9 桌面已经有数字时钟，只改尺寸，不挪位置
      if (state.version === 9) {
        return { version: VERSION, items: upgradeToV10(items) }
      }
      return {
        version: VERSION,
        items: upgradeToV10(
          upgradeToV8(appendNewItems(items, [...INTRODUCED_IN_V4, ...INTRODUCED_IN_V9])),
        ),
      }
    }
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
    if (items) {
      return {
        version: VERSION,
        items: upgradeToV10(
          upgradeToV8(appendNewItems(items, [...INTRODUCED_IN_V4, ...INTRODUCED_IN_V9])),
        ),
      }
    }
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

  /** 「添加」按钮：没有落点，按默认顺序找第一个空位 */
  const add = useCallback(
    (id: WidgetId, size?: WidgetSize) => {
      update((prev) => {
        if (prev.items.some((it) => it.id === id)) return prev
        const def = WIDGET_DEFS[id]
        const chosen = size && def.sizes.includes(size) ? size : def.size
        const { w, h } = gridOf(chosen, DEFAULT_COLUMNS)
        const occupied = occupiedOf(prev.items, null, DEFAULT_COLUMNS)
        const spot = firstFree(occupied, w, h, DEFAULT_COLUMNS)
        return {
          version: VERSION,
          items: [...prev.items, { id, size: chosen, x: spot.x, y: spot.y }],
        }
      })
    },
    [update],
  )

  /**
   * 小组件中心拖放：坐标由 Desktop 算好（含吸附），原样落位，允许压住别的组件。
   * `maxX` 是按容器像素宽度算出的右边界，让组件能进最后一列右边的留白。
   */
  const addAt = useCallback(
    (id: WidgetId, size: WidgetSize, at: AddAt, maxX: number) => {
      update((prev) => {
        if (prev.items.some((it) => it.id === id)) return prev
        return {
          version: VERSION,
          items: [
            ...prev.items,
            { id, size, x: clampTo(at.x, maxX), y: Math.max(0, at.y) },
          ],
        }
      })
    },
    [update],
  )

  const remove = useCallback((id: WidgetId) => {
    update((prev) => ({ ...prev, items: prev.items.filter((it) => it.id !== id) }))
  }, [update])

  /**
   * 改尺寸时卡片尽量钉在原位，放不下的部分把周围卡片推开——手柄不从鼠标下跑掉。
   * 自由落点的小数坐标要保留，所以右边界用像素算出来的 `maxX`，不是列数。
   */
  const resizeAt = useCallback(
    (
      items: LayoutItem[],
      id: WidgetId,
      size: WidgetSize,
      columns: number,
      maxX = STORED_COLUMNS,
    ): LayoutItem[] => {
      const target = items.find((it) => it.id === id)
      if (!target) return items
      const { w, h } = gridOf(size, columns)
      const x = clampTo(target.x, maxX)
      const y = Math.max(0, target.y)
      const rect = { x, y, w, h }
      let next = items.map((it) => (it.id === id ? { ...it, size, x, y } : it))
      const hits = items
        .filter((it) => it.id !== id)
        .map((it) => rectOf(it, columns))
        .filter((other) => collides(other, rect))
        .sort(
          (a, b) =>
            Math.abs(a.x - x) + Math.abs(a.y - y) - (Math.abs(b.x - x) + Math.abs(b.y - y)),
        )
      for (const hit of hits) {
        const current = next.find((it) => it.id === hit.id)
        if (!current) continue
        if (!collides(rectOf(current, columns), rect)) continue
        next = settleItem(next, hit.id, columns)
      }
      return next
    },
    [],
  )

  const setSize = useCallback(
    (id: WidgetId, size: WidgetSize, columns = DEFAULT_COLUMNS, maxX = STORED_COLUMNS) => {
      update((prev) => {
        if (!WIDGET_DEFS[id].sizes.includes(size)) return prev
        return { version: VERSION, items: resizeAt(prev.items, id, size, columns, maxX) }
      })
    },
    [update, resizeAt],
  )

  /** 尺寸手柄：在该组件允许的尺寸里循环 */
  const cycleSize = useCallback(
    (id: WidgetId, columns = DEFAULT_COLUMNS, maxX = STORED_COLUMNS) => {
      update((prev) => {
        const item = prev.items.find((it) => it.id === id)
        if (!item) return prev
        const sizes = WIDGET_DEFS[id].sizes
        const next = sizes[(sizes.indexOf(item.size) + 1) % sizes.length]
        return { version: VERSION, items: resizeAt(prev.items, id, next, columns, maxX) }
      })
    },
    [update, resizeAt],
  )

  /**
   * 自由摆放：吸附与边缘吸附都在 Desktop 指针层算完，这里只做边界钳制并落盘。
   * 不推动、不重排其他组件——用户选的就是「松手在哪就在哪，允许重叠」。
   */
  const move = useCallback(
    (id: WidgetId, x: number, y: number, maxX: number) => {
      update((prev) => ({
        version: VERSION,
        items: prev.items.map((it) =>
          it.id === id ? { ...it, x: clampTo(x, maxX), y: Math.max(0, y) } : it,
        ),
      }))
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
    add, addAt, remove, setSize, cycleSize, move, reset, rest,
  }
}

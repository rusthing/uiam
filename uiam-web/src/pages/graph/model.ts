/**
 * 网关配置图的模型：把三张表摊成「监听器 → 路由 → 目标/后端」的节点与连线。
 *
 * ## 行是怎么排的
 *
 * 图用一张 CSS Grid 渲染，行由**路由**决定：一个监听器占 `max(路由数, 1)` 行，
 * 监听器节点跨这几行并垂直居中；组与组之间插一个空行当间隔。目标节点落在
 * 「第一条引用它的路由」那一行——同名的 LB 只画一个节点，后续路由的连线弯上去，
 * 于是「哪几条路由共用同一个 LB」在图上直接看得见。
 *
 * ## 为什么节点 key 用 balancerId 而不是名字
 *
 * 路由里引用的是 `to.name`，但名字可能指向一个不存在的 LB（发布会因此被拒）。
 * 这种情况下不能拿名字当 key——两个写错的名字会撞成同一个节点。所以：
 * 真实存在的 LB 用 `lb:{id}`，其余（Host / Static / 悬空引用）用 `x:{routeId}`。
 */
import { describeBalancer, shadowedBy, toShape } from '../../lib/format'
import type { Balancer, Listener, Route } from '../../lib/types'

export type Tone = 'neutral' | 'lb' | 'host' | 'static' | 'bad'

export interface Lane {
  listener: Listener
  routes: Route[]
  /** 该组第一行在 grid 里的行号（1 基） */
  startRow: number
  rowCount: number
}

export interface TargetSlot {
  key: string
  kind: 'lb' | 'host' | 'static' | 'bad'
  /** 第一条引用它的路由所在行，决定它画在哪一行 */
  row: number
  /** 代表路由：Host/Static 直接用它显示地址 */
  route: Route
  balancer?: Balancer
  backends: string[]
  /** 被几条路由引用（LB 去重后才需要知道） */
  refs: number
}

export interface Link {
  from: string
  to: string
  tone: Tone
}

export interface GraphModel {
  lanes: Lane[]
  targets: TargetSlot[]
  links: Link[]
  /** 总行数（含组间空行） */
  rows: number
}

const bySort = (a: Route, b: Route) => a.sortNo - b.sortNo || a.id.localeCompare(b.id)

export const listenerKey = (id: string) => `l:${id}`
export const routeKey = (id: string) => `r:${id}`
export const backendKey = (balancerId: string, index: number) => `b:${balancerId}:${index}`

/** 路由的匹配条件是否被上一条吃掉（只有同一监听器内才有意义） */
export function isShadowed(rows: Route[], index: number): boolean {
  const prev = index > 0 ? rows[index - 1] : undefined
  const route = rows[index]
  if (!prev || !route) return false
  if (!prev.enabled || !route.enabled) return false
  return shadowedBy(prev.matcherJson, route.matcherJson)
}

/** 目标摘要，卡片与属性栏共用 */
export function targetSummary(slot: TargetSlot): { title: string; sub: string } {
  const target = toShape(slot.route.toJson)
  switch (slot.kind) {
    case 'lb': {
      const info = slot.balancer ? describeBalancer(slot.balancer.configJson) : undefined
      return {
        title: `LB · ${slot.balancer?.name ?? '（未填名称）'}`,
        sub: `${info?.type ?? '?'} · ${slot.backends.length} 个后端${info?.algorithm ? ` · ${info.algorithm}` : ''}`,
      }
    }
    case 'host':
      return {
        title: `Host · ${target.addr || '（未填地址）'}`,
        sub: target.preserveHost ? '直连 · 透传原 Host' : '直连 · 改写 Host',
      }
    case 'static':
      return { title: 'Static · 本地文件', sub: target.spa ? 'SPA 回退 index.html' : '按路径找文件' }
    default: {
      if (target.type === 'LoadBalancer') {
        return { title: `LB · ${target.name || '（未填名称）'}`, sub: '库里没有这个 LB，发布会失败' }
      }
      return { title: target.type || '未配置目标', sub: 'to_json 解析不出 type，渲染会报错' }
    }
  }
}

export function buildGraph(
  listeners: Listener[],
  routes: Route[],
  balancers: Balancer[],
): GraphModel {
  const lbByName = new Map(balancers.map((b) => [b.name, b]))
  const lanes: Lane[] = []
  const targets: TargetSlot[] = []
  const byKey = new Map<string, TargetSlot>()
  const links: Link[] = []
  let row = 1

  listeners.forEach((listener, listenerIndex) => {
    const rows = routes.filter((r) => r.listenerId === listener.id).sort(bySort)
    const rowCount = Math.max(rows.length, 1)
    lanes.push({ listener, routes: rows, startRow: row, rowCount })

    rows.forEach((route, i) => {
      links.push({ from: listenerKey(listener.id), to: routeKey(route.id), tone: 'neutral' })

      const target = toShape(route.toJson)
      const lb = target.type === 'LoadBalancer' && target.name ? lbByName.get(target.name) : undefined
      let key: string
      let kind: TargetSlot['kind']
      if (target.type === 'LoadBalancer') {
        if (lb) {
          key = `lb:${lb.id}`
          kind = 'lb'
        } else {
          key = `x:${route.id}`
          kind = 'bad'
        }
      } else if (target.type === 'Host') {
        key = `x:${route.id}`
        kind = 'host'
      } else if (target.type === 'Static') {
        key = `x:${route.id}`
        kind = 'static'
      } else {
        key = `x:${route.id}`
        kind = 'bad'
      }

      const existing = byKey.get(key)
      if (existing) {
        existing.refs += 1
      } else {
        const slot: TargetSlot = {
          key,
          kind,
          row: row + i,
          route,
          balancer: lb,
          backends: lb ? describeBalancer(lb.configJson).backends : [],
          refs: 1,
        }
        byKey.set(key, slot)
        targets.push(slot)
      }
      links.push({ from: routeKey(route.id), to: key, tone: kind === 'bad' ? 'bad' : kind })
    })

    row += rowCount
    if (listenerIndex < listeners.length - 1) row += 1
  })

  // LB → 后端：只有 Array / DNS / SystemConfig 这类能列地址的才有后端节点
  for (const slot of targets) {
    if (slot.kind !== 'lb' || !slot.balancer) continue
    slot.backends.forEach((_, i) => {
      links.push({ from: slot.key, to: backendKey(slot.balancer!.id, i), tone: 'lb' })
    })
  }

  return { lanes, targets, links, rows: Math.max(row - 1, 1) }
}

/**
 * 网关配置图：监听器 → 路由 → 目标（LB / Host / Static）→ 后端，四列一条链路。
 *
 * ## 为什么用「测量 + SVG 曲线」而不是纯 CSS 连线
 *
 * 纯 CSS 只能画「同一行内」的直线。这里真正要表达的是**汇聚**：三条路由指向同一个
 * `adm-lb` 时，那个 LB 只该有一个节点，三条线弯上去汇到它——这正是「哪几条路由
 * 共用一个负载均衡器」这个问题的答案。所以节点按正常文档流排（高度自适应内容），
 * 连线的坐标在渲染后从 DOM 量出来，再用三次贝塞尔画。
 *
 * 测量在三种时机重跑：数据变化、容器尺寸变化（ResizeObserver）、字体加载完成
 * （`document.fonts.ready`，否则中文回退字体替换会让第一帧坐标偏掉）。
 *
 * ## 行怎么来的
 *
 * 一张 CSS Grid，行由路由决定，见 `model.ts`。监听器节点跨它那几行并垂直居中，
 * 目标节点落在第一条引用它的路由那一行。
 */
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { describeAddrs, describeMatcher } from '../../lib/format'
import type { Balancer, Listener, Route } from '../../lib/types'
import { IconAlert, IconPlus } from '../../components/icons'
import { Switch } from '../../components/Switch'
import { cx } from '../../components/ui'
import {
  backendKey,
  buildGraph,
  isShadowed,
  listenerKey,
  routeKey,
  targetSummary,
  type Lane,
  type TargetSlot,
  type Tone,
} from './model'

export type Selection =
  | { kind: 'listener'; id: string }
  | { kind: 'route'; id: string }
  | { kind: 'balancer'; id: string }
  | { kind: 'backend'; balancerId: string; index: number }

interface Box {
  x: number
  y: number
  w: number
  h: number
}

function Card({
  nodeKey,
  selected,
  onClick,
  className,
  children,
}: {
  nodeKey: string
  selected: boolean
  onClick?: () => void
  className?: string
  children: React.ReactNode
}) {
  return (
    <div
      data-node={nodeKey}
      className={cx('gnode', className, selected && 'on')}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onClick()
              }
            }
          : undefined
      }
    >
      {children}
    </div>
  )
}

/* ---------------------------------------------------------------- 各类节点 */

function ListenerNode({
  lane,
  selected,
  onSelect,
  onToggle,
}: {
  lane: Lane
  selected: boolean
  onSelect: () => void
  onToggle: () => void
}) {
  const { listener } = lane
  const addrs = describeAddrs(listener.addrsJson)
  return (
    <Card
      nodeKey={listenerKey(listener.id)}
      selected={selected}
      onClick={onSelect}
      className={cx('gnode-listener', !listener.enabled && 'off')}
    >
      <div className="gnode-h">
        <span className={cx('gnode-kind', listener.kind === 1 ? 'http' : 'tcp')}>
          {listener.kind === 1 ? 'HTTP' : 'TCP'}
        </span>
        <span className="gnode-n">{lane.routes.length} 条</span>
        <Switch on={listener.enabled} onChange={onToggle} label="启用监听器" />
      </div>
      <div className="gnode-addrs mono">{addrs.join('\n') || '未配置地址'}</div>
      {listener.remark && <div className="gnode-sub">{listener.remark}</div>}
    </Card>
  )
}

function RouteNode({
  route,
  index,
  shadowed,
  selected,
  onSelect,
  onToggle,
}: {
  route: Route
  index: number
  shadowed: boolean
  selected: boolean
  onSelect: () => void
  onToggle: () => void
}) {
  return (
    <Card
      nodeKey={routeKey(route.id)}
      selected={selected}
      onClick={onSelect}
      className={cx('gnode-route', !route.enabled && 'off', shadowed && 'warn')}
    >
      <div className="gnode-h">
        <span className="gnode-num">{index + 1}</span>
        <span className="gnode-title">{route.name}</span>
        {shadowed && (
          <span className="gnode-flag" title="上一条前缀已覆盖这个路径，永远命中不到">
            <IconAlert size={11} />
          </span>
        )}
        <Switch on={route.enabled} onChange={onToggle} label="启用路由" />
      </div>
      <div className="gnode-m mono">{describeMatcher(route.matcherJson)}</div>
    </Card>
  )
}

function TargetNode({
  slot,
  selected,
  onSelect,
  onToggle,
}: {
  slot: TargetSlot
  selected: boolean
  onSelect: () => void
  onToggle: () => void
}) {
  const { title, sub } = targetSummary(slot)
  const isEntity = slot.kind === 'lb' && slot.balancer
  return (
    <Card
      nodeKey={slot.key}
      selected={selected}
      onClick={onSelect}
      className={cx('gnode-target', slot.kind, slot.balancer && !slot.balancer.enabled && 'off')}
    >
      <div className="gnode-h">
        <span className="gnode-title">{title}</span>
        {isEntity ? (
          <Switch
            on={Boolean(slot.balancer?.enabled)}
            onChange={onToggle}
            label="启用负载均衡器"
          />
        ) : (
          <span className="gnode-flag mute" title="它是路由的转发目标，启停由所在路由决定">
            随路由
          </span>
        )}
      </div>
      <div className="gnode-m">{sub}</div>
      {slot.kind === 'lb' && slot.refs > 1 && (
        <div className="gnode-sub">{slot.refs} 条路由共用</div>
      )}
    </Card>
  )
}

function BackendNode({
  balancerId,
  index,
  addr,
  selected,
  onSelect,
}: {
  balancerId: string
  index: number
  addr: string
  selected: boolean
  onSelect: () => void
}) {
  return (
    <Card
      nodeKey={backendKey(balancerId, index)}
      selected={selected}
      onClick={onSelect}
      className="gnode-backend"
    >
      <span className="gnode-dot" />
      <span className="mono">{addr}</span>
    </Card>
  )
}

/* ---------------------------------------------------------------- 主体 */

export function GatewayGraph({
  listeners,
  routes,
  balancers,
  selected,
  onSelect,
  onToggleListener,
  onToggleRoute,
  onToggleBalancer,
  onAddRoute,
  onAddListener,
  onAddBalancer,
}: {
  listeners: Listener[]
  routes: Route[]
  balancers: Balancer[]
  selected: Selection | null
  onSelect: (sel: Selection | null) => void
  onToggleListener: (listener: Listener) => void
  onToggleRoute: (route: Route) => void
  onToggleBalancer: (balancer: Balancer) => void
  onAddRoute: (listenerId: string) => void
  onAddListener: () => void
  onAddBalancer: () => void
}) {
  const model = useMemo(() => buildGraph(listeners, routes, balancers), [listeners, routes, balancers])
  const wrapRef = useRef<HTMLDivElement>(null)
  const [boxes, setBoxes] = useState<Record<string, Box>>({})
  const [size, setSize] = useState({ w: 0, h: 0 })

  const measure = useCallback(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    const base = wrap.getBoundingClientRect()
    const next: Record<string, Box> = {}
    wrap.querySelectorAll<HTMLElement>('[data-node]').forEach((el) => {
      const r = el.getBoundingClientRect()
      next[el.dataset.node as string] = {
        x: r.left - base.left,
        y: r.top - base.top,
        w: r.width,
        h: r.height,
      }
    })
    setBoxes(next)
    setSize({ w: wrap.scrollWidth, h: wrap.scrollHeight })
  }, [])

  useLayoutEffect(() => {
    measure()
    const wrap = wrapRef.current
    const id = requestAnimationFrame(measure)
    const ro = wrap ? new ResizeObserver(measure) : undefined
    if (wrap && ro) ro.observe(wrap)
    void document.fonts?.ready.then(() => measure())
    return () => {
      cancelAnimationFrame(id)
      ro?.disconnect()
    }
  }, [measure, model])

  const edges = useMemo(() => {
    return model.links.flatMap((link) => {
      const a = boxes[link.from]
      const b = boxes[link.to]
      if (!a || !b) return []
      const x1 = a.x + a.w
      const y1 = a.y + a.h / 2
      const x2 = b.x
      const y2 = b.y + b.h / 2
      const dx = Math.max(18, Math.abs(x2 - x1) / 2)
      return [
        {
          key: `${link.from}->${link.to}`,
          tone: link.tone,
          d: `M${x1} ${y1} C${x1 + dx} ${y1} ${x2 - dx} ${y2} ${x2} ${y2}`,
        },
      ]
    })
  }, [model, boxes])

  const isSelected = (sel: Selection) => {
    if (!selected || selected.kind !== sel.kind) return false
    if (sel.kind === 'backend' && selected.kind === 'backend') {
      return selected.balancerId === sel.balancerId && selected.index === sel.index
    }
    return 'id' in selected && 'id' in sel && selected.id === sel.id
  }

  return (
    <div className="gg">
      <div className="gg-head">
        <div className="gg-h">
          <span>监听器</span>
          <button className="gg-h-add" onClick={onAddListener} title="新建监听器">
            <IconPlus size={11} />
          </button>
        </div>
        <div className="gg-h">
          <span>路由 · 按顺序匹配，命中即停</span>
        </div>
        <div className="gg-h">
          <span>目标</span>
          <button className="gg-h-add" onClick={onAddBalancer} title="新建负载均衡器">
            <IconPlus size={11} />
          </button>
        </div>
        <div className="gg-h">
          <span>后端</span>
        </div>
      </div>

      <div className="gg-wrap" ref={wrapRef} onClick={() => onSelect(null)}>
        <svg className="gg-edges" width={size.w} height={size.h} aria-hidden="true">
          <defs>
            {(['neutral', 'lb', 'host', 'static', 'bad'] as Tone[]).map((tone) => (
              <marker
                key={tone}
                id={`gg-arrow-${tone}`}
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M1.5 1.5 8.5 5 1.5 8.5Z" className={cx('gg-arrow', tone)} />
              </marker>
            ))}
          </defs>
          {edges.map((edge) => (
            <path
              key={edge.key}
              d={edge.d}
              className={cx('gg-edge', edge.tone)}
              markerEnd={`url(#gg-arrow-${edge.tone})`}
            />
          ))}
        </svg>

        <div
          className="gg-grid"
          style={{ gridTemplateRows: `repeat(${model.rows}, auto)` }}
        >
          {model.lanes.map((lane, laneIndex) => {
            const shadowedRows = lane.routes.map((_, i) => isShadowed(lane.routes, i))
            return (
              <div key={lane.listener.id} className="gg-lane-slot" style={{ display: 'contents' }}>
                <div
                  className="gg-cell gg-cell-listener"
                  style={{ gridRow: `${lane.startRow} / span ${lane.rowCount}`, gridColumn: 1 }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <ListenerNode
                    lane={lane}
                    selected={isSelected({ kind: 'listener', id: lane.listener.id })}
                    onSelect={() => onSelect({ kind: 'listener', id: lane.listener.id })}
                    onToggle={() => onToggleListener(lane.listener)}
                  />
                </div>

                {lane.routes.length === 0 && (
                  <div
                    className="gg-empty"
                    style={{ gridRow: lane.startRow, gridColumn: 2 }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    还没有路由，点左侧监听器出线上的「+」新建
                  </div>
                )}

                {lane.routes.map((route, i) => (
                  <div
                    key={route.id}
                    className="gg-cell"
                    style={{ gridRow: lane.startRow + i, gridColumn: 2 }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <RouteNode
                      route={route}
                      index={i}
                      shadowed={shadowedRows[i]}
                      selected={isSelected({ kind: 'route', id: route.id })}
                      onSelect={() => onSelect({ kind: 'route', id: route.id })}
                      onToggle={() => onToggleRoute(route)}
                    />
                  </div>
                ))}

                {laneIndex < model.lanes.length - 1 && (
                  <div
                    className="gg-spacer"
                    style={{ gridRow: lane.startRow + lane.rowCount, gridColumn: '1 / -1' }}
                  />
                )}
              </div>
            )
          })}

          {model.targets.map((slot) => (
            <div
              key={slot.key}
              className="gg-cell"
              style={{ gridRow: slot.row, gridColumn: 3 }}
              onClick={(e) => e.stopPropagation()}
            >
              <TargetNode
                slot={slot}
                selected={isSelected(
                  slot.kind === 'lb' && slot.balancer
                    ? { kind: 'balancer', id: slot.balancer.id }
                    : { kind: 'route', id: slot.route.id },
                )}
                onSelect={() =>
                  onSelect(
                    slot.kind === 'lb' && slot.balancer
                      ? { kind: 'balancer', id: slot.balancer.id }
                      : { kind: 'route', id: slot.route.id },
                  )
                }
                onToggle={() => slot.balancer && onToggleBalancer(slot.balancer)}
              />
            </div>
          ))}

          {model.targets.map((slot) =>
            slot.kind === 'lb' && slot.balancer && slot.backends.length > 0 ? (
              <div
                key={`be-${slot.key}`}
                className="gg-cell gg-backends"
                style={{ gridRow: slot.row, gridColumn: 4 }}
                onClick={(e) => e.stopPropagation()}
              >
                {slot.backends.map((addr, i) => (
                  <BackendNode
                    key={addr + i}
                    balancerId={slot.balancer!.id}
                    index={i}
                    addr={addr}
                    selected={isSelected({
                      kind: 'backend',
                      balancerId: slot.balancer!.id,
                      index: i,
                    })}
                    onSelect={() =>
                      onSelect({ kind: 'backend', balancerId: slot.balancer!.id, index: i })
                    }
                  />
                ))}
              </div>
            ) : null,
          )}
        </div>

        {/* 「+」长在监听器出线的节点上：它是「这个监听器下再加一条路由」的最短路径 */}
        {model.lanes.map((lane) => {
          const box = boxes[listenerKey(lane.listener.id)]
          if (!box) return null
          return (
            <button
              key={`add-${lane.listener.id}`}
              className="gg-add"
              style={{ left: box.x + box.w + 9, top: box.y + box.h / 2 - 9 }}
              title="在该监听器下新建路由"
              onClick={(e) => {
                e.stopPropagation()
                onAddRoute(lane.listener.id)
              }}
            >
              <IconPlus size={11} />
            </button>
          )
        })}
      </div>
    </div>
  )
}

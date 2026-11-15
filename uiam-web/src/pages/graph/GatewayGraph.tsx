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
 *
 * ## 谁在滚
 *
 * `.gg-scroll` 是**唯一**的滚动容器（横竖都它滚），题头 `sticky top` 钉住。上一版把
 * 横向滚动放在外层 `.cfg-canvas`，而 `overflow-x: auto` 会让同一元素在纵向上也变成
 * 滚动容器，于是题头的 sticky 参照物成了「一个永远不纵向滚动的盒子」——看起来就是
 * 「题头跟着一起滚走了」。滚动收进这里之后，sticky 才有一个真的会滚的参照物。
 *
 * ## 缩放为什么用 zoom 而不是 transform
 *
 * `transform: scale()` 不改变布局尺寸，滚动条范围会跟视觉尺寸对不上，得再拿一层
 * 撑高的 stage 去补，而且 `getBoundingClientRect` 与 `scrollWidth` 会开始互相打架。
 * `zoom` 是**布局级**缩放：滚动范围、sticky、文本排版全部跟着变，代价只是量出来的
 * 坐标要多除一次缩放系数（见 `measure`）。
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  describeAddrs,
  describeBalancer,
  describeMatcher,
  listenerTlsCount,
  parseJson,
  routeFlags,
  unknownUriKeys,
} from '../../lib/format'
import type { Balancer, Gateway, Listener, Route } from '../../lib/types'
import {
  IconAlert,
  IconEdit,
  IconFit,
  IconLink,
  IconMap,
  IconMinus,
  IconPlus,
  IconTrash,
} from '../../components/icons'
import { Switch } from '../../components/Switch'
import { cx } from '../../components/ui'
import type { GlobalKey } from './global'
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
  | { kind: 'global'; key: GlobalKey }

interface Box {
  x: number
  y: number
  w: number
  h: number
}

const ZOOM_MIN = 0.4
const ZOOM_MAX = 1.8
const clampZoom = (k: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(k * 100) / 100))

function Card({
  nodeKey,
  selected,
  onClick,
  className,
  actions,
  children,
}: {
  nodeKey: string
  selected: boolean
  onClick?: () => void
  className?: string
  /** 卡片右上角悬浮操作栏：编辑 / 加目标 / 删除。**操作在卡片上，不在属性栏里** */
  actions?: React.ReactNode
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
      {actions && <span className="gnode-acts">{actions}</span>}
      {children}
    </div>
  )
}

function Act({
  title,
  onClick,
  danger,
  children,
}: {
  title: string
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void
  danger?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      className={cx('gnode-act', danger && 'danger')}
      title={title}
      aria-label={title}
      onClick={(e) => {
        e.stopPropagation()
        onClick(e)
      }}
    >
      {children}
    </button>
  )
}

/* ---------------------------------------------------------------- 各类节点 */

function ListenerNode({
  lane,
  selected,
  onSelect,
  onToggle,
  onEdit,
  onDelete,
}: {
  lane: Lane
  selected: boolean
  onSelect: () => void
  onToggle: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const { listener } = lane
  const addrs = describeAddrs(listener.addrsJson)
  const tlsCount = listenerTlsCount(listener.addrsJson)
  return (
    <Card
      nodeKey={listenerKey(listener.id)}
      selected={selected}
      onClick={onSelect}
      className={cx('gnode-listener', !listener.enabled && 'off')}
      actions={
        <>
          <Act title="编辑监听器" onClick={onEdit}>
            <IconEdit size={11} />
          </Act>
          <Act title="删除监听器" onClick={onDelete} danger>
            <IconTrash size={11} />
          </Act>
        </>
      }
    >
      <div className="gnode-h">
        <span className={cx('gnode-kind', listener.kind === 1 ? 'http' : 'tcp')}>
          {listener.kind === 1 ? 'HTTP' : 'TCP'}
        </span>
        {tlsCount > 0 && (
          <span className="gnode-tag tls" title={`${tlsCount} 个地址绑了 TLS 证书`}>
            TLS ×{tlsCount}
          </span>
        )}
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
  onEdit,
  onDelete,
  onAddTarget,
}: {
  route: Route
  index: number
  shadowed: boolean
  selected: boolean
  onSelect: () => void
  onToggle: () => void
  onEdit: () => void
  onDelete: () => void
  onAddTarget: (at: { x: number; y: number }) => void
}) {
  const flags = routeFlags(route.toJson, route.logJson)
  const ignored = unknownUriKeys(route.toJson)
  return (
    <Card
      nodeKey={routeKey(route.id)}
      selected={selected}
      onClick={onSelect}
      className={cx('gnode-route', !route.enabled && 'off', shadowed && 'warn')}
      actions={
        <>
          <Act title="编辑路由" onClick={onEdit}>
            <IconEdit size={11} />
          </Act>
          <Act
            title="新建目标 / 连到已有目标"
            onClick={(e) => {
              const box = e.currentTarget.getBoundingClientRect()
              onAddTarget({ x: box.right + 6, y: box.top })
            }}
          >
            <IconLink size={11} />
          </Act>
          <Act title="删除路由" onClick={onDelete} danger>
            <IconTrash size={11} />
          </Act>
        </>
      }
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
      {(flags.length > 0 || ignored.length > 0) && (
        <div className="gnode-tags">
          {flags.map((f) => (
            <span key={f} className="gnode-tag" title="转发时的行为，偏离了 gatex 默认值">
              {f}
            </span>
          ))}
          {ignored.length > 0 && (
            <span
              className="gnode-tag bad"
              title="uri 里这些键 gatex 不认识，渲染时会被静默丢掉"
            >
              忽略 {ignored.join(', ')}
            </span>
          )}
        </div>
      )}
    </Card>
  )
}

function TargetNode({
  slot,
  selected,
  onSelect,
  onToggle,
  onEdit,
  onDelete,
  staticRoot,
}: {
  slot: TargetSlot
  selected: boolean
  onSelect: () => void
  onToggle: () => void
  onEdit: () => void
  onDelete?: () => void
  staticRoot?: string
}) {
  const { title, sub } = targetSummary(slot)
  const isEntity = slot.kind === 'lb' && slot.balancer
  const info = slot.balancer ? describeBalancer(slot.balancer.configJson) : undefined
  const hc = info?.healthCheck
  return (
    <Card
      nodeKey={slot.key}
      selected={selected}
      onClick={onSelect}
      className={cx('gnode-target', slot.kind, slot.balancer && !slot.balancer.enabled && 'off')}
      actions={
        <>
          <Act title={isEntity ? '编辑负载均衡器' : '编辑这条路由的转发目标'} onClick={onEdit}>
            <IconEdit size={11} />
          </Act>
          {onDelete && (
            <Act title="删除负载均衡器" onClick={onDelete} danger>
              <IconTrash size={11} />
            </Act>
          )}
        </>
      }
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
      {slot.kind === 'lb' && hc && (
        <div className="gnode-m">
          {hc.configured
            ? `健康检查 ${hc.kind ?? '?'} · ${hc.frequency ?? '—'}`
            : '健康检查 · 渲染默认'}
          {info?.updateFrequency ? ` · ${info.updateFrequency} 更新` : ''}
        </div>
      )}
      {slot.kind === 'static' && staticRoot && <div className="gnode-m mono">{staticRoot}</div>}
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
  onEdit,
}: {
  balancerId: string
  index: number
  addr: string
  selected: boolean
  onSelect: () => void
  onEdit: () => void
}) {
  return (
    <Card
      nodeKey={backendKey(balancerId, index)}
      selected={selected}
      onClick={onSelect}
      className="gnode-backend"
      actions={
        <Act title="编辑所属负载均衡器" onClick={onEdit}>
          <IconEdit size={11} />
        </Act>
      }
    >
      <span className="gnode-dot" />
      <span className="mono">{addr}</span>
    </Card>
  )
}

/* ---------------------------------------------------------------- 预览图 */

const MAP_W = 156
const MAP_H = 104

function mapTone(key: string): string {
  if (key.startsWith('l:')) return 'l'
  if (key.startsWith('r:')) return 'r'
  if (key.startsWith('lb:')) return 'lb'
  if (key.startsWith('x:')) return 'x'
  return 'b'
}

/**
 * 预览图：整张图缩成一张小地图，蓝框 = 当前看得见的范围。
 *
 * 图一旦长起来（20 条路由就两屏），「我在哪、右边还有什么」靠滚动条是看不出来的。
 * 点小地图任意位置直接跳过去，比拖滚动条快。
 */
function Minimap({
  boxes,
  size,
  view,
  scroll,
  zoom,
  onJump,
  onHide,
}: {
  boxes: Record<string, Box>
  size: { w: number; h: number }
  view: { w: number; h: number }
  scroll: { left: number; top: number }
  zoom: number
  onJump: (left: number, top: number) => void
  onHide: () => void
}) {
  const s = size.w > 0 && size.h > 0 ? Math.min(MAP_W / size.w, MAP_H / size.h) : 0
  if (s <= 0) return null
  const mw = Math.max(24, size.w * s)
  const mh = Math.max(18, size.h * s)
  const entries = Object.entries(boxes)

  const jump = (e: React.MouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const cx = ((e.clientX - r.left) / s) * zoom
    const cy = ((e.clientY - r.top) / s) * zoom
    onJump(cx - view.w / 2, cy - view.h / 2)
  }

  return (
    <div className="gg-map" title="点一下跳到那里">
      <button className="gg-map-x" onClick={onHide} title="收起预览图" aria-label="收起预览图">
        ×
      </button>
      <svg width={mw} height={mh} onClick={jump} role="presentation">
        {entries.map(([key, b]) => (
          <rect
            key={key}
            x={b.x * s}
            y={b.y * s}
            width={Math.max(1.5, b.w * s)}
            height={Math.max(1.5, b.h * s)}
            rx={1}
            className={cx('gg-map-n', mapTone(key))}
          />
        ))}
        <rect
          className="gg-map-vp"
          x={(scroll.left / zoom) * s}
          y={(scroll.top / zoom) * s}
          width={Math.max(6, (view.w / zoom) * s)}
          height={Math.max(6, (view.h / zoom) * s)}
          rx={1.5}
        />
      </svg>
    </div>
  )
}

/* ---------------------------------------------------------------- 主体 */

export function GatewayGraph({
  gateway,
  listeners,
  routes,
  balancers,
  selected,
  onSelect,
  onToggleListener,
  onToggleRoute,
  onToggleBalancer,
  onEdit,
  onDelete,
  onAddRoute,
  onAddListener,
  onAddBalancer,
  onAddTarget,
}: {
  gateway: Gateway
  listeners: Listener[]
  routes: Route[]
  balancers: Balancer[]
  selected: Selection | null
  onSelect: (sel: Selection | null) => void
  onToggleListener: (listener: Listener) => void
  onToggleRoute: (route: Route) => void
  onToggleBalancer: (balancer: Balancer) => void
  onEdit: (sel: Selection) => void
  onDelete: (sel: Selection) => void
  onAddRoute: (listenerId: string) => void
  onAddListener: () => void
  onAddBalancer: () => void
  /** 从路由卡片给这条路由新建 / 连一个目标；`at` 是弹出面板的锚点（视口坐标） */
  onAddTarget: (route: Route, at: { x: number; y: number }) => void
}) {
  const model = useMemo(() => buildGraph(listeners, routes, balancers), [listeners, routes, balancers])
  const staticRoot = useMemo(() => {
    const d = parseJson(gateway.staticJson)
    if (!d || typeof d !== 'object' || Array.isArray(d)) return ''
    return String((d as Record<string, unknown>)['root-dir'] ?? '')
  }, [gateway.staticJson])

  const scrollRef = useRef<HTMLDivElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const zoomRef = useRef(1)
  const rafRef = useRef(0)

  const [boxes, setBoxes] = useState<Record<string, Box>>({})
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [view, setView] = useState({ w: 0, h: 0 })
  const [scroll, setScroll] = useState({ left: 0, top: 0 })
  const [zoom, setZoom] = useState(1)
  const [mapOpen, setMapOpen] = useState(true)

  const measure = useCallback(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    const k = zoomRef.current
    const base = wrap.getBoundingClientRect()
    const next: Record<string, Box> = {}
    let maxX = 0
    let maxY = 0
    wrap.querySelectorAll<HTMLElement>('[data-node]').forEach((el) => {
      const r = el.getBoundingClientRect()
      // zoom 是布局级缩放，rect 已经是放大后的值；除以系数换回布局坐标，
      // 否则缩到 50% 时连线会全部往左上角缩
      const box: Box = {
        x: (r.left - base.left) / k,
        y: (r.top - base.top) / k,
        w: r.width / k,
        h: r.height / k,
      }
      next[el.dataset.node as string] = box
      maxX = Math.max(maxX, box.x + box.w)
      maxY = Math.max(maxY, box.y + box.h)
    })
    setBoxes(next)
    // 画布尺寸从节点反推，不读 scrollWidth：它受 zoom 与外层 padding 影响，
    // 反推出来的值在任何缩放下都是同一份。不加余量——SVG 是绝对定位的，
    // 多给 1px 就是白白多出一条横向滚动条
    setSize({ w: maxX + 1, h: maxY + 1 })
  }, [])

  const measureView = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    setView({ w: el.clientWidth, h: el.clientHeight })
  }, [])

  useLayoutEffect(() => {
    measure()
    measureView()
    const id = requestAnimationFrame(() => {
      measure()
      measureView()
    })
    const wrap = wrapRef.current
    const el = scrollRef.current
    const ro = new ResizeObserver(measure)
    const roView = new ResizeObserver(measureView)
    if (wrap) ro.observe(wrap)
    if (el) roView.observe(el)
    void document.fonts?.ready.then(() => measure())
    return () => {
      cancelAnimationFrame(id)
      ro.disconnect()
      roView.disconnect()
    }
  }, [measure, measureView, model])

  // zoom 不改变元素自身的布局尺寸，ResizeObserver 不会响，得自己重算一次
  useLayoutEffect(() => {
    zoomRef.current = zoom
    measure()
    measureView()
  }, [zoom, measure, measureView])

  useEffect(() => () => cancelAnimationFrame(rafRef.current), [])

  const onScroll = useCallback(() => {
    if (rafRef.current) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0
      const el = scrollRef.current
      if (el) setScroll({ left: el.scrollLeft, top: el.scrollTop })
    })
  }, [])

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

  const fit = () => {
    const el = scrollRef.current
    if (!el || !size.w) return
    // 只缩不放：内容本来就装得下时「适应」就该是 100%
    setZoom(clampZoom(Math.min(1, el.clientWidth / size.w)))
  }

  const jump = (left: number, top: number) => {
    scrollRef.current?.scrollTo({ left, top, behavior: 'smooth' })
  }

  return (
    <div className="gg">
      <div className="gg-scroll" ref={scrollRef} onScroll={onScroll} onClick={() => onSelect(null)}>
        {/* 缩放必须作用在一个**宽度固定**的 stage 上：直接 zoom 那个流式网格，
            1fr 列会把缩小省下来的宽度吃掉，看起来就是「字变小了、图一点没缩」。
            这里 stage 的宽度取容器宽度（布局 px，不随缩放变），里面的网格再按 100%
            铺满它，于是 zoom 缩放的是整块内容，横向滚动范围也跟着变。 */}
        <div className="gg-stage" style={{ zoom, width: view.w || undefined }}>
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

          <div className="gg-wrap" ref={wrapRef}>
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
                <g key={edge.key}>
                  <path
                    d={edge.d}
                    className={cx('gg-edge', edge.tone)}
                    markerEnd={`url(#gg-arrow-${edge.tone})`}
                  />
                  {/* 第二层是流动的短划：方向感靠它，箭头只负责「到哪」 */}
                  <path d={edge.d} className={cx('gg-flow', edge.tone)} />
                </g>
              ))}
            </svg>

            <div className="gg-grid" style={{ gridTemplateRows: `repeat(${model.rows}, auto)` }}>
              {model.lanes.map((lane, laneIndex) => {
                const shadowedRows = lane.routes.map((_, i) => isShadowed(lane.routes, i))
                return (
                  <div
                    key={lane.listener.id}
                    className="gg-lane-slot"
                    style={{ display: 'contents' }}
                  >
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
                        onEdit={() => onEdit({ kind: 'listener', id: lane.listener.id })}
                        onDelete={() => onDelete({ kind: 'listener', id: lane.listener.id })}
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
                          onEdit={() => onEdit({ kind: 'route', id: route.id })}
                          onDelete={() => onDelete({ kind: 'route', id: route.id })}
                          onAddTarget={(at) => onAddTarget(route, at)}
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
                    onEdit={() =>
                      onEdit(
                        slot.kind === 'lb' && slot.balancer
                          ? { kind: 'balancer', id: slot.balancer.id }
                          : { kind: 'route', id: slot.route.id },
                      )
                    }
                    onDelete={
                      slot.kind === 'lb' && slot.balancer
                        ? () => onDelete({ kind: 'balancer', id: slot.balancer!.id })
                        : undefined
                    }
                    staticRoot={staticRoot}
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
                        onEdit={() => onEdit({ kind: 'balancer', id: slot.balancer!.id })}
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
      </div>

      <div className="gg-dock">
        {mapOpen && (
          <Minimap
            boxes={boxes}
            size={size}
            view={view}
            scroll={scroll}
            zoom={zoom}
            onJump={jump}
            onHide={() => setMapOpen(false)}
          />
        )}
        <div className="gg-zoomctl">
          <button onClick={() => setZoom((k) => clampZoom(k - 0.1))} title="缩小">
            <IconMinus size={11} />
          </button>
          <button className="pct" onClick={() => setZoom(1)} title="回到 100%">
            {Math.round(zoom * 100)}%
          </button>
          <button onClick={() => setZoom((k) => clampZoom(k + 0.1))} title="放大">
            <IconPlus size={11} />
          </button>
          <span className="sep" />
          <button onClick={fit} title="缩到能看见整张图">
            <IconFit size={11} />
          </button>
          <button
            className={cx(mapOpen && 'on')}
            onClick={() => setMapOpen((v) => !v)}
            title={mapOpen ? '收起预览图' : '展开预览图'}
          >
            <IconMap size={11} />
          </button>
        </div>
      </div>
    </div>
  )
}

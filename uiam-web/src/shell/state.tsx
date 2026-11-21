/**
 * 桌面外壳的状态：开着的窗口、焦点、Dock 固定项与临时栏、编辑态、启动台。
 *
 * 为什么不用 react-router：这一版是一个**桌面**，不是文档站。窗口的开/关/最小化
 * 是内存状态（关掉就没了），URL 里塞不下「三个窗口叠在一起、哪个在最上面」这种
 * 信息；硬塞进去只会让地址栏和屏幕对不上。真正需要可分享的是「哪个实例的哪个标签」，
 * 那属于窗口内部状态，由网关窗口自己记。
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { APP_MAP, DEFAULT_PINNED } from '../apps/meta'

export interface WinState {
  id: string
  x: number
  y: number
  w: number
  h: number
  min: boolean
  max: boolean
  z: number
  /**
   * 退场相位：`closing` / `minimizing`。
   *
   * 窗口不是「点了就消失」：先在屏幕上把 CSS 动画演完，定时器到点才真正卸载
   * （close）或落到 `min` 被 `display:none` 藏起来（minimize）。入场不占这个字段——
   * `.window.open` 常驻一条 `winIn`，挂载和被还原时浏览器都会重放一次。
   */
  anim?: 'closing' | 'minimizing'
}

/**
 * 临时栏的一项：开着但没固定的应用，或者最近关掉、还留在栏里的应用。
 * `closedAt` 是关闭序号，只为「超过 3 个时挤掉最早关的那个」排序用；开着时为 null。
 */
export interface TempDockItem {
  id: string
  closedAt: number | null
}

/** 临时栏最多留住几个「已经关掉」的应用 */
const TEMP_KEEP = 3

interface ShellApi {
  wins: WinState[]
  focusId: string | null
  /** 子应用回报的动态标题；没有回报时窗口沿用 APP_MAP 里的名字 */
  titles: Record<string, string>
  setWinTitle: (id: string, title: string) => void
  /** 每个应用本次打开时希望落在的初始路由；不填用 meta 里的 route */
  routes: Record<string, string>
  openApp: (id: string, route?: string) => void
  closeWin: (id: string) => void
  minimizeWin: (id: string) => void
  /** 回到桌面：把所有开着的窗口收起来，再点一次还原（Dock 上的「回到桌面」） */
  toggleDesktop: () => void
  toggleMax: (id: string) => void
  focusWin: (id: string) => void
  moveWin: (id: string, x: number, y: number) => void
  resizeWin: (id: string, geo: { x: number; y: number; w: number; h: number }) => void
  pinned: string[]
  togglePin: (id: string) => void
  /** 拖拽重排固定栏：把 `id` 挪到第 `to` 位（越界会被 clamp） */
  movePin: (id: string, to: number) => void
  /** 临时栏：开着但没固定的 + 最近关掉还没被挤掉的，按进栏顺序排 */
  temp: TempDockItem[]
  editing: boolean
  setEditing: (v: boolean) => void
  launchpad: boolean
  setLaunchpad: (v: boolean) => void
}

const ShellContext = createContext<ShellApi | null>(null)

const PIN_KEY = 'uiam-dock-pinned'
const GEO_KEY = 'uiam-win-geo'

/** 和 `Window.tsx` 里的下限保持一致，否则存下来的值再读回来会被这里放大/缩小一次 */
const MIN_W = 460
const MIN_H = 280
const MIN_Y = 26

/** 和 index.css 里 winOut / winMin 的时长对齐，多留一帧再收尾 */
const CLOSE_MS = 190
const MINIMIZE_MS = 200

type Geo = { x: number; y: number; w: number; h: number }

function loadPinned(): string[] {
  try {
    const raw = localStorage.getItem(PIN_KEY)
    if (raw) {
      const arr = JSON.parse(raw)
      if (Array.isArray(arr)) return arr.filter((id) => typeof id === 'string' && APP_MAP[id])
    }
  } catch {
    // 隐私模式 / 脏数据：退回默认值即可，不值得打断启动
  }
  return DEFAULT_PINNED
}

/**
 * 每个应用上次关掉时的窗口几何。
 *
 * 只记「用户亲手调过」的：拖标题栏、拖把手。最大化 / 最小化不参与——它们的
 * `w/h` 本来就没变（`.window.max` 是 CSS 铺满，不动 state），记下来反而是对的。
 */
function loadGeo(): Record<string, Geo> {
  try {
    const raw = localStorage.getItem(GEO_KEY)
    if (!raw) return {}
    const obj = JSON.parse(raw)
    if (!obj || typeof obj !== 'object') return {}
    const out: Record<string, Geo> = {}
    for (const [id, g] of Object.entries(obj as Record<string, unknown>)) {
      if (!APP_MAP[id] || !g || typeof g !== 'object') continue
      const { x, y, w, h } = g as Geo
      if ([x, y, w, h].some((n) => typeof n !== 'number' || !Number.isFinite(n))) continue
      out[id] = { x, y, w, h }
    }
    return out
  } catch {
    return {}
  }
}

/**
 * 把记住的几何按**当前**视口收一遍。
 *
 * 上次在 27 寸屏上拉到 2200 宽，换到笔记本再打开就会有一半在屏幕外；
 * 收完至少要保证标题栏（含交通灯）能点到，所以纵向 y 卡在 26、横向留 120。
 */
function clampGeo(g: Geo): Geo {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const w = Math.min(Math.max(g.w, MIN_W), Math.max(MIN_W, vw - 70))
  const h = Math.min(Math.max(g.h, MIN_H), Math.max(MIN_H, vh - 110))
  // 宽高已经收进视口了，位置就按「整窗留在屏幕里」收——比拖拽时那套「留 120px
  // 够得着」更严一点：恢复几何时不该出现「右边缘在屏幕外」的窗口
  return {
    w,
    h,
    x: Math.min(Math.max(g.x, 120 - w), Math.max(120 - w, vw - w - 10)),
    y: Math.min(Math.max(g.y, MIN_Y), Math.max(MIN_Y, vh - h - 10)),
  }
}

/** 临时栏最多留住 3 个「已经关掉」的应用，超了就挤掉最早关的那个 */
function trimTemp(items: TempDockItem[]): TempDockItem[] {
  const closed = items.filter((i) => i.closedAt !== null)
  if (closed.length <= TEMP_KEEP) return items
  const drop = new Set(
    closed
      .slice()
      .sort((a, b) => (a.closedAt as number) - (b.closedAt as number))
      .slice(0, closed.length - TEMP_KEEP)
      .map((i) => i.id),
  )
  return items.filter((i) => !drop.has(i.id))
}

/**
 * 开窗几何：有记录就用记录（按视口收），没有就对齐原型的「居中 + 级联偏移」。
 */
function placeWindow(id: string, cascade: number, saved?: Geo) {
  if (saved) return clampGeo(saved)
  const app = APP_MAP[id]
  const vw = window.innerWidth
  const vh = window.innerHeight
  const w = Math.min(app?.w ?? 900, vw - 70)
  const h = Math.min(app?.h ?? 600, vh - 110)
  const off = (cascade % 5) * 24
  const x = Math.max(30, (vw - w) / 2 - 50 + off)
  const y = Math.max(38, (vh - h) / 2 - 40 + off)
  return { x, y, w, h }
}

export function ShellProvider({ children }: { children: ReactNode }) {
  const [wins, setWins] = useState<WinState[]>([])
  const [focusId, setFocusId] = useState<string | null>(null)
  const [titles, setTitles] = useState<Record<string, string>>({})
  const [routes, setRoutes] = useState<Record<string, string>>({})
  const [pinned, setPinned] = useState<string[]>(loadPinned)
  const [temp, setTemp] = useState<TempDockItem[]>([])
  /** `pinned` 的镜像：`openApp` / `closeWin` 的 setState 回调里读不到最新的 pinned */
  const pinnedRef = useRef(pinned)
  pinnedRef.current = pinned
  /** 关闭序号，只用于临时栏的先进先出淘汰 */
  const closeSeq = useRef(0)
  const [editing, setEditing] = useState(false)
  const [launchpad, setLaunchpad] = useState(false)
  const zRef = useRef(100)
  const cascadeRef = useRef(0)
  /** 已落盘的几何，开窗时查它；同时当作「防抖写盘」的缓冲区 */
  const geoRef = useRef<Record<string, Geo>>(loadGeo())
  const geoTimer = useRef(0)
  /** `wins` 的镜像：`moveWin` / `resizeWin` 要算钳制后的值再存，不能读 setState 里的 prev */
  const winsRef = useRef<WinState[]>([])
  winsRef.current = wins
  /** 「回到桌面」收起时那一刻还可见的窗口；只还原这批，用户自己最小化的不动 */
  const deskHidden = useRef<string[]>([])

  /**
   * 退场定时器：窗口在演关窗 / 最小化的动画时才转，到点才真正卸载或藏起来。
   * 重开同一个应用必须先取消，否则刚被拉起来又会被那条旧定时器关掉。
   */
  const animTimers = useRef<Record<string, number>>({})
  const cancelAnim = useCallback((id: string) => {
    const t = animTimers.current[id]
    if (!t) return
    window.clearTimeout(t)
    delete animTimers.current[id]
  }, [])

  /** 拖拽是每帧都来的，攒 400ms 再写一次 localStorage，别每帧同步序列化一遍 */
  const saveGeo = useCallback((id: string, geo: Geo) => {
    geoRef.current = { ...geoRef.current, [id]: geo }
    window.clearTimeout(geoTimer.current)
    geoTimer.current = window.setTimeout(() => {
      try {
        localStorage.setItem(GEO_KEY, JSON.stringify(geoRef.current))
      } catch {
        // 存不下就只在本次会话里生效
      }
    }, 400)
  }, [])

  useEffect(
    () => () => {
      window.clearTimeout(geoTimer.current)
      Object.values(animTimers.current).forEach((t) => window.clearTimeout(t))
    },
    [],
  )

  const focusWin = useCallback(
    (id: string) => {
      // 退场动画进行中被点到：这条命续上，作废的定时器不能再把它关掉
      cancelAnim(id)
      zRef.current += 1
      const z = zRef.current
      setWins((prev) => prev.map((w) => (w.id === id ? { ...w, z, min: false, anim: undefined } : w)))
      setFocusId(id)
    },
    [cancelAnim],
  )

  const setWinTitle = useCallback((id: string, title: string) => {
    setTitles((prev) => (prev[id] === title ? prev : { ...prev, [id]: title }))
  }, [])

  const openApp = useCallback((id: string, route?: string) => {
    const app = APP_MAP[id]
    if (!app) return
    // 新页面模式不占桌面窗口：直接给浏览器，Dock 上也不留运行点
    if (app.mode === 'external' && app.url) {
      window.open(app.url, '_blank', 'noopener,noreferrer')
      setLaunchpad(false)
      return
    }
    // 指定初始路由时（如账户菜单「个人中心」→ adm /profile）记下来，供联邦入口
    // 挂载时用；已经开着的窗口不重置，避免打断用户当前所在页面。
    if (route) {
      setRoutes((prev) => ({ ...prev, [id]: route }))
    }
    zRef.current += 1
    const z = zRef.current
    cancelAnim(id)
    // 没固定的应用进临时栏；从「最近关掉」里重新拉起来的，位置不变，
    // 只把 closedAt 清掉——图标不会在栏里跳一下
    if (!pinnedRef.current.includes(id)) {
      setTemp((prev) => {
        const hit = prev.find((i) => i.id === id)
        if (!hit) return [...prev, { id, closedAt: null }]
        if (hit.closedAt === null) return prev
        return prev.map((i) => (i.id === id ? { ...i, closedAt: null } : i))
      })
    }
    setWins((prev) => {
      // 已经开着（可能被最小化了）：抬到最前并还原，不能只是「focus」——
      // 最小化的窗口还挂在 DOM 上，不把 min 清掉，点 Dock 会像没反应。
      // `anim` 也要清：正演着关窗/最小化又点了 Dock，这条命得续上，旧定时器作废
      if (prev.some((w) => w.id === id)) {
        return prev.map((w) => (w.id === id ? { ...w, min: false, z, anim: undefined } : w))
      }
      const geo = placeWindow(id, cascadeRef.current++, geoRef.current[id])
      return [...prev, { id, ...geo, min: false, max: false, z }]
    })
    setFocusId(id)
    setLaunchpad(false)
  }, [cancelAnim])

  /** 真正把窗口从桌面上拿掉（含标题与 Dock 收尾），关窗动画结束后才由定时器调用 */
  const unmountWin = useCallback((id: string) => {
    setWins((prev) => prev.filter((w) => w.id !== id))
    setTitles((prev) => {
      if (!(id in prev)) return prev
      const next = { ...prev }
      delete next[id]
      return next
    })
    // 关掉不等于从 Dock 上消失：留在临时栏里，攒够 TEMP_KEEP 个之后先进先出地挤掉
    setTemp((prev) => {
      if (!prev.some((i) => i.id === id)) return prev
      closeSeq.current += 1
      const seq = closeSeq.current
      return trimTemp(prev.map((i) => (i.id === id ? { ...i, closedAt: seq } : i)))
    })
  }, [])

  /**
   * 关窗：先挂上 `closing` 让它演完 190ms 的退场，再卸载。
   * 焦点立刻交回桌面，不必等动画——否则这 190ms 里点别的窗口会被旧焦点抢回来。
   */
  const closeWin = useCallback(
    (id: string) => {
      const cur = winsRef.current.find((w) => w.id === id)
      if (!cur) return
      // 已经在退场：别把这条动画从头再排一遍
      if (cur.anim === 'closing') return
      cancelAnim(id)
      setWins((prev) => prev.map((w) => (w.id === id ? { ...w, anim: 'closing' } : w)))
      setFocusId((cur) => (cur === id ? null : cur))
      animTimers.current[id] = window.setTimeout(() => {
        delete animTimers.current[id]
        unmountWin(id)
      }, CLOSE_MS)
    },
    [cancelAnim, unmountWin],
  )

  /**
   * 最小化：同样先演「往 Dock 收下去」的 200ms，到点才置 `min`（`display:none`）。
   * 只在那里落 `min`，是为了窗口全程留在 DOM 里，动画才有东西可动。
   */
  const minimizeWin = useCallback(
    (id: string) => {
      const cur = winsRef.current.find((w) => w.id === id)
      if (!cur || cur.min) return
      // 关窗退场途中又点最小化：让关窗那条路走完，不切动画
      if (cur.anim === 'closing') return
      if (cur.anim === 'minimizing') return
      cancelAnim(id)
      setWins((prev) => prev.map((w) => (w.id === id ? { ...w, anim: 'minimizing' } : w)))
      setFocusId((cur) => (cur === id ? null : cur))
      animTimers.current[id] = window.setTimeout(() => {
        delete animTimers.current[id]
        setWins((prev) => prev.map((w) => (w.id === id ? { ...w, min: true, anim: undefined } : w)))
      }, MINIMIZE_MS)
    },
    [cancelAnim],
  )

  /**
   * 回到桌面：一个动作、两种方向。
   *
   * 还有窗口露在外面 → 全部收起来，并记下「这一刻可见的是哪几个」；已经全部收着 →
   * 只把上一次收起来的还原回来。用快照而不是「还原所有最小化的窗口」，是因为
   * 用户自己按最小化收掉的窗口不该被这个按钮顺手捞出来。
   */
  const toggleDesktop = useCallback(() => {
    const visible = winsRef.current.filter((w) => !w.min)
    if (visible.length > 0) {
      deskHidden.current = visible.map((w) => w.id)
      // 一键收起不做逐窗动画：几扇窗一起往 Dock 里掉会很吵，直接落成 `min`
      visible.forEach((w) => cancelAnim(w.id))
      setWins((prev) => prev.map((w) => (w.min ? w : { ...w, min: true, anim: undefined })))
      setFocusId(null)
      setLaunchpad(false)
      return
    }
    const ids = new Set(deskHidden.current)
    if (ids.size === 0) return
    deskHidden.current = []
    // 还原后把原来最上面那扇抬到最前，和「从 Dock 点开」同一个手感
    const top = winsRef.current
      .filter((w) => ids.has(w.id))
      .reduce<WinState | null>((best, w) => (!best || w.z > best.z ? w : best), null)
    zRef.current += 1
    const z = zRef.current
    setWins((prev) =>
      prev.map((w) => (ids.has(w.id) ? { ...w, min: false, z: w.id === top?.id ? z : w.z } : w)),
    )
    if (top) setFocusId(top.id)
  }, [cancelAnim])

  const toggleMax = useCallback((id: string) => {
    zRef.current += 1
    const z = zRef.current
    setWins((prev) =>
      prev.map((w) => (w.id === id ? { ...w, max: !w.max, z, min: false } : w)),
    )
    setFocusId(id)
  }, [])

  const moveWin = useCallback(
    (id: string, x: number, y: number) => {
      const cur = winsRef.current.find((w) => w.id === id)
      if (!cur) return
      // 不让窗口被拖到完全够不着的地方：横向至少留 120px、纵向标题栏不越过菜单栏
      const maxX = window.innerWidth - 120
      const maxY = window.innerHeight - 60
      const nx = Math.min(Math.max(x, 120 - cur.w), maxX)
      const ny = Math.min(Math.max(y, MIN_Y), maxY)
      saveGeo(id, { x: nx, y: ny, w: cur.w, h: cur.h })
      setWins((prev) => prev.map((w) => (w.id === id ? { ...w, x: nx, y: ny } : w)))
    },
    [saveGeo],
  )

  /**
   * 改窗口大小。
   *
   * 只负责落值，不负责钳制——钳制必须在拖拽方向上做（往左拖时宽度变小、x 要跟着右移，
   * 到下限之后 x 就不能再动），那需要知道是哪个把手在拖，这里看不到。
   * 所以几何钳制在 `WindowFrame` 里算完再传进来。
   */
  const resizeWin = useCallback(
    (id: string, geo: { x: number; y: number; w: number; h: number }) => {
      saveGeo(id, geo)
      setWins((prev) => prev.map((w) => (w.id === id ? { ...w, ...geo, max: false } : w)))
    },
    [saveGeo],
  )

  /** 拖拽重排固定栏。存 localStorage，和 `togglePin` 走同一个 key */
  const movePin = useCallback((id: string, to: number) => {
    const cur = pinnedRef.current
    const from = cur.indexOf(id)
    if (from < 0) return
    const target = Math.max(0, Math.min(to, cur.length - 1))
    if (from === target) return
    const next = cur.slice()
    next.splice(from, 1)
    next.splice(target, 0, id)
    pinnedRef.current = next
    setPinned(next)
    try {
      localStorage.setItem(PIN_KEY, JSON.stringify(next))
    } catch {
      // 存不下就只在本页生效
    }
  }, [])

  const togglePin = useCallback((id: string) => {
    const wasPinned = pinnedRef.current.includes(id)
    const next = wasPinned
      ? pinnedRef.current.filter((x) => x !== id)
      : [...pinnedRef.current, id]
    pinnedRef.current = next
    setPinned(next)
    try {
      localStorage.setItem(PIN_KEY, JSON.stringify(next))
    } catch {
      // 存不下就只在本页生效
    }
    setTemp((prev) => {
      // 变固定：从临时栏搬到固定栏
      if (!wasPinned) return prev.filter((i) => i.id !== id)
      // 取消固定：还开着的回到临时栏末尾；没开着的就直接离开 Dock
      if (prev.some((i) => i.id === id)) return prev
      const running = winsRef.current.some((w) => w.id === id)
      return running ? [...prev, { id, closedAt: null }] : prev
    })
  }, [])

  // 视口变小后把越界的窗口拉回来，否则最大化过的窗口缩屏后会「消失」
  useEffect(() => {
    const onResize = () => {
      setWins((prev) =>
        prev.map((w) => ({
          ...w,
          x: Math.max(120 - w.w, Math.min(w.x, window.innerWidth - 120)),
          y: Math.max(26, Math.min(w.y, window.innerHeight - 60)),
        })),
      )
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const value = useMemo<ShellApi>(
    () => ({
      wins,
      focusId,
      titles,
      setWinTitle,
      routes,
      openApp,
      closeWin,
      minimizeWin,
      toggleDesktop,
      toggleMax,
      focusWin,
      moveWin,
      resizeWin,
      pinned,
      togglePin,
      movePin,
      temp,
      editing,
      setEditing,
      launchpad,
      setLaunchpad,
    }),
    [
      wins,
      focusId,
      titles,
      setWinTitle,
      routes,
      openApp,
      closeWin,
      minimizeWin,
      toggleDesktop,
      toggleMax,
      focusWin,
      moveWin,
      resizeWin,
      pinned,
      togglePin,
      movePin,
      temp,
      editing,
      launchpad,
    ],
  )

  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>
}

export function useShell(): ShellApi {
  const ctx = useContext(ShellContext)
  if (!ctx) throw new Error('useShell 必须在 ShellProvider 内使用')
  return ctx
}

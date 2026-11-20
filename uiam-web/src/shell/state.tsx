/**
 * 桌面外壳的状态：开着的窗口、焦点、Dock 固定项、编辑态、启动台。
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
}

interface ShellApi {
  wins: WinState[]
  focusId: string | null
  /** 子应用回报的动态标题；没有回报时窗口沿用 APP_MAP 里的名字 */
  titles: Record<string, string>
  setWinTitle: (id: string, title: string) => void
  openApp: (id: string) => void
  closeWin: (id: string) => void
  minimizeWin: (id: string) => void
  toggleMax: (id: string) => void
  focusWin: (id: string) => void
  moveWin: (id: string, x: number, y: number) => void
  resizeWin: (id: string, geo: { x: number; y: number; w: number; h: number }) => void
  pinned: string[]
  togglePin: (id: string) => void
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
  const [pinned, setPinned] = useState<string[]>(loadPinned)
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

  useEffect(() => () => window.clearTimeout(geoTimer.current), [])

  const focusWin = useCallback((id: string) => {
    zRef.current += 1
    const z = zRef.current
    setWins((prev) =>
      prev.map((w) => (w.id === id ? { ...w, z, min: false } : w)),
    )
    setFocusId(id)
  }, [])

  const setWinTitle = useCallback((id: string, title: string) => {
    setTitles((prev) => (prev[id] === title ? prev : { ...prev, [id]: title }))
  }, [])

  const openApp = useCallback((id: string) => {
    const app = APP_MAP[id]
    if (!app) return
    // 新页面模式不占桌面窗口：直接给浏览器，Dock 上也不留运行点
    if (app.mode === 'external' && app.url) {
      window.open(app.url, '_blank', 'noopener,noreferrer')
      setLaunchpad(false)
      return
    }
    zRef.current += 1
    const z = zRef.current
    setWins((prev) => {
      // 已经开着（可能被最小化了）：抬到最前并还原，不能只是「focus」——
      // 最小化的窗口还挂在 DOM 上，不把 min 清掉，点 Dock 会像没反应
      if (prev.some((w) => w.id === id)) {
        return prev.map((w) => (w.id === id ? { ...w, min: false, z } : w))
      }
      const geo = placeWindow(id, cascadeRef.current++, geoRef.current[id])
      return [...prev, { id, ...geo, min: false, max: false, z }]
    })
    setFocusId(id)
    setLaunchpad(false)
  }, [])

  const closeWin = useCallback((id: string) => {
    setWins((prev) => prev.filter((w) => w.id !== id))
    setFocusId((cur) => (cur === id ? null : cur))
    setTitles((prev) => {
      if (!(id in prev)) return prev
      const next = { ...prev }
      delete next[id]
      return next
    })
  }, [])

  const minimizeWin = useCallback((id: string) => {
    setWins((prev) => prev.map((w) => (w.id === id ? { ...w, min: true } : w)))
    setFocusId((cur) => (cur === id ? null : cur))
  }, [])

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

  const togglePin = useCallback((id: string) => {
    setPinned((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
      try {
        localStorage.setItem(PIN_KEY, JSON.stringify(next))
      } catch {
        // 存不下就只在本页生效
      }
      return next
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
      openApp,
      closeWin,
      minimizeWin,
      toggleMax,
      focusWin,
      moveWin,
      resizeWin,
      pinned,
      togglePin,
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
      openApp,
      closeWin,
      minimizeWin,
      toggleMax,
      focusWin,
      moveWin,
      resizeWin,
      pinned,
      togglePin,
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

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
  openApp: (id: string) => void
  closeWin: (id: string) => void
  minimizeWin: (id: string) => void
  toggleMax: (id: string) => void
  focusWin: (id: string) => void
  moveWin: (id: string, x: number, y: number) => void
  pinned: string[]
  togglePin: (id: string) => void
  editing: boolean
  setEditing: (v: boolean) => void
  launchpad: boolean
  setLaunchpad: (v: boolean) => void
}

const ShellContext = createContext<ShellApi | null>(null)

const PIN_KEY = 'uiam-dock-pinned'

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

/** 开窗几何：对齐原型的「居中 + 级联偏移」，并按视口收一下，保证标题栏可见 */
function placeWindow(id: string, cascade: number) {
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
  const [pinned, setPinned] = useState<string[]>(loadPinned)
  const [editing, setEditing] = useState(false)
  const [launchpad, setLaunchpad] = useState(false)
  const zRef = useRef(100)
  const cascadeRef = useRef(0)

  const focusWin = useCallback((id: string) => {
    zRef.current += 1
    const z = zRef.current
    setWins((prev) =>
      prev.map((w) => (w.id === id ? { ...w, z, min: false } : w)),
    )
    setFocusId(id)
  }, [])

  const openApp = useCallback((id: string) => {
    if (!APP_MAP[id]) return
    zRef.current += 1
    const z = zRef.current
    setWins((prev) => {
      // 已经开着（可能被最小化了）：抬到最前并还原，不能只是「focus」——
      // 最小化的窗口还挂在 DOM 上，不把 min 清掉，点 Dock 会像没反应
      if (prev.some((w) => w.id === id)) {
        return prev.map((w) => (w.id === id ? { ...w, min: false, z } : w))
      }
      const geo = placeWindow(id, cascadeRef.current++)
      return [...prev, { id, ...geo, min: false, max: false, z }]
    })
    setFocusId(id)
    setLaunchpad(false)
  }, [])

  const closeWin = useCallback((id: string) => {
    setWins((prev) => prev.filter((w) => w.id !== id))
    setFocusId((cur) => (cur === id ? null : cur))
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

  const moveWin = useCallback((id: string, x: number, y: number) => {
    setWins((prev) =>
      prev.map((w) => {
        if (w.id !== id) return w
        // 不让窗口被拖到完全够不着的地方：横向至少留 120px、纵向标题栏不越过菜单栏
        const maxX = window.innerWidth - 120
        const maxY = window.innerHeight - 60
        return {
          ...w,
          x: Math.min(Math.max(x, 120 - w.w), maxX),
          y: Math.min(Math.max(y, 26), maxY),
        }
      }),
    )
  }, [])

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
      openApp,
      closeWin,
      minimizeWin,
      toggleMax,
      focusWin,
      moveWin,
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
      openApp,
      closeWin,
      minimizeWin,
      toggleMax,
      focusWin,
      moveWin,
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

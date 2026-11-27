/**
 * 桌面全屏：把「桌面」这一整页提成全屏，浏览器自己的标题栏、地址栏让位。
 *
 * 注意它和窗口的「最大化」不是一回事：最大化只是把一扇窗放大到桌面可视区里，
 * 菜单栏、Dock 都还在；这里动的是**整块屏幕**——桌面（含顶栏与 Dock）铺满显示器，
 * 窗口该多大还是多大。
 *
 * 三个刻意的取舍：
 *
 * 1. **走 Fullscreen API，不用 CSS 铺满**。CSS 铺不改浏览器自己的窗口装饰，
 *    屏幕上方仍然压着一条地址栏，那不叫全屏。
 * 2. **状态的唯一真值是 `document.fullscreenElement`**，本地不存布尔。退出全屏
 *    的路径有三条（按钮、Esc、系统把全屏切走），只有跟着 `fullscreenchange`
 *    走，图标才不会和屏幕对不上。
 * 3. **不支持时 `toggle` 返回 false**，交给调用方提示一句。让按钮点了没反应
 *    比明确说「这台浏览器不让网页全屏」更糟。
 */

const listeners = new Set<() => void>()
/** 上一次广播出去的状态，只在真变了的时候通知订阅者 */
let active = false
let wired = false

type FsDoc = Document & {
  webkitFullscreenElement?: Element | null
  webkitExitFullscreen?: () => Promise<void> | void
}
type FsEl = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void }

function fullscreenElement(): Element | null {
  const doc = document as FsDoc
  return doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null
}

/** 只认「整个文档」的全屏：某个 iframe 自己进全屏不算桌面全屏 */
function isDocFullscreen(): boolean {
  return fullscreenElement() === document.documentElement
}

function publish() {
  const next = isDocFullscreen()
  if (next === active) return
  active = next
  listeners.forEach((listener) => listener())
}

/** 事件监听只挂一次：多个订阅者（将来可能不止一处按钮）共用一条 */
function wire() {
  if (wired) return
  wired = true
  document.addEventListener('fullscreenchange', publish)
  document.addEventListener('webkitfullscreenchange', publish)
  active = isDocFullscreen()
}

/** 供 `useSyncExternalStore` 使用 */
export function subscribeDesktopFullscreen(listener: () => void): () => void {
  wire()
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function currentDesktopFullscreen(): boolean {
  return active
}

/**
 * 切换桌面全屏。
 *
 * @returns 是否已经把动作交给了浏览器。`false` 表示这套环境没有这个能力
 *          （老浏览器、被 iframe 权限策略拦、非用户手势），调用方应当提示。
 */
export function toggleDesktopFullscreen(): boolean {
  wire()

  const doc = document as FsDoc
  if (isDocFullscreen()) {
    const exit = doc.exitFullscreen ?? doc.webkitExitFullscreen
    if (!exit) return false
    try {
      const ret = exit.call(doc) as Promise<void> | void
      // 失败时把状态拉回真实值，别让图标停在「已全屏」
      if (ret && typeof ret.then === 'function') ret.catch(publish)
      return true
    } catch {
      return false
    }
  }

  const el = document.documentElement as FsEl
  const request = el.requestFullscreen ?? el.webkitRequestFullscreen
  if (!request) return false
  try {
    const ret = request.call(el) as Promise<void> | void
    if (ret && typeof ret.then === 'function') ret.catch(publish)
    return true
  } catch {
    return false
  }
}

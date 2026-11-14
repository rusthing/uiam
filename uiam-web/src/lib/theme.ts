/**
 * 主题：只有 light / dark 两态，点一下直接切。
 *
 * 三个刻意的取舍：
 *
 * 1. **没有第三态**。「跟随系统」只在**首次**（localStorage 没有记录）时决定初值，
 *    之后系统怎么变都不影响——否则用户手动选过的主题会在某天夜里被系统覆盖。
 * 2. **动画圆心是图标中心**，不是鼠标点击点、也不是屏幕中心。扩散从一个确定的
 *    参照物出发才像「灯被点亮」，从鼠标点出发会随点击位置漂移，两次点击看起来
 *    是两种不同的动效。
 * 3. **不支持的浏览器整页过渡兜底**。View Transition 不可用或用户要求减少动效时，
 *    走 `html.theme-fading` 的 CSS 过渡，功能不受影响。
 */

export type Theme = 'light' | 'dark'

const STORAGE_KEY = 'uiam-theme'
const TRANSITION_MS = 480

/** 已经应用到 DOM 的主题 */
let applied: Theme = 'light'
/** 最近一次**请求**切到的主题。连点时用它，避免异步 commit 用旧值覆盖新值 */
let target: Theme = 'light'

/**
 * 订阅者。
 *
 * 页面上有两个切换按钮（侧边栏底部一个、窄屏顶栏一个），它们各自持有一份
 * 组件状态时，点其中一个另一个的图标就不会变。用一个模块级订阅让所有按钮
 * 都读同一份真值——顺带也解决了「切完主题后图标语义要不要反过来」的判断。
 */
const listeners = new Set<() => void>()

/** 供 `useSyncExternalStore` 使用：订阅主题变化 */
export function subscribeTheme(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function readDom(): Theme {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
}

function persist(theme: Theme) {
  try {
    localStorage.setItem(STORAGE_KEY, theme)
  } catch {
    // 隐私模式下 localStorage 可能抛异常，主题只在本页生效即可
  }
}

function commit(theme: Theme) {
  document.documentElement.dataset.theme = theme
  applied = theme
  target = theme
  persist(theme)
  listeners.forEach((listener) => listener())
}

/** 初始化：把模块状态对齐到 `<head>` 里内联脚本已经定好的值 */
export function initTheme(): Theme {
  applied = readDom()
  target = applied
  return applied
}

export function currentTheme(): Theme {
  return applied
}

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * 切换主题。
 *
 * ## 参数
 * * `originEl` - 动画圆心所在元素（外观图标）。为空时退化为整页过渡。
 */
export function toggleTheme(originEl?: HTMLElement | null) {
  // 以「最近请求的目标」为基准，而不是已应用的状态：View Transition 是异步的，
  // 连点两下时第二次读到的 `applied` 可能还没更新，会切回同一个主题（看起来没反应）
  const next: Theme = target === 'dark' ? 'light' : 'dark'
  target = next

  // 先取到函数引用再判断：`typeof x === 'function'` 存进变量后 TS 不会在调用点
  // 继续收窄，直接调 `document.startViewTransition(...)` 会报「可能为 undefined」
  const startViewTransition = document.startViewTransition?.bind(document)
  const canTransition = Boolean(startViewTransition) && !prefersReducedMotion()

  if (!canTransition || !originEl || !startViewTransition) {
    document.documentElement.classList.add('theme-fading')
    commit(next)
    window.setTimeout(
      () => document.documentElement.classList.remove('theme-fading'),
      TRANSITION_MS,
    )
    return
  }

  const rect = originEl.getBoundingClientRect()
  const x = rect.left + rect.width / 2
  const y = rect.top + rect.height / 2
  // 半径取到最远角的距离，保证扩散能盖住整屏（含滚动后的区域）
  const radius = Math.hypot(
    Math.max(x, window.innerWidth - x),
    Math.max(y, window.innerHeight - y),
  )

  const transition = startViewTransition(() => commit(next))
  transition.ready
    .then(() => {
      document.documentElement.animate(
        {
          clipPath: [
            `circle(0px at ${x}px ${y}px)`,
            `circle(${radius}px at ${x}px ${y}px)`,
          ],
        },
        {
          duration: TRANSITION_MS,
          easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
          pseudoElement: '::view-transition-new(root)',
        },
      )
    })
    .catch(() => {
      // 动画失败不影响主题已经切过去的事实，静默即可
    })
}

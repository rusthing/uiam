/**
 * 主题切换按钮。
 *
 * 图标语义是「点一下会去哪」：当前浅色时显示月亮（点它去深色），当前深色时显示
 * 太阳。扩散动画的圆心取这个按钮自身的 `getBoundingClientRect()` 中点——
 * 不是鼠标点，也不是屏幕中心。
 *
 * 主题状态走 `useSyncExternalStore` 而不是组件内 `useState`：页面上有两个按钮
 * （侧边栏底部、窄屏顶栏），点一个要让另一个的图标同时反过来。
 */
import { useRef, useSyncExternalStore } from 'react'
import { currentTheme, subscribeTheme, toggleTheme, type Theme } from '../lib/theme'
import { IconMoon, IconSun } from './icons'

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const ref = useRef<HTMLButtonElement>(null)
  const theme = useSyncExternalStore<Theme>(subscribeTheme, currentTheme, () => 'light')

  return (
    <button
      ref={ref}
      onClick={() => toggleTheme(ref.current)}
      title={theme === 'dark' ? '切换到浅色' : '切换到深色'}
      aria-label={theme === 'dark' ? '切换到浅色主题' : '切换到深色主题'}
      className={
        compact
          ? 'btn btn-ghost h-8 w-8 !px-0'
          : 'flex h-9 w-9 items-center justify-center rounded-[10px] border border-line bg-surface-strong text-ink-soft transition-colors hover:text-ink'
      }
    >
      {theme === 'dark' ? <IconSun size={16} /> : <IconMoon size={16} />}
    </button>
  )
}

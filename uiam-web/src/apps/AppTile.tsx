/**
 * 应用磁贴：渐变底 + 白色图标。Dock / 启动台 / widget 里共用同一份，尺寸交给外层类名。
 */
import type { CSSProperties } from 'react'
import { APP_MAP } from './meta'
import { AppIcon } from './AppIcon'
import { cx } from '../components/ui'

export function AppTile({
  id,
  className,
  style,
}: {
  id: string
  className?: string
  style?: CSSProperties
}) {
  const app = APP_MAP[id]
  if (!app) return null
  return (
    <div
      className={cx('tile', className)}
      style={{ ['--c1' as string]: app.c1, ['--c2' as string]: app.c2, ...style }}
    >
      <AppIcon id={id} />
    </div>
  )
}

/**
 * 启停开关。
 *
 * 它出现在**卡片右上角**和表格的「状态」列，不出现在新建/编辑表单里——
 * 启停是「这个对象现在参不参与渲染」的即时操作，不该逼人先开表单再保存。
 */
import { cx } from './ui'

export function Switch({
  on,
  onChange,
  label,
  size = 'sm',
}: {
  on: boolean
  onChange: (next: boolean) => void
  label: string
  size?: 'sm' | 'md'
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      title={on ? '点击停用（不参与渲染）' : '点击启用'}
      className={cx('ui-sw', size === 'md' && 'md', on && 'on')}
      onClick={(e) => {
        e.stopPropagation()
        onChange(!on)
      }}
    >
      <i />
    </button>
  )
}

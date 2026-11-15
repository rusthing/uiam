/**
 * 桌面：壁纸 + 组件网格 + 窗口层。
 *
 * 拖动排序用 HTML5 DnD 而不是 pointer 拖影：组件在网格里是「换位」不是「跟手」，
 * 原生 DnD 的 dragover 事件刚好能给出「拖到了哪个组件上」，不用自己算碰撞。
 * 落点判断用**指针在目标元素左半还是右半**，而不是比较数组下标——比较下标会在
 * 两个组件之间来回翻转（换完位置下标关系反转，下一次 dragover 又换回来）。
 */
import { useEffect, useState, type CSSProperties, type DragEvent } from 'react'
import { AppBody } from '../apps'
import { cx } from '../components/ui'
import { useShell } from './state'
import { useWidgetLayout, WIDGET_DEFS, type WidgetId } from './useWidgetLayout'
import { WidgetBody } from './widgets'
import { WindowFrame } from './Window'

const I_DRAG = (
  <svg viewBox="0 0 16 16" fill="currentColor">
    <circle cx="5" cy="4" r="1.55" />
    <circle cx="11" cy="4" r="1.55" />
    <circle cx="5" cy="8" r="1.55" />
    <circle cx="11" cy="8" r="1.55" />
    <circle cx="5" cy="12" r="1.55" />
    <circle cx="11" cy="12" r="1.55" />
  </svg>
)

const I_SIZE = (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9.6 2.6h3.8v3.8" />
    <path d="M13.4 2.6L8.8 7.2" />
    <path d="M6.4 13.4H2.6V9.6" />
    <path d="M2.6 13.4l4.6-4.6" />
  </svg>
)

const I_DEL = (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
    <path d="M4.2 4.2l7.6 7.6M11.8 4.2l-7.6 7.6" />
  </svg>
)

export function Desktop() {
  const shell = useShell()
  const { layout, add, remove, cycleSize, reorder, reset, rest } = useWidgetLayout()
  const [dragId, setDragId] = useState<WidgetId | null>(null)

  // 添加面板的显隐挂在 body 上（对齐原型），这样它不会被 `.desktop` 的层级影响
  useEffect(() => {
    document.body.classList.toggle('editing', shell.editing)
    return () => document.body.classList.remove('editing')
  }, [shell.editing])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      shell.setLaunchpad(false)
      if (shell.editing) shell.setEditing(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [shell])

  // 设置窗口里的「恢复默认布局」：布局状态在本组件内，用事件通知比重构成全局 store 划算
  useEffect(() => {
    const onReset = () => reset()
    window.addEventListener('uiam-reset-desktop', onReset)
    return () => window.removeEventListener('uiam-reset-desktop', onReset)
  }, [reset])

  const onDragStart = (e: DragEvent<HTMLDivElement>, id: WidgetId) => {
    if (!shell.editing) return
    setDragId(id)
    e.dataTransfer.effectAllowed = 'move'
    try {
      e.dataTransfer.setData('text/plain', id)
    } catch {
      // Safari 在 dragstart 里 setData 偶尔抛，不影响 effectAllowed
    }
  }

  const onDragOver = (e: DragEvent<HTMLDivElement>, id: WidgetId) => {
    if (!dragId) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (dragId === id) return
    const rect = e.currentTarget.getBoundingClientRect()
    reorder(dragId, id, e.clientX - rect.left > rect.width / 2)
  }

  return (
    <>
      <div className="desktop">
        <div className={cx('widgets', shell.editing && 'editing')}>
          {layout.length === 0 && (
            <div className="wg-empty">桌面是空的 —— 点右上角「编辑桌面」添加组件</div>
          )}
          {layout.map((it, i) => (
            <div
              key={it.id}
              className={cx('widget', dragId === it.id && 'dragging')}
              data-id={it.id}
              style={
                {
                  ['--w' as string]: it.w,
                  ['--h' as string]: it.h,
                  ['--i' as string]: i,
                } as CSSProperties
              }
              draggable={shell.editing}
              onDragStart={(e) => onDragStart(e, it.id)}
              onDragOver={(e) => onDragOver(e, it.id)}
              onDragEnd={() => setDragId(null)}
              onDrop={(e) => {
                e.preventDefault()
                setDragId(null)
              }}
            >
              <div className="wg-tools">
                <div className="wg-tool" title="拖动排序">
                  {I_DRAG}
                </div>
                <div className="wg-tool" title="切换尺寸" onClick={() => cycleSize(it.id)}>
                  {I_SIZE}
                </div>
                <div className="wg-tool del" title="移除" onClick={() => remove(it.id)}>
                  {I_DEL}
                </div>
              </div>
              <WidgetBody id={it.id} />
            </div>
          ))}
        </div>

        <div className="windows">
          {shell.wins.map((w) => (
            <WindowFrame key={w.id} win={w}>
              <AppBody id={w.id} />
            </WindowFrame>
          ))}
        </div>
      </div>

      <div className="wg-add">
        <div className="wg-add-h">添加组件</div>
        <div>
          {rest.length === 0 ? (
            <div className="wg-add-empty">全部组件已在桌面上</div>
          ) : (
            rest.map((id) => (
              <button key={id} className="wg-add-item" onClick={() => add(id)}>
                <span className="plus">+</span>
                {WIDGET_DEFS[id].name}
                <span className="sz">
                  {WIDGET_DEFS[id].w}×{WIDGET_DEFS[id].h}
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </>
  )
}

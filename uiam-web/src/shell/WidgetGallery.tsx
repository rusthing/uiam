/**
 * 小组件中心：搜索、分类、缩略预览、尺寸分组、描述、添加与「完成」。
 *
 * 预览刻意用静态形状而不是渲染真实 `WidgetBody`——真实组件带数据请求、依赖
 * OverviewProvider、还会按容器尺寸换布局，塞进 120px 的预览格里只会得到一堆
 * 挤压的假数据。用「静态界面组件 + 半透明形状」表达「这块长什么样」就够了。
 */
import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { SIZE_FAMILY, WIDGET_DEFS, type WidgetId, type WidgetSize } from './useWidgetLayout'

/** 自定义 MIME 让桌面的 drop 能区分「新组件」和「紧凑模式内部排序」两种拖拽 */
export const GALLERY_DND_MIME = 'application/x-uiam-widget'

interface Props {
  rest: WidgetId[]
  onAdd: (id: WidgetId, size: WidgetSize) => void
  /** 拖起/结束一张卡片时通知桌面，落点预览才能按真实尺寸画 */
  onDragSize?: (size: WidgetSize | null) => void
  onClose: () => void
}

const CATS = ['全部', '生活', '概览', '发布', '快捷'] as const
type Cat = (typeof CATS)[number]

export function WidgetGallery({ rest, onAdd, onDragSize, onClose }: Props) {
  const [query, setQuery] = useState('')
  const [cat, setCat] = useState<Cat>('全部')
  const [sizes, setSizes] = useState<Partial<Record<WidgetId, WidgetSize>>>({})
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const onCardDragStart = (e: DragEvent<HTMLDivElement>, id: WidgetId, size: WidgetSize) => {
    e.dataTransfer.effectAllowed = 'copy'
    try {
      e.dataTransfer.setData(GALLERY_DND_MIME, JSON.stringify({ id, size }))
      // 部分浏览器要求有 text/plain 才允许起拖，同时作为不支持自定义 MIME 时的兜底
      e.dataTransfer.setData('text/plain', id)
    } catch {
      // Safari 在 dragstart 里 setData 偶尔抛；桌面 drop 会读 text/plain 兜底
    }
    setDragging(true)
    onDragSize?.(size)
  }

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // 拖放成功后 rest 变空、被拖的卡片会被卸载，挂在卡片上的 onDragEnd 不一定
  // 有机会触发（源节点没了）。用 window 级 dragend/drop 兜底，否则面板会一直
  // 停在半透明 + pointer-events:none，连「完成」都点不了。
  useEffect(() => {
    const clear = () => {
      setDragging(false)
      onDragSize?.(null)
    }
    window.addEventListener('dragend', clear)
    window.addEventListener('drop', clear)
    return () => {
      window.removeEventListener('dragend', clear)
      window.removeEventListener('drop', clear)
    }
  }, [onDragSize])

  const list = useMemo(() => {
    const q = query.trim().toLowerCase()
    return rest
      .map((id) => WIDGET_DEFS[id])
      .filter((d) => (cat === '全部' || d.category === cat))
      .filter((d) => !q || `${d.name} ${d.desc} ${d.category}`.toLowerCase().includes(q))
  }, [rest, query, cat])

  return (
    <div
      className={`gallery${dragging ? ' dragging-away' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label="小组件中心"
    >
      <div className="gallery-head">
        <input
          ref={inputRef}
          className="gallery-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索组件"
          aria-label="搜索组件"
        />
        <button className="gallery-done" onClick={onClose}>
          完成
        </button>
      </div>

      <div className="gallery-cats" role="tablist" aria-label="组件分类">
        {CATS.map((c) => (
          <button
            key={c}
            role="tab"
            aria-selected={cat === c}
            className={`gallery-cat${cat === c ? ' on' : ''}`}
            onClick={() => setCat(c)}
          >
            {c}
          </button>
        ))}
      </div>

      <div className="gallery-grid">
        {list.length === 0 && (
          <div className="gallery-empty">
            {rest.length === 0 ? '全部组件已在桌面上' : '没有匹配的组件'}
          </div>
        )}
        {list.map((d) => {
          const chosen = sizes[d.id] ?? d.size
          return (
            <div
              className="gallery-card"
              key={d.id}
              draggable
              onDragStart={(e) => onCardDragStart(e, d.id, chosen)}
              onDragEnd={() => setDragging(false)}
              title="拖到桌面任意位置，或点「添加」追加到末尾"
            >
              <div
                className="gp-visual"
                data-id={d.id}
                data-size={`${SIZE_FAMILY[chosen].w}x${SIZE_FAMILY[chosen].h}`}
                aria-hidden="true"
              >
                {d.id === 'weather' ? (
                  <div className={`gp-wx s-${chosen}`}>
                    <div className="gp-wx-city" />
                    <div className="gp-wx-main">
                      <span className="gp-wx-temp" />
                      <span className="gp-wx-cond" />
                    </div>
                    <div className="gp-wx-hours">
                      {Array.from({ length: chosen === 'medium' || chosen === 'xl' ? 6 : 5 }, (_, i) => (
                        <i key={i} />
                      ))}
                    </div>
                    {(chosen === 'large' || chosen === 'xl') && (
                      <div className="gp-wx-days">
                        {Array.from({ length: 5 }, (_, i) => <i key={i} />)}
                      </div>
                    )}
                  </div>
                ) : (
                  <>
                    <div className="gp-k" />
                    <div className="gp-bars">
                      <i className="w1" />
                      <i className="w2" />
                      <i className="w3" />
                    </div>
                    <div className="gp-dot" />
                  </>
                )}
              </div>
              <div className="gp-name">{d.name}</div>
              <div className="gp-desc">{d.desc}</div>
              <div className="gp-sizes" role="group" aria-label={`${d.name} 尺寸`}>
                {d.sizes.map((s) => (
                  <button
                    key={s}
                    className={`gp-size${chosen === s ? ' on' : ''}`}
                    onClick={() => setSizes((prev) => ({ ...prev, [d.id]: s }))}
                    aria-pressed={chosen === s}
                    title={`${SIZE_FAMILY[s].label} · ${SIZE_FAMILY[s].w}×${SIZE_FAMILY[s].h}`}
                  >
                    <span className="gp-size-label">{SIZE_FAMILY[s].label}</span>
                    <span className="gp-size-grid">
                      {SIZE_FAMILY[s].w}×{SIZE_FAMILY[s].h}
                    </span>
                  </button>
                ))}
              </div>
              <button
                className="gp-add"
                onClick={() => onAdd(d.id, chosen)}
                aria-label={`添加${d.name}`}
              >
                添加
              </button>
            </div>
          )
        })}
      </div>
      <div className="gallery-foot">
        把卡片拖到桌面可放在指定位置（自动吸附网格），或点「添加」追加到末尾；点组件本身可打开对应应用。
      </div>
    </div>
  )
}

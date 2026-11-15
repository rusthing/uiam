/**
 * 「给这条路由连一个目标」的弹出面板。
 *
 * 图里最缺的一步是：路由卡片只能改已有的目标，没法**从这条路由出发**去连一个目标。
 * 于是补这个面板——它不是表单，是一个「选择器 + 两个出口」：
 *
 * 1. 点列表里已有的负载均衡器 → 直接把这条路由的 `to` 指过去（一次 PUT，不弹窗）；
 * 2. 「新建负载均衡器」→ 建完自动连上（不用再回来找一遍）；
 * 3. 「直连 Host / 静态站点」→ 交给完整表单，因为这两种目标要填地址，选择器填不了。
 *
 * 用 portal 挂到 body：图区是 `overflow: auto` 的滚动容器，挂在里面会被裁掉。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { describeBalancer, referencedBalancer } from '../lib/format'
import type { Balancer, Route } from '../lib/types'
import { IconEdit, IconPlus } from './icons'
import { cx } from './ui'

export function TargetPicker({
  open,
  anchor,
  route,
  balancers,
  onClose,
  onPick,
  onCreate,
  onFullEdit,
}: {
  open: boolean
  anchor: { x: number; y: number } | null
  route: Route | null
  balancers: Balancer[]
  onClose: () => void
  onPick: (balancer: Balancer) => void
  onCreate: () => void
  onFullEdit: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [q, setQ] = useState('')

  useEffect(() => {
    if (!open) return
    setQ('')
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('keydown', onKey)
    // 用 mousedown 而不是 click：等到 click 时卡片可能已经把选择清掉了
    document.addEventListener('mousedown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
    }
  }, [open, onClose])

  const current = route ? referencedBalancer(route.toJson) : undefined

  const rows = useMemo(() => {
    const kw = q.trim().toLowerCase()
    const list = kw
      ? balancers.filter((b) => b.name.toLowerCase().includes(kw))
      : balancers
    return [...list].sort((a, b) => a.name.localeCompare(b.name))
  }, [balancers, q])

  if (!open || !route || !anchor) return null

  // 贴边时往回收，别让面板跑到屏幕外
  const W = 306
  const H = 392
  const left = Math.max(8, Math.min(anchor.x, window.innerWidth - W - 8))
  const top = Math.max(8, Math.min(anchor.y, window.innerHeight - H - 8))

  return createPortal(
    <div
      ref={ref}
      className="tp"
      style={{ left, top, width: W, maxHeight: H }}
      role="dialog"
      aria-label="选择转发目标"
    >
      <header className="tp-h">
        <span className="tp-t">连到目标</span>
        <span className="tp-route" title={route.name}>
          {route.name}
        </span>
      </header>

      <div className="tp-now">
        现在：
        <b className={cx('mono', !current && 'mute')}>{current || '（不是负载均衡器）'}</b>
      </div>

      <input
        className="input tp-q"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="搜负载均衡器名称"
        autoFocus
      />

      <div className="tp-list">
        {rows.length === 0 && (
          <p className="tp-empty">
            {balancers.length === 0 ? '这个实例还没有负载均衡器' : '没有匹配的名称'}
          </p>
        )}
        {rows.map((b) => {
          const info = describeBalancer(b.configJson)
          return (
            <button
              key={b.id}
              className={cx('tp-item', b.name === current && 'on')}
              onClick={() => onPick(b)}
              title={b.remark || b.name}
            >
              <span className="tp-item-n mono">{b.name}</span>
              <span className="tp-item-s">
                {info.type} · {info.backends.length} 后端
                {!b.enabled && ' · 已停用'}
              </span>
              {b.name === current && <span className="tp-item-cur">当前</span>}
            </button>
          )
        })}
      </div>

      <footer className="tp-f">
        <button className="btn btn-sm" onClick={onCreate}>
          <IconPlus size={12} /> 新建并连上
        </button>
        <button className="btn btn-sm btn-ghost" onClick={onFullEdit} title="直连 Host / 静态站点要填地址，走完整表单">
          <IconEdit size={12} /> 其它目标…
        </button>
      </footer>
    </div>,
    document.body,
  )
}

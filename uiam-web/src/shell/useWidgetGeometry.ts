/**
 * 让每个组件的背景显示「它背后那块壁纸」。
 *
 * 组件背景是一张铺满视口的静态渐变（和 `.desktop` 同一组），按组件左上角在视口
 * 中的坐标做 `background-position` 偏移即可对齐——不需要 `background-attachment:
 * fixed`（它在带 `transform` 的祖先上会退化），也不需要任何运行时滤镜。
 *
 * 坐标用 `offsetLeft/offsetTop` 而不是 `getBoundingClientRect()`：组件有入场和 hover
 * 的 `transform`，量出来的矩形会带位移，而 offset* 不受自身 transform 影响。
 * 只在布局变化、容器 resize、滚动、字体就绪时重算，不跟 pointermove、不每帧写。
 */
import { useLayoutEffect, type RefObject } from 'react'

export function useWidgetGeometry(
  containerRef: RefObject<HTMLElement | null>,
  layoutKey: string,
  editing: boolean,
) {
  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return

    const measure = () => {
      const box = el.getBoundingClientRect()
      el.querySelectorAll<HTMLElement>('.widget').forEach((node) => {
        const x = Math.round(box.left + node.offsetLeft - el.scrollLeft)
        const y = Math.round(box.top + node.offsetTop - el.scrollTop)
        node.style.setProperty('--wg-x', `${x}px`)
        node.style.setProperty('--wg-y', `${y}px`)
      })
    }

    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    el.querySelectorAll<HTMLElement>('.widget').forEach((node) => ro.observe(node))
    window.addEventListener('resize', measure)
    el.addEventListener('scroll', measure, { passive: true })
    // 中文回退字体替换会改卡片高度，第一帧坐标会偏；字体就绪后再量一次
    void document.fonts?.ready.then(measure)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', measure)
      el.removeEventListener('scroll', measure)
    }
    // layoutKey 变化意味着组件增删/改尺寸/换位置，必须重新观察新节点
  }, [containerRef, layoutKey, editing])
}

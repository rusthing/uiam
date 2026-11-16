/**
 * 复制到剪贴板：带降级路径。
 *
 * `navigator.clipboard` 只在**安全上下文**（https 或 localhost）才存在。
 * 这个控制台经常以 `http://<内网IP>:端口` 的形式被人打开——那种情况下
 * `navigator.clipboard` 直接是 `undefined`，调用会抛 TypeError，如果像以前那样
 * 静默 catch 掉，用户看到的就是「点了复制，什么都没发生」。
 *
 * 所以这里先试异步剪贴板 API，不可用或失败就退到 `execCommand('copy')`
 * 走老路（用一次性 textarea 承载文本，同步执行，不需要权限）。
 * 返回值直接告诉调用方成不成，让界面能把失败说出来，而不是假装成功。
 */

/**
 * # 复制文本到剪贴板
 *
 * ## 参数
 * - `text`：要复制的完整文本，按原样写入（不做换行归一化）
 *
 * ## 返回值
 * - `true`：已写入剪贴板
 * - `false`：两条路都失败（非安全上下文且 execCommand 被禁用/不支持）
 *
 * ## 示例
 * ```ts
 * if (!(await copyText(toml))) toast.error('复制失败，请用下载')
 * ```
 */
export async function copyText(text: string): Promise<boolean> {
  // 非安全上下文里 navigator.clipboard 根本不存在，直接走 execCommand。
  // 这里不能先 await 一次失败的调用——浏览器只在「用户手势的那一拍」允许复制，
  // 等一个被拒的 Promise 回来，手势就已经失效，兜底也会跟着失败。
  if (!window.isSecureContext || !navigator.clipboard?.writeText) {
    return copyByExecCommand(text)
  }
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // 权限被拒或文档未聚焦，再试一次老接口（可能已失去手势，失败就如实返回 false）
    return copyByExecCommand(text)
  }
}

/**
 * # 用 execCommand 兜底复制
 *
 * 老接口，但它是唯一在 http 页面上还能用的同步复制方式。
 * textarea 必须真的在文档里且可选中，所以用 fixed + opacity 0 而不是 `display: none`。
 */
function copyByExecCommand(text: string): boolean {
  const active = document.activeElement as HTMLElement | null
  const ta = document.createElement('textarea')
  ta.value = text
  ta.setAttribute('readonly', '')
  ta.style.position = 'fixed'
  ta.style.top = '0'
  ta.style.left = '0'
  ta.style.width = '1px'
  ta.style.height = '1px'
  ta.style.padding = '0'
  ta.style.border = 'none'
  ta.style.opacity = '0'
  ta.style.pointerEvents = 'none'
  document.body.appendChild(ta)

  const selection = document.getSelection()
  const previous = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null

  let ok = false
  try {
    ta.focus({ preventScroll: true })
    ta.select()
    ta.setSelectionRange(0, text.length)
    ok = document.execCommand('copy')
  } catch {
    ok = false
  } finally {
    document.body.removeChild(ta)
    // 把焦点和选区还回去，否则弹窗里的键盘操作会被打断
    if (previous && selection) {
      selection.removeAllRanges()
      selection.addRange(previous)
    }
    active?.focus?.({ preventScroll: true })
  }
  return ok
}

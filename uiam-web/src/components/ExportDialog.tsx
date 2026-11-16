/**
 * 导出：把「发布」会写进 Consul 的那份 TOML 原样拿出来。
 *
 * 有导入就该有导出——导入是「把线上的配置读进库里」，导出是「把库里的配置拿出来」，
 * 两者用的是同一个渲染器，所以导出的内容就是发布的内容，不是另一套拼装逻辑。
 *
 * 为什么不是「导出 JSON」：真正被网关消费的是 TOML。给人看、给人 diff、给人贴到
 * 别处去的，也应该是这一份。
 */
import { useEffect, useState } from 'react'
import { api, ApiError } from '../lib/api'
import { copyText } from '../lib/clipboard'
import { shortChecksum } from '../lib/format'
import type { Gateway, RenderPreview } from '../lib/types'
import { CodeView } from './CodeView'
import { IconCheck, IconCopy, IconDownload } from './icons'
import { useToast } from './Toast'
import { Modal, Spinner } from './ui'

export function ExportDialog({
  open,
  gateway,
  onClose,
}: {
  open: boolean
  gateway: Gateway
  onClose: () => void
}) {
  const toast = useToast()
  const [preview, setPreview] = useState<RenderPreview>()
  const [error, setError] = useState<string>()
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!open) return
    let alive = true
    setLoading(true)
    setError(undefined)
    setPreview(undefined)
    api.publish
      .preview(gateway.id)
      .then((p) => alive && setPreview(p))
      .catch((e) => alive && setError((e as ApiError).message))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [open, gateway.id])

  // 文件名就用 Consul key：它就是网关读的那个文件名，拿出去对得上
  const filename = (gateway.consulKey || `${gateway.code || 'gateway'}.toml`).replace(/[/\\]/g, '_')

  const copy = async () => {
    if (!preview) return
    // 走带降级的复制：http + 非 localhost 时 navigator.clipboard 不存在，
    // 以前静默 catch 的结果就是「点了没反应」，现在失败会明确说出来
    const ok = await copyText(preview.toml)
    if (ok) {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } else {
      toast.error('浏览器不允许写剪贴板，请用「下载」拿这份 TOML')
    }
  }

  const download = () => {
    if (!preview) return
    const blob = new Blob([preview.toml], { type: 'application/toml;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    // 必须挂进文档再点：Firefox 对游离节点上的 click 不触发下载
    a.style.display = 'none'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    // 立刻 revoke 会让 Safari 拿到一个已失效的 blob 地址，下载中断
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
    // 下载已经交给浏览器了，弹窗留着没有意义——直接关掉，再用 toast 交代结果
    toast.success(`已开始下载 ${filename}`)
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      width={880}
      title="导出 TOML"
      description={
        <>
          这就是「发布」会写进 <span className="mono">{gateway.consulKey}</span> 的内容本身
          ——同一个渲染器产出，不是另拼一份。改这个文件不会改库里的配置。
        </>
      }
      footer={
        <>
          <button className="btn" onClick={onClose}>
            关闭
          </button>
          <button className="btn" onClick={copy} disabled={!preview}>
            {copied ? <IconCheck size={13} /> : <IconCopy size={13} />}
            {copied ? '已复制' : '复制'}
          </button>
          <button className="btn btn-primary" onClick={download} disabled={!preview}>
            <IconDownload size={13} /> 下载 {filename}
          </button>
        </>
      }
    >
      {loading && (
        <div className="flex items-center gap-2 py-10 justify-center text-ink-mute">
          <Spinner size={14} /> 渲染中…
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-danger bg-danger-soft px-3.5 py-3 text-[12.5px] leading-relaxed text-ink">
          <b>渲染失败，导不出内容：</b>
          {error}
          <p className="mt-1 text-ink-mute">
            渲染是发布前的同一道闸门——库里的配置有问题时，导出的也不是「一份能用的配置」，
            所以这里直接报错，不给你半成品。
          </p>
        </div>
      )}

      {preview && (
        <div className="grid gap-2.5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-ink-mute">
            <span>
              sha256 <b className="mono text-ink">{shortChecksum(preview.checksum)}</b>
            </span>
            <span>·</span>
            <span>
              {preview.httpListeners + preview.tcpListeners} 监听器 / {preview.routes + preview.tcpRoutes} 路由 /{' '}
              {preview.balancers} 均衡器
            </span>
            {preview.structuralChange && (
              <span className="text-warn">· 结构变化：{preview.structuralChange}</span>
            )}
          </div>

          {preview.warnings.length > 0 && (
            <div className="rounded-lg border border-line bg-warn-soft px-3 py-2 text-[11.5px] leading-relaxed text-ink">
              {preview.warnings.map((w) => (
                <div key={w}>· {w}</div>
              ))}
            </div>
          )}

          <CodeView code={preview.toml} maxHeight={440} />
        </div>
      )}
    </Modal>
  )
}

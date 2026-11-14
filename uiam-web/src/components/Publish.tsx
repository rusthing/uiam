/**
 * 发布链路的三块界面：预览抽屉、发布确认、结果回执。
 *
 * 顺序即设计——**先看预览，再发布，最后看回执**：
 *
 * - 预览里能看到的 `toml` 就是即将 PUT 到 KV 的那份字节流（与 `release.content`
 *   逐字节相同），所以「预览没问题」等于「发出去的就是这个」；
 * - 结构性变更（监听地址、监听器增减、LB、pingora-conf）必须勾选确认才能发，
 *   因为这会让网关重启、在途请求会断；
 * - 回执把 `consulKey` / `modifyIndex` / 告警一起列出来：发布成功不等于生效，
 *   要核对「写到了哪个键」和「网关有没有可能读到」。
 */
import { useEffect, useState } from 'react'
import type { PublishResult, RenderPreview } from '../lib/types'
import { formatTime, shortChecksum } from '../lib/format'
import { CodeView } from './CodeView'
import { Badge, Drawer, Modal, Spinner } from './ui'
import { IconAlert, IconCheck, IconInfo } from './icons'

function CountChip({ label, value }: { label: string; value: number }) {
  return (
    <span className="inline-flex items-baseline gap-1 rounded-lg border border-line bg-surface-sunken px-2 py-1 text-[11.5px] text-ink-mute">
      {label}
      <b className="text-[13px] font-semibold text-ink">{value}</b>
    </span>
  )
}

function WarningList({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) return null
  return (
    <ul className="grid gap-1.5 rounded-xl border border-[color-mix(in_srgb,var(--warn)_32%,transparent)] bg-warn-soft px-3 py-2.5">
      {warnings.map((w, i) => (
        <li key={i} className="flex items-start gap-1.5 text-[12px] leading-relaxed text-ink">
          <IconAlert size={13} className="mt-[3px] shrink-0 text-warn" />
          <span className="min-w-0">{w}</span>
        </li>
      ))}
    </ul>
  )
}

export function StructuralBanner({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-[color-mix(in_srgb,var(--warn)_40%,transparent)] bg-warn-soft px-3 py-2.5">
      <IconAlert size={15} className="mt-0.5 shrink-0 text-warn" />
      <div className="min-w-0 text-[12.5px] leading-relaxed text-ink">
        <p className="font-medium text-warn">本次变更需要重启网关才能生效</p>
        <p className="mt-0.5 text-ink-soft">{text}</p>
      </div>
    </div>
  )
}

/** 渲染预览抽屉 */
export function PreviewDrawer({
  open,
  onClose,
  preview,
  loading,
  error,
  onPublish,
}: {
  open: boolean
  onClose: () => void
  preview?: RenderPreview
  loading: boolean
  error?: Error
  onPublish: () => void
}) {
  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={860}
      title="渲染预览"
      subtitle="只渲染，不落库、不写 KV。这段文本与发布出去的逐字节相同。"
      footer={
        <>
          <button className="btn" onClick={onClose}>
            关闭
          </button>
          <button className="btn btn-primary" onClick={onPublish} disabled={loading || !!error}>
            去发布
          </button>
        </>
      }
    >
      <div className="grid gap-3 p-5">
        {loading && (
          <div className="flex items-center gap-2 py-10 text-[13px] text-ink-mute">
            <Spinner size={15} /> 正在渲染…
          </div>
        )}
        {error && (
          <div className="rounded-xl border border-[color-mix(in_srgb,var(--danger)_35%,transparent)] bg-danger-soft px-3 py-2.5 text-[12.5px] text-danger">
            渲染失败：{error.message}
          </div>
        )}
        {preview && !loading && (
          <>
            <div className="flex flex-wrap items-center gap-1.5">
              <CountChip label="HTTP 监听器" value={preview.httpListeners} />
              <CountChip label="TCP 监听器" value={preview.tcpListeners} />
              <CountChip label="路由" value={preview.routes} />
              <CountChip label="TCP 路由" value={preview.tcpRoutes} />
              <CountChip label="负载均衡器" value={preview.balancers} />
              <span className="ml-auto mono text-[11px] text-ink-mute" title={preview.checksum}>
                sha256 {shortChecksum(preview.checksum)}
              </span>
            </div>
            {preview.structuralChange && <StructuralBanner text={preview.structuralChange} />}
            <WarningList warnings={preview.warnings} />
            <CodeView code={preview.toml} maxHeight={560} />
          </>
        )}
      </div>
    </Drawer>
  )
}

/** 发布确认弹窗 */
export function PublishDialog({
  open,
  onClose,
  preview,
  loading,
  previewError,
  busy,
  error,
  onConfirm,
}: {
  open: boolean
  onClose: () => void
  preview?: RenderPreview
  loading: boolean
  previewError?: Error
  busy: boolean
  error?: string
  onConfirm: (opts: { force: boolean; confirmRestart: boolean }) => void
}) {
  const [force, setForce] = useState(false)
  const [confirmed, setConfirmed] = useState(false)

  useEffect(() => {
    if (open) {
      setForce(false)
      setConfirmed(false)
    }
  }, [open])

  const structural = preview?.structuralChange ?? null
  const needConfirm = Boolean(structural)
  const canSubmit = !busy && !loading && !previewError && (!needConfirm || confirmed)

  return (
    <Modal
      open={open}
      onClose={onClose}
      width={620}
      title="发布到 Consul KV"
      description="发布 = 把当前配置渲染成完整 TOML，落一条版本记录，再 PUT 到网关 watch 的那个键。"
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button
            className="btn btn-primary"
            onClick={() => onConfirm({ force, confirmRestart: confirmed })}
            disabled={!canSubmit}
          >
            {busy ? '发布中…' : '确认发布'}
          </button>
        </>
      }
    >
      <div className="grid gap-3">
        {loading && (
          <div className="flex items-center gap-2 py-6 text-[13px] text-ink-mute">
            <Spinner size={15} /> 正在渲染并比对上一版…
          </div>
        )}
        {previewError && (
          <div className="rounded-xl border border-[color-mix(in_srgb,var(--danger)_35%,transparent)] bg-danger-soft px-3 py-2.5 text-[12.5px] text-danger">
            渲染失败：{previewError.message}
          </div>
        )}
        {preview && !loading && (
          <>
            <div className="grid grid-cols-2 gap-2 rounded-xl border border-line bg-surface-sunken px-3 py-2.5 text-[12px]">
              <div>
                <p className="text-ink-mute">内容摘要</p>
                <p className="mono mt-0.5 text-ink">{shortChecksum(preview.checksum)}</p>
              </div>
              <div>
                <p className="text-ink-mute">构成</p>
                <p className="mt-0.5 text-ink">
                  {preview.httpListeners + preview.tcpListeners} 监听器 · {preview.routes} 路由 ·{' '}
                  {preview.balancers} LB
                </p>
              </div>
            </div>

            {needConfirm ? (
              <>
                <StructuralBanner text={structural!} />
                <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-[color-mix(in_srgb,var(--warn)_38%,transparent)] bg-warn-soft px-3 py-2.5">
                  <input
                    type="checkbox"
                    className="mt-0.5 accent-[var(--warn)]"
                    checked={confirmed}
                    onChange={(e) => setConfirmed(e.target.checked)}
                  />
                  <span className="text-[12.5px] leading-relaxed text-ink">
                    我确认本次发布会重启网关，期间在途请求会断。
                  </span>
                </label>
              </>
            ) : (
              <div className="flex items-start gap-2 rounded-xl border border-line bg-surface-sunken px-3 py-2.5 text-[12.5px] text-ink-soft">
                <IconCheck size={15} className="mt-0.5 shrink-0 text-ok" />
                本次变更不涉及启动期资源，网关会热更新，不需要重启。
              </div>
            )}

            <WarningList warnings={preview.warnings} />

            <label className="flex cursor-pointer items-start gap-2 px-0.5">
              <input
                type="checkbox"
                className="mt-0.5 accent-[var(--brand)]"
                checked={force}
                onChange={(e) => setForce(e.target.checked)}
              />
              <span className="text-[12px] leading-relaxed text-ink-soft">
                内容与线上版本一致时也强制推送
                <span className="block text-[11.5px] text-ink-mute">
                  只在「KV 被手工改过、要按库里的配置盖回去」时才需要。
                </span>
              </span>
            </label>
          </>
        )}

        {error && (
          <div className="rounded-xl border border-[color-mix(in_srgb,var(--danger)_35%,transparent)] bg-danger-soft px-3 py-2.5 text-[12.5px] leading-relaxed text-danger">
            {error}
          </div>
        )}
      </div>
    </Modal>
  )
}

/** 发布 / 回滚结果回执 */
export function ResultDialog({
  open,
  onClose,
  title,
  result,
}: {
  open: boolean
  onClose: () => void
  title: string
  result?: PublishResult | null
}) {
  if (!result) return null
  return (
    <Modal
      open={open}
      onClose={onClose}
      width={560}
      title={title}
      footer={
        <button className="btn btn-primary" onClick={onClose}>
          知道了
        </button>
      }
    >
      <div className="grid gap-3">
        <div className="flex items-center gap-2">
          {result.skipped ? (
            <Badge tone="mute">未重复推送</Badge>
          ) : (
            <Badge tone="ok">已写入 KV</Badge>
          )}
          <Badge tone="brand">v{result.version}</Badge>
          <span className="mono text-[11px] text-ink-mute">{shortChecksum(result.checksum)}</span>
        </div>

        <dl className="grid grid-cols-[88px_1fr] gap-y-1.5 rounded-xl border border-line bg-surface-sunken px-3 py-2.5 text-[12px]">
          <dt className="text-ink-mute">KV key</dt>
          <dd className="mono break-all text-ink">{result.consulKey}</dd>
          <dt className="text-ink-mute">ModifyIndex</dt>
          <dd className="mono text-ink">
            {result.modifyIndex ?? '—'}
            <span className="ml-1.5 font-sans text-[11px] text-ink-mute">
              （回读到的真实索引）
            </span>
          </dd>
          <dt className="text-ink-mute">发布时间</dt>
          <dd className="text-ink">{formatTime(Date.now())}</dd>
        </dl>

        {result.structuralChange && <StructuralBanner text={result.structuralChange} />}

        {result.warnings.length > 0 && <WarningList warnings={result.warnings} />}

        <div className="flex items-start gap-1.5 text-[11.5px] leading-relaxed text-ink-mute">
          <IconInfo size={13} className="mt-[2px] shrink-0" />
          <p className="min-w-0">
            写入 KV 只代表 Consul 收下了。网关什么时候读到、要不要重启，由它自己的配置监听
            与 <span className="mono">structuralChange</span> 决定——可以在网关的{' '}
            <span className="mono">/health</span> 里看 <span className="mono">config-state</span>。
          </p>
        </div>
      </div>
    </Modal>
  )
}

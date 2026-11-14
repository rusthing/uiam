/**
 * 网关工作区：一个实例的全部可编辑面。
 *
 * 数据流是「一个 hook 取整棵子树 + 一个 reload」：改完监听器/路由/LB 之后统一刷新，
 * 避免出现「路由列表更新了但发布预览还是旧的」这种最难查的错觉。
 *
 * 发布相关的三个状态（预览、确认、回执）都放在这一层，因为它们共享同一份
 * `preview`——确认弹窗必须显示「即将发出的那份配置」的摘要与结构变更说明，
 * 让用户在同一屏里看到后果再决定。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { api, ApiError } from '../lib/api'
import { describeAddrs } from '../lib/format'
import type { PublishResult, Release, RenderPreview } from '../lib/types'
import { useGatewayList } from '../state/GatewayList'
import { useGatewayTree } from '../state/useGatewayTree'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { GatewayForm } from '../components/GatewayForm'
import { PublishDialog, PreviewDrawer, ResultDialog } from '../components/Publish'
import { useToast } from '../components/Toast'
import { Badge, Spinner, cx } from '../components/ui'
import {
  IconEdit,
  IconEye,
  IconHistory,
  IconRefresh,
  IconRoute,
  IconScale,
  IconServer,
  IconTrash,
  IconUpload,
} from '../components/icons'
import { OverviewTab } from './tabs/OverviewTab'
import { ListenersTab } from './tabs/ListenersTab'
import { RoutesTab } from './tabs/RoutesTab'
import { BalancersTab } from './tabs/BalancersTab'
import { ReleasesTab } from './tabs/ReleasesTab'

type TabKey = 'overview' | 'listeners' | 'routes' | 'balancers' | 'releases'

const TABS: Array<{ key: TabKey; label: string; icon: typeof IconServer }> = [
  { key: 'overview', label: '概览', icon: IconServer },
  { key: 'listeners', label: '监听器', icon: IconServer },
  { key: 'routes', label: '路由', icon: IconRoute },
  { key: 'balancers', label: '负载均衡器', icon: IconScale },
  { key: 'releases', label: '发布历史', icon: IconHistory },
]

export function GatewayPage() {
  const { gatewayId } = useParams<{ gatewayId: string }>()
  const { gateways, loading: listLoading, reload: reloadList } = useGatewayList()
  const tree = useGatewayTree(gatewayId)
  const toast = useToast()
  const navigate = useNavigate()

  const gateway = useMemo(
    () => gateways.find((g) => g.id === gatewayId),
    [gateways, gatewayId],
  )

  // 当前标签放在 URL 里：这样「把某个实例的路由页发给同事」是可行的，
  // 刷新也不会退回概览
  const [searchParams, setSearchParams] = useSearchParams()
  const tabParam = searchParams.get('tab')
  const tab: TabKey = TABS.some((t) => t.key === tabParam) ? (tabParam as TabKey) : 'overview'
  const setTab = (key: TabKey) => {
    const next = new URLSearchParams(searchParams)
    if (key === 'overview') next.delete('tab')
    else next.set('tab', key)
    setSearchParams(next, { replace: true })
  }

  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  // ---- 发布链路状态 ----
  const [preview, setPreview] = useState<RenderPreview | undefined>(undefined)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState<Error | undefined>(undefined)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [publishOpen, setPublishOpen] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [publishError, setPublishError] = useState<string | undefined>(undefined)
  const [result, setResult] = useState<{ title: string; data: PublishResult } | null>(null)

  // ---- 回滚状态 ----
  const [rollbackTarget, setRollbackTarget] = useState<Release | null>(null)
  const [rollbackNeedConfirm, setRollbackNeedConfirm] = useState<string | undefined>(undefined)
  const [rollbackBusy, setRollbackBusy] = useState(false)

  // 切实例时把所有一次性状态清掉，否则会把上一个实例的预览带过来
  useEffect(() => {
    setPreview(undefined)
    setPreviewError(undefined)
    setPreviewOpen(false)
    setPublishOpen(false)
    setResult(null)
  }, [gatewayId])

  const loadPreview = useCallback(async () => {
    if (!gatewayId) return
    setPreviewLoading(true)
    setPreviewError(undefined)
    try {
      const data = await api.publish.preview(gatewayId)
      setPreview(data)
    } catch (e) {
      setPreviewError(e as Error)
      setPreview(undefined)
    } finally {
      setPreviewLoading(false)
    }
  }, [gatewayId])

  const openPreview = () => {
    setPreviewOpen(true)
    void loadPreview()
  }

  const openPublish = () => {
    setPublishError(undefined)
    setPublishOpen(true)
    void loadPreview()
  }

  const doPublish = async (opts: { force: boolean; confirmRestart: boolean }) => {
    if (!gatewayId) return
    setPublishing(true)
    setPublishError(undefined)
    try {
      const data = await api.publish.publish(gatewayId, opts)
      setPublishOpen(false)
      setResult({ title: data.skipped ? '内容未变化，已跳过推送' : '发布完成', data })
      tree.reload()
    } catch (e) {
      setPublishError((e as ApiError).message)
    } finally {
      setPublishing(false)
    }
  }

  const doRollback = async (confirmRestart: boolean) => {
    if (!rollbackTarget) return
    setRollbackBusy(true)
    try {
      const data = await api.publish.rollback(rollbackTarget.id, { confirmRestart })
      setRollbackTarget(null)
      setRollbackNeedConfirm(undefined)
      setResult({ title: '回滚完成', data })
      tree.reload()
    } catch (e) {
      const err = e as ApiError
      // 服务端在「需要重启但没确认」时返回 400 且 msg 说明原因：把这句话原样
      // 变成「必须勾选才能继续」的闸门，比前端自己猜什么时候要重启更可靠
      if (err.status === 400 && err.message.includes('重启')) {
        setRollbackNeedConfirm(err.message)
      } else {
        toast.error(err.message)
        setRollbackTarget(null)
      }
    } finally {
      setRollbackBusy(false)
    }
  }

  const doDelete = async () => {
    if (!gateway) return
    try {
      await api.gateway.remove(gateway.id)
      toast.success(`已删除「${gateway.name}」`)
      setDeleteOpen(false)
      reloadList()
      navigate('/')
    } catch (e) {
      toast.error((e as ApiError).message)
    }
  }

  if (listLoading && !gateway) {
    return (
      <div className="flex h-[60vh] items-center justify-center gap-2 text-[13px] text-ink-mute">
        <Spinner size={16} /> 加载网关实例…
      </div>
    )
  }

  if (!gateway) {
    return (
      <div className="mx-auto max-w-[560px] px-6 py-24 text-center">
        <p className="text-[15px] font-medium text-ink">找不到这个网关实例</p>
        <p className="mt-1.5 text-[12.5px] text-ink-mute">
          它可能已被删除，或者链接里的 id 不对。
        </p>
        <button className="btn mt-4" onClick={() => navigate('/')}>
          回到实例列表
        </button>
      </div>
    )
  }

  const counts: Record<TabKey, number | undefined> = {
    overview: undefined,
    listeners: tree.listeners.length,
    routes: tree.routes.length,
    balancers: tree.balancers.length,
    releases: tree.releases.length,
  }

  const addrSummary = tree.listeners
    .filter((l) => l.enabled)
    .flatMap((l) => describeAddrs(l.addrsJson))
    .slice(0, 3)

  return (
    <div className="mx-auto w-full max-w-[1240px] px-4 py-4 lg:px-8 lg:py-6">
      {/* 标题区 */}
      <header className="mb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-[20px] font-semibold tracking-tight text-ink">{gateway.name}</h1>
              <span className="mono rounded-md border border-line bg-surface-sunken px-1.5 py-0.5 text-[11.5px] text-ink-soft">
                {gateway.code}
              </span>
              {gateway.enabled ? <Badge tone="ok">启用</Badge> : <Badge tone="mute">停用</Badge>}
            </div>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-ink-mute">
              <span className="mono">{gateway.consulKey}</span>
              {addrSummary.length > 0 && (
                <>
                  <span>·</span>
                  <span className="mono">{addrSummary.join(' / ')}</span>
                </>
              )}
              {gateway.remark && (
                <>
                  <span>·</span>
                  <span className="max-w-[42ch] truncate">{gateway.remark}</span>
                </>
              )}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button className="btn btn-ghost btn-sm" onClick={tree.reload} title="刷新数据">
              <IconRefresh size={13} className={tree.loading ? 'animate-spin' : ''} />
            </button>
            <button className="btn btn-sm" onClick={() => setEditOpen(true)}>
              <IconEdit size={13} /> 编辑
            </button>
            <button
              className="btn btn-ghost btn-sm !px-1.5 text-ink-mute hover:text-danger"
              onClick={() => setDeleteOpen(true)}
              title="删除实例"
            >
              <IconTrash size={13} />
            </button>
            <button className="btn btn-sm" onClick={openPreview}>
              <IconEye size={13} /> 渲染预览
            </button>
            <button className="btn btn-primary btn-sm" onClick={openPublish}>
              <IconUpload size={13} /> 发布
            </button>
          </div>
        </div>

        {/* 标签栏 */}
        <nav className="mt-4 flex gap-1 overflow-x-auto border-b border-line pb-0">
          {TABS.map(({ key, label, icon: Icon }) => {
            const active = tab === key
            const count = counts[key]
            return (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={cx(
                  'relative flex shrink-0 items-center gap-1.5 rounded-t-lg px-3 py-2 text-[13px] transition-colors',
                  active ? 'text-ink' : 'text-ink-mute hover:text-ink-soft',
                )}
              >
                <Icon size={14} />
                {label}
                {count !== undefined && count > 0 && (
                  <span
                    className={cx(
                      'rounded-md px-1 text-[10.5px] leading-[16px]',
                      active ? 'bg-brand-soft text-brand' : 'bg-surface-sunken text-ink-mute',
                    )}
                  >
                    {count}
                  </span>
                )}
                {active && (
                  <span className="absolute inset-x-1.5 -bottom-px h-[2px] rounded-full bg-brand" />
                )}
              </button>
            )
          })}
        </nav>
      </header>

      {tree.error && (
        <div className="mb-4 rounded-xl border border-[color-mix(in_srgb,var(--danger)_35%,transparent)] bg-danger-soft px-3.5 py-2.5 text-[12.5px] text-danger">
          加载配置失败：{tree.error.message}
          <button className="ml-2 underline" onClick={tree.reload}>
            重试
          </button>
        </div>
      )}

      {tab === 'overview' && (
        <OverviewTab gateway={gateway} tree={tree} onPreview={openPreview} />
      )}
      {tab === 'listeners' && (
        <ListenersTab
          gatewayId={gateway.id}
          listeners={tree.listeners}
          routes={tree.routes}
          loading={tree.loading}
          onChanged={tree.reload}
        />
      )}
      {tab === 'routes' && (
        <RoutesTab
          listeners={tree.listeners}
          routes={tree.routes}
          loading={tree.loading}
          onChanged={tree.reload}
        />
      )}
      {tab === 'balancers' && (
        <BalancersTab
          gatewayId={gateway.id}
          balancers={tree.balancers}
          routes={tree.routes}
          loading={tree.loading}
          onChanged={tree.reload}
        />
      )}
      {tab === 'releases' && (
        <ReleasesTab
          releases={tree.releases}
          loading={tree.loading}
          onRollback={(release) => {
            setRollbackNeedConfirm(undefined)
            setRollbackTarget(release)
          }}
        />
      )}

      <GatewayForm
        open={editOpen}
        gateway={gateway}
        onClose={() => setEditOpen(false)}
        onSaved={() => {
          reloadList()
          tree.reload()
        }}
      />

      <ConfirmDialog
        open={deleteOpen}
        title="删除网关实例"
        danger
        confirmText="删除"
        description={
          <>
            将删除 <b>{gateway.name}</b> 及其全部监听器、路由、负载均衡器与发布记录。
            Consul KV 里已经推上去的配置**不会被删除**——网关会继续按那份配置运行，
            直到有人写入新的内容。
          </>
        }
        onCancel={() => setDeleteOpen(false)}
        onConfirm={doDelete}
      />

      <PreviewDrawer
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        preview={preview}
        loading={previewLoading}
        error={previewError}
        onPublish={() => {
          setPreviewOpen(false)
          openPublish()
        }}
      />

      <PublishDialog
        open={publishOpen}
        onClose={() => setPublishOpen(false)}
        preview={preview}
        loading={previewLoading}
        previewError={previewError}
        busy={publishing}
        error={publishError}
        onConfirm={doPublish}
      />

      <ConfirmDialog
        open={Boolean(rollbackTarget)}
        title={`回滚到 v${rollbackTarget?.version ?? ''}`}
        confirmText="确认回滚"
        busy={rollbackBusy}
        description={
          <>
            把 v{rollbackTarget?.version} 的 <b>content 原样</b>再推一次，生成一个新版本。
            注意：<span className="text-ink">回滚只改 Consul KV，不改库里的配置行</span>
            ——下次发布会把库里现在的配置重新推上去，等于撤销这次回滚。
          </>
        }
        requireCheck={rollbackNeedConfirm}
        onCancel={() => {
          setRollbackTarget(null)
          setRollbackNeedConfirm(undefined)
        }}
        onConfirm={() => doRollback(Boolean(rollbackNeedConfirm))}
      />

      <ResultDialog
        open={Boolean(result)}
        onClose={() => setResult(null)}
        title={result?.title ?? ''}
        result={result?.data}
      />
    </div>
  )
}

/**
 * 桌面组件的具体渲染。
 *
 * 一条硬规矩：**这里没有假数据**。8 个组件全部由「网关实例 + 发布历史」两份真实
 * 数据推导。加载态用半透明骨架形状而不是「加载中…」文字（HIG 要求 placeholder
 * 由静态界面组件 + 半透明形状组成），大尺寸组件才显示「更新于 …」——widget
 * 不做实时刷新，说清数据年龄比假装在动更诚实。
 *
 * `size` 决定信息增量：small 只给一个关键数字，medium 加一行趋势，large/XL 才
 * 展开列表。不是把小卡内容等比放大去填满大卡。
 */
import { useEffect, useState } from 'react'
import { APPS } from '../apps/meta'
import { AppTile } from '../apps/AppTile'
import { selectGateway } from '../apps/selection'
import { relativeTime } from '../lib/format'
import type { Gateway, Release } from '../lib/types'
import { useOverview, type ReleaseRow } from './overview'
import { useShell } from './state'
import type { WidgetId, WidgetSize } from './useWidgetLayout'

/** 每个实例「最新一版」的状态；桌面上所有跟发布有关的判断都基于它 */
interface Issue {
  gateway: Gateway
  kind: 'never' | 'failed'
  release?: Release
}

function computeIssues(gateways: Gateway[], releases: ReleaseRow[]): Issue[] {
  const latest = new Map<string, Release>()
  for (const row of releases) {
    if (!latest.has(row.gateway.id)) latest.set(row.gateway.id, row.release)
  }
  const issues: Issue[] = []
  for (const gateway of gateways) {
    // 停用的实例不产生待办：它本来就不该被推配置
    if (!gateway.enabled) continue
    const release = latest.get(gateway.id)
    if (!release) issues.push({ gateway, kind: 'never' })
    else if (!release.pushed) issues.push({ gateway, kind: 'failed', release })
  }
  return issues
}

/** 数据加载中的占位：静态标题 + 半透明形状，不写「加载中…」 */
export function WidgetSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="wg-skeleton" aria-hidden="true">
      <div className="wg-sk-pill" />
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className={`wg-sk-line w${(i % 3) + 1}`} />
      ))}
    </div>
  )
}

/** 只在 medium 以上显示，避免 small 被一行时间戳挤掉主信息 */
export function WidgetUpdatedAt() {
  const { updatedAt, loading } = useOverview()
  if (!updatedAt) return null
  return (
    <div className="wg-updated">
      {loading ? '正在更新…' : `更新于 ${relativeTime(updatedAt)}`}
    </div>
  )
}

/* ---------- 时钟 ---------- */
function ClockWidget() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    let timer: number
    const tick = () => {
      setNow(new Date())
      const d = new Date()
      // 对齐到下一分钟刷新，而不是每 15s 无脑刷：时钟不会漂在分钟边界外
      timer = window.setTimeout(tick, (60 - d.getSeconds()) * 1000 - d.getMilliseconds() + 20)
    }
    tick()
    return () => window.clearTimeout(timer)
  }, [])
  const p = (n: number) => String(n).padStart(2, '0')
  const wd = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][now.getDay()]
  return (
    <div className="wg-clock">
      <div className="wg-time">
        {p(now.getHours())}:{p(now.getMinutes())}
      </div>
      <div className="wg-date">
        {now.getMonth() + 1}月{now.getDate()}日 {wd}
      </div>
    </div>
  )
}

/* ---------- 网关实例数 ---------- */
function CountWidget({ size }: { size: WidgetSize }) {
  const { gateways, loading } = useOverview()
  const n = gateways.length
  return (
    <>
      <div className="wg-k">网关实例</div>
      {loading && n === 0 ? (
        <WidgetSkeleton lines={1} />
      ) : (
        <div className="wg-kpi">
          {/* key 变化触发一次 0.6s 的更新动画（HIG：更新动画不超过 2s） */}
          <div className="wg-num wg-fresh" key={n}>
            {n}
            <small>个</small>
          </div>
          {size !== 'small' && (
            <div className="wg-updated" style={{ marginTop: 4 }}>
              共 {gateways.filter((g) => g.enabled).length} 个启用
            </div>
          )}
        </div>
      )}
    </>
  )
}

/* ---------- 启用中 ---------- */
function EnabledWidget({ size }: { size: WidgetSize }) {
  const { gateways } = useOverview()
  const enabled = gateways.filter((g) => g.enabled).length
  const pct = gateways.length ? Math.round((enabled / gateways.length) * 100) : 0
  const disabled = gateways.length - enabled
  const C = 2 * Math.PI * 18
  return (
    <>
      <div className="wg-k">启用中</div>
      <div className="wg-kpi row">
        <div>
          <div className="wg-num wg-fresh" key={enabled}>
            {enabled}
            <small>/ {gateways.length}</small>
          </div>
          {size !== 'small' && (
            <div>
              <span className={`wg-trend${disabled > 0 ? ' down' : ''}`}>
                {disabled > 0 ? `▲ ${disabled} 个停用` : `▲ ${pct}%`}
              </span>
            </div>
          )}
        </div>
        <svg className="wg-ring" viewBox="0 0 44 44" aria-hidden="true">
          <circle className="track" cx="22" cy="22" r="18" />
          <circle
            className="val"
            cx="22"
            cy="22"
            r="18"
            strokeDasharray={C}
            strokeDashoffset={C * (1 - pct / 100)}
          />
        </svg>
      </div>
    </>
  )
}

/* ---------- 快捷应用 ---------- */
function AppsWidget() {
  const shell = useShell()
  return (
    <>
      <div className="wg-k">快捷应用</div>
      <div className="wg-apps">
        {APPS.map((a) => (
          <button key={a.id} className="wg-app" onClick={() => shell.openApp(a.id)} title={a.desc}>
            <AppTile id={a.id} />
            <span>{a.name}</span>
          </button>
        ))}
      </div>
    </>
  )
}

/* ---------- 实例状态 ---------- */
function NodesWidget({ size }: { size: WidgetSize }) {
  const { gateways, loading, error, reload } = useOverview()
  const shell = useShell()
  const enabled = gateways.filter((g) => g.enabled).length
  const max = size === 'small' ? 2 : size === 'medium' ? 3 : size === 'xl' ? 8 : 6
  if (error) {
    return (
      <>
        <div className="wg-k">实例状态</div>
        <div className="wg-list">
          <div className="wg-row">
            <span className="d warn" />
            <span className="grow">
              <span className="nm">接口连不上</span>{' '}
              <span className="sub">{error.message.slice(0, 28)}</span>
            </span>
            <button className="wg-btn" onClick={reload}>
              重试
            </button>
          </div>
        </div>
      </>
    )
  }
  return (
    <>
      <div className="wg-k">实例状态</div>
      {loading && gateways.length === 0 ? (
        <WidgetSkeleton />
      ) : (
        <>
          <div className="wg-list">
            {gateways.slice(0, max).map((g) => (
              <div
                key={g.id}
                className="wg-row"
                style={{ cursor: 'pointer' }}
                onClick={() => {
                  selectGateway(g.id)
                  shell.openApp('gateway')
                }}
              >
                <span className={`d ${g.enabled ? '' : 'off'}`} />
                <span className="grow">
                  <span className="nm">{g.name}</span>{' '}
                  <span className="sub mono">{g.consulKey}</span>
                </span>
                <span className="ms">{relativeTime(g.updateMs)}</span>
              </div>
            ))}
            {gateways.length === 0 && (
              <div className="wg-row">
                <span className="grow">
                  <span className="sub">还没有网关实例，去「网关配置」新建一个</span>
                </span>
              </div>
            )}
          </div>
          {gateways.length > 0 && size !== 'small' && (
            <div className="wg-sum">
              <span>
                <b>{enabled}</b> 启用
              </span>
              <span>
                <b>{gateways.length - enabled}</b> 停用
              </span>
              <span className="wg-sum-all">共 {gateways.length} 个实例</span>
            </div>
          )}
        </>
      )}
    </>
  )
}

/* ---------- 最近发布 ---------- */
function ReleasesWidget({ size }: { size: WidgetSize }) {
  const { releases, loading } = useOverview()
  const max = size === 'xl' ? 8 : size === 'large' ? 6 : 3
  const rows = releases.slice(0, max)
  return (
    <>
      <div className="wg-k">最近发布</div>
      {loading && rows.length === 0 ? (
        <WidgetSkeleton />
      ) : (
        <div className="wg-list">
          {rows.map(({ gateway, release }) => (
            <div key={release.id} className="wg-row">
              <span className="grow">
                <span className="nm">
                  v{release.version} · {gateway.name}
                </span>{' '}
                <span className="sub">{relativeTime(release.createMs)}</span>
              </span>
              <span className={`tag ${release.pushed ? '' : 'warn'}`}>
                {release.pushed ? '已推送' : '未推送'}
              </span>
            </div>
          ))}
          {rows.length === 0 && (
            <div className="wg-row">
              <span className="grow">
                <span className="sub">还没有发布记录</span>
              </span>
            </div>
          )}
        </div>
      )}
    </>
  )
}

/* ---------- 待推送 ---------- */
function UnpushedWidget({ size }: { size: WidgetSize }) {
  const { gateways, releases } = useOverview()
  const issues = computeIssues(gateways, releases)
  const failed = issues.filter((i) => i.kind === 'failed').length
  return (
    <>
      <div className="wg-k">待推送</div>
      <div className="wg-kpi">
        <div className="wg-num wg-fresh" key={issues.length}>{issues.length}</div>
        {size !== 'small' && (
          <div>
            <span className={`wg-trend${failed > 0 ? ' down' : ''}`}>
              {failed > 0 ? `${failed} 条推送失败` : issues.length > 0 ? '含未发布实例' : '全部已同步'}
            </span>
          </div>
        )}
      </div>
    </>
  )
}

/* ---------- 待处理 ---------- */
function AttentionWidget({ size }: { size: WidgetSize }) {
  const { gateways, releases, loading } = useOverview()
  const shell = useShell()
  const issues = computeIssues(gateways, releases)
  const max = size === 'xl' ? 6 : size === 'large' ? 5 : 3
  const rows = issues.slice(0, max)
  return (
    <>
      <div className="wg-k">待处理</div>
      {loading && issues.length === 0 ? (
        <WidgetSkeleton />
      ) : (
        <div className="wg-list">
          {rows.map((it) => (
            <div key={it.gateway.id} className="wg-row">
              <span className="grow">
                <span className="nm">{it.gateway.name}</span>{' '}
                <span className="sub">
                  {it.kind === 'never'
                    ? '从未发布，网关侧读不到配置'
                    : `v${it.release?.version} 已生成但没写进 KV`}
                </span>
              </span>
              <button
                className="wg-btn"
                onClick={() => {
                  selectGateway(it.gateway.id)
                  shell.openApp('gateway')
                }}
              >
                去发布
              </button>
            </div>
          ))}
          {rows.length === 0 && (
            <div className="wg-row">
              <span className="d" />
              <span className="grow">
                <span className="sub">没有待处理项——所有启用实例的最新版本都已推送</span>
              </span>
            </div>
          )}
        </div>
      )}
    </>
  )
}

export function WidgetBody({ id, size }: { id: WidgetId; size: WidgetSize }) {
  switch (id) {
    case 'clock':
      return <ClockWidget />
    case 'count':
      return <CountWidget size={size} />
    case 'enabled':
      return <EnabledWidget size={size} />
    case 'apps':
      return <AppsWidget />
    case 'nodes':
      return <NodesWidget size={size} />
    case 'releases':
      return <ReleasesWidget size={size} />
    case 'unpushed':
      return <UnpushedWidget size={size} />
    case 'attention':
      return <AttentionWidget size={size} />
    default:
      return null
  }
}

/**
 * 桌面组件的具体渲染。
 *
 * 一条硬规矩：**这里没有假数据**。原型上的「在线用户 128」「今日登录 1,204」是
 * 为了看排版，真跑起来必须换成接口里真有的东西，否则桌面上第一个数字就是错的。
 * 所以 8 个组件全部由「网关实例 + 发布历史」两份真实数据推导：
 * 实例数、启用数、实例状态、最近发布、待推送、待处理。
 */
import { useEffect, useState } from 'react'
import { APPS } from '../apps/meta'
import { AppTile } from '../apps/AppTile'
import { selectGateway } from '../apps/selection'
import { relativeTime } from '../lib/format'
import type { Gateway, Release } from '../lib/types'
import { useOverview, type ReleaseRow } from './overview'
import { useShell } from './state'
import type { WidgetId } from './useWidgetLayout'

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

/* ---------- 时钟 ---------- */
function ClockWidget() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 15000)
    return () => window.clearInterval(t)
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
function CountWidget() {
  const { gateways, loading } = useOverview()
  return (
    <>
      <div className="wg-k">网关实例</div>
      <div className="wg-kpi">
        <div className="wg-num">
          {loading && gateways.length === 0 ? '—' : gateways.length}
          <small>个</small>
        </div>
      </div>
    </>
  )
}

/* ---------- 启用中 ---------- */
function EnabledWidget() {
  const { gateways } = useOverview()
  const enabled = gateways.filter((g) => g.enabled).length
  const pct = gateways.length ? Math.round((enabled / gateways.length) * 100) : 0
  const disabled = gateways.length - enabled
  return (
    <>
      <div className="wg-k">启用中</div>
      <div className="wg-kpi">
        <div className="wg-num">
          {enabled}
          <small>/ {gateways.length}</small>
        </div>
        <div>
          <span className={`wg-trend${disabled > 0 ? ' down' : ''}`}>
            {disabled > 0 ? `▲ ${disabled} 个停用` : `▲ ${pct}%`}
          </span>
        </div>
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
function NodesWidget() {
  const { gateways, loading, error, reload } = useOverview()
  const shell = useShell()
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
      <div className="wg-list">
        {gateways.slice(0, 4).map((g) => (
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
              <span className="sub">{loading ? '加载中…' : '还没有网关实例，去「网关配置」新建一个'}</span>
            </span>
          </div>
        )}
      </div>
    </>
  )
}

/* ---------- 最近发布 ---------- */
function ReleasesWidget() {
  const { releases, loading } = useOverview()
  const rows = releases.slice(0, 3)
  return (
    <>
      <div className="wg-k">最近发布</div>
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
              <span className="sub">{loading ? '加载中…' : '还没有发布记录'}</span>
            </span>
          </div>
        )}
      </div>
    </>
  )
}

/* ---------- 待推送 ---------- */
function UnpushedWidget() {
  const { gateways, releases } = useOverview()
  const issues = computeIssues(gateways, releases)
  const failed = issues.filter((i) => i.kind === 'failed').length
  return (
    <>
      <div className="wg-k">待推送</div>
      <div className="wg-kpi">
        <div className="wg-num">{issues.length}</div>
        <div>
          <span className={`wg-trend${failed > 0 ? ' down' : ''}`}>
            {failed > 0 ? `${failed} 条推送失败` : issues.length > 0 ? '含未发布实例' : '全部已同步'}
          </span>
        </div>
      </div>
    </>
  )
}

/* ---------- 待处理 ---------- */
function AttentionWidget() {
  const { gateways, releases, loading } = useOverview()
  const shell = useShell()
  const issues = computeIssues(gateways, releases)
  const rows = issues.slice(0, 3)
  return (
    <>
      <div className="wg-k">待处理</div>
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
              <span className="sub">
                {loading ? '加载中…' : '没有待处理项——所有启用实例的最新版本都已推送'}
              </span>
            </span>
          </div>
        )}
      </div>
    </>
  )
}

export function WidgetBody({ id }: { id: WidgetId }) {
  switch (id) {
    case 'clock':
      return <ClockWidget />
    case 'count':
      return <CountWidget />
    case 'enabled':
      return <EnabledWidget />
    case 'apps':
      return <AppsWidget />
    case 'nodes':
      return <NodesWidget />
    case 'releases':
      return <ReleasesWidget />
    case 'unpushed':
      return <UnpushedWidget />
    case 'attention':
      return <AttentionWidget />
    default:
      return null
  }
}

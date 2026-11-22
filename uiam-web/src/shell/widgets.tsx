/**
 * 桌面组件的具体渲染。
 *
 * 一条硬规矩：**这里没有假数据**。网关类组件由「实例 + 发布历史」推导，天气取
 * Open-Meteo 的真实观测/预报，日历和时钟用本机真实时间；拿不到数据就显示骨架
 * 或明确的失败态，不拿编造的数字填坑。
 *
 * 加载态用半透明骨架形状而不是「加载中…」文字。大尺寸组件显示「更新于 …」，
 * 说清数据年龄比假装在动更诚实；时钟与日历本来就是实时数据，不需要时间戳。
 *
 * `size` 决定信息增量：small 只给一个关键数字，medium 加一行趋势，large/XL 才
 * 展开列表/表盘/整月。不是把小卡内容等比放大去填满大卡。
 */
import { useEffect, useState, type FormEvent as ReactFormEvent } from 'react'
import { APPS } from '../apps/meta'
import { AppTile } from '../apps/AppTile'
import { selectGateway } from '../apps/selection'
import { cx } from '../components/ui'
import { relativeTime } from '../lib/format'
import { solarToLunar } from '../lib/lunar'
import type { Gateway, Release } from '../lib/types'
import {
  addWeatherCity,
  geocodeCity,
  removeWeatherCity,
  setWeatherCity,
  useWeather,
  useWeatherCity,
  weatherInfo,
  type WeatherKind,
} from '../lib/weather'
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

/* ---------- 生活类组件共用的时间基线与文案 ---------- */

const WEEK_SHORT = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
/** 参考图的日历是周日开头 */
const WEEK_LETTERS = ['日', '一', '二', '三', '四', '五', '六']

/** 对齐到分钟（无秒）或秒边界（有秒/表盘）刷新，不让时钟漂在边界外 */
function useNow(showSeconds: boolean) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    let timer: number
    const tick = () => {
      const d = new Date()
      setNow(d)
      timer = window.setTimeout(
        tick,
        showSeconds ? 1000 - d.getMilliseconds() + 10 : (60 - d.getSeconds()) * 1000 - d.getMilliseconds() + 20,
      )
    }
    tick()
    return () => window.clearTimeout(timer)
  }, [showSeconds])
  return now
}

const p2 = (n: number) => String(n).padStart(2, '0')

/** 周日为一周起点 */
function weekStartIndexOf(d: Date) {
  return d.getDay()
}

function sameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

function dayOfYear(d: Date) {
  return (
    Math.floor(
      (Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) -
        Date.UTC(d.getFullYear(), 0, 0)) /
        86400000,
    )
  )
}

/** 月视图：前置空格 + 真实日期，尾部补到整周 */
function monthCells(year: number, month: number): Array<Date | null> {
  const lead = weekStartIndexOf(new Date(year, month, 1))
  const count = new Date(year, month + 1, 0).getDate()
  const cells: Array<Date | null> = Array.from({ length: lead }, () => null)
  for (let day = 1; day <= count; day += 1) cells.push(new Date(year, month, day))
  while (cells.length % 7 !== 0) cells.push(null)
  return cells
}

/* ---------- 天气图标：一组静态 SVG，跟随文字色，深浅外观自适应 ---------- */

function WeatherIcon({ kind }: { kind: WeatherKind }) {
  const cloud = <path d="M14 35h20a8 8 0 0 0 .5-16 12 12 0 0 0-23-3A9.5 9.5 0 0 0 14 35Z" />
  let body
  switch (kind) {
    case 'sun':
      body = (
        <>
          <circle cx="24" cy="24" r="8" />
          <path d="M24 6v5M24 37v5M6 24h5M37 24h5M11.3 11.3l3.5 3.5M33.2 33.2l3.5 3.5M36.7 11.3l-3.5 3.5M14.8 33.2l-3.5 3.5" />
        </>
      )
      break
    case 'partly':
      body = (
        <>
          <circle cx="17" cy="16" r="6" />
          <path d="M17 4v3M5 16h3M8.5 7.5l2.2 2.2M25.5 7.5l-2.2 2.2" />
          {cloud}
        </>
      )
      break
    case 'fog':
      body = (
        <>
          {cloud}
          <path d="M13 40h21M17 44h17" />
        </>
      )
      break
    case 'drizzle':
      body = (
        <>
          {cloud}
          <path d="M18 40v2M24 40v3M30 40v2" />
        </>
      )
      break
    case 'rain':
      body = (
        <>
          {cloud}
          <path d="m18 39-2 5M25 39l-2 5M32 39l-2 5" />
        </>
      )
      break
    case 'snow':
      body = (
        <>
          {cloud}
          <path d="M18 40v4M16 42h4M25 40v4M23 42h4M32 40v4M30 42h4" />
        </>
      )
      break
    case 'thunder':
      body = (
        <>
          {cloud}
          <path d="m25 38-6 7h5l-2 5 8-8h-5l2-4Z" />
        </>
      )
      break
    default:
      body = cloud
  }
  return (
    <svg
      className="wg-wx-icon"
      viewBox="0 0 48 48"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {body}
    </svg>
  )
}

/* ---------- 天气 ---------- */

/** 多日列表用「周一 / 周二」这种星期标签，和参考大卡一致 */
function weekdayLabel(date: string) {
  const d = new Date(`${date}T00:00:00`)
  return Number.isNaN(d.getTime()) ? date.slice(5) : WEEK_SHORT[d.getDay()]
}

function WeatherWidget({ size }: { size: WidgetSize }) {
  const { cities, data, loading, error, refresh } = useWeather()
  const selected = useWeatherCity()
  const [formOpen, setFormOpen] = useState(false)
  const [cityName, setCityName] = useState('')
  const [lat, setLat] = useState('')
  const [lon, setLon] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [locating, setLocating] = useState(false)
  const [geocoding, setGeocoding] = useState(false)

  const locate = () => {
    if (!navigator.geolocation) {
      setFormError('浏览器不支持定位')
      return
    }
    setLocating(true)
    setFormError(null)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLat(pos.coords.latitude.toFixed(4))
        setLon(pos.coords.longitude.toFixed(4))
        if (!cityName.trim()) setCityName('我的位置')
        setLocating(false)
      },
      (err) => {
        setFormError(`定位失败：${err.message}`)
        setLocating(false)
      },
      { timeout: 8000 },
    )
  }

  const submitCity = async (e: ReactFormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const name = cityName.trim() || '我的位置'
    let la = Number(lat)
    let lo = Number(lon)
    const hasCoords = lat.trim() !== '' && lon.trim() !== ''
    // 只填名字也能加：先查经纬度；查不到再让用户补坐标，不编造位置
    if (!hasCoords) {
      setGeocoding(true)
      setFormError(null)
      const found = await geocodeCity(name)
      setGeocoding(false)
      if (!found) {
        setFormError('没找到这个城市，请补上经纬度')
        return
      }
      la = found.lat
      lo = found.lon
    }
    const result = addWeatherCity({ name, lat: la, lon: lo })
    if (!result.ok) {
      setFormError(result.error)
      return
    }
    setFormError(null)
    setFormOpen(false)
    setCityName('')
    setLat('')
    setLon('')
  }

  const head = (
    <div className="wg-k wg-head-row">
      <span>{data?.city.name ?? selected.name}</span>
      <div className="wg-wx-tools">
        <select
          className="wg-city"
          value={selected.id}
          aria-label="天气城市"
          data-wg-no-drag
          onChange={(e) => setWeatherCity(e.target.value)}
        >
          {cities.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <button
          className="wg-wx-add"
          aria-label="自定义城市"
          title="自定义城市（只填城市名即可，也可填经纬度或定位）"
          data-wg-no-drag
          onClick={() => setFormOpen((v) => !v)}
        >
          +
        </button>
      </div>
    </div>
  )

  const cityForm = formOpen && (
    <form className="wg-wx-form" data-wg-no-drag onSubmit={submitCity}>
      <input
        value={cityName}
        onChange={(e) => setCityName(e.target.value)}
        placeholder="城市名"
        aria-label="城市名"
        maxLength={16}
      />
      <div className="wg-wx-form-hint">只填城市名即可，经纬度可留空</div>
      <div className="wg-wx-form-row">
        <input
          value={lat}
          onChange={(e) => setLat(e.target.value)}
          placeholder="纬度（可选）"
          aria-label="纬度，可选"
          inputMode="decimal"
        />
        <input
          value={lon}
          onChange={(e) => setLon(e.target.value)}
          placeholder="经度（可选）"
          aria-label="经度，可选"
          inputMode="decimal"
        />
      </div>
      {formError && <div className="wg-wx-form-error">{formError}</div>}
      <div className="wg-wx-form-actions">
        <button type="button" onClick={locate} disabled={locating}>
          {locating ? '定位中…' : '定位'}
        </button>
        <button type="submit" disabled={geocoding}>
          {geocoding ? '查询中…' : '添加'}
        </button>
        {selected.id.startsWith('custom-') && (
          <button type="button" className="danger" onClick={() => removeWeatherCity(selected.id)}>
            删除
          </button>
        )}
      </div>
    </form>
  )

  if (loading && !data) return <>{head}{cityForm}<WidgetSkeleton lines={2} /></>
  if (error || !data) {
    return (
      <>
        {head}
        {cityForm}
        <div className="wg-note">
          <span>{error ?? '天气暂不可用'}</span>
          <button className="wg-btn" onClick={refresh}>
            重试
          </button>
        </div>
      </>
    )
  }

  const info = weatherInfo(data.now.code)
  const today = data.days[0]
  const hours = data.hours.slice(0, 6)
  const days = data.days.slice(1, 6)
  const dayMin = Math.min(...days.map((d) => d.min))
  const dayMax = Math.max(...days.map((d) => d.max))
  const daySpan = Math.max(1, dayMax - dayMin)

  return (
    <>
      {head}
      {cityForm}
      <div className={cx('wg-weather', `size-${size}`)}>
        <div className="wg-wx-top">
          <div className="wg-wx-temp">
            {Math.round(data.now.temperature)}
            <small>°</small>
          </div>
          {size !== 'small' && (
            <div className="wg-wx-right">
              <div className="wg-wx-cond">
                <WeatherIcon kind={info.kind} />
                <span>{info.label}</span>
              </div>
              {today && (
                <div className="wg-wx-hl">
                  <span>最高 <b>{Math.round(today.max)}°</b></span>
                  <span>最低 <b>{Math.round(today.min)}°</b></span>
                </div>
              )}
            </div>
          )}
        </div>
        {size === 'small' && (
          <div className="wg-wx-desc">
            {info.label}{today ? ` · ${Math.round(today.max)}° / ${Math.round(today.min)}°` : ''}
          </div>
        )}
        {size !== 'small' && hours.length > 0 && (
          <div className="wg-wx-hours">
            {hours.map((h) => (
              <div className="wg-wx-hour" key={h.time}>
                <span>{Number(h.time.slice(11, 13))}时</span>
                <WeatherIcon kind={weatherInfo(h.code).kind} />
                <b>{Math.round(h.temperature)}°</b>
              </div>
            ))}
          </div>
        )}
        {(size === 'large' || size === 'xl') && days.length > 0 && (
          <div className="wg-wx-days">
            {days.map((d) => {
              const wi = weatherInfo(d.code)
              const avg = (d.min + d.max) / 2
              const hue = Math.round(188 - ((avg - dayMin) / daySpan) * 120)
              const left = ((d.min - dayMin) / daySpan) * 100
              const width = Math.max(8, ((d.max - d.min) / daySpan) * 100)
              return (
                <div className="wg-wx-day" key={d.date}>
                  <span className="wg-wx-day-wd">{weekdayLabel(d.date)}</span>
                  <WeatherIcon kind={wi.kind} />
                  <span className="wg-wx-day-min">{Math.round(d.min)}°</span>
                  <span className="wg-wx-bar" aria-hidden="true">
                    <i
                      style={{
                        left: `${left}%`,
                        width: `${width}%`,
                        background: `linear-gradient(90deg, hsl(${hue} 72% 72%), hsl(${hue - 18} 82% 76%))`,
                      }}
                    />
                  </span>
                  <span className="wg-wx-day-max">{Math.round(d.max)}°</span>
                </div>
              )
            })}
          </div>
        )}
      </div>
      {(size === 'large' || size === 'xl') && (
        <div className="wg-updated">
          {data.stale ? '缓存 · ' : '更新于 '}
          {relativeTime(data.fetchedAt)}
        </div>
      )}
    </>
  )
}

/* ---------- 日历 ---------- */

function CalendarWidget({ size }: { size: WidgetSize }) {
  const now = useNow(false)
  const [view, setView] = useState(() => ({ y: now.getFullYear(), m: now.getMonth() }))
  const [selected, setSelected] = useState<Date | null>(null)
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const cells = monthCells(view.y, view.m)
  const weekStart = new Date(
    today.getFullYear(), today.getMonth(), today.getDate() - weekStartIndexOf(today),
  )
  const week = Array.from(
    { length: 7 },
    (_, i) => new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + i),
  )
  const currentMonth = view.y === today.getFullYear() && view.m === today.getMonth()
  // 标题里的农历跟着「聚焦的那天」走：选中日优先，否则本月就是今天
  const focus = selected && selected.getFullYear() === view.y && selected.getMonth() === view.m
    ? selected
    : currentMonth ? today : new Date(view.y, view.m, 1)
  const focusLunar = solarToLunar(focus)

  // 跨月时把视图带回本月；用户在当月里翻看其它月份不会被打断
  useEffect(() => {
    setView({ y: now.getFullYear(), m: now.getMonth() })
  }, [now.getFullYear(), now.getMonth()])

  if (size === 'small') {
    const lunar = solarToLunar(today)
    return (
      <div className="wg-cal-mini">
        <div className="cm-top">
          <b>{today.getMonth() + 1}月</b>
          <span>{lunar?.text ?? ''}</span>
        </div>
        <div className="cm-day">{today.getDate()}</div>
        <div className="cm-bottom">
          <span className="cm-weekday">{WEEK_SHORT[today.getDay()]}</span>
          <span className="cm-mark" aria-hidden="true" />
        </div>
      </div>
    )
  }

  if (size === 'medium') {
    return (
      <>
        <div className="wg-cal-title compact">
          <b>{today.getMonth() + 1}月</b>
          <span>{focusLunar?.text ?? ''}</span>
        </div>
        <div className="wg-cal-week">
          {week.map((d) => {
            const lunar = solarToLunar(d)
            return (
              <div
                className={cx('wg-cal-cell', sameDay(d, today) && 'today', selected && sameDay(d, selected) && 'selected')}
                key={d.toISOString()}
              >
                <span className="wg-cal-wd">{WEEK_LETTERS[d.getDay()]}</span>
                <b>{d.getDate()}</b>
                {lunar && <small>{lunar.short}</small>}
              </div>
            )
          })}
        </div>
      </>
    )
  }

  return (
    <>
      <div className="wg-cal-head">
        <div className="wg-cal-title">
          <b>{view.m + 1}月</b>
          <span>{focusLunar?.text ?? ''}</span>
        </div>
        <div className="wg-cal-navs">
          <button
            className="wg-cal-nav"
            aria-label="上个月"
            onClick={() => setView((v) => (v.m === 0 ? { y: v.y - 1, m: 11 } : { ...v, m: v.m - 1 }))}
          >
            ‹
          </button>
          <button
            className="wg-cal-nav"
            aria-label="下个月"
            onClick={() => setView((v) => (v.m === 11 ? { y: v.y + 1, m: 0 } : { ...v, m: v.m + 1 }))}
          >
            ›
          </button>
          {!currentMonth && (
            <button className="wg-cal-back" onClick={() => setView({ y: today.getFullYear(), m: today.getMonth() })}>
              今天
            </button>
          )}
        </div>
      </div>
      <div className="wg-cal-weeknames">
        {WEEK_LETTERS.map((w) => (
          <span key={w}>{w}</span>
        ))}
      </div>
      <div className="wg-cal-grid">
        {cells.map((d, i) => {
          if (!d) return <span className="wg-cal-cell blank" key={`blank-${i}`} />
          const lunar = solarToLunar(d)
          return (
            <button
              key={d.toISOString()}
              className={cx(
                'wg-cal-cell',
                sameDay(d, today) && 'today',
                selected && sameDay(d, selected) && 'selected',
                d.getMonth() !== view.m && 'outside',
              )}
              onClick={() => setSelected(d)}
              aria-label={`${d.getMonth() + 1}月${d.getDate()}日${lunar ? ` 农历${lunar.text}` : ''}`}
            >
              <b>{d.getDate()}</b>
              {lunar && <small>{lunar.short}</small>}
            </button>
          )
        })}
      </div>
      {size === 'xl' && (
        <div className="wg-cal-detail">
          {selected
            ? `${selected.getMonth() + 1}月${selected.getDate()}日 ${WEEK_SHORT[selected.getDay()]} · 今年第 ${dayOfYear(selected)} 天`
            : `今天是今年第 ${dayOfYear(today)} 天`}
        </div>
      )}
    </>
  )
}

/* ---------- 数字时钟：最初那张卡，作为独立组件保留 ---------- */

function DigitalClockWidget({ size }: { size: WidgetSize }) {
  const now = useNow(false)
  const p = p2
  const wd = WEEK_SHORT[now.getDay()]
  return (
    <div className={cx('wg-clock', 'digital', `size-${size}`)}>
      <div className="dc-label">当地时间</div>
      <div className="dc-time">
        {p(now.getHours())}<span>:</span>{p(now.getMinutes())}
      </div>
      <div className="dc-rule" aria-hidden="true" />
      <div className="dc-date">
        {size === 'medium' ? `${now.getFullYear()}年` : ''}{now.getMonth() + 1}月{now.getDate()}日
        <b>{wd}</b>
      </div>
    </div>
  )
}

/* ---------- 模拟表盘时钟 ---------- */

function ClockWidget({ size }: { size: WidgetSize }) {
  // 一格小卡也用表盘：SVG 缩放不失真，比换成纯数字更贴近参考图
  const now = useNow(true)
  const p = p2
  const wd = WEEK_SHORT[now.getDay()]
  const hourDeg = (now.getHours() % 12) * 30 + now.getMinutes() * 0.5
  const minuteDeg = now.getMinutes() * 6 + now.getSeconds() * 0.1
  const secondDeg = now.getSeconds() * 6
  return (
    <div className={cx('wg-clock', 'analog', `size-${size}`)}>
      <svg className="wg-face" viewBox="0 0 120 120" role="img" aria-label={`${p(now.getHours())}:${p(now.getMinutes())}`}>
        <circle className="wg-face-bg" cx="60" cy="60" r="58" />
        {Array.from({ length: 60 }, (_, i) => {
          const major = i % 5 === 0
          return (
            <line
              key={i}
              x1="60"
              y1={major ? 6 : 8}
              x2="60"
              y2={major ? 14 : 11}
              transform={`rotate(${i * 6} 60 60)`}
              stroke={major ? '#3a3a3c' : '#c2c2c6'}
              strokeWidth={major ? 1.5 : 0.8}
              strokeLinecap="round"
            />
          )
        })}
        {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => {
          const rad = ((n * 30 - 90) * Math.PI) / 180
          return (
            <text
              key={n}
              x={60 + 36 * Math.cos(rad)}
              y={60 + 36 * Math.sin(rad) + 4}
              textAnchor="middle"
              fontSize="11"
              fontWeight="600"
              fill="#1c1c1e"
            >
              {n}
            </text>
          )
        })}
        <line x1="60" y1="62" x2="60" y2="30" transform={`rotate(${hourDeg} 60 60)`} stroke="#1c1c1e" strokeWidth="4.5" strokeLinecap="round" />
        <line x1="60" y1="64" x2="60" y2="22" transform={`rotate(${minuteDeg} 60 60)`} stroke="#1c1c1e" strokeWidth="3" strokeLinecap="round" />
        <line x1="60" y1="66" x2="60" y2="13" transform={`rotate(${secondDeg} 60 60)`} stroke="#ff9f0a" strokeWidth="1.2" strokeLinecap="round" />
        <circle cx="60" cy="60" r="3" fill="#ff9f0a" stroke="#fff" strokeWidth="1" />
        <circle cx="60" cy="60" r="1.1" fill="#1c1c1e" />
      </svg>
      {(size === 'medium' || size === 'xl') && (
        <div className="wg-clock-digital">
          <div className="wg-time">
            {p(now.getHours())}:{p(now.getMinutes())}<small>:{p(now.getSeconds())}</small>
          </div>
          <div className="wg-date">
            {now.getFullYear()}年{now.getMonth() + 1}月{now.getDate()}日 {wd}
          </div>
        </div>
      )}
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
      return <ClockWidget size={size} />
    case 'clock-digital':
      return <DigitalClockWidget size={size} />
    case 'weather':
      return <WeatherWidget size={size} />
    case 'calendar':
      return <CalendarWidget size={size} />
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

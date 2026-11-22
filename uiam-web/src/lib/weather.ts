/**
 * 桌面天气组件的数据层：Open-Meteo 公共接口（免密钥）+ 本地缓存 + 失败降级。
 *
 * 这里不编造任何天气数字：拿到什么就显示什么，拿不到就明确说「暂不可用」，
 * 有旧缓存时标成「缓存」并带上抓取时间。组件尺寸只决定展示多少真实字段，
 * 不决定数据本身。
 *
 * 城市选择只存本机（不是 uiam 偏好键），因为它跟账号无关，也不该被偏好
 * 同步覆盖；远端偏好那套仍然只管桌面布局、外观、站点和画廊。
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'

export interface WeatherCity {
  id: string
  name: string
  lat: number
  lon: number
}

/** 常用城市；坐标来自 Open-Meteo 的经纬度口径（lat/lon） */
export const WEATHER_CITIES: WeatherCity[] = [
  { id: 'beijing', name: '北京', lat: 39.9042, lon: 116.4074 },
  { id: 'shanghai', name: '上海', lat: 31.2304, lon: 121.4737 },
  { id: 'guangzhou', name: '广州', lat: 23.1291, lon: 113.2644 },
  { id: 'shenzhen', name: '深圳', lat: 22.5431, lon: 114.0579 },
  { id: 'hangzhou', name: '杭州', lat: 30.2741, lon: 120.1551 },
  { id: 'chengdu', name: '成都', lat: 30.5728, lon: 104.0668 },
  { id: 'chongqing', name: '重庆', lat: 29.5630, lon: 106.5516 },
  { id: 'wuhan', name: '武汉', lat: 30.5928, lon: 114.3055 },
  { id: 'xian', name: '西安', lat: 34.3416, lon: 108.9398 },
  { id: 'nanjing', name: '南京', lat: 32.0603, lon: 118.7969 },
]

export type WeatherKind =
  | 'sun'
  | 'partly'
  | 'cloud'
  | 'fog'
  | 'drizzle'
  | 'rain'
  | 'snow'
  | 'thunder'

export interface WeatherNow {
  time: string
  temperature: number
  apparent: number
  humidity: number
  wind: number
  code: number
}

export interface WeatherHour {
  time: string
  temperature: number
  code: number
  pop: number
}

export interface WeatherDay {
  date: string
  code: number
  max: number
  min: number
  pop: number
}

export interface WeatherData {
  city: WeatherCity
  timezone: string
  now: WeatherNow
  /** 从当前时刻起的逐小时预报 */
  hours: WeatherHour[]
  days: WeatherDay[]
  /** 取数时刻；stale 为 true 时表示接口没连上、显示的是最后一次成功的结果 */
  fetchedAt: number
  stale: boolean
}

/** WMO code → 中文描述与图标种类；未列出的码按阴天处理，不丢数据 */
export function weatherInfo(code: number): { label: string; kind: WeatherKind } {
  if (code === 0) return { label: '晴', kind: 'sun' }
  if (code === 1) return { label: '大部晴朗', kind: 'partly' }
  if (code === 2) return { label: '局部多云', kind: 'partly' }
  if (code === 3) return { label: '阴', kind: 'cloud' }
  if (code === 45 || code === 48) return { label: '雾', kind: 'fog' }
  if (code >= 51 && code <= 57) return { label: '毛毛雨', kind: 'drizzle' }
  if (code >= 61 && code <= 67) return { label: code >= 65 ? '大雨' : '小雨', kind: 'rain' }
  if (code >= 71 && code <= 77) return { label: code >= 75 ? '大雪' : '小雪', kind: 'snow' }
  if (code >= 80 && code <= 82) return { label: '阵雨', kind: 'rain' }
  if (code === 85 || code === 86) return { label: '阵雪', kind: 'snow' }
  if (code === 95 || code === 96 || code === 99) return { label: '雷阵雨', kind: 'thunder' }
  return { label: '阴', kind: 'cloud' }
}

/* ---------- 城市选择：预设 + 自定义，本机存储，多实例共用一份订阅 ---------- */

const CITY_KEY = 'uiam-weather-city'
const CUSTOM_KEY = 'uiam-weather-custom-cities'
const cityListeners = new Set<() => void>()

function readCustomCities(): WeatherCity[] {
  try {
    const raw = localStorage.getItem(CUSTOM_KEY)
    const parsed = raw ? (JSON.parse(raw) as unknown) : []
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((c): c is WeatherCity =>
        Boolean(
          c &&
          typeof c === 'object' &&
          typeof (c as WeatherCity).id === 'string' &&
          (c as WeatherCity).id.startsWith('custom-') &&
          typeof (c as WeatherCity).name === 'string' &&
          Number.isFinite((c as WeatherCity).lat) &&
          Number.isFinite((c as WeatherCity).lon),
        ),
      )
      .slice(0, 20)
  } catch {
    return []
  }
}

let customCities = readCustomCities()
let cityList = [...WEATHER_CITIES, ...customCities]

function rebuildList() {
  cityList = [...WEATHER_CITIES, ...customCities]
}

function readCity(): WeatherCity {
  try {
    const id = localStorage.getItem(CITY_KEY)
    return cityList.find((c) => c.id === id) ?? WEATHER_CITIES[0]
  } catch {
    return WEATHER_CITIES[0]
  }
}

let currentCity = readCity()

function notify() {
  cityListeners.forEach((fn) => fn())
}

function subscribeCity(listener: () => void) {
  cityListeners.add(listener)
  return () => cityListeners.delete(listener)
}

function getCityList() {
  return cityList
}

function getCity() {
  return currentCity
}

/** 换城市：小组件和「生活」应用里的天气会一起更新 */
export function setWeatherCity(id: string) {
  const next = cityList.find((c) => c.id === id)
  if (!next || next.id === currentCity.id) return
  currentCity = next
  try {
    localStorage.setItem(CITY_KEY, next.id)
  } catch {
    // 隐私模式写不进去：当前页仍然生效
  }
  notify()
}

export type AddCityResult = { ok: true; city: WeatherCity } | { ok: false; error: string }

/** 新增自定义城市（经纬度来自用户输入或浏览器定位），校验后即切换过去 */
export function addWeatherCity(input: { name: string; lat: number; lon: number }): AddCityResult {
  const name = input.name.trim().slice(0, 16)
  if (!name) return { ok: false, error: '请填写城市名' }
  if (!Number.isFinite(input.lat) || input.lat < -90 || input.lat > 90) {
    return { ok: false, error: '纬度应在 -90 ~ 90 之间' }
  }
  if (!Number.isFinite(input.lon) || input.lon < -180 || input.lon > 180) {
    return { ok: false, error: '经度应在 -180 ~ 180 之间' }
  }
  const city: WeatherCity = {
    id: `custom-${Date.now()}`,
    name,
    lat: Number(input.lat.toFixed(4)),
    lon: Number(input.lon.toFixed(4)),
  }
  customCities = [...customCities, city]
  rebuildList()
  try {
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(customCities))
  } catch {
    // 写不进去时本次会话仍然可用
  }
  currentCity = city
  try {
    localStorage.setItem(CITY_KEY, city.id)
  } catch {
    // 同上
  }
  notify()
  return { ok: true, city }
}

/** 删除自定义城市；删掉正在使用的城市会回到北京 */
export function removeWeatherCity(id: string) {
  if (!id.startsWith('custom-')) return
  customCities = customCities.filter((c) => c.id !== id)
  rebuildList()
  try {
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(customCities))
  } catch {
    // 同上
  }
  if (currentCity.id === id) {
    currentCity = WEATHER_CITIES[0]
    try {
      localStorage.setItem(CITY_KEY, currentCity.id)
    } catch {
      // 同上
    }
  }
  notify()
}

export function useWeatherCity(): WeatherCity {
  return useSyncExternalStore(subscribeCity, getCity, () => WEATHER_CITIES[0])
}

/** 预设 + 用户自定义城市的稳定快照（给 useSyncExternalStore 用） */
export function useWeatherCities(): WeatherCity[] {
  return useSyncExternalStore(subscribeCity, getCityList, getCityList)
}

/* ---------- 缓存：本地留存最后一次成功结果，断网时降级 ---------- */

const CACHE_KEY = 'uiam-weather-cache'
const FRESH_MS = 10 * 60 * 1000
type Cache = Record<string, { at: number; data: WeatherData }>

function readCache(): Cache {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    const parsed = raw ? (JSON.parse(raw) as unknown) : null
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Cache) : {}
  } catch {
    return {}
  }
}

function writeCache(city: WeatherCity, data: WeatherData) {
  try {
    const cache = readCache()
    cache[city.id] = { at: Date.now(), data }
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache))
  } catch {
    // 缓存写不进去不影响本次展示
  }
}

/* ---------- 请求 ---------- */

interface OpenMeteoResponse {
  timezone?: string
  current?: {
    time?: string
    temperature_2m?: number
    apparent_temperature?: number
    relative_humidity_2m?: number
    wind_speed_10m?: number
    weather_code?: number
  }
  hourly?: {
    time?: string[]
    temperature_2m?: number[]
    weather_code?: number[]
    precipitation_probability?: number[]
  }
  daily?: {
    time?: string[]
    weather_code?: number[]
    temperature_2m_max?: number[]
    temperature_2m_min?: number[]
    precipitation_probability_max?: number[]
  }
}

function parseResponse(raw: OpenMeteoResponse, city: WeatherCity, fetchedAt: number): WeatherData {
  const cur = raw.current
  const daily = raw.daily
  if (
    !cur ||
    typeof cur.temperature_2m !== 'number' ||
    typeof cur.weather_code !== 'number' ||
    !daily?.time?.length
  ) {
    throw new Error('天气接口返回的数据不完整')
  }

  // 先固化成局部常量：回调里访问 cur 的属性会丢掉上面的类型收窄
  const fallbackTemp = cur.temperature_2m
  const fallbackCode = cur.weather_code
  const days: WeatherDay[] = daily.time.map((date, i) => ({
    date,
    code: daily.weather_code?.[i] ?? 3,
    max: daily.temperature_2m_max?.[i] ?? fallbackTemp,
    min: daily.temperature_2m_min?.[i] ?? fallbackTemp,
    pop: daily.precipitation_probability_max?.[i] ?? 0,
  }))

  // Open-Meteo 的 hourly 从当天 00:00 起；按 current.time 找到「现在这一小时」
  const hour = cur.time?.slice(0, 13) + ':00'
  const start = Math.max(0, (raw.hourly?.time ?? []).findIndex((t) => t >= hour))
  const hours: WeatherHour[] = (raw.hourly?.time ?? [])
    .slice(start, start + 12)
    .map((time, i) => ({
      time,
      temperature: raw.hourly?.temperature_2m?.[start + i] ?? fallbackTemp,
      code: raw.hourly?.weather_code?.[start + i] ?? fallbackCode,
      pop: raw.hourly?.precipitation_probability?.[start + i] ?? 0,
    }))

  return {
    city,
    timezone: raw.timezone ?? 'Asia/Shanghai',
    now: {
      time: cur.time ?? '',
      temperature: cur.temperature_2m,
      apparent: cur.apparent_temperature ?? cur.temperature_2m,
      humidity: cur.relative_humidity_2m ?? 0,
      wind: cur.wind_speed_10m ?? 0,
      code: cur.weather_code,
    },
    hours,
    days,
    fetchedAt,
    stale: false,
  }
}

async function requestWeather(city: WeatherCity, signal: AbortSignal): Promise<WeatherData> {
  const params = new URLSearchParams({
    latitude: String(city.lat),
    longitude: String(city.lon),
    current: 'temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m',
    hourly: 'temperature_2m,weather_code,precipitation_probability',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
    timezone: 'auto',
    forecast_days: '7',
  })
  const url = (import.meta.env.VITE_WEATHER_URL?.trim() || 'https://api.open-meteo.com/v1/forecast') + '?' + params
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`天气接口 HTTP ${res.status}`)
  const data = parseResponse((await res.json()) as OpenMeteoResponse, city, Date.now())
  writeCache(city, data)
  return data
}

/**
 * 城市名 → 经纬度：Open-Meteo Geocoding（免密钥）。
 * 用户只填城市名时也走这条查坐标；找不到或网络失败返回 null，界面提示补经纬度。
 */
export interface GeoCity {
  lat: number
  lon: number
  label: string
}

interface GeoResult {
  name?: string
  latitude?: number
  longitude?: number
}

export async function geocodeCity(name: string): Promise<GeoCity | null> {
  const query = name.trim()
  if (!query) return null
  const params = new URLSearchParams({ name: query, count: '1', language: 'zh', format: 'json' })
  const url =
    (import.meta.env.VITE_GEOCODING_URL?.trim() ||
      'https://geocoding-api.open-meteo.com/v1/search') +
    '?' +
    params
  const ac = new AbortController()
  const timer = window.setTimeout(() => ac.abort(), 8000)
  try {
    const res = await fetch(url, { signal: ac.signal })
    if (!res.ok) return null
    const data = (await res.json()) as { results?: GeoResult[] }
    const first = data.results?.[0]
    if (!first || typeof first.latitude !== 'number' || typeof first.longitude !== 'number') {
      return null
    }
    return { lat: first.latitude, lon: first.longitude, label: first.name ?? query }
  } catch {
    return null
  } finally {
    window.clearTimeout(timer)
  }
}

/** 天气 hook：城市变化即重取，10 分钟内复用缓存，失败回落到旧缓存 */
export function useWeather() {
  const city = useWeatherCity()
  const [data, setData] = useState<WeatherData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [version, setVersion] = useState(0)

  const refresh = useCallback(() => setVersion((v) => v + 1), [])

  useEffect(() => {
    let alive = true
    const ac = new AbortController()
    const timer = window.setTimeout(() => ac.abort(), 8000)
    const cached = readCache()[city.id]
    setData(null)
    setError(null)
    setLoading(true)

    if (cached && Date.now() - cached.at < FRESH_MS) {
      setData({ ...cached.data, stale: false })
      setLoading(false)
      window.clearTimeout(timer)
      return () => {
        alive = false
      }
    }

    void requestWeather(city, ac.signal)
      .then((next) => {
        if (alive) setData(next)
      })
      .catch((e: unknown) => {
        if (!alive) return
        if (cached) setData({ ...cached.data, stale: true })
        else setError(e instanceof Error ? e.message : '天气暂不可用')
      })
      .finally(() => {
        if (alive) setLoading(false)
        window.clearTimeout(timer)
      })

    return () => {
      alive = false
      ac.abort()
      window.clearTimeout(timer)
    }
  }, [city, version])

  const cities = useWeatherCities()
  return { city, cities, data, loading, error, refresh }
}

/**
 * 应用注册表（元数据）。
 *
 * 只放「桌面上要用的」信息：名字、图标渐变、默认窗口尺寸。真正的窗口内容是
 * React 组件，在 `apps/index.tsx` 里按 id 分发——外壳（Dock / 启动台 / 窗口）
 * 只依赖这份元数据，不会因为某个业务页面改结构而跟着动。
 *
 * 这里登记的是**真实存在**的应用：内置应用直接渲染组件，外部控制台按 mode 走
 * internal / federation / iframe / external。sandbox / webcomponent 的适配器还没接入，
 * 不在这里伪装成可用应用，避免出现点开是空壳的假入口。
 */
import type { AppCaps, AppMode } from './runtime'

export interface AppMeta {
  id: string
  name: string
  desc: string
  /** 图标渐变起止色 */
  c1: string
  c2: string
  /** 默认窗口尺寸，实际开窗时会按视口裁一下 */
  w: number
  h: number
  /** 嵌入模式；不填按 internal 处理（兼容原有四个内置应用） */
  mode?: AppMode
  /** iframe / external 的目标地址；开发期可用 VITE_XXX_WEB_URL 覆盖 */
  url?: string
  /** iframe 打开后希望子应用定位到的初始路由 */
  route?: string
  /** 显式覆盖的能力；不填由模式推断 */
  caps?: Partial<AppCaps>
}

/** 开发联调时允许把子应用指到别处；生产走同源前缀 */
function webUrl(key: string, fallback: string): string {
  return (import.meta.env[key] as string | undefined)?.trim() || fallback
}

export const APPS: AppMeta[] = [
  {
    id: 'gateway',
    name: '网关配置',
    desc: 'Consul KV 网关配置的编辑、发布与回滚',
    c1: '#6f8cf7',
    c2: '#2f4bc0',
    w: 1120,
    h: 680,
    mode: 'internal',
  },
  {
    id: 'api',
    name: '接口速查',
    desc: 'uiam-svr 对外提供的全部接口',
    c1: '#2ad1d6',
    c2: '#0a8a99',
    w: 860,
    h: 600,
    mode: 'internal',
  },
  {
    id: 'settings',
    name: '系统设置',
    desc: '外观、操作者与桌面布局',
    c1: '#9aa0a6',
    c2: '#4a4f55',
    w: 760,
    h: 560,
    mode: 'internal',
  },
  {
    id: 'about',
    name: '关于 uiam',
    desc: '版本、设计约束与生效路径',
    c1: '#4facfe',
    c2: '#0a6ed1',
    w: 640,
    h: 500,
    mode: 'internal',
  },
  {
    id: 'msg',
    name: '消息中心',
    desc: '消息模板、通道与投递记录',
    c1: '#36cfc9',
    c2: '#08979c',
    w: 1180,
    h: 720,
    mode: 'iframe',
    url: webUrl('VITE_MSG_WEB_URL', '/msg-web/'),
  },
  {
    id: 'alarm',
    name: '报警中心',
    desc: '报警规则、事件与处置记录',
    c1: '#ff9c6e',
    c2: '#d4380d',
    w: 1180,
    h: 720,
    mode: 'iframe',
    url: webUrl('VITE_ALARM_WEB_URL', '/alarm-web/'),
  },
  {
    id: 'dbz',
    name: '连接器',
    desc: 'Debezium 连接器与同步位点',
    c1: '#69c0ff',
    c2: '#0958d9',
    w: 1240,
    h: 760,
    mode: 'iframe',
    url: webUrl('VITE_DBZ_WEB_URL', '/dbz-web/'),
    route: '/control-panel',
  },
  {
    id: 'syn',
    name: '同步控制台',
    desc: '同步任务、试跑与投递记录（联邦 POC）',
    c1: '#9254de',
    c2: '#531dab',
    w: 1200,
    h: 740,
    mode: 'federation',
    // url 只作为联邦加载失败时的「独立打开」出口
    url: webUrl('VITE_SYN_WEB_URL', '/syn-web/'),
    route: '/',
  },
  {
    id: 'adm',
    name: '权限管理',
    desc: '账号、角色、菜单与登录审计',
    c1: '#ffc53d',
    c2: '#ad4e00',
    w: 1200,
    h: 740,
    mode: 'external',
    url: webUrl('VITE_ADM_WEB_URL', '/adm-rs-web/'),
  },
  {
    id: 'dtw',
    name: '定位联调',
    desc: '定位数据接入与报警联调',
    c1: '#95de64',
    c2: '#237804',
    w: 1200,
    h: 740,
    mode: 'external',
    url: webUrl('VITE_DTW_WEB_URL', '/dtw-rs-web/'),
  },
  {
    id: 'jobx',
    name: '计划任务',
    desc: '周期任务的注册、日志与重放',
    c1: '#ff85c0',
    c2: '#a8071a',
    w: 1200,
    h: 740,
    mode: 'external',
    url: webUrl('VITE_JOBX_WEB_URL', '/jobx-web/'),
  },
]

export const APP_MAP: Record<string, AppMeta> = Object.fromEntries(
  APPS.map((a) => [a.id, a]),
)

/** Dock 固定栏的默认成员；用户可以右键改，存在 localStorage */
export const DEFAULT_PINNED = [
  'gateway',
  'msg',
  'alarm',
  'dbz',
  'syn',
  'api',
  'settings',
  'about',
]

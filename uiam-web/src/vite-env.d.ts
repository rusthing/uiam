/// <reference types="vite/client" />

/**
 * 本项目的环境变量（值写在 `.env.development` / `.env.production`）。
 *
 * 只声明**真的会读**的那一个：vite 自带 `ImportMetaEnv` 的索引签名是 `any`，
 * 不声明的话 `import.meta.env.VITE_API_BAES` 这种拼错也会静默通过。
 */
interface ImportMetaEnv {
  /**
   * 接口「服务名段」前缀。
   *
   * - 开发：留空 —— vite 把 `/uiam` 直反代到 uiam-svr，路径就是内部路径
   * - 生产：`/uiam-svr` —— 网关按服务名分流，剥掉第一段后转发给 uiam-svr
   */
  readonly VITE_API_BASE?: string
  /** 顶部站点标题；留空用 `统一身份认证平台` */
  readonly VITE_SITE_NAME?: string
  /** 顶部站点图标：内置预设 id（gateway/grid/pulse/layers）或图片 URL */
  readonly VITE_SITE_ICON?: string
  /**
   * 偏好配置中心地址。**uiam-svr 目前没有这个接口**，留空即纯本地模式；
   * 配了之后启动时 GET 快照、改动防抖 PUT，失败静默回退 localStorage。
   */
  readonly VITE_PREFERENCES_URL?: string
  /** 外部控制台地址覆盖（开发联调用；留空走同源 /xxx-web/ 前缀） */
  readonly VITE_MSG_WEB_URL?: string
  readonly VITE_ALARM_WEB_URL?: string
  readonly VITE_DBZ_WEB_URL?: string
  readonly VITE_SYN_WEB_URL?: string
  readonly VITE_ADM_WEB_URL?: string
  readonly VITE_DTW_WEB_URL?: string
  readonly VITE_JOBX_WEB_URL?: string
  /** 联邦：开发期各子应用 remoteEntry.js 的绝对地址（生产走同源前缀） */
  readonly VITE_SYN_REMOTE_ENTRY?: string
  readonly VITE_MSG_REMOTE_ENTRY?: string
  readonly VITE_ALARM_REMOTE_ENTRY?: string
  readonly VITE_DBZ_REMOTE_ENTRY?: string
  readonly VITE_ADM_REMOTE_ENTRY?: string
  readonly VITE_DTW_REMOTE_ENTRY?: string
  readonly VITE_JOBX_REMOTE_ENTRY?: string
}

/** 联邦模块在构建期由 @module-federation/vite 解析，这里只给 TS 一份形状 */
interface FederatedAppProps {
  theme?: 'light' | 'dark'
  initialPath?: string
  onRoute?: (path: string, title: string) => void
}

declare module 'syn-web/syn-app' {
  import type { ComponentType } from 'react'
  const App: ComponentType<FederatedAppProps>
  export default App
}

declare module 'msg-web/msg-app' {
  import type { ComponentType } from 'react'
  const App: ComponentType<FederatedAppProps>
  export default App
}

declare module 'alarm-web/alarm-app' {
  import type { ComponentType } from 'react'
  const App: ComponentType<FederatedAppProps>
  export default App
}

declare module 'dbz-web/dbz-app' {
  import type { ComponentType } from 'react'
  const App: ComponentType<FederatedAppProps>
  export default App
}

declare module 'adm-web/adm-app' {
  import type { ComponentType } from 'react'
  const App: ComponentType<FederatedAppProps>
  export default App
}

declare module 'dtw-web/dtw-app' {
  import type { ComponentType } from 'react'
  const App: ComponentType<FederatedAppProps>
  export default App
}

declare module 'jobx-web/jobx-app' {
  import type { ComponentType } from 'react'
  const App: ComponentType<FederatedAppProps>
  export default App
}

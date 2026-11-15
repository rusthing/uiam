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
}

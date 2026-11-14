use idworker::IdWorkerConfig;
use robotech::db::DbConnConfig;
use robotech::web::WebServerConfig;
use serde::Deserialize;

/// # 应用配置
///
/// 字段名与 TOML 的 kebab-case 对应（`id_worker` ↔ `id-worker`）。
///
/// 一期没有 Redis、没有调度器：网关管理面只有「读库 → 渲染 → 写 KV」，
/// 没有需要缓存或定时扫描的东西。
#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "kebab-case")]
pub struct AppConfig {
    /// 数据库连接
    pub db: DbConnConfig,
    /// Web 服务器
    #[serde(default = "WebServerConfig::default")]
    pub web: WebServerConfig,
    /// 雪花 ID 生成器
    #[serde(default = "IdWorkerConfig::default")]
    pub id_worker: IdWorkerConfig,
}

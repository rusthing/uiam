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
    /// Consul KV（发布网关配置的唯一出口）
    pub consul: ConsulKvConfig,
}

/// # Consul KV 配置
///
/// ## 为什么单独一段，不复用 `[micro-svc.consul]`
///
/// `[micro-svc.consul]` 是框架的**服务治理**配置：uiam 自己注册到哪个 Consul。
/// 这里是**业务**配置：网关的配置 TOML 写进哪个 Consul。两者在部署上通常指向
/// 同一个 agent，但语义和生命周期不同——网关配置可能落在另一个数据中心、
/// 另一套 ACL token 下，而 uiam 自己的注册信息不会跟着搬。合成一段的话，
/// 将来要拆就得改配置结构，不如一开始就分开。
///
/// 顺带一个实际原因：框架那个客户端只有配了 `[micro-svc.consul.config]` 才创建，
/// 且 `set_config` 不检查响应码（见 `crate::kv` 的模块说明）。
#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "kebab-case")]
pub struct ConsulKvConfig {
    /// Consul HTTP 地址，如 `http://consul:8500`
    pub base_url: String,
    /// 网关配置在 KV 里的路径前缀，如 `dev/`
    ///
    /// ## 为什么前缀是配置而不是数据
    ///
    /// robotech 配置中心的 key 形态是 `{namespace}/{group}/{data_id}`，
    /// 各服务按 `group`（即 profile）分组存自己的配置——本机 Consul 里现成的
    /// 就是 `dev/jobx-svr.toml`、`dev/msg-svr.toml` 这一批。网关按同一套规则读，
    /// 所以它要的 key 是 `dev/gatex-rs-svr.toml`，而库里 `consul_key` 列存的
    /// 是 `gatex-rs-svr.toml`。
    ///
    /// 环境前缀是**部署属性**：同一个 uiam 部署下所有实例共用同一个环境。
    /// 存进每一行的话，从 dev 提到 prod 要把整张表刷一遍，而且迟早会有几行漏掉。
    ///
    /// 非空时必须以 `/` 结尾（启动时校验）——「`dev` 到底意味着 `dev/xxx`
    /// 还是 `devxxx`」这种歧义不该靠猜。
    #[serde(default)]
    pub key_prefix: String,
    /// 单次请求超时（毫秒）
    ///
    /// 默认 5 秒。发布是同步动作，用户在页面上等结果——超时太长会让「点了没反应」
    /// 变成常态；太短则正常的 KV 写入也可能被判失败（Consul 写 KV 要落 raft 日志，
    /// 集群抖动时会慢到几百毫秒）。
    #[serde(default = "consul_timeout_ms_default")]
    pub timeout_ms: u64,
}

/// Consul 请求超时的默认值（毫秒）
fn consul_timeout_ms_default() -> u64 {
    5000
}

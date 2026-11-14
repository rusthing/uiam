use robotech::macros::crud_dto;

/// # 网关实例
///
/// 一个实例对应 Consul KV 里的**一个 key**，也对应一组 pingora 进程。
/// 监听器 / 路由 / 负载均衡器 / 发布版本都挂在实例下，发布时整棵子树一起渲染成
/// 一份 TOML 推到该 key。
///
/// ## 为什么 `pingora-conf` 是 TOML 文本而不是 JSON 列
///
/// `ServerConf` 是 pingora 自己的胖结构，几十个字段且随上游版本变化。全落表既无意义
/// 也跟不上上游，所以存一段 TOML（`extra_toml`），渲染时 parse 成 `toml::Value`
/// 合并进最终配置。界面上它就是一个「高级配置」文本域。
#[crud_dto]
pub struct UiamGatewayDto {
    /// 实例标识
    /// 如 svr01、svr00，与 Consul 注册名一致
    /// @len 1..=50
    pub code: String,
    /// 展示名
    /// @len 1..=50
    pub name: String,
    /// Consul KV 的完整 key
    /// 发布时整份 TOML 就 PUT 到这里
    /// @len 1..=200
    pub consul_key: String,
    /// 高级配置（TOML 文本）
    ///
    /// 对应 `AppConfig.pingora-conf` 等无法结构化的部分。留空表示全部用默认值。
    /// 渲染时与结构化字段做 `toml::Value` 合并（只补缺失的顶层键），不做字符串拼接。
    pub extra_toml: Option<String>,
    /// 运维端点配置（JSON）
    /// 对应 `OpsConfig`：health_path / metrics_path / addrs
    pub ops_json: Option<String>,
    /// 静态资源配置（JSON）
    /// 对应 `StaticConfig`：root_dir / page_404_path
    pub static_json: Option<String>,
    /// 上游异常配置（JSON）
    /// 对应 `UpstreamErrorConfig`
    pub upstream_error_json: Option<String>,
    /// 备注
    /// @len 0..=200
    pub remark: Option<String>,
    /// 启用
    /// 停用的实例不参与发布
    #[db_default]
    pub enabled: bool,
}

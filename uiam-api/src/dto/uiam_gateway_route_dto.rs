use robotech::macros::crud_dto;

/// # 网关路由
///
/// 一条路由 = 一个匹配条件 + 一个转发目标。`sort_no` **顺序即语义**：
/// 同一个 listener 下前面的先匹配，改顺序就是改行为。
///
/// ## 三个 JSON 列
///
/// `matcher_json` / `to_json` / `log_json` 分别对应 gatex 的 `RouteMatcherConfig`
/// （5 种变体）/ `ToConfig`（N 种变体）/ `LogConfig`。变体太多，拆成列既写不完
/// 也跟不上上游，所以统一存 JSON 文本，由 svc 层做合法性校验。
#[crud_dto]
pub struct UiamGatewayRouteDto {
    /// 所属监听器ID
    pub listener_id: u64,
    /// 匹配顺序
    /// 顺序即语义，前面的先匹配
    pub sort_no: i32,
    /// 名称
    /// 便于人看的名字，如「adm 后台接口」
    /// @len 1..=100
    pub name: String,
    /// 匹配条件（JSON 文本）
    /// 对应 RouteMatcherConfig
    pub matcher_json: String,
    /// 转发目标（JSON 文本）
    /// 对应 ToConfig
    pub to_json: String,
    /// 日志配置（JSON 文本）
    /// 对应 LogConfig，为空时用默认
    pub log_json: Option<String>,
    /// 启用
    #[db_default]
    pub enabled: bool,
}

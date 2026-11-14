use robotech::macros::svc;

/// # 网关路由业务层
///
/// 一期的 CRUD 全部由 `#[svc]` 生成，这里先只放骨架。
///
/// 后续会补三类能力，都是「跨表 / 需要解析 JSON」才放进来的：
///
/// 1. **三个 JSON 列校验**：`matcher_json` / `to_json` / `log_json` 分别对应
///    gatex 的 `RouteMatcherConfig` / `ToConfig` / `LogConfig`。要在写库阶段
///    反序列化一次，格式不对当场报错——否则错误会一路漂到发布渲染时才炸，
///    那时用户已经在等发布结果了。
/// 2. **`to.type = "load-balancer"` 的引用校验**：引用的 `name` 必须在本实例的
///    `uiam_gateway_balancer` 里存在。这是硬错误，不能等 pingora 启动时才发现。
/// 3. **`matcher_json` 的变体互斥**：5 种 matcher 变体只能命中一个，
///    由枚举的 serde 反序列化天然保证，这里只负责把错误信息翻成人话。
#[svc]
pub struct UiamGatewayRouteSvc;

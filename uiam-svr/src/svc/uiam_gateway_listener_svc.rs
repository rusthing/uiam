use robotech::macros::svc;

/// # 网关监听器业务层
///
/// 一期的 CRUD 全部由 `#[svc]` 生成，这里先只放骨架。
///
/// 后续会补两类能力：
///
/// 1. **`addrs_json` 校验**：它是 `Vec<ListenerAddrConfig>` 的 JSON 文本，
///    而那个类型在 `gatex-svr` 里（不能引进 `uiam-api` 以免污染依赖方向）。
///    所以在这里反序列化一次，格式不对当场报错，不等到发布时才在渲染阶段炸。
/// 2. **`kind` 与地址的一致性**：`Http` 监听器不应带 TCP 专属字段，反之亦然。
///    这类语义校验只能在这里做——`#[crud_dto]` 只负责字段级约束。
#[svc]
pub struct UiamGatewayListenerSvc;

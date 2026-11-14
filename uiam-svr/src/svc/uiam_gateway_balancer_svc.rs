use robotech::macros::svc;

/// # 网关负载均衡器业务层
///
/// 一期的 CRUD 全部由 `#[svc]` 生成，这里先只放骨架。
///
/// 后续会补两类能力：
///
/// 1. **`config_json` 校验**：反序列化成 `BalancerConfig`，算法名、后端地址
///    格式不对当场报错。
/// 2. **改名时的引用连带**：`name` 是 route `to_json` 里的引用键。改名不能只改
///    这一行——要么拒绝（提示先改引用方），要么在同一事务里扫出所有引用并改写。
///    这件事跨表，必须放在 svc，不能指望前端。
#[svc]
pub struct UiamGatewayBalancerSvc;

use robotech::macros::svc;

/// # 网关实例业务层
///
/// 一期的 CRUD 全部由 `#[svc]` 生成，这里先只放骨架。
///
/// 后续会在这里补三类能力，都是「跨表 / 需要校验」才放进来的：
///
/// 1. **发布**：读整棵子树（listener / route / balancer）→ 渲染 TOML → 校验
///    `AppConfig` → 与上一版做结构比对 → 落 `uiam_gateway_release` → 写 Consul KV → 回填
/// 2. **回滚**：把历史 release 的 `content` 重新 PUT，**不重新渲染**
/// 3. **引用校验**：发布前确认 route 里 `to.type = "load-balancer"` 引用的名字在本实例
///    `uiam_gateway_balancer` 中存在——这是硬错误，必须在写库阶段拦住，不能等网关启动
#[svc]
pub struct UiamGatewaySvc;

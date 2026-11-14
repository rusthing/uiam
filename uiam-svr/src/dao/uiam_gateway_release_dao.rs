use robotech::macros::dao;

/// # 网关发布版本 DAO
///
/// ## 外键
/// - `gateway_id` → `uiam_gateway.id`：发布记录是实例的历史，删除/更新受限
///
/// ## 唯一约束
/// - `(gateway_id, version)`：同一实例内版本号递增且唯一。版本号并发分配时
///   靠这条约束兜底——两个请求同时算出「下一版是 7」，只有一个能写进去，
///   另一个收到唯一键冲突后重试取 8，不会出现两版都叫 7。
///
/// ## 为什么这里不做「内容不可变」的约束
///
/// `content` / `checksum` / `version` 落库后不该再改，但数据库层面拦不住——
/// 加触发器或 REVOKE 都比这件事本身更重。约束放在 svc 层：`update` 不对外
/// 暴露这几个字段，只允许回填 `pushed` / `pushed_ms`。
#[dao(
    foreign_keys: [
        ("gateway_id", "uiam_gateway", "网关实例"),
    ],
    unique_keys: [
        ("gateway_id,version", "实例内版本号"),
    ],
)]
pub struct UiamGatewayReleaseDao;

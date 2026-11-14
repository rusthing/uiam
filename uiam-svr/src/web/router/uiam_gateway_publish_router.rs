//! # 网关发布路由
//!
//! 三条，都在 `/uiam/gateway` 下：
//!
//! - `GET  /uiam/gateway/render-preview/{id}`
//! - `POST /uiam/gateway/publish/{id}`
//! - `POST /uiam/gateway/rollback/{id}`
//!
//! ## 为什么不与 CRUD 的 `/{id}` 冲突
//!
//! CRUD 的路径是 `/uiam/gateway/{id}`，只有两段；这里三条都是三段
//! （`/uiam/gateway/<静态段>/<id>`），段数就不同。axum 的路由匹配按段比对，
//! 静态段优先，不存在「`render-preview` 被当成 id」的可能。
//!
//! ## `rollback/{id}` 里的 id 是发布记录 ID
//!
//! 不是实例 ID——回滚的粒度是「回到某一版」，版本本身就能定位到实例
//! （`release.gateway_id`），再要一个实例 ID 是多余的参数，还多一种
//! 「两个 id 不匹配」的校验负担。

#![allow(unused_imports)]

use robotech::macros::router;

#[router(routes [
    ("/uiam/gateway/render-preview/{id}", get(render_preview_handler)),
    ("/uiam/gateway/publish/{id}", post(publish_handler)),
    ("/uiam/gateway/rollback/{id}", post(rollback_handler))
])]
struct UiamGatewayPublishRouter;

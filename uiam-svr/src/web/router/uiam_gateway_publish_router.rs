//! # 网关发布路由
//!
//! `GET /uiam/gateway/render-preview/{id}`。静态段 `render-preview` 与 CRUD 的
//! `/uiam/gateway/{id}` 在段数上就不同（2 段 vs 3 段），不存在重叠。

#![allow(unused_imports)]

use robotech::macros::router;

#[router(routes [("/uiam/gateway/render-preview/{id}", get(render_preview_handler))])]
struct UiamGatewayPublishRouter;

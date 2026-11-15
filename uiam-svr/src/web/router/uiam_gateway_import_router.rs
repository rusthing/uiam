//! # 网关配置导入路由
//!
//! 一条：`POST /uiam/gateway/import/{id}`。
//!
//! ## 为什么不与 CRUD 的 `/{id}` 冲突
//!
//! CRUD 的路径是 `/uiam/gateway/{id}`，只有两段；这条是三段
//! （`/uiam/gateway/import/<id>`），段数就不同。axum 按段比对，静态段优先，
//! 不存在「`import` 被当成 id」的可能——和 `publish` / `rollback` 同理。

#![allow(unused_imports)]

use robotech::macros::router;

#[router(routes [
    ("/uiam/gateway/import/{id}", post(import_handler))
])]
struct UiamGatewayImportRouter;

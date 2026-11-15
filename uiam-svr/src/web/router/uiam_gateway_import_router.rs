//! # 网关配置导入路由
//!
//! 两条：`GET /uiam/gateway/import/source/{id}` 读线上原文，
//! `POST /uiam/gateway/import/{id}` 拆解落库。
//!
//! ## 为什么不与 CRUD 的 `/{id}` 冲突
//!
//! CRUD 的路径是 `/uiam/gateway/{id}`，只有两段；这两条都是三段
//! （`/uiam/gateway/import/<id>`、`/uiam/gateway/import/source/<id>`），段数
//! 就不同。axum 按段比对、静态段优先，不存在「`import` 被当成 id」的可能
//! ——和 `publish` / `rollback` 同理。
//!
//! `source` 排在 `{id}` 之前声明只是习惯：两者的第二段一个是静态字面量、
//! 一个是占位符，本来就不会互相吞掉。

#![allow(unused_imports)]

use robotech::macros::router;

#[router(routes [
    ("/uiam/gateway/import/source/{id}", get(source_handler)),
    ("/uiam/gateway/import/{id}", post(import_handler))
])]
struct UiamGatewayImportRouter;

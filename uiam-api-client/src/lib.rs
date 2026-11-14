//! # uiam-api-client
//!
//! uiam 的 feign 客户端。每个实体一个 `*ApiClient`，由 `#[feign]` 宏按 ctrl 的路由
//! 规则生成方法，服务名/路径与 `uiam-svr` 侧一一对应。

mod api_client;

pub use api_client::*;
pub use uiam_api::*;

//! # uiam-api
//!
//! uiam（统一身份认证平台）的共享类型：DTO / VO / MO / 字典。
//!
//! 这个 crate 同时被 `uiam-svr`（服务端）和 `uiam-api-client`（feign 客户端）依赖，
//! 所以除 `mo` 之外的模块都不加 feature 门控——`#[vo]` / `#[crud_dto]` 宏自己会按
//! `server` feature 决定生成哪部分。

pub mod dic;
pub mod dto;
pub mod vo;

#[cfg(feature = "server")]
pub mod mo;

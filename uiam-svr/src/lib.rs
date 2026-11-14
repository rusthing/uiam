//! # uiam-svr
//!
//! uiam（统一身份认证平台）服务端。一期只做**网关管理面**：把 Consul KV 里那份
//! TOML 变成可增删改查、可发布、可回滚的数据库记录。
//!
//! ## 分层
//!
//! - `config`：`AppConfig` 及子配置
//! - `dao`：`#[dao]` 标记的实体 DAO，CRUD 与检索由宏生成
//! - `svc`：业务编排，跨表操作与校验都在这一层
//! - `web`：`ctrl`（HTTP 入口）/ `router`（路由注册）/ `api_doc`（OpenAPI 文档）
//! - `render`：把整棵子树渲染成可发布的 TOML，并做自检与试装配

pub mod config;
pub mod dao;
pub mod render;
pub mod svc;
pub mod web;

pub use uiam_api::*;

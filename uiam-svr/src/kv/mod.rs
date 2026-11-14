//! # KV 下发
//!
//! 发布链路里**唯一**的外部副作用：把渲染好的 TOML 写进 Consul KV。
//! 除此之外发布只碰自己的库（写 release、回填 `pushed`），不调用任何网关接口
//! ——「网关侧零网络交互、只从 KV 单向读」是 gatex 的铁律，管理面不能破。
//!
//! ## 为什么不复用框架的 `ConfigCenterClient::set_config`
//!
//! 那个客户端是给「服务读自己的配置」用的，只有配了 `[micro-svc.consul.config]`
//! 才会被创建；而且它的 `set_config` 只关心「HTTP 请求有没有发出去」，不看响应码
//! ——Consul 返回 500 或 ACL 拒绝时照样 `Ok(())`。发布这件事必须知道 Consul
//! **到底有没有收下**这份配置，所以这里单独一个薄客户端，对响应码和响应体都做判定。
//!
//! ## 为什么是全局单例
//!
//! 客户端要跟着配置热更新走（`[consul]` 改了地址，下一次发布就该用新地址）。
//! 用 [`ArcSwapOption`] 存一份，`setup` 每次热更新重建一次，业务侧
//! [`get_consul_kv`] 取到的永远是当前配置对应的那一个。

mod consul;
mod error;

pub use consul::*;
pub use error::*;

use crate::config::ConsulKvConfig;
use arc_swap::ArcSwapOption;
use std::sync::Arc;

/// 当前生效的 KV 客户端；`None` 表示服务启动时没成功初始化
static CONSUL_KV: ArcSwapOption<ConsulKv> = ArcSwapOption::const_empty();

/// # 初始化（或热更新）KV 客户端
///
/// 由 `main::setup` 在每次配置加载时调用：首次启动建一次，之后配置热更新
/// 重建一次。重建是幂等的——地址没变也只是换了个等价的客户端。
///
/// ## 参数
/// - `config`：`[consul]` 段
///
/// ## 返回值
/// 成功返回 `Ok(())`；地址不是合法 URL、超时为 0 等配置错误返回 [`KvError`]
///
/// ## 错误
/// 这里**故意**让配置错误直接失败：`[consul]` 写错了的话，服务起来也发布不了，
/// 与其等到用户点「发布」才发现，不如启动时就报出来。
pub fn setup_consul_kv(config: &ConsulKvConfig) -> Result<(), KvError> {
    let kv = ConsulKv::new(config)?;
    CONSUL_KV.store(Some(Arc::new(kv)));
    Ok(())
}

/// # 取当前 KV 客户端
///
/// ## 返回值
/// 客户端句柄（`Arc`，可跨 `await` 持有）
///
/// ## 错误
/// 服务没走过 [`setup_consul_kv`] 时返回 [`KvError::NotInitialized`]。
/// 正常启动流程下不会出现；单元测试或没经过 `bootstrap!` 的入口才会。
pub fn get_consul_kv() -> Result<Arc<ConsulKv>, KvError> {
    CONSUL_KV.load_full().ok_or(KvError::NotInitialized)
}

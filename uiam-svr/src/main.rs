use anyhow::anyhow;
use config::Value;
use robotech::app::setup_id_worker;
use robotech::db::setup_db_conn;
use robotech::macros::{bootstrap, db_migrate, log_call};
use robotech::web::setup_web_server;
use std::collections::HashMap;
use std::sync::Arc;
use uiam_svr::config::AppConfig;
use uiam_svr::kv::setup_consul_kv;

bootstrap!(AppConfig);

/// # 初始化或更新应用配置
///
/// 由 `bootstrap!` 生成的启动流程调用。首次启动与配置中心热更新走同一条路径，
/// 所以每个 `setup_*` 都要能接受 `changed` 并只重建受影响的部分。
///
/// ## 参数
///
/// - `app_config`：当前生效的配置快照
/// - `changed`：本次变更的键值；首次启动时为 `None`
/// - `port`：热重启时由旧进程传入的端口
/// - `old_pid`：旧进程 PID，用于优雅接替
#[log_call]
async fn setup(
    app_config: &Arc<AppConfig>,
    changed: &Option<HashMap<String, Value>>,
    port: Option<u16>,
    old_pid: Option<u32>,
) -> Result<(), anyhow::Error> {
    let db_url = app_config.db.get_url();
    db_migrate!(db_url);

    setup_id_worker(app_config.id_worker.clone(), changed).await?;
    setup_db_conn(app_config.db.clone(), changed).await?;
    // 放在 Web 之前：Web 一起来就可能有人点「发布」，那时 KV 客户端必须已经就位。
    // 这里失败直接让进程起不来——[consul] 配错了的服务，起来了也发布不了，
    // 与其等用户点发布才发现，不如启动时就报。
    setup_consul_kv(&app_config.consul)?;
    setup_web_server(app_config.web.clone(), port, old_pid, changed).await?;

    Ok(())
}

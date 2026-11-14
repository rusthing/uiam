/*==============================================================*/
/* uiam 一期初始化数据                                            */
/*                                                              */
/* id 用固定小整数，与运行时生成的雪花 ID（19 位）天然不冲突。      */
/* consul_key 与网关侧读取的 KV key 保持一致。                     */
/*==============================================================*/

insert into uiam_gateway (
    id, code, name, consul_key,
    extra_toml, ops_json, static_json, upstream_error_json,
    remark, enabled,
    creater_id, create_ms, updater_id, update_ms
) values (
    1, 'svr01', '主网关', 'gatex-rs-svr.toml',
    null, null, null, null,
    '开发环境默认实例', true,
    1, 1763136000000, 1, 1763136000000
);

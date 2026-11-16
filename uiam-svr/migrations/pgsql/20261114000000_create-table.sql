/*==============================================================*/
/* DBMS name:      PostgreSQL 9.x                               */
/* Created on:     2026/11/14 22:10:00                          */
/*                                                              */
/* uiam 一期：网关配置（5 张表）+ 桌面偏好（1 张表）               */
/*   uiam_gateway            网关实例（= 一个 Consul KV key）     */
/*   uiam_gateway_listener   监听器（http / tcp 同构，kind 区分） */
/*   uiam_gateway_route      路由（顺序即语义）                   */
/*   uiam_gateway_balancer   负载均衡器（name 被 route 引用）     */
/*   uiam_gateway_release    发布版本（content 存完整 TOML）      */
/*   uiam_user_pref          用户偏好（桌面布局等，按用户隔离）    */
/*==============================================================*/


/*==============================================================*/
/* Table: uiam_gateway                                          */
/*==============================================================*/
create table uiam_gateway (
                               id                   INT8                 not null,
                               code                 VARCHAR(50)          not null,
                               name                 VARCHAR(50)          not null,
                               consul_key           VARCHAR(200)         not null,
                               extra_toml           TEXT                 null,
                               ops_json             TEXT                 null,
                               static_json          TEXT                 null,
                               upstream_error_json  TEXT                 null,
                               remark               VARCHAR(200)         null,
                               enabled              BOOL                 not null default true,
                               creater_id           INT8                 not null,
                               create_ms            INT8                 not null,
                               updater_id           INT8                 not null,
                               update_ms            INT8                 not null,
                               constraint PK_UIAM_GATEWAY primary key (id),
                               constraint AK_CODE_UIAM_GATEWAY unique (code),
                               constraint AK_CONSUL_KEY_UIAM_GATEWAY unique (consul_key)
);

comment on table uiam_gateway is
'网关实例
一个实例对应 Consul KV 里的一个 key，也对应一组 pingora 进程';

comment on column uiam_gateway.id is
'ID';

comment on column uiam_gateway.code is
'实例标识
与 Consul 注册名一致
@len 1..=50';

comment on column uiam_gateway.name is
'展示名
@len 1..=50';

comment on column uiam_gateway.consul_key is
'Consul KV 的完整 key
发布时整份 TOML 就 PUT 到这里
@len 1..=200';

comment on column uiam_gateway.extra_toml is
'高级配置（TOML 文本）
对应 AppConfig.pingora-conf 等无法结构化的部分，留空表示全用默认值';

comment on column uiam_gateway.ops_json is
'运维端点配置（JSON）
对应 OpsConfig：health_path / metrics_path / addrs';

comment on column uiam_gateway.static_json is
'静态资源配置（JSON）
对应 StaticConfig：root_dir / page_404_path';

comment on column uiam_gateway.upstream_error_json is
'上游异常配置（JSON）
对应 UpstreamErrorConfig';

comment on column uiam_gateway.remark is
'备注
@len 0..=200';

comment on column uiam_gateway.enabled is
'启用
停用的实例不参与发布';

comment on column uiam_gateway.creater_id is
'创建者ID';

comment on column uiam_gateway.create_ms is
'创建时间戳';

comment on column uiam_gateway.updater_id is
'更新者ID';

comment on column uiam_gateway.update_ms is
'更新时间戳';


/*==============================================================*/
/* Table: uiam_gateway_listener                                 */
/*==============================================================*/
create table uiam_gateway_listener (
                                       id                   INT8                 not null,
                                       gateway_id           INT8                 not null,
                                       kind                 INT2                 not null,
                                       sort_no              INT4                 not null default 0,
                                       addrs_json           TEXT                 not null,
                                       remark               VARCHAR(200)         null,
                                       enabled              BOOL                 not null default true,
                                       creater_id           INT8                 not null,
                                       create_ms            INT8                 not null,
                                       updater_id           INT8                 not null,
                                       update_ms            INT8                 not null,
                                       constraint PK_UIAM_GATEWAY_LISTENER primary key (id)
);

comment on table uiam_gateway_listener is
'监听器
HTTP 与 TCP 的 listener 结构同构（都是 addrs + routes），用 kind 区分，不建两张表';

comment on column uiam_gateway_listener.id is
'ID';

comment on column uiam_gateway_listener.gateway_id is
'所属网关实例ID';

comment on column uiam_gateway_listener.kind is
'监听器类型
@enum ListenerKind default=Http
  1=Http  HTTP/HTTPS 监听器，渲染到 listeners
  2=Tcp   TCP 监听器，渲染到 tcp-listeners';

comment on column uiam_gateway_listener.sort_no is
'渲染顺序
listeners 是数组，顺序即语义';

comment on column uiam_gateway_listener.addrs_json is
'监听地址（JSON）
Vec<ListenerAddrConfig>，含 addr 与可选 tls';

comment on column uiam_gateway_listener.remark is
'备注
@len 0..=200';

comment on column uiam_gateway_listener.enabled is
'启用
停用的不参与渲染';

comment on column uiam_gateway_listener.creater_id is
'创建者ID';

comment on column uiam_gateway_listener.create_ms is
'创建时间戳';

comment on column uiam_gateway_listener.updater_id is
'更新者ID';

comment on column uiam_gateway_listener.update_ms is
'更新时间戳';


/*==============================================================*/
/* Table: uiam_gateway_route                                    */
/*==============================================================*/
create table uiam_gateway_route (
                                    id                   INT8                 not null,
                                    listener_id          INT8                 not null,
                                    sort_no              INT4                 not null default 0,
                                    name                 VARCHAR(100)         not null,
                                    matcher_json         TEXT                 not null,
                                    to_json              TEXT                 not null,
                                    log_json             TEXT                 null,
                                    enabled              BOOL                 not null default true,
                                    creater_id           INT8                 not null,
                                    create_ms            INT8                 not null,
                                    updater_id           INT8                 not null,
                                    update_ms            INT8                 not null,
                                    constraint PK_UIAM_GATEWAY_ROUTE primary key (id)
);

comment on table uiam_gateway_route is
'路由
顺序即语义，前面的先匹配';

comment on column uiam_gateway_route.id is
'ID';

comment on column uiam_gateway_route.listener_id is
'所属监听器ID';

comment on column uiam_gateway_route.sort_no is
'匹配顺序
顺序即语义，前面的先匹配';

comment on column uiam_gateway_route.name is
'名称
便于人看的名字，如「adm 后台接口」
@len 1..=100';

comment on column uiam_gateway_route.matcher_json is
'匹配条件（JSON）
对应 RouteMatcherConfig，有 5 种变体';

comment on column uiam_gateway_route.to_json is
'转发目标（JSON）
对应 ToConfig';

comment on column uiam_gateway_route.log_json is
'日志配置（JSON）
对应 LogConfig，为空时用默认';

comment on column uiam_gateway_route.enabled is
'启用';

comment on column uiam_gateway_route.creater_id is
'创建者ID';

comment on column uiam_gateway_route.create_ms is
'创建时间戳';

comment on column uiam_gateway_route.updater_id is
'更新者ID';

comment on column uiam_gateway_route.update_ms is
'更新时间戳';


/*==============================================================*/
/* Table: uiam_gateway_balancer                                 */
/*==============================================================*/
create table uiam_gateway_balancer (
                                       id                   INT8                 not null,
                                       gateway_id           INT8                 not null,
                                       name                 VARCHAR(100)         not null,
                                       config_json          TEXT                 not null,
                                       remark               VARCHAR(200)         null,
                                       enabled              BOOL                 not null default true,
                                       creater_id           INT8                 not null,
                                       create_ms            INT8                 not null,
                                       updater_id           INT8                 not null,
                                       update_ms            INT8                 not null,
                                       constraint PK_UIAM_GATEWAY_BALANCER primary key (id),
                                       constraint AK_NAME_UIAM_GATEWAY_BALANCER unique (gateway_id, name)
);

comment on table uiam_gateway_balancer is
'负载均衡器
balancers 是实例级全局 map，不分 listener';

comment on column uiam_gateway_balancer.id is
'ID';

comment on column uiam_gateway_balancer.gateway_id is
'所属网关实例ID';

comment on column uiam_gateway_balancer.name is
'名称
被 to.type = load-balancer 引用的名字，必须独立成列以便发布前做引用校验
@len 1..=100';

comment on column uiam_gateway_balancer.config_json is
'配置（JSON）
对应 BalancerConfig：算法、后端列表、健康检查';

comment on column uiam_gateway_balancer.remark is
'备注
@len 0..=200';

comment on column uiam_gateway_balancer.enabled is
'启用';

comment on column uiam_gateway_balancer.creater_id is
'创建者ID';

comment on column uiam_gateway_balancer.create_ms is
'创建时间戳';

comment on column uiam_gateway_balancer.updater_id is
'更新者ID';

comment on column uiam_gateway_balancer.update_ms is
'更新时间戳';


/*==============================================================*/
/* Table: uiam_gateway_release                                  */
/*==============================================================*/
create table uiam_gateway_release (
                                      id                   INT8                 not null,
                                      gateway_id           INT8                 not null,
                                      version              INT4                 not null,
                                      content              TEXT                 not null,
                                      checksum             VARCHAR(64)          not null,
                                      pushed               BOOL                 not null default false,
                                      pushed_ms            INT8                 null,
                                      creater_id           INT8                 not null,
                                      create_ms            INT8                 not null,
                                      updater_id           INT8                 not null,
                                      update_ms            INT8                 not null,
                                      constraint PK_UIAM_GATEWAY_RELEASE primary key (id),
                                      constraint AK_VERSION_UIAM_GATEWAY_RELEASE unique (gateway_id, version)
);

comment on table uiam_gateway_release is
'发布版本
content 是唯一存渲染结果的地方；回滚 = 把历史 content 重新 PUT，不重新渲染';

comment on column uiam_gateway_release.id is
'ID';

comment on column uiam_gateway_release.gateway_id is
'所属网关实例ID';

comment on column uiam_gateway_release.version is
'版本号
同一实例内从 1 递增';

comment on column uiam_gateway_release.content is
'渲染出的完整 TOML';

comment on column uiam_gateway_release.checksum is
'内容摘要
sha256 hex，用于「内容没变就不重复推」';

comment on column uiam_gateway_release.pushed is
'是否已推到 Consul
发布 != 生效：这里只代表 KV 写成功';

comment on column uiam_gateway_release.pushed_ms is
'推送成功时间戳';

comment on column uiam_gateway_release.creater_id is
'发布者ID';

comment on column uiam_gateway_release.create_ms is
'发布时间戳';

comment on column uiam_gateway_release.updater_id is
'最后操作者ID
只有推送回填（pushed / pushed_ms）会改这张表，所以这里是「谁触发的那次推送」';

comment on column uiam_gateway_release.update_ms is
'最后操作时间戳
同上：推送成功回填时刷新，用于判断「这条记录是不是刚被推过」';


/*==============================================================*/
/* Table: uiam_user_pref                                        */
/*==============================================================*/
create table uiam_user_pref (
   id                   INT8                 not null,
   user_id              INT8                 not null,
   pref_key             VARCHAR(64)          not null,
   pref_value           TEXT                 not null,
   creater_id           INT8                 not null,
   create_ms            INT8                 not null,
   updater_id           INT8                 not null,
   update_ms            INT8                 not null,
   constraint PK_UIAM_USER_PREF primary key (id),
   constraint AK_USER_KEY_UIAM_USER_PREF unique (user_id, pref_key)
);

comment on table uiam_user_pref is
'用户偏好
按用户保存桌面布局等前端偏好，key 由前端约定，value 为 JSON 文本
一个用户可以有多个 key，同一 key 只有一行';

comment on column uiam_user_pref.id is
'ID';

comment on column uiam_user_pref.user_id is
'用户 ID
来自 X-User-Id，与 adm 的用户主键一致';

comment on column uiam_user_pref.pref_key is
'偏好键
如 uiam-desktop / uiam-widget-appearance / uiam-site / uiam-gallery
@len 1..=64';

comment on column uiam_user_pref.pref_value is
'偏好值
JSON 文本，结构由对应模块自行解释
@len 1..';

comment on column uiam_user_pref.creater_id is
'创建人 ID';

comment on column uiam_user_pref.create_ms is
'创建时间戳（毫秒）';

comment on column uiam_user_pref.updater_id is
'最后修改人 ID';

comment on column uiam_user_pref.update_ms is
'最后修改时间戳（毫秒）';


/*==============================================================*/
/* 外键约束                                                      */
/*                                                              */
/* 数据库侧必须真建，不能只写在 #[dao(foreign_keys=...)] 里：        */
/* 宏里的声明只影响生成的校验代码，不产生约束。少了这段，           */
/* 「删监听器」会留下一堆孤儿路由，渲染时静默产出空 routes 数组。    */
/*                                                              */
/* route → listener 用 cascade：删监听器时路由跟着走。            */
/* 其余用 restrict：实例下还有子资源时禁止删除，逼调用方显式处理。   */
/*==============================================================*/

alter table uiam_gateway_listener
    add constraint fk_gateway_id__from__uiam_gateway foreign key (gateway_id)
        references uiam_gateway (id)
        on delete restrict on update restrict;

alter table uiam_gateway_route
    add constraint fk_listener_id__from__uiam_gateway_listener foreign key (listener_id)
        references uiam_gateway_listener (id)
        on delete cascade on update restrict;

alter table uiam_gateway_balancer
    add constraint fk_gateway_id__from__uiam_gateway foreign key (gateway_id)
        references uiam_gateway (id)
        on delete restrict on update restrict;

alter table uiam_gateway_release
    add constraint fk_gateway_id__from__uiam_gateway foreign key (gateway_id)
        references uiam_gateway (id)
        on delete restrict on update restrict;


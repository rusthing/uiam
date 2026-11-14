/*==============================================================*/
/* uiam 一期索引                                                  */
/*                                                              */
/* 只建查询路径真正用到的索引：                                     */
/*   按实例列子资源（listener / balancer / release）               */
/*   按监听器列路由并按顺序取                                       */
/* 不建 matcher 前缀索引：查询场景只有「按 listener 列出全部路由」，  */
/* 没有「按前缀搜路由」的需求。                                     */
/*==============================================================*/

CREATE INDEX idx_uiam_gateway_listener_gateway
    ON uiam_gateway_listener USING btree (gateway_id, kind, sort_no);

CREATE INDEX idx_uiam_gateway_route_listener
    ON uiam_gateway_route USING btree (listener_id, sort_no);

CREATE INDEX idx_uiam_gateway_balancer_gateway
    ON uiam_gateway_balancer USING btree (gateway_id);

CREATE INDEX idx_uiam_gateway_release_gateway_create
    ON uiam_gateway_release USING btree (gateway_id, create_ms DESC);

/**
 * 实体 → 提交载荷。
 *
 * 存在的理由只有一个：uiam 的更新接口是 **PUT 全量**，漏一个字段就等于把它清空。
 * 「在图上点一下启用」这种操作最容易犯这个错——只想着 `enabled`，忘了 `addrs_json`。
 * 所以所有「改一个字段」的地方都用 `as*Payload(entity)` 铺底再覆盖。
 */
import type {
  Balancer,
  BalancerPayload,
  Listener,
  ListenerPayload,
  Route,
  RoutePayload,
} from './types'

export function asListenerPayload(l: Listener): ListenerPayload {
  return {
    id: l.id,
    gatewayId: l.gatewayId,
    kind: l.kind,
    sortNo: l.sortNo,
    addrsJson: l.addrsJson,
    remark: l.remark ?? null,
    enabled: l.enabled,
  }
}

export function asRoutePayload(r: Route): RoutePayload {
  return {
    id: r.id,
    listenerId: r.listenerId,
    sortNo: r.sortNo,
    name: r.name,
    matcherJson: r.matcherJson,
    toJson: r.toJson,
    logJson: r.logJson ?? null,
    enabled: r.enabled,
  }
}

export function asBalancerPayload(b: Balancer): BalancerPayload {
  return {
    id: b.id,
    gatewayId: b.gatewayId,
    name: b.name,
    configJson: b.configJson,
    remark: b.remark ?? null,
    enabled: b.enabled,
  }
}

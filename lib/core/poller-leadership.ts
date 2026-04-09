/**
 * 轮询主节点选举与租约续租
 */

import "server-only";

import {randomBytes} from "node:crypto";

import {ensurePollerLeaseRow, tryAcquirePollerLease, tryRenewPollerLease} from "../database/poller-lease";
import {logError} from "../utils";
import {getPollerLeaderTimer, getPollerRole, setPollerLeaderTimer, setPollerRole, type PollerRole,} from "./global-state";

// 固定租约参数，不暴露环境变量
const LEASE_DURATION_MS = 120_000;
const LEASE_RENEW_INTERVAL_MS = 30_000;
const DEFAULT_NODE_ID = "node";

let initPromise: Promise<void> | null = null;

/**
 * 解析节点身份：用户配置的 CHECK_NODE_ID（或 HOSTNAME）作为可读前缀，
 * 再追加一个进程级唯一后缀（pid + 随机 hex），保证多节点即使共用同名配置
 * 也绝不会在租约表里撞车。
 */
function resolveNodeId(): string {
  const raw = process.env.CHECK_NODE_ID?.trim();
  const prefix = raw || process.env.HOSTNAME?.trim() || DEFAULT_NODE_ID;
  const instanceSuffix = `${process.pid}-${randomBytes(3).toString("hex")}`;
  const nodeId = `${prefix}#${instanceSuffix}`;

  if (!raw) {
    console.warn(
      `[check-cx] 未设置 CHECK_NODE_ID，使用 ${nodeId} 作为节点身份`
    );
  } else {
    console.log(`[check-cx] 轮询节点身份：${nodeId}`);
  }
  return nodeId;
}

const NODE_ID = resolveNodeId();

function setRole(nextRole: PollerRole): void {
  const currentRole = getPollerRole();
  if (currentRole === nextRole) {
    return;
  }
  setPollerRole(nextRole);
  console.log(
    `[check-cx] 节点角色切换：${currentRole} -> ${nextRole} (node=${NODE_ID})`
  );
}

async function refreshLeadership(): Promise<void> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + LEASE_DURATION_MS);
  const currentRole = getPollerRole();

  if (currentRole === "leader") {
    const renewed = await tryRenewPollerLease(NODE_ID, now, expiresAt);
    if (!renewed) {
      setRole("standby");
    }
    return;
  }

  const acquired = await tryAcquirePollerLease(NODE_ID, now, expiresAt);
  if (acquired) {
    setRole("leader");
  }
}

export async function ensurePollerLeadership(): Promise<void> {
  if (getPollerLeaderTimer()) {
    return initPromise ?? Promise.resolve();
  }
  if (initPromise) {
    return initPromise;
  }

  initPromise = (async () => {
    await ensurePollerLeaseRow();
    await refreshLeadership();
    const timer = setInterval(() => {
      refreshLeadership().catch((error) => {
        logError("pollerLeadership.refresh", error);
      });
    }, LEASE_RENEW_INTERVAL_MS);
    setPollerLeaderTimer(timer);
  })();

  return initPromise;
}

export function isPollerLeader(): boolean {
  return getPollerRole() === "leader";
}

export function getPollerNodeId(): string {
  return NODE_ID;
}

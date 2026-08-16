import { normalizeBaseUrl } from './tokenMetrics'
import { requestJson } from './sub2apiClient'
import type {
  AdminMonitorMetrics,
  PoolAccountDetailItem,
  PoolAccountSummary,
  ServerStatus
} from './tokenMetrics'

const healthTimeoutMs = 10_000

export interface CliProxyApiConfig {
  baseUrl: string
  managementKey: string
}

/**
 * Read-only adapter for CLIProxyAPI's Management API. Recent CLIProxyAPI
 * versions intentionally do not expose aggregate token statistics, so the
 * returned metrics keep those fields null and focus on service/account health.
 */
export async function fetchCliProxyApiMetrics(config: CliProxyApiConfig): Promise<AdminMonitorMetrics> {
  const baseUrl = normalizeBaseUrl(config.baseUrl)
  const headers = {
    Authorization: `Bearer ${config.managementKey.trim()}`,
    Accept: 'application/json'
  }
  const startedAt = Date.now()
  const [healthPayload, authFilesPayload] = await Promise.all([
    requestJson(`${baseUrl}/healthz`, {}, 'GET', undefined, healthTimeoutMs, 'CLIProxyAPI'),
    requestJson(`${baseUrl}/v0/management/auth-files`, headers, 'GET', undefined, undefined, 'CLIProxyAPI')
  ])

  const accountDetails = parseCliProxyAuthFiles(authFilesPayload)
  const poolAccounts = summarizeCliProxyAccounts(accountDetails)
  const requestTotals = summarizeCliProxyRequests(authFilesPayload)
  const now = new Date().toISOString()

  return {
    source: 'cliproxyapi',
    todayTotalTokens: null,
    todayTotalCost: null,
    totalRequests: requestTotals.success + requestTotals.failed,
    failedRequests: requestTotals.failed,
    totalTokens: null,
    totalActualCost: null,
    totalAccountCost: null,
    totalStandardCost: null,
    averageDurationMs: null,
    activeUsers: null,
    poolRemainingPercent: null,
    poolLatestResetAt: null,
    poolResetItems: [],
    poolSevenDayRemainingPercent: null,
    poolSevenDayLatestResetAt: null,
    poolSevenDayResetItems: [],
    poolAccounts,
    poolCapacity: null,
    poolAccountDetails: accountDetails,
    userRanking: [],
    serverStatus: isHealthyPayload(healthPayload) ? 'online' : 'degraded',
    serverLatencyMs: Math.max(0, Date.now() - startedAt),
    serverCpuPercent: null,
    serverMemoryPercent: null,
    serverUptimeSeconds: null,
    codexStatus: 'unknown',
    activeCodexTasks: null,
    queuedCodexTasks: null,
    updatedAt: now
  }
}

export function parseCliProxyAuthFiles(payload: unknown): PoolAccountDetailItem[] {
  const files = readCliProxyAuthFileItems(payload)
  return files
    .map((item, index) => parseCliProxyAuthFile(item, index))
    .filter((item): item is PoolAccountDetailItem => item !== null)
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((item, index) => ({ ...item, rank: index + 1 }))
}

export function summarizeCliProxyAccounts(details: PoolAccountDetailItem[]): PoolAccountSummary {
  return details.reduce<PoolAccountSummary>((summary, item) => {
    summary.total += 1
    if (item.status === 'error' || item.status === 'disabled') summary.error += 1
    else if (item.status === 'limited') summary.limited += 1
    else if (item.schedulable) summary.active += 1
    return summary
  }, { active: 0, limited: 0, error: 0, total: 0 })
}

export function summarizeCliProxyRequests(payload: unknown): { success: number; failed: number } {
  return readCliProxyAuthFileItems(payload).reduce<{ success: number; failed: number }>((summary, item) => {
    if (!isRecord(item)) return summary
    summary.success += Math.max(0, readNumber(item.success) ?? 0)
    summary.failed += Math.max(0, readNumber(item.failed) ?? 0)
    return summary
  }, { success: 0, failed: 0 })
}

function readCliProxyAuthFileItems(payload: unknown): unknown[] {
  if (!isRecord(payload)) return []
  if (Array.isArray(payload.files)) return payload.files
  if (isRecord(payload.data) && Array.isArray(payload.data.files)) return payload.data.files
  return []
}

function parseCliProxyAuthFile(value: unknown, index: number): PoolAccountDetailItem | null {
  if (!isRecord(value)) return null
  const name = readString(value, ['name', 'label', 'email', 'id']) || `账号 ${index + 1}`
  const rawStatus = readString(value, ['status', 'status_message']).toLowerCase()
  const disabled = value.disabled === true || rawStatus.includes('disabled')
  const unavailable = value.unavailable === true || rawStatus.includes('unavailable')
  const limited = rawStatus.includes('limit') || rawStatus.includes('rate') || rawStatus.includes('overload')
  const errored = unavailable || rawStatus.includes('error') || rawStatus.includes('fail')
  const status = disabled ? 'disabled' : errored ? 'error' : limited ? 'limited' : 'normal'
  const schedulable = !disabled && !unavailable
  const success = readNumber(value.success)
  const failed = readNumber(value.failed)
  const requestSummary = success === null && failed === null ? '' : ` · ${success ?? 0} 成功 / ${failed ?? 0} 失败`

  return {
    rank: 0,
    priority: readNumber(value.priority),
    name,
    status,
    statusText: statusText(status),
    schedulable,
    scheduleText: schedulable ? `可调度${requestSummary}` : '不可调度',
    capacityText: readString(value, ['provider', 'type', 'account_type']) || 'CLIProxyAPI',
    capacityUsed: null,
    todayTokens: null,
    sevenDayCost: null,
    usageWindows: []
  }
}

function statusText(status: PoolAccountDetailItem['status']): string {
  return ({ normal: '正常', limited: '限流', error: '异常', disabled: '已停用' })[status]
}

function isHealthyPayload(payload: unknown): boolean {
  if (!isRecord(payload)) return false
  const status = readString(payload, ['status']).toLowerCase()
  return status === '' || status === 'ok' || status === 'healthy'
}

function readString(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  }
  return ''
}

function readNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function cliProxyServerStatusLabel(status: ServerStatus | undefined): string {
  return ({ online: '在线', degraded: '部分异常', offline: '离线', unknown: '未提供' })[status ?? 'unknown']
}

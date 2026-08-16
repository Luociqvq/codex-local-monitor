import {
  buildAdminApiKeyHeaders,
  buildSub2apiHeaders,
  calculatePoolRemainingPercent,
  countPoolAccounts,
  findExactGroupIdsByNames,
  findPoolCapacitySummary,
  findLatestPoolResetAt,
  listPoolAccountDetails,
  listPoolResetItems,
  normalizeBaseUrl,
  parseGroups,
  parseActiveUsers,
  parseServerTelemetry,
  parseAverageDurationMs,
  parseLatestFirstTokenMs,
  parseTodayActualCost,
  parseTotalAccountCost,
  parseTotalActualCost,
  parseTotalStandardCost,
  parseTotalTokens,
  parseTodayTokens,
  parseModelUsageRanking,
  parseModelUserUsage,
  parseUserModelUsage,
  parseUserRanking,
  parseUsers,
  readItems,
  type AdminMonitorMetrics,
  type ModelUsageRankItem,
  type ModelUserUsageItem,
  type PoolAccountTodayStats,
  type UserIdentityItem,
  type UserModelUsageItem,
  type TokenOrbMetrics
} from './tokenMetrics'

type TauriInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>
type HttpMethod = 'GET' | 'POST'

const requestTimeoutMs = 30_000
const optionalOpsTimeoutMs = 5_000
let tauriInvokePromise: Promise<TauriInvoke | null> | null = null

export interface Sub2apiConfig {
  baseUrl: string
  token: string
}

export interface AdminMonitorConfig {
  baseUrl: string
  apiKey: string
  poolGroupName?: string
  poolGroupNames?: string[]
  /** Skip rankings and per-account usage calls for a low-overhead widget poll. */
  lightweight?: boolean
}

export async function fetchSub2apiMetrics(config: Sub2apiConfig): Promise<TokenOrbMetrics> {
  const baseUrl = normalizeBaseUrl(config.baseUrl)
  const headers = buildSub2apiHeaders(config.token)

  const [statsPayload, usagePayload] = await Promise.all([
    requestJson(`${baseUrl}/api/v1/usage/dashboard/stats`, headers),
    requestJson(`${baseUrl}/api/v1/usage?page=1&page_size=1&sort=created_at&order=desc`, headers)
  ])

  return {
    todayTokens: parseTodayTokens(statsPayload),
    todayCost: parseTodayActualCost(statsPayload),
    firstTokenMs: parseLatestFirstTokenMs(usagePayload),
    updatedAt: new Date().toISOString()
  }
}

export async function fetchAdminMonitorMetrics(config: AdminMonitorConfig): Promise<AdminMonitorMetrics> {
  const baseUrl = normalizeBaseUrl(config.baseUrl)
  const headers = buildAdminApiKeyHeaders(config.apiKey)
  const realtimeHeaders = buildRealtimeHeaders(headers)
  const startedAt = Date.now()
  const today = formatLocalDate(new Date())
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai'
  const todayQuery = `start_date=${today}&end_date=${today}&timezone=${encodeURIComponent(timezone)}`
  const groupNames = normalizePoolGroupNames(config.poolGroupNames ?? config.poolGroupName)
  const lightweight = config.lightweight === true
  const refreshAt = Date.now()
  const opsOverviewRequest = requestOptionalJson(
    buildRealtimeUrl(`${baseUrl}/api/v1/admin/ops/dashboard/overview?time_range=5m`, refreshAt),
    realtimeHeaders
  )
  const opsConcurrencyRequest = requestOptionalJson(
    buildRealtimeUrl(`${baseUrl}/api/v1/admin/ops/concurrency?platform=openai`, refreshAt),
    realtimeHeaders
  )
  const groupsPayload = groupNames.length > 0 ? await requestJson(`${baseUrl}/api/v1/admin/groups/all`, headers) : null
  const poolGroupIds = groupNames.length > 0 ? findExactGroupIdsByNames(parseGroups(groupsPayload), groupNames) : []
  const groupMatched = groupNames.length === 0 || poolGroupIds.length > 0
  const accountsRequests =
    poolGroupIds.length > 0
      ? poolGroupIds.map((groupId) =>
          requestJson(
            buildRealtimeUrl(
              `${baseUrl}/api/v1/admin/accounts?page=1&page_size=200&group=${encodeURIComponent(String(groupId))}`,
              refreshAt
            ),
            realtimeHeaders
          )
        )
      : [requestJson(buildRealtimeUrl(`${baseUrl}/api/v1/admin/accounts?page=1&page_size=200`, refreshAt), realtimeHeaders)]

  const [statsPayload, rankingPayload, usersPayload, accountsPayloads, capacityPayload, opsOverviewPayload, opsConcurrencyPayload] = await Promise.all([
    requestJson(buildRealtimeUrl(`${baseUrl}/api/v1/admin/dashboard/stats?timezone=${encodeURIComponent(timezone)}`, refreshAt), realtimeHeaders),
    lightweight
      ? Promise.resolve(null)
      : requestJson(buildRealtimeUrl(`${baseUrl}/api/v1/admin/dashboard/users-ranking?${todayQuery}&limit=10`, refreshAt), realtimeHeaders),
    lightweight ? Promise.resolve(null) : requestJson(`${baseUrl}/api/v1/admin/users?page=1&page_size=200`, headers),
    Promise.all(accountsRequests),
    requestJson(buildRealtimeUrl(`${baseUrl}/api/v1/admin/groups/capacity-summary?timezone=${encodeURIComponent(timezone)}`, refreshAt), realtimeHeaders),
    opsOverviewRequest,
    opsConcurrencyRequest
  ])

  const accountItems = groupMatched ? dedupeAccounts(accountsPayloads.flatMap((payload) => readItems(payload))) : []
  const selectedGroupIds = poolGroupIds.length > 0 ? poolGroupIds : null
  const now = new Date()
  const [todayStatsByAccountId, sevenDayCostByAccountId] = groupMatched && !lightweight
    ? await Promise.all([
        fetchAccountTodayStats(baseUrl, headers, accountItems, refreshAt),
        fetchAccountSevenDayCosts(baseUrl, headers, accountItems, refreshAt)
      ])
    : [{}, {}]
  const userIdentities = parseUsers(usersPayload)

  const telemetry = parseServerTelemetry(statsPayload, opsOverviewPayload, opsConcurrencyPayload)
  const requestLatencyMs = Math.max(0, Date.now() - startedAt)

  return {
    source: 'sub2api',
    todayTotalTokens: parseTodayTokens(statsPayload),
    todayTotalCost: parseTodayActualCost(statsPayload),
    totalTokens: parseTotalTokens(statsPayload),
    totalActualCost: parseTotalActualCost(statsPayload),
    totalAccountCost: parseTotalAccountCost(statsPayload),
    totalStandardCost: parseTotalStandardCost(statsPayload),
    averageDurationMs: parseAverageDurationMs(statsPayload),
    activeUsers: parseActiveUsers(statsPayload),
    poolRemainingPercent: groupMatched ? calculatePoolRemainingPercent(accountItems, selectedGroupIds, now, '5h') : null,
    poolLatestResetAt: groupMatched ? findLatestPoolResetAt(accountItems, selectedGroupIds, now, '5h') : null,
    poolResetItems: groupMatched ? listPoolResetItems(accountItems, selectedGroupIds, now, '5h') : [],
    poolSevenDayRemainingPercent: groupMatched ? calculatePoolRemainingPercent(accountItems, selectedGroupIds, now, '7d') : null,
    poolSevenDayLatestResetAt: groupMatched ? findLatestPoolResetAt(accountItems, selectedGroupIds, now, '7d') : null,
    poolSevenDayResetItems: groupMatched ? listPoolResetItems(accountItems, selectedGroupIds, now, '7d') : [],
    poolAccounts: groupMatched ? countPoolAccounts(accountItems, selectedGroupIds) : null,
    poolCapacity: groupMatched ? findPoolCapacitySummary(capacityPayload, selectedGroupIds) : null,
    poolAccountDetails: groupMatched
      ? listPoolAccountDetails(accountItems, selectedGroupIds, now, todayStatsByAccountId, sevenDayCostByAccountId)
      : [],
    userRanking: parseUserRanking(rankingPayload, userIdentities),
    userIdentities,
    serverStatus: 'online',
    serverLatencyMs: requestLatencyMs,
    serverCpuPercent: telemetry.cpuPercent,
    serverMemoryPercent: telemetry.memoryPercent,
    serverUptimeSeconds: telemetry.uptimeSeconds,
    codexStatus: telemetry.codexStatus,
    activeCodexTasks: telemetry.activeCodexTasks,
    queuedCodexTasks: telemetry.queuedCodexTasks,
    updatedAt: new Date().toISOString()
  }
}

export async function fetchAdminUserModelUsage(
  config: Pick<AdminMonitorConfig, 'baseUrl' | 'apiKey'>,
  userId: number
): Promise<UserModelUsageItem[]> {
  const baseUrl = normalizeBaseUrl(config.baseUrl)
  const headers = buildRealtimeHeaders(buildAdminApiKeyHeaders(config.apiKey))
  const today = formatLocalDate(new Date())
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai'
  const query = `start_date=${today}&end_date=${today}&timezone=${encodeURIComponent(timezone)}&user_id=${encodeURIComponent(String(userId))}`
  const payload = await requestJson(buildRealtimeUrl(`${baseUrl}/api/v1/admin/dashboard/models?${query}`), headers)
  return parseUserModelUsage(payload)
}

export async function fetchAdminModelUsageRanking(
  config: Pick<AdminMonitorConfig, 'baseUrl' | 'apiKey'>
): Promise<ModelUsageRankItem[]> {
  const baseUrl = normalizeBaseUrl(config.baseUrl)
  const headers = buildRealtimeHeaders(buildAdminApiKeyHeaders(config.apiKey))
  const today = formatLocalDate(new Date())
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai'
  const query = `start_date=${today}&end_date=${today}&timezone=${encodeURIComponent(timezone)}&model_source=requested`
  const payload = await requestJson(buildRealtimeUrl(`${baseUrl}/api/v1/admin/dashboard/models?${query}`), headers)
  return parseModelUsageRanking(payload)
}

export async function fetchAdminModelUserUsage(
  config: Pick<AdminMonitorConfig, 'baseUrl' | 'apiKey'>,
  model: string,
  userIdentities: UserIdentityItem[] = []
): Promise<ModelUserUsageItem[]> {
  const baseUrl = normalizeBaseUrl(config.baseUrl)
  const headers = buildRealtimeHeaders(buildAdminApiKeyHeaders(config.apiKey))
  const today = formatLocalDate(new Date())
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai'
  const query = `start_date=${today}&end_date=${today}&timezone=${encodeURIComponent(timezone)}&model_source=requested&model=${encodeURIComponent(model)}&limit=200`
  const payload = await requestJson(buildRealtimeUrl(`${baseUrl}/api/v1/admin/dashboard/user-breakdown?${query}`), headers)
  return parseModelUserUsage(payload, userIdentities)
}

function normalizePoolGroupNames(value: string | string[] | undefined): string[] {
  const values = Array.isArray(value) ? value : [value]
  const names = values.map((item) => String(item ?? '').trim()).filter((item) => item !== '')
  return Array.from(new Set(names))
}

function dedupeAccounts(accounts: unknown[]): unknown[] {
  const seen = new Set<string>()
  const deduped: unknown[] = []

  accounts.forEach((account, index) => {
    const key = getAccountDedupeKey(account, index)
    if (seen.has(key)) return
    seen.add(key)
    deduped.push(account)
  })

  return deduped
}

function getAccountDedupeKey(account: unknown, index: number): string {
  if (typeof account !== 'object' || account === null || Array.isArray(account)) return `index:${index}`
  const record = account as Record<string, unknown>
  const id = record.id ?? record.account_id ?? record.accountId ?? record.token_id ?? record.tokenId
  if (id !== undefined && id !== null && String(id).trim() !== '') return `id:${String(id)}`
  return `index:${index}`
}

async function fetchAccountTodayStats(
  baseUrl: string,
  headers: Record<string, string>,
  accounts: unknown[],
  refreshAt: number
): Promise<Record<string, PoolAccountTodayStats>> {
  const accountIds = listAccountIds(accounts)
  if (accountIds.length === 0) return {}

  try {
    const payload = await requestJson(
      buildRealtimeUrl(`${baseUrl}/api/v1/admin/accounts/today-stats/batch`, refreshAt),
      { ...headers, 'Content-Type': 'application/json' },
      'POST',
      { account_ids: accountIds }
    )
    return parseAccountTodayStats(payload)
  } catch {
    return {}
  }
}

function listAccountIds(accounts: unknown[]): number[] {
  const seen = new Set<number>()
  const ids: number[] = []
  accounts.forEach((account) => {
    if (typeof account !== 'object' || account === null || Array.isArray(account)) return
    const record = account as Record<string, unknown>
    const id = readFiniteNumber(record.id ?? record.account_id ?? record.accountId ?? record.token_id ?? record.tokenId)
    if (id === null || id <= 0 || seen.has(id)) return
    seen.add(id)
    ids.push(id)
  })
  return ids
}

async function fetchAccountSevenDayCosts(
  baseUrl: string,
  headers: Record<string, string>,
  accounts: unknown[],
  refreshAt: number
): Promise<Record<string, number | null>> {
  const accountIds = listAccountIds(accounts.filter(hasSevenDayUsageWindow))
  const costs: Record<string, number | null> = {}

  for (let index = 0; index < accountIds.length; index += 4) {
    const batch = accountIds.slice(index, index + 4)
    await Promise.all(batch.map(async (accountId) => {
      try {
        const payload = await requestJson(
          buildRealtimeUrl(`${baseUrl}/api/v1/admin/accounts/${accountId}/usage?source=active`, refreshAt),
          headers
        )
        costs[String(accountId)] = parseSevenDayWindowCost(payload)
      } catch {
        costs[String(accountId)] = null
      }
    }))
  }

  return costs
}

function hasSevenDayUsageWindow(account: unknown): boolean {
  if (typeof account !== 'object' || account === null || Array.isArray(account)) return false
  const extra = (account as Record<string, unknown>).extra
  if (typeof extra !== 'object' || extra === null || Array.isArray(extra)) return false
  const record = extra as Record<string, unknown>
  return ['codex_7d_used_percent', 'codex_7d_reset_at', 'codex_7d_reset_after_seconds']
    .some((key) => record[key] !== undefined && record[key] !== null)
}

function parseSevenDayWindowCost(payload: unknown): number | null {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return null
  const root = payload as Record<string, unknown>
  const data = typeof root.data === 'object' && root.data !== null && !Array.isArray(root.data)
    ? root.data as Record<string, unknown>
    : root
  const sevenDay = typeof data.seven_day === 'object' && data.seven_day !== null && !Array.isArray(data.seven_day)
    ? data.seven_day as Record<string, unknown>
    : null
  const windowStats = sevenDay && typeof sevenDay.window_stats === 'object' && sevenDay.window_stats !== null && !Array.isArray(sevenDay.window_stats)
    ? sevenDay.window_stats as Record<string, unknown>
    : null
  return readFiniteNumber(windowStats?.cost)
}

function parseAccountTodayStats(payload: unknown): Record<string, PoolAccountTodayStats> {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return {}
  const record = payload as Record<string, unknown>
  const data = typeof record.data === 'object' && record.data !== null && !Array.isArray(record.data)
    ? record.data as Record<string, unknown>
    : record
  const stats = typeof data.stats === 'object' && data.stats !== null && !Array.isArray(data.stats)
    ? data.stats as Record<string, unknown>
    : {}

  return Object.fromEntries(Object.entries(stats).map(([accountId, value]) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return [accountId, { tokens: null }]
    }
    const item = value as Record<string, unknown>
    return [accountId, {
      tokens: readFiniteNumber(item.tokens)
    }]
  }))
}

function readFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

async function requestJson(
  url: string,
  headers: Record<string, string>,
  method: HttpMethod = 'GET',
  body?: unknown,
  timeoutMs = requestTimeoutMs,
  serviceLabel = 'sub2api'
): Promise<unknown> {
  const invoke = await loadTauriInvoke()
  if (invoke) {
    return invoke('sub2api_request', { request: { url, headers, method, body, timeoutMs } })
  }

  const response = await fetch(url, {
    method,
    headers,
    body: method === 'GET' || body === undefined ? undefined : JSON.stringify(body),
    signal: typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal
      ? AbortSignal.timeout(timeoutMs)
      : undefined
  })
  if (!response.ok) {
    throw new Error(await formatApiHttpError(response, serviceLabel))
  }
  return response.json()
}

export { requestJson }

async function formatApiHttpError(response: Response, serviceLabel: string): Promise<string> {
  const detail = await readSub2apiErrorDetail(response)
  const authFailed = response.status === 401 || response.status === 403
  if (authFailed) {
    if (serviceLabel === 'sub2api') {
      return detail
        ? `认证失败，Token 错误或已失效：${detail}`
        : `认证失败，Token 错误或已失效（HTTP ${response.status}）`
    }
    return detail
      ? `${serviceLabel} 认证失败：${detail}`
      : `${serviceLabel} 认证失败（HTTP ${response.status}）`
  }
  return detail
    ? `${serviceLabel} 请求失败（HTTP ${response.status}）：${detail}`
    : `${serviceLabel} 请求失败：HTTP ${response.status}`
}

async function readSub2apiErrorDetail(response: Response): Promise<string> {
  const text = await response.text().catch(() => '')
  if (!text.trim()) return ''
  try {
    const parsed = JSON.parse(text) as unknown
    return readErrorMessage(parsed) || text.trim()
  } catch {
    return text.trim()
  }
}

function readErrorMessage(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return ''
  const record = value as Record<string, unknown>
  for (const key of ['message', 'error', 'detail', 'msg']) {
    const message = readErrorMessage(record[key])
    if (message) return message
  }
  return ''
}

export function buildRealtimeUrl(url: string, timestamp = Date.now()): string {
  const separator = url.includes('?') ? '&' : '?'
  return `${url}${separator}_ts=${encodeURIComponent(String(timestamp))}`
}

function buildRealtimeHeaders(headers: Record<string, string>): Record<string, string> {
  return {
    ...headers,
    'Cache-Control': 'no-cache',
    Pragma: 'no-cache'
  }
}

async function loadTauriInvoke(): Promise<TauriInvoke | null> {
  if (!('__TAURI_INTERNALS__' in window)) return null
  if (tauriInvokePromise) return tauriInvokePromise
  tauriInvokePromise = import('@tauri-apps/api/core')
    .then((api) => api.invoke as TauriInvoke)
    .catch(() => null)
  return tauriInvokePromise
}

async function requestOptionalJson(url: string, headers: Record<string, string>): Promise<unknown | null> {
  try {
    return await requestJson(url, headers, 'GET', undefined, optionalOpsTimeoutMs)
  } catch {
    return null
  }
}

function formatLocalDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

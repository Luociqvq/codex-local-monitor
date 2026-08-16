import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  fetchCliProxyApiMetrics,
  parseCliProxyAuthFiles,
  summarizeCliProxyAccounts,
  summarizeCliProxyRequests
} from './cliProxyApiClient'

afterEach(() => {
  vi.unstubAllGlobals()
  delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
})

describe('CLIProxyAPI adapter', () => {
  const authFilesPayload = {
    files: [
      { name: 'codex-b.json', provider: 'codex', status: 'active', success: 20, failed: 2 },
      { name: 'claude-disabled.json', provider: 'claude', status: 'disabled', disabled: true, success: 4, failed: 1 },
      { name: 'codex-limited.json', provider: 'codex', status: 'rate_limited', success: 7, failed: 3 },
      { name: 'antigravity-error.json', provider: 'antigravity', status: 'error', unavailable: true, success: 0, failed: 5 }
    ]
  }

  it('normalizes CLIProxyAPI auth files into account details', () => {
    const details = parseCliProxyAuthFiles(authFilesPayload)

    expect(details.map((item) => item.name)).toEqual([
      'antigravity-error.json',
      'claude-disabled.json',
      'codex-b.json',
      'codex-limited.json'
    ])
    expect(details.map((item) => item.status)).toEqual(['error', 'disabled', 'normal', 'limited'])
    expect(details.find((item) => item.name === 'codex-b.json')?.scheduleText).toContain('20 成功 / 2 失败')
  })

  it('summarizes account and request status without treating disabled accounts as active', () => {
    const details = parseCliProxyAuthFiles(authFilesPayload)

    expect(summarizeCliProxyAccounts(details)).toEqual({ active: 1, limited: 1, error: 2, total: 4 })
    expect(summarizeCliProxyRequests(authFilesPayload)).toEqual({ success: 31, failed: 11 })
  })

  it('requests health and read-only management data with the management key', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/healthz')) return jsonResponse({ status: 'ok' })
      if (url.endsWith('/v0/management/auth-files')) return jsonResponse(authFilesPayload)
      return jsonResponse({ error: 'not found' }, 404)
    })
    vi.stubGlobal('fetch', fetchMock)

    const metrics = await fetchCliProxyApiMetrics({
      baseUrl: 'http://127.0.0.1:8317/',
      managementKey: 'MANAGEMENT_KEY'
    })

    expect(metrics.source).toBe('cliproxyapi')
    expect(metrics.serverStatus).toBe('online')
    expect(metrics.totalRequests).toBe(42)
    expect(metrics.failedRequests).toBe(11)
    expect(metrics.poolAccounts).toEqual({ active: 1, limited: 1, error: 2, total: 4 })
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8317/v0/management/auth-files',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer MANAGEMENT_KEY' })
      })
    )
  })
})

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}

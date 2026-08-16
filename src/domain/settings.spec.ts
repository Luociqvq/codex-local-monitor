import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  hasCliProxySettings,
  hasRequiredSub2apiSettings,
  loadSettings,
  saveSettings,
  settingsStorageKey
} from './settings'

describe('settings data sources', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', window.localStorage)
    localStorage.clear()
  })

  it('keeps legacy settings on the sub2api data source', () => {
    localStorage.setItem(settingsStorageKey, JSON.stringify({
      sub2apiBaseUrl: 'https://sub2api.example.test',
      adminApiKey: 'ADMIN_KEY',
      refreshSeconds: 30
    }))

    const settings = loadSettings()

    expect(settings.dataSource).toBe('sub2api')
    expect(settings.cliProxyManagementKey).toBe('')
    expect(hasRequiredSub2apiSettings(settings)).toBe(true)
  })

  it('persists and validates a CLIProxyAPI management source', () => {
    const settings = saveSettings({
      dataSource: 'cliproxyapi',
      sub2apiBaseUrl: 'http://127.0.0.1:8317',
      adminApiKey: '',
      cliProxyManagementKey: 'MANAGEMENT_KEY',
      personalFloatingEnabled: false,
      personalToken: '',
      poolGroupName: '',
      poolGroupNames: [],
      refreshSeconds: 15
    })

    expect(hasCliProxySettings(settings)).toBe(true)
    expect(hasRequiredSub2apiSettings(settings)).toBe(false)
    expect(loadSettings()).toEqual(expect.objectContaining({
      dataSource: 'cliproxyapi',
      cliProxyManagementKey: 'MANAGEMENT_KEY'
    }))
  })
})

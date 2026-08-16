import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App.vue'
import { settingsStorageKey, type AppSettings } from '@/domain/settings'
import type { AdminMonitorMetrics, TokenOrbMetrics } from '@/domain/tokenMetrics'
import { fetchAdminMonitorMetrics, fetchSub2apiMetrics } from '@/domain/sub2apiClient'
import { fetchCliProxyApiMetrics } from '@/domain/cliProxyApiClient'

enableAutoUnmount(afterEach)

const tauri = vi.hoisted(() => {
  let settingsListener: (() => void) | undefined
  let openSettingsListener: (() => void) | undefined
  const invoke = vi.fn(async () => undefined)
  const emit = vi.fn(async () => undefined)
  const listen = vi.fn(async (name: string, callback: () => void) => {
    if (name === 'token-orb-settings-updated') settingsListener = callback
    if (name === 'token-orb-open-settings') openSettingsListener = callback
    return vi.fn()
  })
  const getVersion = vi.fn(async () => '0.4.13')
  const check = vi.fn<() => Promise<{ version: string; body: string } | null>>(async () => null)
  const relaunch = vi.fn(async () => undefined)
  const currentWindow = {
    close: vi.fn(async () => undefined),
    hide: vi.fn(async () => undefined),
    show: vi.fn(async () => undefined),
    setFocus: vi.fn(async () => undefined),
    startDragging: vi.fn(async () => undefined)
  }
  return {
    invoke,
    emit,
    listen,
    getVersion,
    check,
    relaunch,
    currentWindow,
    getSettingsListener: () => settingsListener,
    getOpenSettingsListener: () => openSettingsListener,
    resetSettingsListener: () => { settingsListener = undefined; openSettingsListener = undefined }
  }
})

const defaultAdminMetrics = (): AdminMonitorMetrics => ({
  todayTotalTokens: null,
  todayTotalCost: null,
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
  poolAccounts: null,
  poolCapacity: null,
  poolAccountDetails: [],
  userRanking: [],
  userIdentities: [],
  serverStatus: 'unknown',
  serverLatencyMs: null,
  serverCpuPercent: null,
  serverMemoryPercent: null,
  serverUptimeSeconds: null,
  codexStatus: 'unknown',
  activeCodexTasks: null,
  queuedCodexTasks: null,
  updatedAt: null
})

const defaultPersonalMetrics = (): TokenOrbMetrics => ({
  todayTokens: null,
  todayCost: null,
  firstTokenMs: null,
  updatedAt: null
})

vi.mock('@/domain/sub2apiClient', () => ({
  fetchAdminMonitorMetrics: vi.fn(),
  fetchSub2apiMetrics: vi.fn()
}))

vi.mock('@/domain/cliProxyApiClient', () => ({
  fetchCliProxyApiMetrics: vi.fn()
}))

vi.mock('@tauri-apps/api/core', () => ({ invoke: tauri.invoke }))
vi.mock('@tauri-apps/api/app', () => ({ getVersion: tauri.getVersion }))
vi.mock('@tauri-apps/api/event', () => ({ emit: tauri.emit, listen: tauri.listen }))
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => tauri.currentWindow }))
vi.mock('@tauri-apps/plugin-updater', () => ({ check: tauri.check }))
vi.mock('@tauri-apps/plugin-process', () => ({ relaunch: tauri.relaunch }))

const adminSettings: AppSettings = {
  dataSource: 'sub2api',
  sub2apiBaseUrl: 'https://subapi.example.test',
  adminApiKey: 'admin-key',
  cliProxyManagementKey: '',
  personalFloatingEnabled: false,
  personalToken: '',
  poolGroupName: 'codex',
  poolGroupNames: ['codex'],
  refreshSeconds: 10
}

const personalSettings: AppSettings = {
  ...adminSettings,
  adminApiKey: '',
  personalFloatingEnabled: true,
  personalToken: 'personal-token',
  poolGroupName: '',
  poolGroupNames: []
}

function setSettings(value: AppSettings) {
  localStorage.setItem(settingsStorageKey, JSON.stringify(value))
}

function setTauri(enabled = true) {
  if (enabled) Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value: {} })
  else delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
}

describe('Sub2API Pulse dashboard', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    tauri.resetSettingsListener()
    vi.stubGlobal('localStorage', window.localStorage)
    window.localStorage.clear()
    setTauri(false)
    window.history.replaceState({}, '', '/?view=platform')
    vi.mocked(fetchAdminMonitorMetrics).mockResolvedValue(defaultAdminMetrics())
    vi.mocked(fetchSub2apiMetrics).mockResolvedValue(defaultPersonalMetrics())
    vi.mocked(fetchCliProxyApiMetrics).mockResolvedValue(defaultAdminMetrics())
  })

  it('renders the setup form when no credentials are configured', async () => {
    const wrapper = mount(App)
    await flushPromises()

    expect(wrapper.get('.onboarding .updated').text()).toContain('数据源')
    expect(wrapper.get('.onboarding .setup-intro').text()).toContain('CLIProxyAPI')
    expect(wrapper.get('button.primary-button--wide').text()).toContain('连接并开始监控')
    expect(fetchAdminMonitorMetrics).not.toHaveBeenCalled()
    expect(fetchSub2apiMetrics).not.toHaveBeenCalled()
  })

  it('requests the native setup geometry on first launch', async () => {
    setTauri(true)
    const wrapper = mount(App)
    await flushPromises()
    expect(wrapper.find('.onboarding').exists()).toBe(true)
    expect(tauri.invoke).toHaveBeenCalledWith('set_widget_setup')
  })

  it('polls admin metrics in lightweight mode and renders telemetry', async () => {
    setSettings(adminSettings)
    vi.mocked(fetchAdminMonitorMetrics).mockResolvedValueOnce({
      ...defaultAdminMetrics(),
      todayTotalTokens: 382_130_000,
      todayTotalCost: 544.43,
      totalActualCost: 1024.5,
      poolRemainingPercent: 80,
      poolAccounts: { active: 2, limited: 33, error: 25, total: 80 },
      serverStatus: 'online',
      serverLatencyMs: 14290,
      serverCpuPercent: 42,
      serverMemoryPercent: 68,
      serverUptimeSeconds: 90061,
      codexStatus: 'running',
      activeCodexTasks: 2,
      queuedCodexTasks: 1,
      updatedAt: '2026-08-11T12:34:56.000Z'
    })

    const wrapper = mount(App)
    await flushPromises()

    expect(fetchAdminMonitorMetrics).toHaveBeenCalledWith(expect.objectContaining({
      baseUrl: adminSettings.sub2apiBaseUrl,
      apiKey: adminSettings.adminApiKey,
      poolGroupNames: adminSettings.poolGroupNames,
      lightweight: true
    }))
    // Configured widgets start as a compact orb. Expand it before checking card telemetry.
    expect(wrapper.get('.quota-orb strong').text()).toBe('382M')
    expect(wrapper.get('.quota-orb').attributes('aria-label')).toContain('382.13M')
    await wrapper.get('.quota-orb').trigger('click')
    await flushPromises()

    expect(wrapper.get('.hero-metric').text()).toContain('382.13M')
    expect(wrapper.get('.metric-card--quota').text()).toContain('2 / 80')
    expect(wrapper.get('.metric-card--quota').text()).toContain('余量 80%')
    expect(wrapper.get('.metric-card--cost').text()).toContain('$544.43')
    expect(wrapper.get('.info-section').text()).toContain('42%')
    expect(wrapper.get('.info-section').text()).toContain('68%')
    expect(wrapper.get('.info-section').text()).toContain('14290ms')
    expect(wrapper.get('.info-section').text()).toContain('1d 1h')
    expect(wrapper.get('.codex-section').classes()).toContain('active')
    expect(wrapper.get('.codex-section').text()).toContain('2')
    expect(wrapper.get('.codex-section').text()).toContain('1')
  })

  it('polls CLIProxyAPI management metrics and renders request/account labels', async () => {
    const cliProxySettings: AppSettings = {
      ...adminSettings,
      dataSource: 'cliproxyapi',
      adminApiKey: '',
      cliProxyManagementKey: 'management-key'
    }
    setSettings(cliProxySettings)
    vi.mocked(fetchCliProxyApiMetrics).mockResolvedValueOnce({
      ...defaultAdminMetrics(),
      source: 'cliproxyapi',
      totalRequests: 1234,
      failedRequests: 12,
      poolAccounts: { active: 3, limited: 1, error: 1, total: 5 },
      serverStatus: 'online',
      serverLatencyMs: 42,
      updatedAt: '2026-08-17T12:34:56.000Z'
    })

    const wrapper = mount(App)
    await flushPromises()

    expect(fetchCliProxyApiMetrics).toHaveBeenCalledWith({
      baseUrl: cliProxySettings.sub2apiBaseUrl,
      managementKey: cliProxySettings.cliProxyManagementKey
    })
    expect(fetchAdminMonitorMetrics).not.toHaveBeenCalled()
    expect(wrapper.get('.quota-orb').text()).toContain('REQS')
    await wrapper.get('.quota-orb').trigger('click')
    await flushPromises()
    expect(wrapper.get('.card-title').text()).toContain('CLI PROXY API')
    expect(wrapper.get('.hero-metric').text()).toContain('1.23K')
    expect(wrapper.get('.metric-card--cost').text()).toContain('失败请求')
    expect(wrapper.get('.metric-card--quota').text()).toContain('3 / 5')
    expect(wrapper.get('.codex-section').text()).toContain('代理账户')
  })

  it('uses the personal endpoint when only a personal token is enabled', async () => {
    setSettings(personalSettings)
    vi.mocked(fetchSub2apiMetrics).mockResolvedValueOnce({
      todayTokens: 12_345_678,
      todayCost: 1.2345,
      firstTokenMs: 1200,
      updatedAt: '2026-08-11T12:34:56.000Z'
    })

    const wrapper = mount(App)
    await flushPromises()

    expect(fetchSub2apiMetrics).toHaveBeenCalledWith({
      baseUrl: personalSettings.sub2apiBaseUrl,
      token: personalSettings.personalToken
    })
    expect(fetchAdminMonitorMetrics).not.toHaveBeenCalled()
    await wrapper.get('.quota-orb').trigger('click')
    await flushPromises()

    expect(wrapper.get('.card-title .eyebrow').text()).toContain('PERSONAL')
    expect(wrapper.get('.hero-metric').text()).toContain('12.35M')
    expect(wrapper.get('.metric-card--cost').text()).toContain('$1.23')
    expect(wrapper.get('.metric-card--cost').text()).toContain('个人统计')
  })

  it('accepts a saved personal token even when the legacy enable flag is false', async () => {
    setSettings({ ...personalSettings, personalFloatingEnabled: false })
    mount(App)
    await flushPromises()

    expect(fetchSub2apiMetrics).toHaveBeenCalledWith({
      baseUrl: personalSettings.sub2apiBaseUrl,
      token: personalSettings.personalToken
    })
  })

  it('does not create a polling timer before setup is complete', async () => {
    mount(App)
    await flushPromises()
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000)

    expect(fetchAdminMonitorMetrics).not.toHaveBeenCalled()
    expect(fetchSub2apiMetrics).not.toHaveBeenCalled()
  })

  it('does not poll while the settings view is open', async () => {
    window.history.replaceState({}, '', '/?view=settings')
    setSettings(adminSettings)
    const wrapper = mount(App)
    await flushPromises()
    await vi.advanceTimersByTimeAsync(30_000)

    expect(wrapper.find('.settings-panel').exists()).toBe(true)
    expect(fetchAdminMonitorMetrics).not.toHaveBeenCalled()
    expect(fetchSub2apiMetrics).not.toHaveBeenCalled()
  })

  it('validates and saves setup values', async () => {
    const wrapper = mount(App)
    await flushPromises()
    await wrapper.get('form.quick-setup input[type="url"]').setValue('https://subapi.example.test///')
    await wrapper.get('form.quick-setup input[placeholder="管理员 API Key"]').setValue('admin-key')
    await wrapper.get('form.quick-setup').trigger('submit')
    await flushPromises()

    const saved = JSON.parse(localStorage.getItem(settingsStorageKey) ?? '{}') as AppSettings
    expect(saved.sub2apiBaseUrl).toBe('https://subapi.example.test')
    expect(saved.adminApiKey).toBe('admin-key')
    expect(wrapper.find('.onboarding').exists()).toBe(false)
  })

  it('shows a validation message for an incomplete setup', async () => {
    const wrapper = mount(App)
    await flushPromises()
    await wrapper.get('form.quick-setup').trigger('submit')
    expect(wrapper.get('.form-error').text()).toContain('服务器地址')
    expect(localStorage.getItem(settingsStorageKey)).toBeNull()
  })

  it('opens complete configuration inline without creating a second Tauri window', async () => {
    setTauri(true)
    const wrapper = mount(App)
    await flushPromises()

    await wrapper.get('.text-button').trigger('click')
    await flushPromises()

    expect(wrapper.find('.settings-panel').exists()).toBe(true)
    expect(tauri.invoke).toHaveBeenCalledWith('set_widget_settings')
    expect(tauri.invoke).not.toHaveBeenCalledWith('tray_command', { command: 'settings' })

    await wrapper.get('.icon-button').trigger('click')
    await flushPromises()
    expect(wrapper.find('.settings-panel').exists()).toBe(false)
    expect(tauri.invoke).toHaveBeenCalledWith('set_widget_setup')
  })

  it('routes the native tray reconfigure event into the same inline view', async () => {
    setTauri(true)
    const wrapper = mount(App)
    await flushPromises()

    const openSettingsListener = tauri.getOpenSettingsListener()
    expect(openSettingsListener).toBeDefined()
    openSettingsListener!()
    await flushPromises()

    expect(wrapper.find('.settings-panel').exists()).toBe(true)
    expect(tauri.invoke).toHaveBeenCalledWith('set_widget_settings')
  })

  it('tests a draft connection without persisting it', async () => {
    window.history.replaceState({}, '', '/?view=settings')
    const wrapper = mount(App)
    await wrapper.get('input[placeholder="http://127.0.0.1:8081"]').setValue(adminSettings.sub2apiBaseUrl)
    await wrapper.get('input[placeholder="读取管理员指标"]').setValue(adminSettings.adminApiKey)
    await wrapper.get('button.secondary-button').trigger('click')
    await flushPromises()

    expect(fetchAdminMonitorMetrics).toHaveBeenCalledWith(expect.objectContaining({ lightweight: true }))
    expect(wrapper.get('.form-success').text()).toContain('连接正常')
    expect(localStorage.getItem(settingsStorageKey)).toBeNull()
  })

  it('refreshes with settings received from another window', async () => {
    setSettings(adminSettings)
    mount(App)
    await flushPromises()
    vi.mocked(fetchAdminMonitorMetrics).mockClear()
    const updated = { ...adminSettings, poolGroupNames: ['new-group'], poolGroupName: 'new-group' }
    localStorage.setItem(settingsStorageKey, JSON.stringify(updated))
    window.dispatchEvent(new StorageEvent('storage', { key: settingsStorageKey, newValue: JSON.stringify(updated) }))
    await flushPromises()

    expect(fetchAdminMonitorMetrics).toHaveBeenCalledWith(expect.objectContaining({ poolGroupNames: ['new-group'] }))
  })

  it('renders tray commands and forwards the selected command to Rust', async () => {
    window.history.replaceState({}, '', '/?view=tray-menu')
    setTauri(true)
    const wrapper = mount(App)
    await flushPromises()

    expect(wrapper.text()).toContain('打开监控')
    expect(wrapper.text()).toContain('重新配置')
    expect(wrapper.text()).toContain('检查更新')
    expect(wrapper.text()).toContain('Sub2API Pulse v0.4.13')
    await wrapper.get('.tray-menu-item').trigger('click')
    await flushPromises()
    expect(tauri.invoke).toHaveBeenCalledWith('tray_command', { command: 'monitor' })
  })

  it('checks for and displays an available update in the updater view', async () => {
    window.history.replaceState({}, '', '/?view=updater')
    setTauri(true)
    tauri.check.mockResolvedValueOnce({ version: '0.4.14', body: '性能改进' })
    const wrapper = mount(App)
    await flushPromises()

    expect(wrapper.get('.utility-status').text()).toContain('发现新版本')
    expect(wrapper.get('.version-line').text()).toContain('0.4.14')
    expect(wrapper.get('button.primary-button').text()).toContain('立即更新')
  })

  it('marks a failed request as offline and exposes the error', async () => {
    setSettings(adminSettings)
    vi.mocked(fetchAdminMonitorMetrics).mockRejectedValueOnce(new Error('连接超时'))
    const wrapper = mount(App)
    await flushPromises()

    await wrapper.get('.quota-orb').trigger('click')
    await flushPromises()

    expect(wrapper.get('.usage-indicator').classes()).toContain('offline')
    expect(wrapper.get('.reset-time').text()).toContain('连接超时')
  })

  it('expands the orb on click and collapses it from the card footer', async () => {
    setSettings(adminSettings)
    const wrapper = mount(App)
    await flushPromises()

    expect(wrapper.find('.quota-orb').exists()).toBe(true)
    expect(wrapper.find('.quota-card').exists()).toBe(false)

    await wrapper.get('.quota-orb').trigger('click')
    await flushPromises()
    expect(wrapper.find('.quota-orb').exists()).toBe(false)
    expect(wrapper.find('.quota-card').exists()).toBe(true)

    await wrapper.get('.collapse-button').trigger('click')
    await flushPromises()
    expect(wrapper.find('.quota-orb').exists()).toBe(true)
    expect(wrapper.find('.quota-card').exists()).toBe(false)
  })

  it('starts one native drag from the card header and ignores controls', async () => {
    setTauri(true)
    setSettings(adminSettings)
    const wrapper = mount(App)
    await flushPromises()
    await wrapper.get('.quota-orb').trigger('click')
    await flushPromises()

    tauri.currentWindow.startDragging.mockClear()
    await wrapper.get('.card-header').trigger('mousedown', { button: 0 })
    await flushPromises()
    expect(tauri.currentWindow.startDragging).toHaveBeenCalledTimes(1)

    tauri.currentWindow.startDragging.mockClear()
    await wrapper.get('.control-button').trigger('mousedown', { button: 0 })
    await flushPromises()
    expect(tauri.currentWindow.startDragging).not.toHaveBeenCalled()
  })

  it('expands while hovered and auto-collapses after leaving', async () => {
    setSettings(adminSettings)
    const wrapper = mount(App)
    await flushPromises()

    const surface = wrapper.get('.quota-surface')
    await surface.trigger('mouseenter')
    await vi.advanceTimersByTimeAsync(120)
    await flushPromises()
    expect(wrapper.find('.quota-card').exists()).toBe(true)

    await surface.trigger('mouseleave')
    await vi.advanceTimersByTimeAsync(180)
    await flushPromises()
    expect(wrapper.find('.quota-orb').exists()).toBe(true)
  })

  it('persists fixed-expand and always-on-top control state', async () => {
    setSettings(adminSettings)
    const wrapper = mount(App)
    await flushPromises()
    await wrapper.get('.quota-orb').trigger('click')
    await flushPromises()

    const controls = wrapper.findAll('.control-button')
    const fixedButton = controls.find((button) => button.attributes('title') === '固定展开')
    const topButton = controls.find((button) => /置顶/.test(button.attributes('title') ?? ''))
    expect(fixedButton).toBeDefined()
    expect(topButton).toBeDefined()

    await fixedButton!.trigger('click')
    await topButton!.trigger('click')
    await flushPromises()

    expect(fixedButton!.attributes('aria-pressed')).toBe('true')
    expect(topButton!.attributes('aria-pressed')).toBe('false')
    const saved = JSON.parse(localStorage.getItem(settingsStorageKey) ?? '{}') as AppSettings
    expect(saved.stayExpanded).toBe(true)
    expect(saved.alwaysOnTop).toBe(false)
  })

  it('delegates native resize and pin changes when running inside Tauri', async () => {
    setTauri(true)
    setSettings(adminSettings)
    const wrapper = mount(App)
    await flushPromises()
    await wrapper.get('.quota-orb').trigger('click')
    await flushPromises()
    expect(tauri.invoke).toHaveBeenCalledWith('set_widget_expanded', { expanded: true })

    const topButton = wrapper.findAll('.control-button').find((button) => /置顶/.test(button.attributes('title') ?? ''))
    expect(topButton).toBeDefined()
    await topButton!.trigger('click')
    await flushPromises()
    expect(tauri.invoke).toHaveBeenCalledWith('set_widget_always_on_top', { enabled: false })
  })
})

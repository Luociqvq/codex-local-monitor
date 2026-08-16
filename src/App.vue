<template>
  <main v-if="isTrayMenuView" class="tray-menu-shell">
    <button class="tray-menu-item" type="button" @click="runTrayCommand('monitor')"><Gauge :size="16" /><span>打开监控</span></button>
    <button class="tray-menu-item" type="button" @click="runTrayCommand('settings')"><Settings :size="16" /><span>重新配置</span></button>
    <button class="tray-menu-item" type="button" @click="runTrayCommand('update')"><RefreshCw :size="16" /><span>检查更新</span><i v-if="platformUpdateAvailable" class="tray-menu-update-dot" /></button>
    <div class="tray-menu-version">Sub2API Pulse v{{ appVersion }}</div>
    <div class="tray-menu-separator" />
    <button class="tray-menu-item tray-menu-item--quit" type="button" @click="runTrayCommand('quit')"><Power :size="16" /><span>退出</span></button>
  </main>

  <main v-else-if="isUpdaterView" class="utility-shell">
    <section class="utility-panel">
      <header class="utility-header"><div class="title-with-icon"><RefreshCw :size="17" /><strong>应用更新</strong></div><button class="icon-button" type="button" title="关闭" @click="closeWindow"><X :size="17" /></button></header>
      <div class="version-line"><strong>v{{ appVersion }}</strong><span v-if="updateVersion">最新 v{{ updateVersion }}</span></div>
      <p class="utility-status" :class="updateState">{{ updateMessage }}</p>
      <pre v-if="updateBody" class="release-notes">{{ updateBody }}</pre>
      <div v-if="downloadPercent !== null" class="update-progress"><i :style="{ width: `${downloadPercent}%` }" /></div>
      <div class="utility-actions">
        <button v-if="updateState === 'available'" class="primary-button" type="button" @click="installAppUpdate"><Download :size="15" />立即更新</button>
        <button v-else-if="updateState === 'installed'" class="primary-button" type="button" @click="restartApp">重启完成更新</button>
        <button v-else class="secondary-button" type="button" :disabled="updateBusy" @click="checkForAppUpdate"><RefreshCw :class="{ spinning: updateBusy }" :size="15" />重新检查</button>
      </div>
    </section>
  </main>

  <main v-else-if="isSettingsView || showInlineSettings" class="utility-shell settings-shell">
    <section class="utility-panel settings-panel">
      <header class="utility-header"><div class="title-with-icon"><SlidersHorizontal :size="17" /><strong>连接设置</strong></div><button class="icon-button" type="button" title="关闭" @click="closeWindow"><X :size="17" /></button></header>
      <p class="settings-caption">sub2api / 监控数据源</p>
      <div class="setup-steps"><span class="is-active">01</span><i /><span>连接</span><i /><span>显示</span></div>
      <form class="settings-form" @submit.prevent="saveDraft">
        <label class="field"><span>服务器地址</span><div class="input-wrap"><Link2 :size="14" /><input v-model="draft.sub2apiBaseUrl" autocomplete="url" placeholder="http://127.0.0.1:8081" /></div></label>
        <label class="field"><span>管理员 API Key <em>账号、服务器与 Codex</em></span><div class="input-wrap"><KeyRound :size="14" /><input v-model="draft.adminApiKey" autocomplete="off" type="password" placeholder="读取管理员指标" /></div></label>
        <label class="field"><span>个人 Token <em>可选</em></span><div class="input-wrap"><KeyRound :size="14" /><input v-model="draft.personalToken" autocomplete="off" type="password" placeholder="读取个人 Token" /></div></label>
        <label class="field"><span>账号池分组 <em>可选</em></span><div class="input-wrap"><Database :size="14" /><input v-model="draft.poolGroupName" placeholder="留空统计全部账号" /></div></label>
        <label class="field field-inline"><span>自动同步</span><div class="number-input"><input v-model.number="draft.refreshSeconds" min="10" max="300" step="5" type="number" /><small>秒</small></div></label>
        <p v-if="formError" class="form-error" role="alert"><AlertTriangle :size="14" />{{ formError }}</p><p v-if="saveMessage" class="form-success" role="status"><CheckCircle2 :size="14" />{{ saveMessage }}</p>
        <div class="settings-actions"><button class="secondary-button" type="button" :disabled="testing" @click="testDraft"><LoaderCircle v-if="testing" class="spinning" :size="15" /><Wifi v-else :size="15" />测试连接</button><button class="primary-button" type="submit"><CheckCircle2 :size="15" />保存配置</button></div>
      </form>
    </section>
  </main>

  <main v-else class="app-shell" :class="[`tone-${stateTone}`, { 'is-expanded': expanded, 'is-setup': !configured }]">
    <section ref="widgetRef" class="quota-surface" :class="{ 'quota-surface--orb': configured && !expanded, 'quota-surface--card': expanded || !configured, 'is-idle': configured && !expanded && !hovered }" data-tauri-drag-region @mouseenter="handleHover(true)" @mouseleave="handleHover(false)" @mousedown="handleSurfaceMouseDown">
      <button v-if="configured && !expanded" class="quota-orb" type="button" :aria-label="`展开监控，${connectionLabel}，今日 Token ${formattedTodayTokens}，Codex ${codexStatusLabel}`" @click.stop="expandWidget">
        <span class="orb-sheen" aria-hidden="true" />
        <span class="island-status" data-window-drag title="拖动悬浮窗" @mousedown.stop="startWindowDrag"><GripHorizontal :size="12" aria-hidden="true" /><i class="orb-led" :class="stateTone" /></span>
        <span class="island-metric"><strong>{{ compactTodayTokens }}</strong><small>TOKENS</small></span>
        <span class="island-activity" :class="codexTone" aria-hidden="true"><Bot :size="14" /></span>
      </button>

      <section v-else-if="configured" class="quota-card" :class="`quota-card--${stateTone}`">
        <header class="card-header" data-tauri-drag-region @mousedown.stop="handleSurfaceMouseDown">
          <div class="card-title"><p class="eyebrow">SUB2API · {{ dataSourceLabel === '管理员视角' ? 'ADMIN' : 'PERSONAL' }}</p><p class="updated">今日 Token</p></div><span class="drag-cue" title="拖动悬浮窗"><GripHorizontal :size="13" aria-hidden="true" /></span>
          <nav class="card-actions" aria-label="监控控制" @mousedown.stop>
            <span class="usage-indicator" :class="connectionState" :title="connectionLabel"><i /></span>
            <button class="control-button" type="button" :title="loading ? '正在刷新' : '刷新数据'" :aria-label="loading ? '正在刷新' : '刷新数据'" :disabled="loading || !configured" @click.stop="refreshAll"><RefreshCw :class="{ spinning: loading }" :size="13" /></button>
            <button class="control-button" type="button" :title="stayExpanded ? '关闭固定展开' : '固定展开'" :aria-label="stayExpanded ? '关闭固定展开' : '固定展开'" :aria-pressed="stayExpanded" @click.stop="toggleStayExpanded"><Minimize2 v-if="stayExpanded" :size="13" /><Maximize2 v-else :size="13" /></button>
            <button class="control-button" type="button" :title="alwaysOnTop ? '关闭置顶' : '保持置顶'" :aria-label="alwaysOnTop ? '关闭置顶' : '保持置顶'" :aria-pressed="alwaysOnTop" @click.stop="toggleAlwaysOnTop"><Pin v-if="alwaysOnTop" :size="13" /><PinOff v-else :size="13" /></button>
            <button class="control-button" type="button" title="重新配置" aria-label="重新配置" @click.stop="openSettings"><Settings :size="13" /></button>
          </nav>
        </header>

        <section class="primary-metric hero-metric" aria-label="今日 Token"><strong>{{ formattedTodayTokens }}</strong><span>tokens</span></section>
        <div class="metric-meta"><span class="status-copy"><i class="status-dot" :class="connectionState" />{{ connectionLabel }}</span><span>{{ lastUpdatedLabel }}</span></div>
        <div class="quota-progress" role="progressbar" aria-label="账号池余量" aria-valuemin="0" aria-valuemax="100" :aria-valuenow="poolRemainingNumber ?? undefined"><i :style="{ width: poolProgressWidth }" /></div>
        <p class="reset-time">账号池余量 {{ formattedPoolRemaining }}<span v-if="errorMessage"> · {{ errorMessage }}</span></p>

        <section class="metric-grid compact-metrics" aria-label="核心指标">
          <article class="metric-card metric-card--cost"><span>今日消费</span><strong>{{ formattedTodayCost }}</strong><small>{{ totalCostLabel }}</small></article>
          <article class="metric-card metric-card--quota"><span>账号余量</span><strong>{{ availableAccountCount }}</strong><small>{{ accountSummaryLabel }}</small></article>
        </section>

        <section class="info-section server-section"><div class="section-heading"><span><Gauge :size="13" />服务器性能</span><small>{{ endpointLabel }}</small></div><div class="performance-grid"><div class="performance-item"><span><Cpu :size="12" />CPU</span><strong>{{ formattedCpu }}</strong><div class="thin-progress"><i :class="cpuClass" :style="{ width: performanceWidth(adminMetrics.serverCpuPercent) }" /></div></div><div class="performance-item"><span><Database :size="12" />内存</span><strong>{{ formattedMemory }}</strong><div class="thin-progress"><i :class="memoryClass" :style="{ width: performanceWidth(adminMetrics.serverMemoryPercent) }" /></div></div><div class="performance-item performance-item--compact"><span><Wifi :size="12" />延迟</span><strong>{{ formattedLatency }}</strong></div><div class="performance-item performance-item--compact"><span><Clock3 :size="12" />运行</span><strong>{{ formattedUptime }}</strong></div></div></section>

        <section class="codex-section" :class="codexTone"><div class="section-heading"><span><Bot :size="13" />Codex 调度</span><b class="codex-badge">{{ codexStatusLabel }}</b></div><div class="codex-content"><div class="codex-pulse"><i /><i /><i /></div><div class="codex-copy"><strong>{{ codexHeadline }}</strong><span>{{ codexDetail }}</span></div><div class="task-counts"><b>{{ taskCount(adminMetrics.activeCodexTasks) }}</b><small>运行</small><b>{{ taskCount(adminMetrics.queuedCodexTasks) }}</b><small>排队</small></div></div></section>
        <footer class="widget-footer"><span><i class="footer-led" :class="connectionState" />{{ refreshLabel }}</span><button type="button" class="collapse-button" title="收起悬浮窗" aria-label="收起悬浮窗" @mousedown.stop @click.stop="collapseWidget"><ChevronDown :size="14" /></button></footer>
      </section>

      <section v-if="!configured" class="onboarding quota-card quota-card--idle"><header class="card-header" data-tauri-drag-region @mousedown.stop="handleSurfaceMouseDown"><div class="card-title"><p class="eyebrow">SUB2API PULSE</p><p class="updated">连接你的 sub2api</p></div><span class="drag-cue" title="拖动悬浮窗"><GripHorizontal :size="13" aria-hidden="true" /></span><Sparkles :size="20" class="setup-mark" aria-hidden="true" /></header><p class="setup-intro">先配置服务器和认证信息，悬浮窗会自动收起为 orb。</p><form class="quick-setup" @submit.prevent="saveDraft"><label class="field"><span>服务器地址</span><div class="input-wrap"><Link2 :size="14" /><input v-model="draft.sub2apiBaseUrl" autocomplete="url" type="url" placeholder="http://127.0.0.1:8081" /></div></label><label class="field"><span>管理员 API Key <em>可选</em></span><div class="input-wrap"><KeyRound :size="14" /><input v-model="draft.adminApiKey" autocomplete="off" type="password" placeholder="管理员 API Key" /></div></label><label class="field"><span>个人 Token <em>可选</em></span><div class="input-wrap"><KeyRound :size="14" /><input v-model="draft.personalToken" autocomplete="off" type="password" placeholder="个人用量 Token" /></div></label><p v-if="formError" class="form-error" role="alert"><AlertTriangle :size="14" />{{ formError }}</p><button class="primary-button primary-button--wide" type="submit"><Wifi :size="15" />连接并开始监控</button></form><button class="text-button" type="button" @click="openSettings">打开完整配置</button></section>
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Clock3,
  Cpu,
  Database,
  Download,
  Gauge,
  GripHorizontal,
  KeyRound,
  Link2,
  LoaderCircle,
  ChevronDown,
  Maximize2,
  Minimize2,
  Pin,
  PinOff,
  Power,
  RefreshCw,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Wifi,
  X
} from 'lucide-vue-next'
import { fetchAdminMonitorMetrics, fetchSub2apiMetrics } from '@/domain/sub2apiClient'
import {
  formatCost,
  formatTokenCount,
  type AdminMonitorMetrics,
  type CodexTaskStatus,
  type TokenOrbMetrics
} from '@/domain/tokenMetrics'
import {
  defaultSettings,
  hasAdminSettings,
  hasPersonalSettings,
  loadSettings,
  saveSettings,
  settingsStorageKey,
  type AppSettings
} from '@/domain/settings'

type TauriWindowApi = typeof import('@tauri-apps/api/window')

const view = new URLSearchParams(window.location.search).get('view') ?? 'platform'
const isSettingsView = view === 'settings'
const isUpdaterView = view === 'updater'
const isTrayMenuView = view === 'tray-menu'
const settings = ref<AppSettings>(loadSettings())
const draft = reactive<AppSettings>(createDraft(settings.value))
const showInlineSettings = ref(false)
const loading = ref(false)
const testing = ref(false)
const errorMessage = ref('')
const formError = ref('')
const saveMessage = ref('')
const personalMetrics = ref<TokenOrbMetrics>({ todayTokens: null, todayCost: null, firstTokenMs: null, updatedAt: null })
const adminMetrics = ref<AdminMonitorMetrics>(emptyAdminMetrics())
const platformUpdateAvailable = ref(false)
const appVersion = ref('0.4.13')
const updateVersion = ref('')
const updateBody = ref('')
const updateState = ref<'idle' | 'checking' | 'available' | 'latest' | 'downloading' | 'installed' | 'error'>('idle')
const updateMessage = ref('点击重新检查获取最新版本。')
const downloadPercent = ref<number | null>(null)
const widgetRef = ref<HTMLElement | null>(null)
const expanded = ref(false)
const hovered = ref(false)
const settingsReturnExpanded = ref(false)
const stayExpanded = ref(settings.value.stayExpanded === true)
const alwaysOnTop = ref(settings.value.alwaysOnTop !== false)
let timer: number | null = null
let refreshGeneration = 0
let refreshInFlight = false
let unlistenSettingsChanged: (() => void) | null = null
let unlistenMonitorVisibility: (() => void) | null = null
let tauriWindowApi: TauriWindowApi | null = null
let availableUpdate: import('@tauri-apps/plugin-updater').Update | null = null

const configured = computed(() => hasAdminSettings(settings.value) || hasPersonalSettings(settings.value))
const hasAdmin = computed(() => hasAdminSettings(settings.value))
const hasPersonal = computed(() => hasPersonalSettings(settings.value))
const endpointLabel = computed(() => settings.value.sub2apiBaseUrl ? compactEndpoint(settings.value.sub2apiBaseUrl) : '未连接')
const dataSourceLabel = computed(() => hasAdmin.value ? '管理员视角' : '个人视角')
const formattedTodayTokens = computed(() => formatTokenCount(hasAdmin.value ? adminMetrics.value.todayTotalTokens : personalMetrics.value.todayTokens))
const compactTodayTokens = computed(() => compactTokenCount(hasAdmin.value ? adminMetrics.value.todayTotalTokens : personalMetrics.value.todayTokens))
const formattedTodayCost = computed(() => formatCost(hasAdmin.value ? adminMetrics.value.todayTotalCost : personalMetrics.value.todayCost))
const formattedPoolRemaining = computed(() => {
  const value = adminMetrics.value.poolRemainingPercent ?? adminMetrics.value.poolSevenDayRemainingPercent ?? null
  return value === null ? '--' : `${Math.round(value)}%`
})
const availableAccountCount = computed(() => {
  const pool = adminMetrics.value.poolAccounts
  return pool ? `${pool.active} / ${pool.total}` : '-- / --'
})
const poolProgressWidth = computed(() => {
  const value = adminMetrics.value.poolRemainingPercent ?? adminMetrics.value.poolSevenDayRemainingPercent ?? null
  return value === null ? '0%' : `${Math.min(100, Math.max(0, value))}%`
})
const poolRemainingNumber = computed(() => {
  const value = adminMetrics.value.poolRemainingPercent ?? adminMetrics.value.poolSevenDayRemainingPercent ?? null
  return value == null || Number.isNaN(value) ? null : Math.round(Math.min(100, Math.max(0, value)))
})
const accountSummaryLabel = computed(() => {
  const pool = adminMetrics.value.poolAccounts
  if (!pool) return hasAdmin.value ? '账号状态未提供' : '需管理员 API Key'
  const remaining = formattedPoolRemaining.value === '--' ? '' : ` · 余量 ${formattedPoolRemaining.value}`
  return `${pool.limited} 限流 · ${pool.error} 异常${remaining}`
})
const totalCostLabel = computed(() => {
  if (!hasAdmin.value) return '个人统计'
  const total = adminMetrics.value.totalActualCost
  return total == null ? '管理员统计' : `累计 ${formatCost(total)}`
})
const connectionState = computed<'online' | 'degraded' | 'offline' | 'idle'>(() => {
  if (!configured.value) return 'idle'
  if (errorMessage.value && !adminMetrics.value.updatedAt && !personalMetrics.value.updatedAt) return 'offline'
  if (errorMessage.value) return 'degraded'
  return 'online'
})
const connectionLabel = computed(() => ({ online: '已连接', degraded: '部分异常', offline: '连接失败', idle: '待配置' }[connectionState.value]))
const stateTone = computed<'healthy' | 'warning' | 'danger' | 'idle'>(() => {
  if (!configured.value || connectionState.value === 'idle') return 'idle'
  if (connectionState.value === 'offline') return 'danger'
  const remaining = poolRemainingNumber.value
  if (connectionState.value === 'degraded' || (remaining !== null && remaining <= 20)) return 'danger'
  if (remaining !== null && remaining <= 45) return 'warning'
  return 'healthy'
})
const lastUpdatedLabel = computed(() => {
  const timestamp = adminMetrics.value.updatedAt || personalMetrics.value.updatedAt
  if (!timestamp) return '等待首次同步'
  return `更新于 ${new Date(timestamp).toLocaleTimeString('zh-CN', { hour12: false })}`
})
const refreshLabel = computed(() => `每 ${settings.value.refreshSeconds}s 自动同步`)
const serverVersionLabel = computed(() => adminMetrics.value.serverUptimeSeconds == null ? '接口未提供主机指标' : `运行 ${formatUptime(adminMetrics.value.serverUptimeSeconds)}`)
const formattedCpu = computed(() => formatPercent(adminMetrics.value.serverCpuPercent))
const formattedMemory = computed(() => formatPercent(adminMetrics.value.serverMemoryPercent))
const formattedLatency = computed(() => adminMetrics.value.serverLatencyMs == null ? '--' : `${Math.round(adminMetrics.value.serverLatencyMs)}ms`)
const formattedUptime = computed(() => formatUptime(adminMetrics.value.serverUptimeSeconds))
const cpuClass = computed(() => performanceTone(adminMetrics.value.serverCpuPercent))
const memoryClass = computed(() => performanceTone(adminMetrics.value.serverMemoryPercent))
const codexStatus = computed<CodexTaskStatus>(() => {
  return adminMetrics.value.codexStatus ?? 'unknown'
})
const codexTone = computed(() => codexStatus.value === 'error' ? 'danger' : codexStatus.value === 'running' ? 'active' : codexStatus.value === 'queued' ? 'queued' : '')
const codexStatusLabel = computed(() => ({ running: '运行中', queued: '排队中', idle: '空闲', error: '异常', unknown: '未提供' }[codexStatus.value]))
const codexHeadline = computed(() => ({ running: '正在处理 Codex 任务', queued: '任务等待调度', idle: '当前没有活动任务', error: 'Codex 任务异常', unknown: '等待任务状态' }[codexStatus.value]))
const codexDetail = computed(() => codexStatus.value === 'unknown' ? '当前部署未返回任务队列指标' : `${endpointLabel.value} · 低频采样`)
const updateBusy = computed(() => updateState.value === 'checking' || updateState.value === 'downloading')

let collapseTimer: number | null = null
let hoverExpandTimer: number | null = null

function emptyAdminMetrics(): AdminMonitorMetrics {
  return {
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
    serverStatus: 'unknown',
    serverLatencyMs: null,
    serverCpuPercent: null,
    serverMemoryPercent: null,
    serverUptimeSeconds: null,
    codexStatus: 'unknown',
    activeCodexTasks: null,
    queuedCodexTasks: null,
    updatedAt: null
  }
}

function createDraft(source: AppSettings): AppSettings {
  return { ...defaultSettings, ...source, poolGroupNames: [...(source.poolGroupNames ?? [])] }
}

async function resizeWidget(nextExpanded: boolean) {
  if (!('__TAURI_INTERNALS__' in window)) return
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('set_widget_expanded', { expanded: nextExpanded })
    return
  } catch {
    // Older builds do not have the command; use the window API as a fallback.
  }
  const api = await loadTauriWindowApi()
  if (!api) return
  try {
    const currentWindow = api.getCurrentWindow()
    const { LogicalSize } = await import('@tauri-apps/api/dpi')
    await currentWindow.setSize(new LogicalSize(nextExpanded ? 314 : 166, nextExpanded ? 382 : 50))
  } catch { return }
}

async function resizeSetupWindow() {
  if (!('__TAURI_INTERNALS__' in window)) return
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('set_widget_setup')
    return
  } catch {
    // Fall back to the window API for older local builds.
  }
  const api = await loadTauriWindowApi()
  if (!api) return
  try {
    const { LogicalSize } = await import('@tauri-apps/api/dpi')
    await api.getCurrentWindow().setSize(new LogicalSize(390, 440))
  } catch { return }
}

async function resizeSettingsWindow() {
  if (!('__TAURI_INTERNALS__' in window)) return
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('set_widget_settings')
    return
  } catch {
    // Fall back to the window API for older local builds.
  }
  const api = await loadTauriWindowApi()
  if (!api) return
  try {
    const { LogicalSize } = await import('@tauri-apps/api/dpi')
    await api.getCurrentWindow().setSize(new LogicalSize(390, 560))
  } catch { return }
}

async function applyAlwaysOnTop(enabled: boolean) {
  if (!('__TAURI_INTERNALS__' in window)) return
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('set_widget_always_on_top', { enabled })
    return
  } catch {
    // Keep compatibility with a development build that predates the command.
  }
  const api = await loadTauriWindowApi()
  if (!api) return
  try { await api.getCurrentWindow().setAlwaysOnTop(enabled) } catch { return }
}

function syncWidgetPreferences() {
  stayExpanded.value = settings.value.stayExpanded === true
  alwaysOnTop.value = settings.value.alwaysOnTop !== false
  expanded.value = configured.value && stayExpanded.value
  if (configured.value) void resizeWidget(expanded.value)
  else void resizeSetupWindow()
  void applyAlwaysOnTop(alwaysOnTop.value)
}

function expandWidget() {
  if (!configured.value) return
  if (hoverExpandTimer !== null) window.clearTimeout(hoverExpandTimer)
  hoverExpandTimer = null
  if (collapseTimer !== null) window.clearTimeout(collapseTimer)
  collapseTimer = null
  expanded.value = true
  void resizeWidget(true)
}

function collapseWidget() {
  if (stayExpanded.value) return
  if (collapseTimer !== null) window.clearTimeout(collapseTimer)
  expanded.value = false
  void resizeWidget(false)
}

function handleHover(value: boolean) {
  hovered.value = value
  if (hoverExpandTimer !== null) window.clearTimeout(hoverExpandTimer)
  hoverExpandTimer = null
  if (collapseTimer !== null) window.clearTimeout(collapseTimer)
  collapseTimer = null
  if (value) {
    if (configured.value) {
      // Let a click finish against the compact orb before the native window
      // moves left to make room for the expanded surface.
      hoverExpandTimer = window.setTimeout(() => {
        hoverExpandTimer = null
        if (hovered.value) expandWidget()
      }, 120)
    }
    return
  }
  if (!configured.value || stayExpanded.value) return
  collapseTimer = window.setTimeout(() => {
    collapseTimer = null
    if (!hovered.value) collapseWidget()
  }, 180)
}

function toggleStayExpanded() {
  const next = !stayExpanded.value
  stayExpanded.value = next
  const saved = saveSettings({ ...settings.value, stayExpanded: next })
  settings.value = saved
  Object.assign(draft, createDraft(saved))
  if (next) expandWidget()
  else if (!hovered.value) collapseWidget()
}

async function toggleAlwaysOnTop() {
  const next = !alwaysOnTop.value
  alwaysOnTop.value = next
  const saved = saveSettings({ ...settings.value, alwaysOnTop: next })
  settings.value = saved
  Object.assign(draft, createDraft(saved))
  await applyAlwaysOnTop(next)
}

async function refreshAll() {
  if (!configured.value || refreshInFlight || isSettingsView || isUpdaterView || isTrayMenuView) return
  refreshInFlight = true
  loading.value = true
  errorMessage.value = ''
  const errors: string[] = []
  try {
    if (hasAdmin.value) {
      try {
        adminMetrics.value = await fetchAdminMonitorMetrics({
          baseUrl: settings.value.sub2apiBaseUrl,
          apiKey: settings.value.adminApiKey,
          poolGroupNames: settings.value.poolGroupNames,
          lightweight: true
        })
      } catch (error) {
        errors.push(errorMessageOf(error, '管理员接口请求失败'))
      }
    }
    if (!hasAdmin.value && hasPersonal.value) {
      try {
        personalMetrics.value = await fetchSub2apiMetrics({ baseUrl: settings.value.sub2apiBaseUrl, token: settings.value.personalToken })
      } catch (error) {
        errors.push(errorMessageOf(error, '个人接口请求失败'))
      }
    }
    if (errors.length > 0) errorMessage.value = errors[0]
  } finally {
    loading.value = false
    refreshInFlight = false
  }
}

function scheduleRefresh(delayMs = 0) {
  stopRefresh()
  if (!configured.value || isSettingsView || isUpdaterView || isTrayMenuView || document.visibilityState === 'hidden') return
  const generation = refreshGeneration
  const run = async () => {
    if (generation !== refreshGeneration) return
    timer = null
    await refreshAll()
    if (generation === refreshGeneration && configured.value && document.visibilityState !== 'hidden') {
      timer = window.setTimeout(run, Math.max(10, settings.value.refreshSeconds) * 1000)
    }
  }
  if (delayMs <= 0) void run()
  else timer = window.setTimeout(run, delayMs)
}

function stopRefresh() {
  refreshGeneration += 1
  if (timer !== null) window.clearTimeout(timer)
  timer = null
}

function syncRefreshVisibility() {
  if (document.visibilityState === 'hidden') stopRefresh()
  else if (configured.value) scheduleRefresh(0)
}

function validateDraft(): boolean {
  formError.value = ''
  const url = draft.sub2apiBaseUrl.trim()
  if (!url) {
    formError.value = '请填写服务器地址'
    return false
  }
  try {
    const parsed = new URL(url)
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error()
  } catch {
    formError.value = '服务器地址需要以 http:// 或 https:// 开头'
    return false
  }
  if (!draft.adminApiKey.trim() && !draft.personalToken.trim()) {
    formError.value = '至少填写管理员 API Key 或个人 Token'
    return false
  }
  return true
}

function saveDraft() {
  if (!validateDraft()) return
  const wasConfigured = configured.value
  const next = saveSettings({
    ...draft,
    sub2apiBaseUrl: draft.sub2apiBaseUrl.trim().replace(/\/+$/, ''),
    adminApiKey: draft.adminApiKey.trim(),
    personalToken: draft.personalToken.trim(),
    personalFloatingEnabled: draft.personalToken.trim() !== '',
    poolGroupName: draft.poolGroupName.trim(),
    poolGroupNames: draft.poolGroupName.trim() ? [draft.poolGroupName.trim()] : [],
    refreshSeconds: Number(draft.refreshSeconds)
  })
  settings.value = next
  Object.assign(draft, createDraft(next))
  stayExpanded.value = next.stayExpanded === true
  alwaysOnTop.value = next.alwaysOnTop !== false
  if (!wasConfigured) {
    expanded.value = stayExpanded.value
    void resizeWidget(expanded.value)
  }
  saveMessage.value = '配置已保存'
  formError.value = ''
  void notifySettingsChanged()
  scheduleRefresh(0)
  if (!isSettingsView && !showInlineSettings.value && wasConfigured) {
    expanded.value = next.stayExpanded === true
    void resizeWidget(expanded.value)
  }
  if (isSettingsView || showInlineSettings.value) window.setTimeout(() => closeWindow(), 320)
}

async function testDraft() {
  if (!validateDraft()) return
  testing.value = true
  formError.value = ''
  try {
    if (draft.adminApiKey.trim()) {
      await fetchAdminMonitorMetrics({ baseUrl: draft.sub2apiBaseUrl, apiKey: draft.adminApiKey, poolGroupNames: [], lightweight: true })
    } else {
      await fetchSub2apiMetrics({ baseUrl: draft.sub2apiBaseUrl, token: draft.personalToken })
    }
    saveMessage.value = '连接正常，可以保存'
  } catch (error) {
    formError.value = errorMessageOf(error, '连接测试失败')
  } finally {
    testing.value = false
  }
}

async function openSettings() {
  if (!isSettingsView) {
    if (!showInlineSettings.value) settingsReturnExpanded.value = expanded.value
    showInlineSettings.value = true
    stopRefresh()
    await resizeSettingsWindow()
  }
}

async function closeWindow() {
  if (showInlineSettings.value) {
    showInlineSettings.value = false
    if (configured.value) {
      expanded.value = stayExpanded.value || settingsReturnExpanded.value
      await resizeWidget(expanded.value)
    } else {
      await resizeSetupWindow()
    }
    scheduleRefresh(0)
    return
  }
  if (!isSettingsView && !isUpdaterView && !isTrayMenuView) stopRefresh()
  try {
    const api = await loadTauriWindowApi()
    if (api) {
      const currentWindow = api.getCurrentWindow()
      if (isSettingsView || isUpdaterView) await currentWindow.close()
      else await currentWindow.hide()
    }
    else if (!isSettingsView) window.history.back()
  } catch {
    return
  }
}

async function startWindowDrag(event?: MouseEvent) {
  if (event && event.button !== 0) return
  const api = await loadTauriWindowApi()
  if (!api) return
  try { await api.getCurrentWindow().startDragging() } catch { return }
}

function handleSurfaceMouseDown(event: MouseEvent) {
  if (event.button !== 0) return
  const target = event.target instanceof HTMLElement ? event.target : null
  if (target?.closest('button, input, textarea, select, a')) return
  event.preventDefault()
  void startWindowDrag(event)
}

async function runTrayCommand(command: 'monitor' | 'settings' | 'update' | 'quit') {
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('tray_command', { command })
  } catch {
    return
  }
}

function performanceWidth(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '0%'
  return `${Math.min(100, Math.max(0, value))}%`
}

function performanceTone(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return 'unknown'
  if (value >= 85) return 'danger'
  if (value >= 65) return 'warning'
  return 'healthy'
}

function formatPercent(value: number | null | undefined): string {
  return value == null || Number.isNaN(value) ? '--' : `${Math.round(value)}%`
}

function formatUptime(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '--'
  const totalMinutes = Math.floor(value / 60)
  const days = Math.floor(totalMinutes / 1440)
  const hours = Math.floor((totalMinutes % 1440) / 60)
  const minutes = totalMinutes % 60
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

function taskCount(value: number | null | undefined): string {
  return value == null || Number.isNaN(value) ? '--' : String(Math.max(0, Math.round(value)))
}

function compactTokenCount(value: number | null): string {
  if (value === null || Number.isNaN(value)) return '--'
  const absolute = Math.abs(value)
  if (absolute >= 1_000_000_000) return `${trimCompact(value / 1_000_000_000, absolute >= 100_000_000_000 ? 0 : 1)}B`
  if (absolute >= 1_000_000) return `${trimCompact(value / 1_000_000, absolute >= 100_000_000 ? 0 : absolute >= 10_000_000 ? 1 : 2)}M`
  if (absolute >= 1_000) return `${trimCompact(value / 1_000, absolute >= 100_000 ? 0 : absolute >= 10_000 ? 1 : 2)}K`
  return String(Math.round(value))
}

function trimCompact(value: number, decimals: number): string {
  return value.toFixed(decimals).replace(/\.0+$|(?<=\.[0-9])0+$/, '')
}

function compactEndpoint(value: string): string {
  try {
    const url = new URL(value)
    return `${url.hostname}${url.port ? `:${url.port}` : ''}`
  } catch {
    return value.replace(/^https?:\/\//, '').slice(0, 28)
  }
}

function errorMessageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : typeof error === 'string' && error.trim() ? error : fallback
}

async function notifySettingsChanged() {
  if (!('__TAURI_INTERNALS__' in window)) return
  try {
    const { emit } = await import('@tauri-apps/api/event')
    await emit('token-orb-settings-updated')
  } catch { return }
}

async function loadTauriWindowApi(): Promise<TauriWindowApi | null> {
  if (!('__TAURI_INTERNALS__' in window)) return null
  if (tauriWindowApi) return tauriWindowApi
  try {
    tauriWindowApi = await import('@tauri-apps/api/window')
    return tauriWindowApi
  } catch { return null }
}

async function initAppVersion() {
  try {
    const { getVersion } = await import('@tauri-apps/api/app')
    appVersion.value = await getVersion()
  } catch { return }
}

async function checkPlatformUpdate() {
  if (!('__TAURI_INTERNALS__' in window)) return
  try {
    const { check } = await import('@tauri-apps/plugin-updater')
    platformUpdateAvailable.value = (await check()) !== null
  } catch { platformUpdateAvailable.value = false }
}

async function checkForAppUpdate() {
  updateState.value = 'checking'
  updateMessage.value = '正在检查更新...'
  try {
    if (!('__TAURI_INTERNALS__' in window)) throw new Error('请在桌面应用中检查更新')
    const { check } = await import('@tauri-apps/plugin-updater')
    const update = await check()
    if (!update) {
      updateState.value = 'latest'
      updateMessage.value = '当前已经是最新版本。'
      return
    }
    availableUpdate = update
    updateVersion.value = update.version
    updateBody.value = update.body || ''
    updateState.value = 'available'
    updateMessage.value = '发现新版本。'
  } catch (error) {
    updateState.value = 'error'
    updateMessage.value = errorMessageOf(error, '检查更新失败')
  }
}

async function installAppUpdate() {
  if (!availableUpdate) return
  updateState.value = 'downloading'
  downloadPercent.value = 0
  try {
    await availableUpdate.download((event) => {
      if (event.event === 'Progress') downloadPercent.value = Math.min(100, (downloadPercent.value ?? 0) + 1)
      if (event.event === 'Finished') downloadPercent.value = 100
    })
    await availableUpdate.install()
    updateState.value = 'installed'
    updateMessage.value = '更新已安装，重启后生效。'
  } catch (error) {
    updateState.value = 'error'
    updateMessage.value = errorMessageOf(error, '更新安装失败')
  }
}

async function restartApp() {
  try { await (await import('@tauri-apps/plugin-process')).relaunch() } catch { return }
}

function syncExternalSettingsChange(event: StorageEvent) {
  if (event.key !== settingsStorageKey || event.newValue === null) return
  settings.value = loadSettings()
  Object.assign(draft, createDraft(settings.value))
  syncWidgetPreferences()
  scheduleRefresh(0)
}

function onVisibilityChange() {
  syncRefreshVisibility()
}

onMounted(() => {
  window.addEventListener('storage', syncExternalSettingsChange)
  document.addEventListener('visibilitychange', onVisibilityChange)
  void initAppVersion()
  if (isTrayMenuView) {
    void checkPlatformUpdate()
    return
  }
  if (isUpdaterView) {
    void checkForAppUpdate()
    return
  }
  if (!isSettingsView) syncWidgetPreferences()
  if (configured.value) scheduleRefresh(0)
  if ('__TAURI_INTERNALS__' in window) {
    void import('@tauri-apps/api/event').then(async ({ listen }) => {
      const unlisteners = await Promise.all([
        listen('token-orb-settings-updated', () => {
          settings.value = loadSettings()
          Object.assign(draft, createDraft(settings.value))
          syncWidgetPreferences()
          scheduleRefresh(0)
        }),
        listen('token-orb-open-settings', () => {
          void openSettings()
        }),
        listen<boolean>('token-orb-monitor-visibility', ({ payload }) => {
          if (payload) scheduleRefresh(0)
          else stopRefresh()
        })
      ])
      ;[unlistenSettingsChanged, unlistenMonitorVisibility] = unlisteners
    }).catch(() => undefined)
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('storage', syncExternalSettingsChange)
  document.removeEventListener('visibilitychange', onVisibilityChange)
  stopRefresh()
  if (collapseTimer !== null) window.clearTimeout(collapseTimer)
  if (hoverExpandTimer !== null) window.clearTimeout(hoverExpandTimer)
  if (unlistenSettingsChanged) unlistenSettingsChanged()
  if (unlistenMonitorVisibility) unlistenMonitorVisibility()
})
</script>

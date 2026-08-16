# Sub2API Pulse

[![Release](https://img.shields.io/github/v/release/Luociqvq/sub2api-pulse?display_name=tag)](https://github.com/Luociqvq/sub2api-pulse/releases)
[![Build](https://github.com/Luociqvq/sub2api-pulse/actions/workflows/release.yml/badge.svg)](https://github.com/Luociqvq/sub2api-pulse/actions/workflows/release.yml)
[![Tauri](https://img.shields.io/badge/Tauri-2-24C8DB?logo=tauri&logoColor=white)](https://v2.tauri.app/)

Sub2API Pulse 是一个面向 [sub2api](https://github.com/Wei-Shaw/sub2api) 的轻量桌面监控器。它以紧凑悬浮岛常驻桌面，集中展示 Token 消耗、实际费用、账号池状态、服务器健康度和 OpenAI/Codex 并发情况。

数据由客户端直接从你配置的 sub2api 实例读取，不经过中转服务。

## 界面预览

> 下列预览使用模拟数据，不包含真实服务器地址或凭据。

### 平台监控

![Sub2API Pulse 平台监控面板](docs/images/platform-monitor-demo.svg)

### 个人用量

![Sub2API Pulse 个人用量悬浮岛](docs/images/personal-orb-demo.svg)

### 连接设置

![Sub2API Pulse 设置界面](docs/images/settings-demo.svg)

### 应用更新

![Sub2API Pulse 更新界面](docs/images/updater-demo.svg)

## 功能

- **实时用量**：今日 Token、今日实际金额和最近请求延迟。
- **账号池概览**：可用账号、账号总量、限流/异常数量和平均配额余量。
- **服务器状态**：CPU、内存、接口延迟和运行时长。
- **Codex 调度**：OpenAI 平台请求的运行数与排队数。
- **双凭据模式**：支持管理员 API Key，也支持只配置个人 Token。
- **桌面悬浮交互**：自动收起、固定展开、保持置顶和托盘快捷菜单。
- **后台节流**：窗口隐藏时暂停轮询，恢复显示后立即刷新。
- **自动更新**：通过 GitHub Releases 检查并安装新版本。

> Codex 调度数据来自 sub2api Ops 并发接口，不是本机 Codex Desktop 的任务列表。未启用 Ops 监控时，该区域会显示“未提供”，不影响其他指标。

## 安装

在 [Releases](https://github.com/Luociqvq/sub2api-pulse/releases) 页面下载与你的平台对应的安装包。

Windows 推荐使用：

- `Sub2API Pulse_VERSION_x64-setup.exe`：NSIS 安装程序。
- `Sub2API Pulse_VERSION_x64_en-US.msi`：MSI 安装包。

macOS 构建由发布工作流生成。首次打开未签名的本地构建时，系统可能要求你在“隐私与安全性”中确认。

## 配置

首次启动时填写以下信息：

| 配置项 | 必填 | 说明 |
| --- | --- | --- |
| 服务器地址 | 是 | sub2api 服务根地址，例如 `http://127.0.0.1:8081` |
| 管理员 API Key | 二选一 | 展示平台、账号池、服务器和 Ops 指标 |
| 个人 Token | 二选一 | 展示当前用户的 Token 与费用数据 |
| 账号池分组 | 否 | 与 sub2api 中的 active 分组名称完全一致；留空统计全部账号 |
| 刷新间隔 | 否 | 支持 10-300 秒，默认 30 秒 |

管理员 API Key 与个人 Token 可以同时配置。保存前可使用“测试连接”验证地址和凭据。

## 数据接口

Sub2API Pulse 根据凭据和服务能力调用以下接口：

```text
/api/v1/usage/dashboard/stats
/api/v1/usage?page=1&page_size=1&sort=created_at&order=desc
/api/v1/admin/dashboard/stats
/api/v1/admin/groups/all
/api/v1/admin/accounts
/api/v1/admin/groups/capacity-summary
/api/v1/admin/ops/dashboard/overview?time_range=5m
/api/v1/admin/ops/concurrency?platform=openai
```

Ops 接口是可选能力，请求超时或服务端未启用时不会阻断主面板刷新。

## 隐私与安全

- 服务器地址与凭据保存在本机 WebView 存储中。
- 凭据只发送到你填写的 sub2api 服务地址。
- 项目不内置分析、遥测或第三方数据中转。
- 公开仓库不包含作者或使用者的服务器地址、API Key、Token 等运行配置。

建议为外网部署启用 HTTPS，并定期轮换管理员 API Key 与个人 Token。

## 本地开发

环境要求：

- Node.js 20+
- Rust stable
- Tauri 2 对应的[系统依赖](https://v2.tauri.app/start/prerequisites/)

```bash
git clone https://github.com/Luociqvq/sub2api-pulse.git
cd sub2api-pulse
npm install
npm run desktop
```

常用命令：

```bash
npm run dev       # 启动前端开发服务器
npm test          # 运行前端与发布脚本测试
npm run build     # 类型检查并构建前端
npm run desktop   # 启动 Tauri 桌面应用
```

构建 Windows 安装包：

```bash
npm run tauri build -- --config src-tauri/tauri.local-build.conf.json
```

本地覆盖配置会关闭 updater 产物生成，适合验证安装包。正式发布使用默认 Tauri 配置。

## 发布

版本号和更新说明以 `package.json` 为单一来源：

```bash
npm run release:sync
npm test
npm run build
npm run release:tag
git push origin main --follow-tags
```

推送 `v*` 标签后，GitHub Actions 会构建 Windows 与 macOS 安装包并创建 Release。自动更新签名需要在仓库 Secrets 中配置 `TAURI_SIGNING_PRIVATE_KEY` 和 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`。

## 技术栈

- Vue 3 + TypeScript + Vite
- Tauri 2 + Rust
- Vitest

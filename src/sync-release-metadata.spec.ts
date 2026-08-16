import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

// @ts-expect-error 同步脚本是 Node ESM 工具脚本，当前项目不为 .mjs 生成声明。
import { createFixture, readReleaseMetadata, syncReleaseMetadata, writeGithubOutput } from '../scripts/sync-release-metadata.mjs'

type TestFixture = {
  rootDir: string
  cleanup: () => void
}

const fixtures: TestFixture[] = []

afterEach(() => {
  while (fixtures.length > 0) {
    const fixture = fixtures.pop()
    fixture?.cleanup()
  }
})

describe('syncReleaseMetadata', () => {
  it('从 package.json 读取版本和发布说明', () => {
    const fixture = createCodexLocalMonitorFixture({
      packageJson: {
        name: 'codex-local-monitor',
        version: '1.2.3',
        release: {
          notes: ['新增自动同步版本信息', '修复 Release 说明来源分散的问题'],
        },
      },
    })

    expect(readReleaseMetadata(fixture.rootDir)).toEqual({
      version: '1.2.3',
      tag: 'v1.2.3',
      releaseName: 'Codex Local Monitor v1.2.3',
      releaseBody: '新增自动同步版本信息\n修复 Release 说明来源分散的问题',
    })
  })

  it('把 package.json version 同步到所有发布相关文件', () => {
    const fixture = createCodexLocalMonitorFixture({
      packageJson: {
        name: 'codex-local-monitor',
        version: '1.2.3',
        release: {
          notes: '统一维护版本号和更新记录',
        },
      },
    })

    syncReleaseMetadata(fixture.rootDir)

    expect(JSON.parse(read('package-lock.json', fixture)).version).toBe('1.2.3')
    expect(JSON.parse(read('package-lock.json', fixture)).packages[''].version).toBe('1.2.3')
    expect(JSON.parse(read('src-tauri/tauri.conf.json', fixture)).version).toBe('1.2.3')
    expect(read('src-tauri/Cargo.toml', fixture)).toContain('version = "1.2.3"')
    expect(read('src-tauri/Cargo.lock', fixture)).toContain('name = "codex-local-monitor"\nversion = "1.2.3"')
  })

  it('支持 Windows CRLF 换行的 Cargo.lock', () => {
    const fixture = createCodexLocalMonitorFixture({
      packageJson: {
        name: 'codex-local-monitor',
        version: '1.2.3',
        release: {
          notes: '统一维护版本号和更新记录',
        },
      },
    })

    writeFileSync(path.join(fixture.rootDir, 'src-tauri', 'Cargo.lock'), [
      '[[package]]',
      'name = "codex-local-monitor"',
      'version = "0.0.1"',
      '',
    ].join('\r\n'))

    syncReleaseMetadata(fixture.rootDir)

    expect(read('src-tauri/Cargo.lock', fixture)).toContain('name = "codex-local-monitor"\r\nversion = "1.2.3"')
  })

  it('拒绝缺失发布说明，避免 GitHub Release 继续写死在 workflow', () => {
    const fixture = createCodexLocalMonitorFixture({
      packageJson: {
        name: 'codex-local-monitor',
        version: '1.2.3',
      },
    })

    expect(() => syncReleaseMetadata(fixture.rootDir)).toThrow(/release\.notes 不能为空/)
  })

  it('输出 GitHub Actions 可读取的 release body', () => {
    const fixture = createCodexLocalMonitorFixture({
      packageJson: {
        name: 'codex-local-monitor',
        version: '1.2.3',
        release: {
          notes: '第一行\n第二行',
        },
      },
    })
    const outputPath = path.join(fixture.rootDir, 'github-output.txt')

    writeGithubOutput(syncReleaseMetadata(fixture.rootDir), outputPath)

    expect(readFileSync(outputPath, 'utf8')).toContain('release_body<<CODEX_LOCAL_MONITOR_RELEASE_BODY\n第一行\n第二行\nCODEX_LOCAL_MONITOR_RELEASE_BODY')
  })
})

function createCodexLocalMonitorFixture({ packageJson }: { packageJson: Record<string, unknown> }) {
  const fixture = createFixture({})
  fixtures.push(fixture)

  mkdirSync(path.join(fixture.rootDir, 'src-tauri'), { recursive: true })
  writeFileSync(path.join(fixture.rootDir, 'package.json'), `${JSON.stringify(packageJson, null, 2)}\n`)
  writeFileSync(path.join(fixture.rootDir, 'package-lock.json'), JSON.stringify({
    name: 'codex-local-monitor',
    version: '0.0.1',
    lockfileVersion: 3,
    packages: {
      '': {
        name: 'codex-local-monitor',
        version: '0.0.1',
      },
    },
  }, null, 2))
  writeFileSync(path.join(fixture.rootDir, 'src-tauri', 'tauri.conf.json'), JSON.stringify({
    productName: 'Codex Local Monitor',
    version: '0.0.1',
  }, null, 2))
  writeFileSync(path.join(fixture.rootDir, 'src-tauri', 'Cargo.toml'), [
    '[package]',
    'name = "codex-local-monitor"',
    'version = "0.0.1"',
    '',
  ].join('\n'))
  writeFileSync(path.join(fixture.rootDir, 'src-tauri', 'Cargo.lock'), [
    '[[package]]',
    'name = "codex-local-monitor"',
    'version = "0.0.1"',
    '',
  ].join('\n'))

  return fixture
}

function read(relativePath: string, fixture: TestFixture) {
  return readFileSync(path.join(fixture.rootDir, relativePath), 'utf8')
}

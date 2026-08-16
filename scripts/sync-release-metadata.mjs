import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const VERSION_PATTERN = /^\d+\.\d+\.\d+([.-][0-9A-Za-z.-]+)?$/

export function readReleaseMetadata(rootDir) {
  const packageJsonPath = path.join(rootDir, 'package.json')
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'))
  const version = packageJson.version
  const notes = normalizeNotes(packageJson.release?.notes)

  if (!VERSION_PATTERN.test(version)) {
    throw new Error(`package.json version 必须是语义化版本且不带 v 前缀，当前是: ${version}`)
  }

  if (!notes) {
    throw new Error('package.json release.notes 不能为空，GitHub Release 更新记录从这里读取')
  }

  return {
    version,
    tag: `v${version}`,
    releaseName: `Codex Local Monitor v${version}`,
    releaseBody: notes,
  }
}

export function syncReleaseMetadata(rootDir) {
  const metadata = readReleaseMetadata(rootDir)
  const { version } = metadata
  const packageName = JSON.parse(readFileSync(path.join(rootDir, 'package.json'), 'utf8')).name

  updateJson(path.join(rootDir, 'package-lock.json'), (json) => {
    json.version = version
    if (json.packages?.['']) {
      json.packages[''].version = version
    }
  })

  updateJson(path.join(rootDir, 'src-tauri', 'tauri.conf.json'), (json) => {
    json.version = version
  })

  updatePackageVersionInToml(path.join(rootDir, 'src-tauri', 'Cargo.toml'), version)
  updatePackageVersionInCargoLock(path.join(rootDir, 'src-tauri', 'Cargo.lock'), packageName, version)

  return metadata
}

export function writeGithubOutput(metadata, outputPath) {
  if (!outputPath) return

  const output = [
    `version=${metadata.version}`,
    `tag=${metadata.tag}`,
    `release_name=${metadata.releaseName}`,
    heredocOutput('release_body', metadata.releaseBody),
    '',
  ].join('\n')

  writeFileSync(outputPath, output, { flag: 'a' })
}

function normalizeNotes(notes) {
  if (Array.isArray(notes)) {
    return notes.map((line) => String(line).trim()).filter(Boolean).join('\n')
  }

  if (typeof notes === 'string') {
    return notes.trim()
  }

  return ''
}

function updateJson(filePath, mutate) {
  const json = JSON.parse(readFileSync(filePath, 'utf8'))
  const before = JSON.stringify(json)
  mutate(json)
  const after = JSON.stringify(json)

  if (after !== before) {
    writeFileSync(filePath, `${JSON.stringify(json, null, 2)}\n`)
  }
}

function updatePackageVersionInToml(filePath, version) {
  const content = readFileSync(filePath, 'utf8')
  const { found, updated } = updateTomlPackageVersion(content, version)

  if (!found) {
    throw new Error(`未找到 Cargo.toml 的 [package] version: ${filePath}`)
  }

  if (updated !== content) {
    writeFileSync(filePath, updated)
  }
}

function updateTomlPackageVersion(content, version) {
  const lines = content.split('\n')
  let inPackageSection = false

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (/^\s*\[/.test(line)) {
      inPackageSection = /^\s*\[package\]\s*$/.test(line)
      continue
    }

    if (inPackageSection && /^\s*version\s*=/.test(line)) {
      lines[index] = line.replace(/^(\s*version\s*=\s*)"[^"]+"/, `$1"${version}"`)
      return {
        found: true,
        updated: lines.join('\n'),
      }
    }
  }

  return {
    found: false,
    updated: content,
  }
}

function updatePackageVersionInCargoLock(filePath, packageName, version) {
  const content = readFileSync(filePath, 'utf8')
  const { found, updated } = updateCargoLockPackageVersion(content, packageName, version)

  if (!found) {
    throw new Error(`未找到 Cargo.lock 中的 ${packageName} 包版本: ${filePath}`)
  }

  if (updated !== content) {
    writeFileSync(filePath, updated)
  }
}

function updateCargoLockPackageVersion(content, packageName, version) {
  const newline = content.includes('\r\n') ? '\r\n' : '\n'
  const lines = content.split(/\r?\n/)
  let inPackageBlock = false
  let currentPackageMatches = false

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]

    if (/^\s*\[\[package\]\]\s*$/.test(line)) {
      inPackageBlock = true
      currentPackageMatches = false
      continue
    }

    if (inPackageBlock && /^\s*\[/.test(line)) {
      inPackageBlock = false
      currentPackageMatches = false
      continue
    }

    if (inPackageBlock && line.trim() === `name = "${packageName}"`) {
      currentPackageMatches = true
      continue
    }

    if (inPackageBlock && currentPackageMatches && /^\s*version\s*=/.test(line)) {
      lines[index] = line.replace(/^(\s*version\s*=\s*)"[^"]+"/, `$1"${version}"`)
      return {
        found: true,
        updated: lines.join(newline),
      }
    }
  }

  return {
    found: false,
    updated: content,
  }
}

function heredocOutput(name, value) {
  const delimiter = uniqueDelimiter(value)
  return `${name}<<${delimiter}\n${value}\n${delimiter}`
}

function uniqueDelimiter(value) {
  let index = 0
  let delimiter = 'CODEX_LOCAL_MONITOR_RELEASE_BODY'
  while (value.includes(delimiter)) {
    index += 1
    delimiter = `CODEX_LOCAL_MONITOR_RELEASE_BODY_${index}`
  }
  return delimiter
}

function main() {
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const metadata = syncReleaseMetadata(rootDir)

  if (process.argv.includes('--github-output')) {
    writeGithubOutput(metadata, process.env.GITHUB_OUTPUT)
  }

  console.log(`已同步版本: ${metadata.tag}`)
}

export function createFixture(files) {
  const rootDir = mkdtempSync(path.join(tmpdir(), 'codex-local-monitor-release-'))
  for (const [relativePath, content] of Object.entries(files)) {
    const filePath = path.join(rootDir, relativePath)
    writeFileSync(filePath, content)
  }
  return {
    rootDir,
    cleanup: () => rmSync(rootDir, { recursive: true, force: true }),
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}

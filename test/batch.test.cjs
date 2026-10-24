const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const { execFileSync } = require('node:child_process')
const { pathToFileURL, fileURLToPath } = require('node:url')
const { test } = require('node:test')
const { buildSync } = require('esbuild')

const bundle = buildSync({
  entryPoints: [path.join(__dirname, '../src/index.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['vscode'],
  write: false,
}).outputFiles[0].text

class Uri {
  constructor(value) {
    this.url = new URL(value)
    this.scheme = this.url.protocol.slice(0, -1)
    this.fsPath = this.scheme === 'file' ? fileURLToPath(this.url) : decodeURIComponent(this.url.pathname)
  }
  static file(value) {
    return new Uri(pathToFileURL(path.resolve(value)))
  }
  static parse(value) {
    return new Uri(value)
  }
  static joinPath(uri, ...parts) {
    return Uri.file(path.join(uri.fsPath, ...parts))
  }
  toString() {
    return this.url.toString()
  }
}

class EventEmitter {
  listeners = []
  event = (listener) => {
    this.listeners.push(listener)
    return { dispose() {} }
  }
  fire(value) {
    this.listeners.forEach((listener) => listener(value))
  }
}

async function fixture(t) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'favorites-batch-'))
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }))
  const git = (root, ...args) =>
    execFileSync('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] }).toString()
  const repositories = []
  const addRepository = (name) => {
    const root = path.join(temporary, name)
    fs.mkdirSync(root)
    git(root, 'init', '--quiet')
    const repository = { rootUri: Uri.file(root), state: { HEAD: { name: 'main' } }, statusCalls: 0 }
    repository.status = async () => {
      repository.statusCalls++
    }
    repositories.push(repository)
    return repository
  }
  const repository = addRepository('first')
  const root = repository.rootUri.fsPath
  const config = { resources: [], groups: ['Default', 'Other'], currentGroup: 'Default', sortOrder: 'MANUAL' }
  const handlers = new Map()
  const views = new Map()
  const messages = []
  const writes = []
  const opened = []
  const failures = []
  const api = {
    git: { path: 'git' },
    repositories,
    getRepository: (uri) =>
      [...repositories]
        .sort((a, b) => b.rootUri.fsPath.length - a.rootUri.fsPath.length)
        .find((repo) => {
          const relative = path.relative(repo.rootUri.fsPath, uri.fsPath)
          return (
            relative &&
            relative !== '..' &&
            !relative.startsWith('..' + path.sep) &&
            !path.isAbsolute(relative)
          )
        }),
  }
  const extension = { exports: { getAPI: () => api }, activate: async () => extension.exports }
  const vscode = {
    Uri,
    EventEmitter,
    TreeItem: class {
      constructor(label, collapsibleState) {
        Object.assign(this, { label, collapsibleState })
      }
    },
    TreeItemCollapsibleState: { None: 0, Collapsed: 1 },
    FileType: { File: 1, Directory: 2 },
    ViewColumn: { Beside: -2 },
    workspace: {
      workspaceFolders: [{ uri: Uri.file(root) }],
      getConfiguration: (section) => ({
        get: (key, fallback) =>
          section === 'favorites' ? structuredClone(config[key] ?? fallback) : fallback,
        update: async (key, value) => {
          writes.push(key)
          config[key] = structuredClone(value)
        },
      }),
      onDidChangeConfiguration: () => ({ dispose() {} }),
      onDidRenameFiles: () => ({ dispose() {} }),
      fs: {
        stat: async (uri) => {
          const stat = fs.statSync(uri.fsPath)
          return { type: stat.isFile() ? 1 : 2 }
        },
        readDirectory: async (uri) =>
          fs
            .readdirSync(uri.fsPath, { withFileTypes: true })
            .map((item) => [item.name, item.isFile() ? 1 : 2]),
      },
    },
    window: {
      createTreeView: (id, options) => {
        views.set(id, options)
        return {}
      },
      showInformationMessage: async (message) => {
        messages.push(['info', message])
      },
      showWarningMessage: async (message) => {
        messages.push(['warning', message])
      },
      showErrorMessage: async (message) => {
        messages.push(['error', message])
      },
      showQuickPick: async () => 'Other',
    },
    extensions: { getExtension: () => extension },
    commands: {
      registerCommand: (id, handler) => {
        handlers.set(id, handler)
        return {
          dispose() {
            if (handlers.get(id) === handler) handlers.delete(id)
          },
        }
      },
      executeCommand: async (id, ...args) => {
        if (handlers.has(id)) return handlers.get(id)(...args)
        if (id === 'vscode.open') opened.push(args)
      },
    },
  }
  const module = { exports: {} }
  vm.runInNewContext(bundle, {
    module,
    exports: module.exports,
    require: (name) => (name === 'vscode' ? vscode : require(name)),
    console: { log() {}, error: (...args) => failures.push(args) },
    Buffer,
    setTimeout,
    clearTimeout,
  })
  module.exports.activate({ subscriptions: [] })
  await new Promise(setImmediate)
  const file = (name, repo = repository) => {
    const filePath = path.join(repo.rootUri.fsPath, name)
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, name)
    return Uri.file(filePath)
  }
  const item = (uri, child = false) => ({
    resourceUri: uri,
    uri,
    value: path.relative(root, uri.fsPath),
    contextValue: child ? 'uri.resourceChild' : 'uri.resource',
  })
  const run = async (id, ...args) => {
    assert.ok(handlers.has(id), `Command registered: ${id}`)
    await handlers.get(id)(...args)
    await new Promise(setImmediate)
  }
  const indexed = (repo = repository) =>
    git(repo.rootUri.fsPath, 'ls-files', '-z').split('\0').filter(Boolean).sort()
  return {
    root,
    config,
    views,
    writes,
    messages,
    opened,
    vscode,
    repository,
    file,
    item,
    run,
    indexed,
    addRepository,
    git,
    failures,
  }
}

test('both Favorites views enable native multi-selection', async (t) => {
  const f = await fixture(t)
  assert.equal(f.views.size, 2)
  for (const view of f.views.values()) assert.equal(view.canSelectMany, true)
})

test('Explorer batch add deduplicates and saves resources once', async (t) => {
  const f = await fixture(t)
  const a = f.file('中文 待办.md'),
    b = f.file('another.md')
  f.config.resources = [{ filePath: a.fsPath, group: 'Default' }]
  await f.run('favorites.addToFavorites', a, [a, b, b])
  assert.equal(f.config.resources.length, 2)
  assert.equal(f.config.resources[1].filePath, 'another.md')
  assert.deepEqual(f.writes, ['resources'])
})

test('batch add to group and dynamic group commands handle the entire selection', async (t) => {
  const f = await fixture(t)
  const a = f.file('a.md'),
    b = f.file('b.md')
  await f.run('favorites.addToFavoritesGroup', a, [a, b])
  assert.equal(f.config.currentGroup, 'Other')
  assert.deepEqual(
    f.config.resources.map((r) => r.group),
    ['Other', 'Other'],
  )
  await f.run('favorites.addToFavorites.Default', a, [a, b])
  assert.equal(f.config.resources.length, 4)
  assert.equal(f.config.currentGroup, 'Default')
})

test('right-click outside the selection operates only on the clicked resource', async (t) => {
  const f = await fixture(t)
  const a = f.file('a.md'),
    b = f.file('b.md'),
    c = f.file('c.md')
  await f.run('favorites.addToFavorites', c, [a, b])
  assert.deepEqual(f.config.resources, [{ filePath: 'c.md', group: 'Default' }])
})

test('batch removal preserves other groups, legacy entries and physical files', async (t) => {
  const f = await fixture(t)
  const a = f.file('a.md'),
    b = f.file('b.md')
  const remote = Uri.parse('https://example.com/note')
  f.config.resources = [
    'a.md',
    { filePath: 'b.md', group: 'Default' },
    { filePath: 'a.md', group: 'Other' },
    { filePath: remote.toString(), group: 'Default' },
    { filePath: remote.toString(), group: 'Other' },
  ]
  const selected = [f.item(a), f.item(b), f.item(remote)]
  await f.run('favorites.deleteFavorite', selected[0], selected)
  assert.deepEqual(f.config.resources, [
    { filePath: 'a.md', group: 'Other' },
    { filePath: remote.toString(), group: 'Other' },
  ])
  assert.ok(fs.existsSync(a.fsPath) && fs.existsSync(b.fsPath))
  assert.deepEqual(f.writes, ['resources'])
})

test('folder children mixed into removal prevent partial removal', async (t) => {
  const f = await fixture(t)
  const a = f.item(f.file('a.md')),
    child = f.item(f.file('folder/b.md'), true)
  f.config.resources = [{ filePath: 'a.md', group: 'Default' }]
  await f.run('favorites.deleteFavorite', a, [a, child])
  assert.equal(f.config.resources.length, 1)
  assert.equal(f.writes.length, 0)
  assert.match(f.messages[0][1], /top-level/)
})

test('all four movement commands reject multi-selection without writing settings', async (t) => {
  const f = await fixture(t)
  const a = f.item(f.file('a.md')),
    b = f.item(f.file('b.md'))
  f.config.resources = [
    { filePath: 'a.md', group: 'Default' },
    { filePath: 'b.md', group: 'Default' },
  ]
  for (const command of ['moveUp', 'moveDown', 'moveToTop', 'moveToBottom']) {
    await f.run('favorites.' + command, a, [a, b])
  }
  assert.equal(f.messages.length, 4)
  assert.ok(f.messages.every(([, message]) => /Batch moving is not supported/.test(message)))
  assert.equal(f.writes.length, 0)
})

test('single selection retains the existing movement behavior', async (t) => {
  const f = await fixture(t)
  const a = f.item(f.file('a.md')),
    b = f.item(f.file('b.md'))
  f.config.resources = [
    { filePath: 'a.md', group: 'Default' },
    { filePath: 'b.md', group: 'Default' },
  ]
  await f.run('favorites.moveDown', a, [a])
  assert.deepEqual(
    f.config.resources.map((r) => r.filePath),
    ['b.md', 'a.md'],
  )
  await f.run('favorites.moveUp', a)
  assert.deepEqual(
    f.config.resources.map((r) => r.filePath),
    ['a.md', 'b.md'],
  )
  await f.run('favorites.moveToTop', b)
  assert.deepEqual(
    f.config.resources.map((r) => r.filePath),
    ['b.md', 'a.md'],
  )
  await f.run('favorites.moveToBottom', b)
  assert.deepEqual(
    f.config.resources.map((r) => r.filePath),
    ['a.md', 'b.md'],
  )
})

test('batch open keeps all selected files as non-preview tabs', async (t) => {
  const f = await fixture(t)
  const a = f.item(f.file('a.md')),
    b = f.item(f.file('b.md'))
  await f.run('favorites.openToSide', a, [a, b])
  assert.equal(f.opened.length, 2)
  assert.ok(f.opened.every(([, options]) => !options.preview && options.preserveFocus))
})

test('normal staging respects ignores, literal filenames and reports partial failure', async (t) => {
  const f = await fixture(t)
  fs.writeFileSync(path.join(f.root, '.gitignore'), 'private/\n')
  const a = f.item(f.file('中文 待办.md')),
    ignored = f.item(f.file('private/note.md'))
  const literal = f.item(f.file('note[1].md'))
  f.file('note1.md')
  await f.run('favorites.stage', a, [a, ignored, literal])
  assert.deepEqual(f.indexed(), ['note[1].md', '中文 待办.md'].sort())
  assert.match(f.messages.at(-1)[1], /2 file\(s\); 1 failed/)
  assert.equal(f.repository.statusCalls, 1)
})

test('force staging adds only selected ignored files across their own repositories', async (t) => {
  const f = await fixture(t)
  const second = f.addRepository('second')
  fs.writeFileSync(path.join(f.root, '.gitignore'), 'private/\n')
  const a = f.item(f.file('private/中文 [1].md'))
  const b = f.item(f.file('second.md', second))
  f.file('private/中文 1.md')
  f.file('private/unselected.md')
  await f.run('favorites.forceStage', a, [a, b, a])
  assert.deepEqual(f.indexed(), ['private/中文 [1].md'])
  assert.deepEqual(f.indexed(second), ['second.md'])
  assert.match(f.messages.at(-1)[1], /2 file\(s\)/)
  assert.equal(f.repository.statusCalls, 1)
  assert.equal(second.statusCalls, 1)
})

test('staging preflight rejects folders and repository-external files before any index write', async (t) => {
  const f = await fixture(t)
  const a = f.item(f.file('a.md')),
    folder = f.item(Uri.file(f.root))
  await f.run('favorites.forceStage', a, [a, folder])
  assert.deepEqual(f.indexed(), [])
  const outside = f.file('../outside.md')
  await f.run('favorites.forceStage', a, [a, f.item(outside)])
  assert.deepEqual(f.indexed(), [])
  await f.run('favorites.forceStage', a, [a, f.item(Uri.parse('https://example.com/note'))])
  assert.deepEqual(f.indexed(), [])
  assert.equal(f.messages.filter(([kind]) => kind === 'error').length, 3)
})

test('empty selection and unavailable Git extension never stage the whole repository', async (t) => {
  const f = await fixture(t)
  const a = f.item(f.file('a.md'))
  await f.run('favorites.stage')
  f.vscode.extensions.getExtension = () => undefined
  await f.run('favorites.stage', a)
  assert.deepEqual(f.indexed(), [])
  assert.match(f.messages.at(-1)[1], /Git extension is not available/)
})

test('Git status refresh failure does not stop staging the remaining repositories', async (t) => {
  const f = await fixture(t)
  const second = f.addRepository('second')
  const a = f.item(f.file('a.md')),
    b = f.item(f.file('b.md', second))
  f.repository.status = async () => {
    throw new Error('Refresh failed')
  }
  await f.run('favorites.stage', a, [a, b])
  assert.deepEqual(f.indexed(), ['a.md'])
  assert.deepEqual(f.indexed(second), ['b.md'])
  assert.match(f.messages.at(-1)[1], /2 file\(s\); 0 failed/)
  assert.match(f.messages.at(-1)[1], /Git status refresh failed/)
})

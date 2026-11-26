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
    this.path = decodeURIComponent(this.url.pathname)
    this.authority = this.url.host
    this.fsPath = this.scheme === 'file' ? fileURLToPath(this.url) : decodeURIComponent(this.url.pathname)
  }
  static file(value) {
    return new Uri(pathToFileURL(path.resolve(value)))
  }
  static parse(value) {
    return new Uri(value)
  }
  static joinPath(uri, ...parts) {
    return uri.with({ path: path.posix.join(uri.path, ...parts) })
  }
  with(change) {
    const url = new URL(this.url)
    if (change.path !== undefined) url.pathname = change.path.split('/').map(encodeURIComponent).join('/')
    if (change.query !== undefined) url.search = change.query
    if (change.fragment !== undefined) url.hash = change.fragment
    return new Uri(url)
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

async function fixture(t, overrides = {}, options = {}) {
  const subscriptions = []
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'favorites-batch-'))
  t.after(() => {
    subscriptions.forEach((item) => item?.dispose())
    fs.rmSync(temporary, { recursive: true, force: true })
  })
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
  const config = { resources: [], groups: ['Default', 'Other'], currentGroup: 'Default', sortOrder: 'MANUAL', language: 'en', ...overrides }
  const handlers = new Map()
  const views = new Map()
  const treeViews = new Map()
  const messages = []
  const writes = []
  const opened = []
  const nativeReveals = []
  const copied = []
  const failures = []
  const contexts = new Map()
  const configurationListeners = []
  const notifyConfiguration = (key) => Promise.all(configurationListeners.map((listener) => listener({
    affectsConfiguration: (section) => section === 'favorites' || section === 'favorites.' + key,
  })))
  const renameListeners = []
  const appliedEdits = []
  const input = { name: undefined, folder: undefined, pick: undefined, confirm: undefined }
  const visibleEditorListeners = []
  const activeEditorListeners = []
  const visibilityListeners = new Map()
  const revealed = []
  const settings = { filesExclude: {} }
  const timers = new Set()
  const storage = {}
  const diagnostics = []
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
    ThemeColor: class { constructor(id) { this.id = id } },
    ThemeIcon: class { constructor(id, color) { this.id = id; this.color = color } },
    FileType: { File: 1, Directory: 2 },
    ViewColumn: { Beside: -2 },
    DataTransferItem: class {
      constructor(value) { this.value = value }
      async asString() { return String(this.value) }
    },
    WorkspaceEdit: class {
      renames = []
      renameFile(oldUri, newUri, options) { this.renames.push({ oldUri, newUri, options }) }
    },
    env: { language: 'en', clipboard: { writeText: async (text) => copied.push(text) } },
    workspace: {
      workspaceFolders: [{ uri: Uri.file(root) }],
      asRelativePath: (uri, includeWorkspaceFolder) => {
        const roots = vscode.workspace.workspaceFolders || []
        for (const { uri: folder } of roots) {
          if (uri.scheme !== folder.scheme || uri.authority !== folder.authority) continue
          const relative = path.relative(folder.fsPath, uri.fsPath)
          if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) continue
          return includeWorkspaceFolder && roots.length > 1 ? path.join(path.basename(folder.fsPath), relative) : relative
        }
        return uri.fsPath
      },
      getConfiguration: (section) => ({
          get: (key, fallback) =>
            section === 'favorites' ? structuredClone(config[key] ?? fallback)
              : section === 'files' && key === 'exclude' ? structuredClone(settings.filesExclude)
                : section === 'workbench.editor' && key === 'enablePreview' ? true : fallback,
        update: async (key, value) => {
          writes.push(key)
          config[key] = structuredClone(value)
          void notifyConfiguration(key)
        },
      }),
      onDidChangeConfiguration: (listener) => { configurationListeners.push(listener); return { dispose() {} } },
      onDidRenameFiles: (listener) => { renameListeners.push(listener); return { dispose() {} } },
      onDidSaveTextDocument: () => ({ dispose() {} }),
      applyEdit: async (edit) => {
        appliedEdits.push(edit)
        for (const { oldUri, newUri, options } of edit.renames) {
          if (fs.existsSync(newUri.fsPath) && !options?.overwrite) return false
          fs.renameSync(oldUri.fsPath, newUri.fsPath)
        }
        await Promise.all(renameListeners.map((listener) => listener({ files: edit.renames })))
        return true
      },
      fs: {
        stat: async (uri) => {
          const stat = fs.statSync(uri.fsPath)
          return { type: stat.isFile() ? 1 : 2, mtime: stat.mtimeMs, ctime: stat.ctimeMs, size: stat.size }
        },
        createDirectory: async (uri) => fs.mkdirSync(uri.fsPath, { recursive: true }),
        delete: async (uri, options) => fs.rmSync(uri.fsPath, { recursive: !!options?.recursive }),
        readFile: async (uri) => fs.readFileSync(uri.fsPath),
        writeFile: async (uri, content) => fs.writeFileSync(uri.fsPath, content),
        readDirectory: async (uri) =>
          fs
            .readdirSync(uri.fsPath, { withFileTypes: true })
            .map((item) => [item.name, item.isFile() ? 1 : 2]),
      },
    },
    window: {
      createTreeView: (id, options) => {
        views.set(id, options)
        const listeners = []
        visibilityListeners.set(id, listeners)
        const view = {
          visible: true, dispose() {},
          onDidChangeVisibility: (listener) => { listeners.push(listener); return { dispose() {} } },
          reveal: async (target, options) => { revealed.push({ view: id, target, options }) },
        }
        treeViews.set(id, view)
        return view
      },
      visibleTextEditors: [],
      onDidChangeVisibleTextEditors: (listener) => { visibleEditorListeners.push(listener); return { dispose() {} } },
      onDidChangeActiveTextEditor: (listener) => { activeEditorListeners.push(listener); return { dispose() {} } },
      createOutputChannel: (name) => ({
        info: (...args) => diagnostics.push(args), warn: (...args) => diagnostics.push(args),
        error: (...args) => diagnostics.push(args), show: () => diagnostics.push(['show', name]), dispose() {},
      }),
      showInformationMessage: async (message) => {
        messages.push(['info', message])
      },
      showWarningMessage: async (message, ...args) => {
        messages.push(['warning', message])
        return input.confirm ? args.find((item) => typeof item === 'string') : undefined
      },
      showErrorMessage: async (message) => {
        messages.push(['error', message])
      },
      showQuickPick: async (items) => {
        if (items.some((item) => item.value === 'browse')) {
          if (!input.folder) return undefined
          return items.find((item) => item.value === input.folder.toString()) || items.find((item) => item.value === 'browse')
        }
        return input.pick ? items.find((item) => item.value === input.pick) : 'Other'
      },
      showInputBox: async () => input.name,
      showOpenDialog: async () => input.folder ? [input.folder] : undefined,
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
        if (id === 'revealInExplorer' || id === 'revealFileInOS') nativeReveals.push([id, ...args])
        if (id === 'setContext') contexts.set(args[0], args[1])
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
    process: Object.create(process, { platform: { value: options.platform || process.platform } }),
    setTimeout,
    clearTimeout,
    setInterval: (callback, delay) => {
      const timer = { callback, delay, unref() {} }
      timers.add(timer)
      return timer
    },
    clearInterval: (timer) => timers.delete(timer),
  })
  module.exports.activate({
    subscriptions,
    workspaceState: {
      get: (key, fallback) => structuredClone(storage[key] ?? fallback),
      update: async (key, value) => { storage[key] = structuredClone(value) },
    },
  })
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
    treeViews,
    writes,
    messages,
    opened,
    nativeReveals,
    commandIds: () => [...handlers.keys()],
    copied,
    vscode,
    repository,
    file,
    item,
    run,
    indexed,
    addRepository,
    git,
    failures,
    input,
    contexts,
    appliedEdits,
    diagnostics,
    storage,
    timers,
    revealed,
    settings,
    activateEditor: async (uri) => {
      vscode.window.activeTextEditor = uri ? { document: { uri } } : undefined
      for (const listener of activeEditorListeners) await listener(vscode.window.activeTextEditor)
    },
    showView: async (id, visible) => {
      treeViews.get(id).visible = visible
      for (const listener of visibilityListeners.get(id)) await listener({ visible })
    },
    tick: async () => { for (const timer of [...timers]) await timer.callback() },
    showEditors: async (...uris) => {
      vscode.window.visibleTextEditors = uris.map((uri) => ({ document: { uri } }))
      for (const listener of visibleEditorListeners) await listener(vscode.window.visibleTextEditors)
      await new Promise(setImmediate)
    },
    rename: async (files) => Promise.all(renameListeners.map((listener) => listener({ files }))),
    changeConfig: async (key, value) => {
      config[key] = value
      await notifyConfiguration(key)
    },
  }
}

module.exports = { fixture, Uri }

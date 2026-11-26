import * as vscode from 'vscode'
import { getCurrentResources } from './util'
import { isEqualOrParent, isFileSystemUri, resourcePathToUri, uriKey } from './resourcePaths'
import type { ResourceRename } from './favoriteRenames'
import { logOperation } from './diagnostics'

type ActivityState = { roots: Record<string, string[]>; unread: string[]; opened: string[] }
const STATE_KEY = 'favorites.fileActivity.v1'

export class FileActivity implements vscode.Disposable {
  private roots: Record<string, string[]>
  private unread: Set<string>
  private opened: Set<string>
  private timer: ReturnType<typeof setInterval> | undefined
  private interval = -1
  private running: Promise<void> | undefined
  private writes: Promise<void> = Promise.resolve()
  private disposed = false
  private revision = 0
  private again = false
  private lastSaved: string | undefined

  constructor(private state: vscode.Memento, private changed: () => Promise<void>) {
    const saved = state.get<ActivityState>(STATE_KEY, { roots: {}, unread: [], opened: [] })
    this.roots = saved.roots
    this.unread = new Set(saved.unread)
    this.opened = new Set(saved.opened)
  }

  start(): void {
    this.configure()
    void this.refresh(false)
  }

  configure(): void {
    const value = vscode.workspace.getConfiguration('favorites').get<number>('refreshInterval', 30)
    const seconds = Number.isFinite(value) ? Math.min(3600, Math.max(0, Math.floor(value))) : 30
    if (seconds === this.interval) return
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
    this.interval = seconds
    if (seconds > 0) {
      this.timer = setInterval(() => this.refresh(false), seconds * 1000)
      this.timer.unref()
    }
  }

  refresh(forceRescan = true): Promise<void> {
    if (this.disposed) return Promise.resolve()
    if (this.running) {
      if (forceRescan) this.again = true
      return this.running
    }
    this.running = (async () => {
      do {
        this.again = false
        const revision = this.revision
        await this.scan()
        if (revision !== this.revision) this.again = true
      } while (this.again && !this.disposed)
    })().catch((error) => {
      logOperation('refresh.failed', { error: String(error) })
    }).finally(async () => {
      this.running = undefined
      if (!this.disposed) await this.changed()
    })
    return this.running
  }

  invalidate(): void { this.revision++ }

  isNew(uri: vscode.Uri): boolean { return this.unread.has(uriKey(uri)) }

  async markOpened(uris: readonly vscode.Uri[]): Promise<void> {
    let changed = false
    let clearedMarker = false
    for (const uri of uris) {
      if (!isFileSystemUri(uri) || !Object.keys(this.roots).some((root) => isEqualOrParent(uri, vscode.Uri.parse(root)))) continue
      const key = uriKey(uri)
      if (!this.opened.has(key) || this.unread.has(key)) changed = true
      this.opened.add(key)
      if (this.unread.delete(key)) clearedMarker = true
    }
    if (changed) {
      this.revision++
      if (clearedMarker) await this.changed()
      await this.persist()
    }
  }

  remap(renames: readonly ResourceRename[]): void {
    let changed = false
    const remap = (key: string) => {
      const uri = vscode.Uri.parse(key)
      const rename = renames.find(({ oldUri }) => isEqualOrParent(uri, oldUri))
      if (!rename) return key
      const next = uriKey(rename.newUri.with({ path: rename.newUri.path.replace(/\/+$/, '') + uri.path.slice(rename.oldUri.path.replace(/\/+$/, '').length) }))
      if (next !== key) changed = true
      return next
    }
    const roots = Object.fromEntries(Object.entries(this.roots).map(([key, files]) => [remap(key), files.map(remap)]))
    const unread = [...this.unread].map(remap)
    const opened = [...this.opened].map(remap)
    if (!changed) return
    this.revision++
    this.roots = roots
    this.unread = new Set(unread)
    this.opened = new Set(opened)
    void this.persist()
  }

  remove(uris: readonly vscode.Uri[]): void {
    this.revision++
    const keep = (key: string) => !uris.some((uri) => isEqualOrParent(vscode.Uri.parse(key), uri))
    this.roots = Object.fromEntries(Object.entries(this.roots).filter(([key]) => keep(key)).map(([key, files]) => [key, files.filter(keep)]))
    this.unread = new Set([...this.unread].filter(keep))
    this.opened = new Set([...this.opened].filter(keep))
    void this.persist()
  }

  private async scan(): Promise<void> {
    const revision = this.revision
    const unread = new Set(this.unread)
    const candidates = [...new Map((await getCurrentResources()).map((entry) => {
      const uri = resourcePathToUri(entry.filePath)
      return [uriKey(uri), uri] as const
    })).values()].filter(isFileSystemUri)
    const roots: { uri: vscode.Uri; directory: boolean }[] = []
    const next: Record<string, string[]> = {}
    for (const uri of candidates.sort((a, b) => a.path.length - b.path.length)) {
      if (roots.some((root) => root.directory && isEqualOrParent(uri, root.uri))) continue
      try {
        const stat = await vscode.workspace.fs.stat(uri)
        roots.push({ uri, directory: !!(stat.type & vscode.FileType.Directory) })
      } catch (error) {
        const key = uriKey(uri)
        if (this.roots[key]) {
          const missing = ['FileNotFound', 'ENOENT', 'ENOTDIR'].includes((error as { code?: string }).code || '')
          next[key] = missing ? [] : this.roots[key]
        }
        logOperation('refresh.rootUnavailable', { uri: uri.toString(), error: String(error) })
      }
    }
    for (const root of roots) {
      if (this.disposed) return
      const key = uriKey(root.uri)
      try {
        const files: string[] = []
        if (root.directory) await this.walk(root.uri, files)
        else files.push(key)
        const previous = new Set(this.roots[key] || [])
        if (Object.prototype.hasOwnProperty.call(this.roots, key)) {
          for (const file of files) if (!previous.has(file) && !this.opened.has(file)) unread.add(file)
        }
        next[key] = files
      } catch (error) {
        if (this.roots[key]) next[key] = this.roots[key]
        logOperation('refresh.scanFailed', { uri: root.uri.toString(), error: String(error) })
      }
    }
    if (this.disposed || revision !== this.revision) return
    this.roots = next
    this.unread = unread
    for (const editor of vscode.window.visibleTextEditors) {
      const key = uriKey(editor.document.uri)
      this.opened.add(key)
      this.unread.delete(key)
    }
    const current = new Set(Object.values(next).flat())
    this.unread = new Set([...this.unread].filter((key) => current.has(key)))
    this.opened = new Set([...this.opened].filter((key) => current.has(key)))
    await this.persist()
  }

  private async walk(directory: vscode.Uri, files: string[]): Promise<void> {
    for (const [name, type] of await vscode.workspace.fs.readDirectory(directory)) {
      if (this.disposed) return
      const uri = vscode.Uri.joinPath(directory, name)
      if ((type & vscode.FileType.Directory) && !(type & vscode.FileType.SymbolicLink)) await this.walk(uri, files)
      else if (type & vscode.FileType.File) files.push(uriKey(uri))
    }
  }

  private persist(): Promise<void> {
    if (this.disposed) return Promise.resolve()
    const value: ActivityState = { roots: this.roots, unread: [...this.unread], opened: [...this.opened] }
    const serialized = JSON.stringify(value)
    this.writes = this.writes.catch(() => {}).then(async () => {
      if (serialized === this.lastSaved) return
      await this.state.update(STATE_KEY, value)
      this.lastSaved = serialized
    }).catch((error) => {
      logOperation('refresh.stateSaveFailed', { error: String(error) })
    })
    return this.writes
  }

  dispose(): void {
    this.disposed = true
    if (this.timer) clearInterval(this.timer)
  }
}

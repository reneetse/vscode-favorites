import * as vscode from 'vscode'
import type { FavoritesProvider, Resource } from '../provider/FavoritesProvider'
import { logOperation } from './diagnostics'

export class AutoReveal implements vscode.Disposable {
  private revision = 0
  private queued: Promise<void> = Promise.resolve()
  private disposed = false
  private disposables: vscode.Disposable[]

  constructor(private provider: FavoritesProvider, private views: readonly vscode.TreeView<Resource>[]) {
    this.disposables = [vscode.window.onDidChangeActiveTextEditor(() => this.sync())]
    for (const view of views) this.disposables.push(view.onDidChangeVisibility(({ visible }) => visible ? this.sync() : undefined))
    void this.sync()
  }

  async sync(): Promise<void> {
    const revision = ++this.revision
    const editor = vscode.window.activeTextEditor
    if (this.disposed || !editor || !vscode.workspace.getConfiguration('favorites').get('autoReveal', true)) return
    const views = this.views.filter((view) => view.visible)
    if (!views.length) return
    try {
      const resource = await this.provider.findResource(editor.document.uri)
      if (!resource || revision !== this.revision || this.disposed) return
      this.queued = this.queued.catch(() => {}).then(async () => {
        if (revision !== this.revision || this.disposed) return
        for (const view of views) {
          if (revision !== this.revision || this.disposed) return
          if (view.visible) {
            try { await view.reveal(resource, { select: true, focus: false, expand: true }) }
            catch (error) { logOperation('autoReveal.failed', { uri: editor.document.uri.toString(), error: String(error) }) }
          }
        }
      })
      await this.queued
    } catch (error) {
      logOperation('autoReveal.failed', { uri: editor.document.uri.toString(), error: String(error) })
    }
  }

  dispose(): void {
    this.disposed = true
    this.revision++
    this.disposables.forEach((item) => item.dispose())
  }
}

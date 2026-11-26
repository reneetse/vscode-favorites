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
    const isCurrent = () => revision === this.revision && !this.disposed && vscode.window.activeTextEditor === editor
    try {
      await this.provider.waitForMove()
      if (!isCurrent()) return
      const resource = await this.provider.findResource(editor.document.uri)
      if (!resource || !isCurrent()) return
      this.queued = this.queued.catch(() => {}).then(async () => {
        if (!isCurrent()) return
        await Promise.all(views.map(async (view) => {
          if (!view.visible) return
          const options = { select: true, focus: false, expand: false }
          try {
            await view.reveal(resource, options)
          } catch {
            // VS Code applies tree change events asynchronously after file edits.
            await new Promise<void>((resolve) => setTimeout(resolve, 250))
            if (!isCurrent() || !view.visible) return
            try {
              const updated = await this.provider.findResource(editor.document.uri)
              if (updated && isCurrent() && view.visible) {
                await view.reveal(updated, options)
              }
            } catch (error) {
              logOperation('autoReveal.failed', { uri: editor.document.uri.toString(), error: String(error) })
            }
          }
        }))
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

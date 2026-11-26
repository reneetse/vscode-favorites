import * as vscode from 'vscode'
import { homedir } from 'os'
import { lstat, realpath } from 'fs/promises'
import type { Resource, FavoritesProvider } from '../provider/FavoritesProvider'
import { getSelectedUris } from '../helper/selection'
import { isEqualOrParent, uriKey } from '../helper/resourcePaths'
import { resourceExists } from '../helper/fileOperations'
import { removeDeletedFavorites } from '../helper/favoriteRenames'
import { logOperation } from '../helper/diagnostics'
import { t } from '../helper/i18n'

type DeleteTarget = {
  uri: vscode.Uri; physical: string; directory: boolean; dev: number; ino: number; ctime: number
}

function protectRoot(uri: vscode.Uri, protectedUris: readonly vscode.Uri[]): void {
  if (uri.path === '/' || /^\/[a-z]:\/?$/i.test(uri.path) ||
      (uri.authority && uri.path.split('/').filter(Boolean).length <= 1) || protectedUris.some((root) => isEqualOrParent(root, uri))) {
    throw new Error(t('The workspace root, home directory and their parent folders cannot be deleted.'))
  }
}

async function inspectTarget(uri: vscode.Uri): Promise<DeleteTarget> {
  if (uri.scheme !== 'file') throw new Error(t('Delete requires a file on this VS Code host. Use Explorer for virtual or remote-provider URIs.'))
  const logicalRoots = [vscode.Uri.file(homedir()), ...(vscode.workspace.workspaceFolders || []).map((folder) => folder.uri)]
  protectRoot(uri, logicalRoots)
  const [stat, physical, physicalRoots] = await Promise.all([
    lstat(uri.fsPath),
    realpath(uri.fsPath),
    Promise.all(logicalRoots.filter((root) => root.scheme === 'file').map(async (root) => vscode.Uri.file(await realpath(root.fsPath)))),
  ])
  if (stat.isSymbolicLink()) throw new Error(t('Deleting symbolic links is not supported here. Use Explorer.'))
  if (!stat.isFile() && !stat.isDirectory()) throw new Error(t('Only regular files and folders can be deleted.'))
  protectRoot(vscode.Uri.file(physical), physicalRoots)
  const actual = await lstat(physical)
  if (actual.dev !== stat.dev || actual.ino !== stat.ino) throw new Error(t('The selected item changed. Review it and try again.'))
  return { uri, physical, directory: stat.isDirectory(), dev: stat.dev, ino: stat.ino, ctime: stat.ctimeMs }
}

async function revalidate(target: DeleteTarget, allowContentChange = false): Promise<DeleteTarget> {
  const latest = await inspectTarget(target.uri)
  if (latest.physical !== target.physical || latest.directory !== target.directory || latest.dev !== target.dev ||
      latest.ino !== target.ino || (!allowContentChange && latest.ctime !== target.ctime)) {
    throw new Error(t('The selected item changed. Review it and try again.'))
  }
  return latest
}

async function deleteOne(target: DeleteTarget): Promise<boolean> {
  await revalidate(target)
  try {
    await vscode.workspace.fs.delete(target.uri, { recursive: target.directory, useTrash: true })
    return true
  } catch (error) {
    if (!(await resourceExists(target.uri))) return true
    if (!/trash|recycle|回收站/i.test((error as Error).message)) throw error
    const remaining = await revalidate(target, true)
    const permanent = t('Permanently delete')
    const decision = await vscode.window.showWarningMessage(t('Trash is unavailable for {0}. Permanently delete it?', target.uri.fsPath), {
      modal: true, detail: t('This permanently deletes the item and its contents and cannot be undone.'),
    }, permanent)
    if (decision !== permanent) return false
    await revalidate(remaining)
    try {
      await vscode.workspace.fs.delete(target.uri, { recursive: target.directory, useTrash: false })
    } catch (failure) {
      if (await resourceExists(target.uri)) throw failure
    }
    return true
  }
}

export function deleteFiles(provider: FavoritesProvider) {
  return vscode.commands.registerCommand('favorites.deleteFiles', async (value?: Resource | vscode.Uri, selected?: readonly (Resource | vscode.Uri)[]) => {
    const started = Date.now()
    try {
      if (!value) return vscode.window.showWarningMessage(t('You have to choose a resource first'))
      const uris = [...new Map(getSelectedUris(value, selected).map((uri) => [uriKey(uri), uri])).values()]
      if (!uris.length) return vscode.window.showWarningMessage(t('You have to choose a resource first'))
      const items = await Promise.all(uris.map(inspectTarget))
      const roots = items.filter(({ uri }) => !items.some((other) => other.uri !== uri && other.directory && isEqualOrParent(uri, other.uri)))
      const confirm = t('Delete')
      logOperation('delete.confirmationRequested', { count: roots.length, preflightMs: Date.now() - started })
      const answer = await vscode.window.showWarningMessage(t('Delete {0} selected item(s) from disk?', roots.length), {
        modal: true, detail: roots.map(({ uri }) => uri.fsPath).join('\n') + '\n' + t('Folders include all their contents. Favorites alone will not be removed.'),
      }, confirm)
      if (answer !== confirm) return
      const completed: vscode.Uri[] = []
      const failures: string[] = []
      for (const target of roots) {
        const deleting = Date.now()
        logOperation('delete.request', { uri: target.uri.toString(), useTrash: true })
        try {
          if (await deleteOne(target)) {
            completed.push(target.uri)
            provider.removeDeletedRows([target.uri])
          }
        } catch (error) { failures.push(`${target.uri.fsPath}: ${String(error)}`) }
        logOperation('delete.processed', { uri: target.uri.toString(), elapsedMs: Date.now() - deleting })
      }
      let cleanupError = ''
      try { await removeDeletedFavorites(completed) }
      catch (error) { cleanupError = String(error) }
      provider.refresh()
      logOperation('delete.completed', { deleted: completed.map((uri) => uri.toString()), failures, cleanupError })
      const message = t('Deleted {0} item(s); {1} failed or were skipped.', completed.length, roots.length - completed.length)
      if (cleanupError) failures.push(t('Disk deletion completed, but favorites could not be saved: {0}', cleanupError))
      if (failures.length) vscode.window.showWarningMessage(`${message}\n${failures.join('\n')}`)
      else vscode.window.showInformationMessage(message)
    } catch (error) {
      logOperation('delete.failed', { error: String(error) })
      provider.refresh()
      vscode.window.showErrorMessage(t('Failed to delete files: {0}', (error as Error).message))
    }
  })
}

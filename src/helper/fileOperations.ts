import * as vscode from 'vscode'
import * as path from 'path'
import { isEqualOrParent, isFileSystemUri, uriKey } from './resourcePaths'
import { updateFavoritePaths, ResourceRename } from './favoriteRenames'
import { t } from './i18n'

export async function resourceExists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri)
    return true
  } catch (error) {
    if (['FileNotFound', 'ENOENT', 'ENOTDIR'].includes((error as { code?: string }).code || '')) return false
    throw error
  }
}

export async function getTargetDirectory(uri: vscode.Uri): Promise<vscode.Uri> {
  if (!isFileSystemUri(uri)) throw new Error(t('Only filesystem resources can be managed.'))
  const stat = await vscode.workspace.fs.stat(uri)
  return stat.type & vscode.FileType.Directory ? uri : uri.with({ path: path.posix.dirname(uri.path) })
}

let moving = false

export async function moveResources(
  sources: readonly vscode.Uri[],
  destination: vscode.Uri,
  token?: vscode.CancellationToken,
): Promise<number> {
  if (moving) throw new Error(t('Another move is in progress. Please wait.'))
  moving = true
  try {
    if (!isFileSystemUri(destination)) throw new Error(t('Only filesystem resources can be managed.'))
    if (!((await vscode.workspace.fs.stat(destination)).type & vscode.FileType.Directory)) {
      throw new Error(t('The destination must be a folder.'))
    }
    const unique = [...new Map(sources.map((uri) => [uriKey(uri), uri])).values()]
    const items = await Promise.all(unique.map(async (uri) => {
      if (!isFileSystemUri(uri)) throw new Error(t('Only filesystem resources can be managed.'))
      if (uri.scheme !== destination.scheme || uri.authority !== destination.authority) {
        throw new Error(t('Files must be moved within the same filesystem.'))
      }
      return { uri, stat: await vscode.workspace.fs.stat(uri) }
    }))
    const topLevel = items.filter(({ uri }) => !items.some((other) =>
      other.uri !== uri && (other.stat.type & vscode.FileType.Directory) && isEqualOrParent(uri, other.uri),
    ))
    const renames: ResourceRename[] = []
    const destinations = new Set<string>()
    for (const { uri, stat } of topLevel) {
      if ((stat.type & vscode.FileType.Directory) && isEqualOrParent(destination, uri)) {
        throw new Error(t('A folder cannot be moved into itself or its descendants.'))
      }
      const name = path.posix.basename(uri.path)
      const next = vscode.Uri.joinPath(destination, name)
      if (uriKey(uri) === uriKey(next)) continue
      // Be conservative across case-insensitive and Unicode-normalizing volumes.
      const nameKey = name.normalize('NFC').toLowerCase()
      if (destinations.has(nameKey)) {
        throw new Error(t('Multiple selected resources have the same name: {0}. No files were moved.', name))
      }
      if (await resourceExists(next)) {
        throw new Error(t('The destination already contains "{0}". No files were moved.', name))
      }
      destinations.add(nameKey)
      renames.push({ oldUri: uri, newUri: next })
    }
    if (!renames.length || token?.isCancellationRequested) return 0
    const edit = new vscode.WorkspaceEdit()
    for (const { oldUri, newUri } of renames) {
      edit.renameFile(oldUri, newUri, { overwrite: false, ignoreIfExists: false })
    }
    let applied: boolean
    try {
      applied = await vscode.workspace.applyEdit(edit)
    } catch (error) {
      return await reportFailedMove(renames, (error as Error).message)
    }
    if (!applied) {
      return await reportFailedMove(renames, t('VS Code did not complete the move.'))
    }
    try {
      await updateFavoritePaths(renames)
    } catch (error) {
      console.error('Files moved but updating favorites failed:', error)
      vscode.window.showWarningMessage(t('Files were moved, but favorites could not be updated: {0}', (error as Error).message))
    }
    return renames.length
  } finally {
    moving = false
  }
}

async function reportFailedMove(renames: readonly ResourceRename[], errorMessage: string): Promise<never> {
  const completed: ResourceRename[] = []
  let inspected = true
  try {
    for (const rename of renames) {
      if (!(await resourceExists(rename.oldUri)) && await resourceExists(rename.newUri)) completed.push(rename)
    }
  } catch (error) {
    inspected = false
    console.error('Error inspecting a partial move:', error)
  }
  try {
    await updateFavoritePaths(completed)
  } catch (error) {
    console.error('Error recovering favorites after a partial move:', error)
    vscode.window.showWarningMessage(t('Files were moved, but favorites could not be updated: {0}', (error as Error).message))
  }
  const status = inspected
    ? t('Move interrupted. Completed {0} of {1} item(s): {2}. Check both folders before retrying.', completed.length, renames.length, completed.map(({ newUri }) => newUri.fsPath).join(', ') || '—')
    : t('Move interrupted. Some paths could not be checked. Inspect both folders before retrying.')
  throw new Error(`${status} ${errorMessage}`)
}

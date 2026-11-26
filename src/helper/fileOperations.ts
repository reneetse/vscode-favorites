import * as vscode from 'vscode'
import * as path from 'path'
import { isEqualOrParent, isFileSystemUri, uriKey, parentDirectory } from './resourcePaths'
import { updateFavoritePaths, ResourceRename } from './favoriteRenames'
import { t } from './i18n'
import configMgr from './configMgr'
import { DEFAULT_GROUP } from '../enum'
import { logOperation } from './diagnostics'

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
  return stat.type & vscode.FileType.Directory ? uri : parentDirectory(uri)
}

let pendingMove: readonly ResourceRename[] | undefined
export type MoveOutcome = { moved: number; cancelled: boolean; destination: vscode.Uri; warnings: string[] }

export function externalRenames(renames: readonly ResourceRename[]): readonly ResourceRename[] {
  const pending = pendingMove
  return pending?.length ? renames.filter(({ oldUri, newUri }) => !pending.some((pair) =>
    uriKey(pair.oldUri) === uriKey(oldUri) && uriKey(pair.newUri) === uriKey(newUri),
  )) : renames
}

export async function moveResources(
  sources: readonly vscode.Uri[],
  destination: vscode.Uri,
  token?: vscode.CancellationToken,
): Promise<MoveOutcome> {
  const started = Date.now()
  logOperation('move.request', { sources: sources.map((uri) => uri.toString()), destination: destination.toString() })
  try {
    const group = ((await configMgr.get('currentGroup')) as string) || DEFAULT_GROUP
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
      if (uriKey(uri) === uriKey(next)) {
        logOperation('move.sameDirectory', { source: uri.toString(), destination: destination.toString() })
        continue
      }
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
    const cancelled = !!token?.isCancellationRequested
    if (cancelled || !renames.length) {
      return { moved: 0, cancelled, destination, warnings: [] }
    }
    const edit = new vscode.WorkspaceEdit()
    for (const { oldUri, newUri } of renames) {
      edit.renameFile(oldUri, newUri, { overwrite: false, ignoreIfExists: false })
    }
    pendingMove = renames
    const editing = Date.now()
    let moveError: string | undefined
    try {
      if (!await vscode.workspace.applyEdit(edit)) moveError = t('VS Code did not complete the move.')
    } catch (error) {
      moveError = String(error)
    }
    logOperation('move.diskEdit', { preflightMs: editing - started, elapsedMs: Date.now() - editing, error: moveError })
    const { completed, inspected } = moveError === undefined
      ? { completed: renames, inspected: true }
      : await inspectPartialMove(renames)
    const warnings: string[] = []
    try {
      await updateFavoritePaths(completed, group)
    } catch (error) {
      console.error('Files moved but updating favorites failed:', error)
      warnings.push(t('Files were moved, but favorites could not be updated: {0}', (error as Error).message))
    }
    if (moveError !== undefined) {
      const status = inspected
        ? t('Move interrupted. Completed {0} of {1} item(s): {2}. Check both folders before retrying.', completed.length, renames.length, completed.map(({ newUri }) => newUri.fsPath).join(', ') || '—')
        : t('Move interrupted. Some paths could not be checked. Inspect both folders before retrying.')
      throw new Error([status, moveError, ...warnings].join('\n'))
    }
    logOperation('move.completed', { moved: completed.length, destination: destination.toString(), elapsedMs: Date.now() - started, warnings })
    return { moved: completed.length, cancelled: false, destination, warnings }
  } catch (error) {
    logOperation('move.failed', { destination: destination.toString(), error: String(error) })
    throw error
  } finally {
    pendingMove = undefined
  }
}

export function moveOutcomeMessage(result: MoveOutcome): string {
  if (result.warnings.length) return result.warnings.join('\n')
  return result.moved
    ? t('Moved {0} item(s) to {1}. Favorites follow their actual paths.', result.moved, result.destination.fsPath)
    : t('The files are already at {0}; no disk move was needed.', result.destination.fsPath)
}

async function inspectPartialMove(renames: readonly ResourceRename[]) {
  const completed: ResourceRename[] = []
  let inspected = true
  for (const rename of renames) {
    try {
      if (!(await resourceExists(rename.oldUri)) && await resourceExists(rename.newUri)) completed.push(rename)
    } catch (error) {
      inspected = false
      console.error('Error inspecting a partial move:', error)
    }
  }
  return { completed, inspected }
}

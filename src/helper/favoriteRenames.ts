import * as vscode from 'vscode'
import configMgr from './configMgr'
import { isEqualOrParent, resourcePathToUri, serializeFavoriteUri, uriKey, isFileSystemUri, newFavoritePath } from './resourcePaths'
import type { ItemInSettingsJson } from '../model'
import { DEFAULT_GROUP } from '../enum'
import { logOperation } from './diagnostics'

export type ResourceRename = { readonly oldUri: vscode.Uri; readonly newUri: vscode.Uri }

let pending: Promise<void> = Promise.resolve()
type FavoriteEntry = ItemInSettingsJson | string
const renamed = new vscode.EventEmitter<readonly ResourceRename[]>()
const deleted = new vscode.EventEmitter<readonly vscode.Uri[]>()
export const onResourcesRenamed = renamed.event
export const onResourcesDeleted = deleted.event

function mutateFavorites(transform: (resources: FavoriteEntry[]) => FavoriteEntry[]): Promise<void> {
  const operation = pending.then(async () => {
    const resources = ((await configMgr.get('resources')) as FavoriteEntry[]) || []
    const updated = transform(resources)
    if (updated !== resources) await configMgr.save('resources', updated)
  })
  pending = operation.catch(() => {})
  return operation
}

export function updateFavoritePaths(renames: readonly ResourceRename[]): Promise<void> {
  return mutateFavorites((resources) => {
    let changed = false
    const updated = resources.map((resource) => {
      const filePath = typeof resource === 'string' ? resource : resource.filePath
      const uri = resourcePathToUri(filePath)
      const rename = renames.find(({ oldUri }) => isEqualOrParent(uri, oldUri))
      if (!rename) return resource
      const suffix = uri.path.slice(rename.oldUri.path.replace(/\/+$/, '').length)
      const next = rename.newUri.with({ path: rename.newUri.path.replace(/\/+$/, '') + suffix })
      const newPath = serializeFavoriteUri(next, filePath)
      if (newPath === filePath) return resource
      changed = true
      return typeof resource === 'string' ? newPath : { ...resource, filePath: newPath }
    })
    return changed ? updated : resources
  }).then(() => { if (renames.length) renamed.fire(renames) })
}

export async function organizeFavoriteTargets(targets: readonly vscode.Uri[], group: string, addMissing: readonly vscode.Uri[] = targets): Promise<number> {
  const resources = ((await configMgr.get('resources')) as FavoriteEntry[]) || []
  const coveringFolders = new Map<string, vscode.Uri>()
  for (const entry of resources) {
    if ((typeof entry === 'string' ? DEFAULT_GROUP : entry.group) !== group) continue
    const uri = resourcePathToUri(typeof entry === 'string' ? entry : entry.filePath)
    if (!isFileSystemUri(uri) || targets.some((target) => isEqualOrParent(uri, target))) continue
    try {
      if ((await vscode.workspace.fs.stat(uri)).type & vscode.FileType.Directory) coveringFolders.set(uriKey(uri), uri)
    } catch (error) {
      logOperation('favorites.coverageUnavailable', { uri: uri.toString(), error: String(error) })
    }
  }
  let organized = 0
  const mayAdd = new Set(addMissing.map(uriKey))
  await mutateFavorites((latest) => {
    const current = latest.filter((entry) => (typeof entry === 'string' ? DEFAULT_GROUP : entry.group) === group)
    const present = new Set(current.map((entry) => uriKey(resourcePathToUri(typeof entry === 'string' ? entry : entry.filePath))))
    const folders = [...coveringFolders.values()].filter((uri) => present.has(uriKey(uri)))
    const additions: FavoriteEntry[] = []
    for (const target of targets) {
      if (folders.some((folder) => isEqualOrParent(target, folder))) {
        organized++
      }
      if (mayAdd.has(uriKey(target)) && !present.has(uriKey(target))) {
        additions.push({ filePath: newFavoritePath(target), group })
        present.add(uriKey(target))
      }
    }
    return additions.length ? [...latest, ...additions] : latest
  })
  logOperation('favorites.organized', { group, organized, targets: targets.map((uri) => uri.toString()) })
  return organized
}

export function removeDeletedFavorites(uris: readonly vscode.Uri[]): Promise<void> {
  return mutateFavorites((resources) => {
    const filtered = resources.filter((entry) => {
      const uri = resourcePathToUri(typeof entry === 'string' ? entry : entry.filePath)
      return !uris.some((parent) => isEqualOrParent(uri, parent))
    })
    return filtered.length === resources.length ? resources : filtered
  }).finally(() => { if (uris.length) deleted.fire(uris) })
}

import * as vscode from 'vscode'
import configMgr from './configMgr'
import { isEqualOrParent, resourcePathToUri, serializeFavoriteUri, uriKey, newFavoritePath } from './resourcePaths'
import type { ItemInSettingsJson } from '../model'
import { DEFAULT_GROUP } from '../enum'

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

export function updateFavoritePaths(renames: readonly ResourceRename[], addToGroup?: string): Promise<void> {
  if (!renames.length) return Promise.resolve()
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
    if (addToGroup !== undefined) {
      const present = new Set(updated
        .filter((entry) => (typeof entry === 'string' ? DEFAULT_GROUP : entry.group) === addToGroup)
        .map((entry) => uriKey(resourcePathToUri(typeof entry === 'string' ? entry : entry.filePath))))
      for (const { newUri } of renames) {
        const key = uriKey(newUri)
        if (present.has(key)) continue
        updated.push({ filePath: newFavoritePath(newUri), group: addToGroup })
        present.add(key)
        changed = true
      }
    }
    return changed ? updated : resources
  }).finally(() => renamed.fire(renames))
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

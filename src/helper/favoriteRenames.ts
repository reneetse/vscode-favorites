import * as vscode from 'vscode'
import configMgr from './configMgr'
import { isEqualOrParent, resourcePathToUri, serializeFavoriteUri } from './resourcePaths'
import type { ItemInSettingsJson } from '../model'

export type ResourceRename = { readonly oldUri: vscode.Uri; readonly newUri: vscode.Uri }

let pending: Promise<void> = Promise.resolve()

export function updateFavoritePaths(renames: readonly ResourceRename[]): Promise<void> {
  const operation = pending.then(async () => {
    const resources = ((await configMgr.get('resources')) as (ItemInSettingsJson | string)[]) || []
    let changed = false
    const updated = resources.map((resource) => {
      const filePath = typeof resource === 'string' ? resource : resource.filePath
      const uri = resourcePathToUri(filePath)
      const rename = renames.find(({ oldUri }) => isEqualOrParent(uri, oldUri))
      if (!rename) return resource
      const suffix = uri.path.slice(rename.oldUri.path.replace(/\/$/, '').length)
      const next = rename.newUri.with({ path: rename.newUri.path.replace(/\/$/, '') + suffix })
      const newPath = serializeFavoriteUri(next, filePath)
      if (newPath === filePath) return resource
      changed = true
      return typeof resource === 'string' ? newPath : { ...resource, filePath: newPath }
    })
    if (changed) await configMgr.save('resources', updated)
  })
  pending = operation.catch(() => {})
  return operation
}

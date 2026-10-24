import * as vscode from 'vscode'
import type { Resource } from '../provider/FavoritesProvider'
import configMgr from '../helper/configMgr'
import { getCurrentResources, resourcePathToUri } from '../helper/util'
import { getSelectedTargets, getSelectedUris } from '../helper/selection'
import { DEFAULT_GROUP } from '../enum'

export function deleteFavorite() {
  return vscode.commands.registerCommand(
    'favorites.deleteFavorite',
    async (value?: Resource | vscode.Uri, selected?: readonly (Resource | vscode.Uri)[]) => {
      try {
        if (
          getSelectedTargets(value, selected).some(
            (item) => 'contextValue' in item && item.contextValue?.includes('resourceChild'),
          )
        ) {
          return vscode.window.showWarningMessage(
            'Only top-level favorites can be removed. Please select favorite entries, not folder contents.',
          )
        }
        const uris = getSelectedUris(value, selected)
        if (!uris.length) {
          return vscode.window.showWarningMessage('You have to choose a resource first')
        }
        const paths = new Set(uris.map((uri) => uri.toString()))
        const currentGroup = ((await configMgr.get('currentGroup')) as string) || DEFAULT_GROUP
        const resources = await getCurrentResources()
        await configMgr.save(
          'resources',
          resources.filter(
            (item) => item.group !== currentGroup || !paths.has(resourcePathToUri(item.filePath).toString()),
          ),
        )
      } catch (error) {
        console.error('Error deleting from favorites:', error)
        vscode.window.showErrorMessage('Failed to delete resource from favorites')
      }
    },
  )
}

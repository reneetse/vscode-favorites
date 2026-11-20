import { t } from '../helper/i18n'
import * as vscode from 'vscode'
import type { Resource } from '../provider/FavoritesProvider'
import configMgr from '../helper/configMgr'
import { getCurrentResources, resourcePathToUri } from '../helper/util'
import { getSelectedTargets, getSelectedUris } from '../helper/selection'
import { DEFAULT_GROUP } from '../enum'
import { uriKey } from '../helper/resourcePaths'

export function deleteFavorite() {
  return vscode.commands.registerCommand(
    'favorites.deleteFavorite',
    async (value?: Resource | vscode.Uri, selected?: readonly (Resource | vscode.Uri)[]) => {
      try {
        const uris = getSelectedUris(value, selected)
        if (!uris.length) {
          return vscode.window.showWarningMessage(t('You have to choose a resource first'))
        }
        const paths = new Set(uris.map(uriKey))
        const currentGroup = ((await configMgr.get('currentGroup')) as string) || DEFAULT_GROUP
        const resources = await getCurrentResources()
        if (getSelectedTargets(value, selected).some((item) =>
          'contextValue' in item && item.contextValue?.includes('resourceChild') && !resources.some((entry) =>
            entry.group === currentGroup && uriKey(resourcePathToUri(entry.filePath)) === uriKey(item.resourceUri)),
        )) {
          return vscode.window.showWarningMessage(t('Only top-level or independently favorited entries can be removed. Folder contents are not separate favorites.'))
        }
        await configMgr.save(
          'resources',
          resources.filter(
            (item) => item.group !== currentGroup || !paths.has(uriKey(resourcePathToUri(item.filePath))),
          ),
        )
      } catch (error) {
        console.error('Error deleting from favorites:', error)
        vscode.window.showErrorMessage(t('Failed to delete resource from favorites'))
      }
    },
  )
}

import * as vscode from 'vscode'
import { addFavoriteUris } from '../helper/util'
import { getSelectedUris } from '../helper/selection'
import configMgr from '../helper/configMgr'
import { DEFAULT_GROUP } from '../enum'

export function addToFavorites() {
  return vscode.commands.registerCommand(
    'favorites.addToFavorites',
    async (fileUri?: vscode.Uri, selected?: readonly vscode.Uri[]) => {
      try {
        const uris = getSelectedUris(fileUri, selected)
        if (!uris.length) {
          return vscode.window.showWarningMessage('You have to choose a resource first')
        }
        const currentGroup = ((await configMgr.get('currentGroup')) as string) || DEFAULT_GROUP
        await addFavoriteUris(uris, currentGroup)

        const groups = (await configMgr.get('groups')) as string[]
        if (!groups || groups.length === 0) {
          await configMgr.save('groups', [DEFAULT_GROUP])
        }
      } catch (error) {
        console.error('Error adding to favorites:', error)
        vscode.window.showErrorMessage('Failed to add resource to favorites')
      }
    },
  )
}

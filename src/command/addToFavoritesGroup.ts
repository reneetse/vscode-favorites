import * as vscode from 'vscode'
import { addFavoriteUris } from '../helper/util'
import { getSelectedUris } from '../helper/selection'
import configMgr from '../helper/configMgr'

export function addToFavoritesGroup() {
  return vscode.commands.registerCommand(
    'favorites.addToFavoritesGroup',
    async (fileUri?: vscode.Uri, selected?: readonly vscode.Uri[]) => {
      try {
        const uris = getSelectedUris(fileUri, selected)
        if (!uris.length) {
          return vscode.window.showWarningMessage('You have to choose a resource first')
        }
        const groups = (await configMgr.get('groups')) as string[]
        if (!groups || groups.length === 0) {
          return vscode.window.showErrorMessage('No groups found')
        }
        const selectedGroup = await vscode.window.showQuickPick(groups, {
          placeHolder: 'Select a group to add to',
        })
        if (!selectedGroup) {
          return
        }

        await addFavoriteUris(uris, selectedGroup)
        await configMgr.save('currentGroup', selectedGroup)
        await vscode.commands.executeCommand('favorites.nav.refresh')
        vscode.window.showInformationMessage(`Added to group: ${selectedGroup}`)
      } catch (error) {
        console.error('Error adding to favorites:', error)
        vscode.window.showErrorMessage('Failed to add resource to favorites')
      }
    },
  )
}

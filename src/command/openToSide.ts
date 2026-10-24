import * as vscode from 'vscode'
import type { Resource } from '../provider/FavoritesProvider'
import { getSelectedUris } from '../helper/selection'

export function openToSide() {
  return vscode.commands.registerCommand(
    'favorites.openToSide',
    async function (value?: Resource, selected?: readonly Resource[]) {
      const uris = getSelectedUris(value, selected)
      if (!uris.length) {
        return vscode.window.showWarningMessage('You have to choose a resource first')
      }
      for (const uri of uris) {
        await vscode.commands.executeCommand('vscode.open', uri, {
          viewColumn: vscode.ViewColumn.Beside,
          preserveFocus: true,
          preview: false,
        })
      }
    },
  )
}

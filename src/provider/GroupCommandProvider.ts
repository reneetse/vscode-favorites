import * as vscode from 'vscode'
import configMgr from '../helper/configMgr'
import { getSelectedUris } from '../helper/selection'
import { addFavoriteUris } from '../helper/util'

export class GroupCommandProvider implements vscode.Disposable {
  private disposables: vscode.Disposable[] = []
  private isUpdating = false

  constructor() {
    // Register command dynamic provider
    this.updateGroupCommands()

    // Listen for group changes
    configMgr.onConfigChange(() => {
      this.updateGroupCommands()
    })
  }

  private async updateGroupCommands() {
    // Prevent concurrent updates
    if (this.isUpdating) {
      return
    }

    try {
      this.isUpdating = true

      // Clear existing disposables
      this.disposables.forEach((d) => d.dispose())
      this.disposables = []

      // Get current groups
      const value = await configMgr.get('groups')
      const groups = Array.isArray(value) ? value.filter((item: any) => typeof item === 'string') : []

      if (groups && groups.length > 0) {
        for (const group of groups) {
          try {
            // Register command for each group
            const disposable = vscode.commands.registerCommand(
              `favorites.addToFavorites.${group}`,
              async (fileUri?: vscode.Uri, selected?: readonly vscode.Uri[]) => {
                try {
                  const uris = getSelectedUris(fileUri, selected)
                  if (!uris.length) {
                    return vscode.window.showWarningMessage('You have to choose a resource first')
                  }
                  await addFavoriteUris(uris, group)

                  // Switch current group to the selected group
                  await configMgr.save('currentGroup', group)

                  // Refresh the favorites view
                  await vscode.commands.executeCommand('favorites.nav.refresh')
                } catch (error) {
                  console.error('Error adding to favorites:', error)
                  vscode.window.showErrorMessage('Failed to add resource to favorites')
                }
              },
            )

            this.disposables.push(disposable)
          } catch (error) {
            // Command already exists, skip
            console.log(`Command favorites.addToFavorites.${group} already exists, skipping`)
          }
        }
      }
    } catch (error) {
      console.error('Error updating group commands:', error)
    } finally {
      this.isUpdating = false
    }
  }

  dispose() {
    this.disposables.forEach((d) => d.dispose())
  }
}

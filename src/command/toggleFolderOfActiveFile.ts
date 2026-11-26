import { t } from '../helper/i18n'
import * as vscode from 'vscode'
import configMgr from '../helper/configMgr'
import { getCurrentResources } from '../helper/util'
import { isFileSystemUri, newFavoritePath, parentDirectory } from '../helper/resourcePaths'
import { DEFAULT_GROUP } from '../enum'

export function toggleFolderOfActiveFile() {
  return vscode.commands.registerCommand('favorites.toggleFolderOfActiveFile', async () => {
    try {
      // Get active editor
      const editor = vscode.window.activeTextEditor
      if (!editor) {
        vscode.window.showInformationMessage(t('No active editor found'))
        return
      }

      const resourceUri = editor.document.uri
      const normalizedFolderPath = isFileSystemUri(resourceUri)
        ? newFavoritePath(parentDirectory(resourceUri))
        : resourceUri.toString()

      // Get current resources
      const resources = await getCurrentResources()
      const resourceIndex = resources.findIndex((r) => r.filePath === normalizedFolderPath)

      if (resourceIndex >= 0) {
        // Remove from favorites
        resources.splice(resourceIndex, 1)
        await configMgr.save('resources', resources)
        vscode.window.showInformationMessage(t('Removed folder from favorites'))
      } else {
        // Add to favorites
        const currentGroup = ((await configMgr.get('currentGroup')) as string) || DEFAULT_GROUP
        resources.push({ filePath: normalizedFolderPath, group: currentGroup })
        await configMgr.save('resources', resources)
        vscode.window.showInformationMessage(t('Added folder to favorites'))
      }

      // Refresh favorites view
      await vscode.commands.executeCommand('favorites.nav.refresh')
    } catch (error) {
      console.error('Error toggling folder favorite:', error)
      vscode.window.showErrorMessage(t('Failed to toggle folder favorite status'))
    }
  })
}

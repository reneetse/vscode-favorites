import * as vscode from 'vscode'
import type { Resource, FavoritesProvider } from '../provider/FavoritesProvider'
import { getSelectedUris } from '../helper/selection'
import { getTargetDirectory, moveResources, resourceExists } from '../helper/fileOperations'
import { t } from '../helper/i18n'

export function newFolder(provider: FavoritesProvider) {
  return vscode.commands.registerCommand('favorites.newFolder', async (value?: Resource) => {
    try {
      const uri = getSelectedUris(value)[0]
      if (!uri) return vscode.window.showWarningMessage(t('You have to choose a resource first'))
      const directory = await getTargetDirectory(uri)
      const name = await vscode.window.showInputBox({ title: t('Enter the new folder name') })
      if (name === undefined) return
      if (!name.trim() || name !== name.trim() || /[\\/<>:"|?*\x00-\x1f]/.test(name) || /[. ]$/.test(name) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) {
        throw new Error(t('Enter a single valid folder name, without path separators.'))
      }
      const folder = vscode.Uri.joinPath(directory, name)
      if (await resourceExists(folder)) throw new Error(t('A file or folder named "{0}" already exists.', name))
      await vscode.workspace.fs.createDirectory(folder)
      provider.refresh()
      vscode.window.showInformationMessage(t('Created folder: {0}', name))
    } catch (error) {
      console.error('Error creating folder:', error)
      vscode.window.showErrorMessage(t('Failed to create folder: {0}', (error as Error).message))
    }
  })
}

export function moveToFolder(provider: FavoritesProvider) {
  return vscode.commands.registerCommand('favorites.moveToFolder', async (value?: Resource, selected?: readonly Resource[]) => {
    try {
      const uris = getSelectedUris(value, selected)
      if (!uris.length) return vscode.window.showWarningMessage(t('You have to choose a resource first'))
      const folders = await vscode.window.showOpenDialog({
        title: t('Select the destination folder'),
        openLabel: t('Move here'),
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        defaultUri: await getTargetDirectory(uris[0]),
      })
      if (!folders?.length) return
      const count = await moveResources(uris, folders[0])
      provider.refresh()
      vscode.window.showInformationMessage(count ? t('Moved {0} item(s).', count) : t('The selected items are already in this folder.'))
    } catch (error) {
      console.error('Error moving files:', error)
      provider.refresh()
      vscode.window.showErrorMessage(t('Failed to move files: {0}', (error as Error).message))
    }
  })
}

import * as vscode from 'vscode'
import * as path from 'path'
import { getCurrentResources } from '../helper/util'
import { resourcePathToUri, uriKey, isFileSystemUri, parentDirectory } from '../helper/resourcePaths'
import type { Resource, FavoritesProvider } from '../provider/FavoritesProvider'
import { getSelectedUris } from '../helper/selection'
import { getTargetDirectory, moveResources, resourceExists, moveOutcomeMessage } from '../helper/fileOperations'
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

async function selectDestination(uris: readonly vscode.Uri[]): Promise<vscode.Uri | undefined> {
  const directory = await getTargetDirectory(uris[0])
  const currentParent = parentDirectory(uris[0])
  const parent = parentDirectory(currentParent)
  const choices = new Map<string, { label: string; description: string; value: string; uri: vscode.Uri }>()
  choices.set(uriKey(parent), { label: t('Parent folder'), description: parent.fsPath, value: parent.toString(), uri: parent })
  for (const item of await getCurrentResources()) {
    const uri = resourcePathToUri(item.filePath)
    if (!isFileSystemUri(uri) || choices.has(uriKey(uri))) continue
    try {
      if ((await vscode.workspace.fs.stat(uri)).type & vscode.FileType.Directory) {
        choices.set(uriKey(uri), { label: path.posix.basename(uri.path) || uri.fsPath, description: uri.fsPath, value: uri.toString(), uri })
      }
    } catch { /* A stale favorite is not a destination. */ }
  }
  const choice = await vscode.window.showQuickPick([
    ...choices.values(),
    { label: t('Choose another folder...'), description: '', value: 'browse', uri: undefined },
  ], { title: t('Select the destination folder'), placeHolder: t('Paths shown below are the actual destination folders.') })
  if (!choice) return
  if (choice.value !== 'browse') return choice.uri
  return (await vscode.window.showOpenDialog({
    title: t('Select the destination folder'), openLabel: t('Move here'),
    canSelectFiles: false, canSelectFolders: true, canSelectMany: false, defaultUri: directory,
  }))?.[0]
}

function registerMove(provider: FavoritesProvider, toParent: boolean) {
  return vscode.commands.registerCommand(toParent ? 'favorites.moveToParentFolder' : 'favorites.moveToFolder', async (value?: Resource, selected?: readonly Resource[]) => {
    try {
      const uris = getSelectedUris(value, selected)
      if (!uris.length) return vscode.window.showWarningMessage(t('You have to choose a resource first'))
      const parents = new Map(uris.map((uri) => {
        const current = parentDirectory(uri)
        const parent = parentDirectory(current)
        if (toParent && uriKey(current) === uriKey(parent)) throw new Error(t('There is no parent destination above this filesystem root.'))
        return [uriKey(parent), parent] as const
      }))
      if (toParent && parents.size !== 1) throw new Error(t('Select items with the same parent destination.'))
      const destination = toParent ? [...parents.values()][0] : await selectDestination(uris)
      if (!destination) return
      const result = await moveResources(uris, destination)
      provider.refresh()
      if (!result.cancelled) {
        if (result.warnings.length) vscode.window.showWarningMessage(moveOutcomeMessage(result))
        else vscode.window.showInformationMessage(moveOutcomeMessage(result))
      }
    } catch (error) {
      console.error('Error moving files:', error)
      provider.refresh()
      vscode.window.showErrorMessage(t('Failed to move files: {0}', (error as Error).message))
    }
  })
}

export function moveToFolder(provider: FavoritesProvider) { return registerMove(provider, false) }
export function moveToParentFolder(provider: FavoritesProvider) { return registerMove(provider, true) }

// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode'
import { FavoritesProvider } from './provider/FavoritesProvider'
import { GroupCommandProvider } from './provider/GroupCommandProvider'
import configMgr from './helper/configMgr'
import { updateFavoritePaths } from './helper/favoriteRenames'
import { t, getLanguage } from './helper/i18n'
import { registerLocalizedCommands } from './helper/localizedCommands'

import {
  addToFavorites,
  addToFavoritesGroup,
  addNewGroup,
  deleteFavorite,
  toggleFavorite,
  toggleFolderOfActiveFile,
  moveUp,
  moveDown,
  moveToTop,
  moveToBottom,
  refresh,
  toggleSort,
  changeGroup,
  revealInOS_mac,
  revealInOS_windows,
  revealInOS_other,
  revealInSideBar,
  openToSide,
  copyFileName,
  copyFilePath,
  copyRelativePath,
  open,
  stage,
  newFolder,
  moveToFolder,
} from './command'

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  // Use the console to output diagnostic information (console.log) and errors (console.error)
  // This line of code will only be executed once when your extension is activated
  console.log('Congratulations, your extension "favorites" is now active!')

  vscode.commands.executeCommand('setContext', 'ext:allFavoriteViews', ['favorites', 'favorites-full-view'])

  const favoritesProvider = new FavoritesProvider()
  const groupCommandProvider = new GroupCommandProvider()

  // Add to context subscriptions
  context.subscriptions.push(groupCommandProvider)

  const explorerTree = vscode.window.createTreeView('favorites', {
    treeDataProvider: favoritesProvider,
    canSelectMany: true,
    showCollapseAll: true,
    dragAndDropController: favoritesProvider,
  })
  const tree = vscode.window.createTreeView('favorites-full-view', {
    treeDataProvider: favoritesProvider,
    canSelectMany: true,
    showCollapseAll: true,
    dragAndDropController: favoritesProvider,
  })

  const updateViewLanguage = async () => {
    await vscode.commands.executeCommand('setContext', 'ext:favoritesEnglish', getLanguage() === 'en')
    const currentGroup = ((await configMgr.get('currentGroup')) as string) || 'Default'
    for (const view of [explorerTree, tree]) {
      view.title = t('Favorites')
      view.message = t('Current Group: {0}', currentGroup)
    }
  }
  context.subscriptions.push(configMgr.onConfigChange(() => {
    void updateViewLanguage()
    favoritesProvider.refresh()
  }))
  void updateViewLanguage()
  context.subscriptions.push(explorerTree, tree)

  vscode.workspace.onDidChangeConfiguration(
    async () => {
      await updateViewLanguage()
      favoritesProvider.refresh()
    },
    undefined,
    context.subscriptions,
  )
  vscode.workspace.onDidSaveTextDocument(
    () => favoritesProvider.refresh(),
    undefined,
    context.subscriptions,
  )

  // Listen for file rename events to update favorites
  vscode.workspace.onDidRenameFiles(
    async (event) => {
      try {
        await updateFavoritePaths(event.files)
      } catch (error) {
        console.error('Error updating favorites after rename:', error)
        vscode.window.showErrorMessage(t('Failed to update favorites after rename: {0}', (error as Error).message))
      } finally {
        favoritesProvider.refresh()
      }
    },
    undefined,
    context.subscriptions,
  )

  context.subscriptions.push(...registerLocalizedCommands())
  context.subscriptions.push(addToFavorites())
  context.subscriptions.push(addToFavoritesGroup())
  context.subscriptions.push(deleteFavorite())
  context.subscriptions.push(toggleFavorite())
  context.subscriptions.push(toggleFolderOfActiveFile())
  context.subscriptions.push(revealInOS_mac())
  context.subscriptions.push(revealInOS_windows())
  context.subscriptions.push(revealInOS_other())
  context.subscriptions.push(revealInSideBar())
  context.subscriptions.push(openToSide())
  context.subscriptions.push(copyFileName())
  context.subscriptions.push(copyFilePath())
  context.subscriptions.push(copyRelativePath())
  context.subscriptions.push(newFolder(favoritesProvider))
  context.subscriptions.push(moveToFolder(favoritesProvider))
  context.subscriptions.push(stage())
  context.subscriptions.push(stage(true))
  context.subscriptions.push(open(favoritesProvider))
  context.subscriptions.push(moveUp(favoritesProvider))
  context.subscriptions.push(moveDown(favoritesProvider))
  context.subscriptions.push(moveToTop(favoritesProvider))
  context.subscriptions.push(moveToBottom(favoritesProvider))
  context.subscriptions.push(refresh(favoritesProvider))
  context.subscriptions.push(toggleSort(favoritesProvider))
  context.subscriptions.push(changeGroup(favoritesProvider))
  context.subscriptions.push(addNewGroup(favoritesProvider))
}

// this method is called when your extension is deactivated
export function deactivate() {}

// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode'
import { FavoritesProvider } from './provider/FavoritesProvider'
import { GroupCommandProvider } from './provider/GroupCommandProvider'
import configMgr from './helper/configMgr'
import { updateFavoritePaths, onResourcesRenamed, onResourcesDeleted } from './helper/favoriteRenames'
import { t, getLanguage } from './helper/i18n'
import { registerLocalizedCommands } from './helper/localizedCommands'
import { initializeDiagnostics, logOperation } from './helper/diagnostics'
import { FileActivity } from './helper/fileActivity'
import { AutoReveal } from './helper/autoReveal'

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
  moveToParentFolder,
  deleteFiles,
} from './command'

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  // Use the console to output diagnostic information (console.log) and errors (console.error)
  // This line of code will only be executed once when your extension is activated
  console.log('Congratulations, your extension "favorites" is now active!')

  vscode.commands.executeCommand('setContext', 'ext:allFavoriteViews', ['favorites', 'favorites-full-view'])

  initializeDiagnostics(context)
  logOperation('extension.started', {
    version: context.extension?.packageJSON.version || 'development',
    workspaceFolders: vscode.workspace.workspaceFolders?.map((folder) => folder.uri.toString()) || [],
  })
  const activity = new FileActivity(context.workspaceState, (): Promise<void> => favoritesProvider.refresh())
  const favoritesProvider = new FavoritesProvider(activity)
  context.subscriptions.push(activity)
  context.subscriptions.push(onResourcesRenamed((renames) => activity.remap(renames)))
  context.subscriptions.push(onResourcesDeleted((uris) => activity.remove(uris)))
  context.subscriptions.push(vscode.window.onDidChangeVisibleTextEditors(async (editors) => {
    await activity.markOpened(editors.map((editor) => editor.document.uri))
  }))
  activity.start()
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
  const autoReveal = new AutoReveal(favoritesProvider, [explorerTree, tree])
  context.subscriptions.push(autoReveal)

  let lastGroup: string | undefined
  let lastLanguage: string | undefined
  let hasResources: boolean | undefined
  let viewRevision = 0
  const updateViewState = async () => {
    const revision = ++viewRevision
    const [group, resources] = await Promise.all([configMgr.get('currentGroup'), configMgr.get('resources')])
    if (revision !== viewRevision) return false
    const currentGroup = typeof group === 'string' && group ? group : 'Default'
    const language = getLanguage()
    const groupChanged = lastGroup !== currentGroup
    const languageChanged = lastLanguage !== language
    const present = Array.isArray(resources) && resources.length > 0
    if (present !== hasResources) {
      hasResources = present
      void vscode.commands.executeCommand('setContext', 'ext:favoritesHasResources', present)
    }
    if (languageChanged) {
      lastLanguage = language
      void vscode.commands.executeCommand('setContext', 'ext:favoritesEnglish', language === 'en')
    }
    lastGroup = currentGroup
    for (const view of [explorerTree, tree]) {
      if (languageChanged) view.title = t('Favorites')
      if (languageChanged || groupChanged) view.message = t('Current Group: {0}', currentGroup)
    }
    return groupChanged
  }
  context.subscriptions.push(configMgr.onConfigChange(async () => {
    activity.invalidate()
    const groupChanged = await updateViewState()
    await favoritesProvider.refresh()
    if (groupChanged) await autoReveal.sync()
  }))
  void updateViewState()
  context.subscriptions.push(explorerTree, tree)

  vscode.workspace.onDidChangeConfiguration(
    async (event) => {
      if (!event.affectsConfiguration('favorites') && !event.affectsConfiguration('files.exclude')) return
      activity.invalidate()
      activity.configure()
      const groupChanged = await updateViewState()
      await favoritesProvider.refresh()
      if (groupChanged || event.affectsConfiguration('favorites.autoReveal')) {
        await autoReveal.sync()
      }
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
  context.subscriptions.push(moveToParentFolder(favoritesProvider))
  context.subscriptions.push(deleteFiles(favoritesProvider))
  context.subscriptions.push(stage())
  context.subscriptions.push(stage(true))
  context.subscriptions.push(open(favoritesProvider))
  context.subscriptions.push(moveUp(favoritesProvider))
  context.subscriptions.push(moveDown(favoritesProvider))
  context.subscriptions.push(moveToTop(favoritesProvider))
  context.subscriptions.push(moveToBottom(favoritesProvider))
  context.subscriptions.push(refresh(favoritesProvider, activity))
  context.subscriptions.push(toggleSort(favoritesProvider))
  context.subscriptions.push(changeGroup(favoritesProvider))
  context.subscriptions.push(addNewGroup(favoritesProvider))
}

// this method is called when your extension is deactivated
export function deactivate() {}

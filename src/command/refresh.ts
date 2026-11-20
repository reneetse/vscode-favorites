import * as vscode from 'vscode'

import { Resource, FavoritesProvider } from '../provider/FavoritesProvider'
import type { FileActivity } from '../helper/fileActivity'

export function refresh(favoritesProvider: FavoritesProvider, activity?: FileActivity) {
  return vscode.commands.registerCommand('favorites.nav.refresh', async function () {
    if (activity) await activity.refresh()
    else await favoritesProvider.refresh()
  })
}

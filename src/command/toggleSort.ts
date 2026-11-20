import * as vscode from 'vscode'

import type { FavoritesProvider } from '../provider/FavoritesProvider'
import configMgr from '../helper/configMgr'
import { t } from '../helper/i18n'
import { getSortOrder } from '../helper/sortOrder'

export function toggleSort(provider: FavoritesProvider) {
  return vscode.commands.registerCommand('favorites.nav.sort', async () => {
    const current = await getSortOrder()
    const choices = [
      { value: 'ASC', label: t('Name (A–Z)') },
      { value: 'DESC', label: t('Name (Z–A)') },
      { value: 'MTIME_DESC', label: t('Recently modified first') },
      { value: 'MTIME_ASC', label: t('Oldest modified first') },
      { value: 'FILETYPE', label: t('File type') },
      { value: 'MANUAL', label: t('Manual order') },
    ].map((choice) => ({ ...choice, description: choice.value === current ? t('Current sort order') : undefined }))
    const choice = await vscode.window.showQuickPick(choices, { title: t('Choose a sort order') })
    if (!choice) return
    await configMgr.save('sortOrder', choice.value)
    provider.refresh()
  })
}

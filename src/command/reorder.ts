import * as vscode from 'vscode'
import type { FavoritesProvider, Resource } from '../provider/FavoritesProvider'
import configMgr from '../helper/configMgr'
import { getCurrentResources } from '../helper/util'
import { rejectBatchMove } from '../helper/selection'
import { uriKey } from '../helper/resourcePaths'
import { DEFAULT_GROUP } from '../enum'
import { t } from '../helper/i18n'

export function registerReorder(
  command: string,
  direction: 'up' | 'down' | 'top' | 'bottom',
  provider: FavoritesProvider,
) {
  return vscode.commands.registerCommand(command, async (target?: Resource, selected?: readonly Resource[]) => {
    if (!target) return vscode.window.showWarningMessage(t('You have to choose a resource first'))
    if (rejectBatchMove(target, selected)) return
    try {
      const group = ((await configMgr.get('currentGroup')) as string) || DEFAULT_GROUP
      const visible = await provider.getChildren()
      if (((await configMgr.get('currentGroup')) || DEFAULT_GROUP) !== group) return
      const resources = await getCurrentResources()
      const used = new Set<number>()
      const rows = visible.flatMap((item) => {
        const index = resources.findIndex((entry, index) =>
          !used.has(index) && entry.group === group && entry.filePath === item.value,
        )
        if (index < 0) return []
        used.add(index)
        return [{ item, index }]
      })
      let from = rows.findIndex(({ item }) => item.value === target.value)
      if (from < 0) from = rows.findIndex(({ item }) => uriKey(item.resourceUri) === uriKey(target.resourceUri))
      if (from < 0) return
      const to = direction === 'top' ? 0 : direction === 'bottom' ? rows.length - 1 : from + (direction === 'up' ? -1 : 1)
      if (to < 0 || to >= rows.length || from === to) return
      const ordered = rows.map(({ index }) => resources[index])
      ordered.splice(to, 0, ordered.splice(from, 1)[0])
      let next = 0
      const updated = resources.map((entry, index) => used.has(index) ? ordered[next++] : entry)
      await configMgr.save('resources', updated)
      await configMgr.save('sortOrder', 'MANUAL')
    } catch (error) {
      console.error('Error reordering favorites:', error)
      vscode.window.showErrorMessage(t('Failed to reorder favorites: {0}', (error as Error).message))
    }
  })
}

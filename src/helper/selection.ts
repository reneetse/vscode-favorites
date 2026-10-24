import * as vscode from 'vscode'
import type { Resource } from '../provider/FavoritesProvider'

export type SelectionTarget = Resource | vscode.Uri

function getTargetUri(target: SelectionTarget): vscode.Uri {
  return 'resourceUri' in target ? target.resourceUri : target
}

export function getSelectedTargets<T extends SelectionTarget>(
  target?: T,
  selected?: readonly T[],
): readonly T[] {
  if (!target || !(getTargetUri(target) instanceof vscode.Uri)) {
    return []
  }
  const uri = getTargetUri(target).toString()
  return selected?.some((item) => getTargetUri(item).toString() === uri) ? selected : [target]
}

export function getSelectedUris(
  target?: SelectionTarget,
  selected?: readonly SelectionTarget[],
): vscode.Uri[] {
  const targets = getSelectedTargets(target || vscode.window.activeTextEditor?.document.uri, selected)
  return [
    ...new Map(
      targets.map((item) => {
        const uri = getTargetUri(item)
        return [uri.toString(), uri] as const
      }),
    ).values(),
  ]
}

export function rejectBatchMove(target: Resource, selected?: readonly Resource[]): boolean {
  if (getSelectedTargets(target, selected).length <= 1) {
    return false
  }
  vscode.window.showInformationMessage('Batch moving is not supported. Please select a single item.')
  return true
}

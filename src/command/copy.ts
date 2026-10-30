import * as vscode from 'vscode'
import * as path from 'path'
import { EOL } from 'os'
import type { Resource } from '../provider/FavoritesProvider'
import { getSelectedUris } from '../helper/selection'

function registerCopyCommand(command: string, getText: (uri: vscode.Uri) => string) {
  return vscode.commands.registerCommand(
    command,
    async (value?: Resource, selected?: readonly Resource[]) => {
      const uris = getSelectedUris(value, selected)
      if (!uris.length) {
        return vscode.window.showWarningMessage('You have to choose a resource first')
      }
      await vscode.env.clipboard.writeText(uris.map(getText).join(EOL))
    },
  )
}

export function copyFileName() {
  return registerCopyCommand('favorites.copyFileName', (uri) => path.posix.basename(uri.path))
}

export function copyFilePath() {
  return registerCopyCommand('favorites.copyFilePath', (uri) =>
    uri.scheme === 'file' || uri.scheme === 'vscode-remote' ? uri.fsPath : uri.toString(),
  )
}

export function copyRelativePath() {
  return registerCopyCommand('favorites.copyRelativePath', (uri) =>
    uri.scheme === 'file' || uri.scheme === 'vscode-remote'
      ? vscode.workspace.asRelativePath(uri, false)
      : uri.toString(),
  )
}

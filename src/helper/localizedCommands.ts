import * as vscode from 'vscode'
import commandIds from '../i18n/commands.json'

export function registerLocalizedCommands(): vscode.Disposable[] {
  return commandIds.map((command) => vscode.commands.registerCommand(
    'favorites.localized.en.' + command.slice('favorites.'.length),
    (...args: unknown[]) => vscode.commands.executeCommand(command, ...args),
  ))
}

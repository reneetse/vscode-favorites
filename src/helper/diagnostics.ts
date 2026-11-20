import * as vscode from 'vscode'

let channel: vscode.LogOutputChannel | undefined

export function initializeDiagnostics(context: vscode.ExtensionContext): void {
  channel = vscode.window.createOutputChannel('Favorites', { log: true })
  context.subscriptions.push(channel)
  context.subscriptions.push(vscode.commands.registerCommand('favorites.showDiagnostics', () => channel?.show()))
}

export function logOperation(event: string, data: Record<string, unknown>): void {
  try { channel?.info(`${event} ${JSON.stringify(data)}`) } catch { /* Logging cannot change a completed filesystem operation. */ }
}

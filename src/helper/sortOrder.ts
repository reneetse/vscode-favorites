import * as vscode from 'vscode'
import configMgr from './configMgr'

export async function getSortOrder(): Promise<string> {
  const stored = await configMgr.get('sortOrder')
  // Older .vscfavoriterc files kept sorting in VS Code settings.
  return typeof stored === 'string'
    ? stored
    : vscode.workspace.getConfiguration('favorites').get<string>('sortOrder', 'ASC')
}

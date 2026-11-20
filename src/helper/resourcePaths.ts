import * as vscode from 'vscode'
import * as path from 'path'

export function isUriPath(value: string): boolean {
  return !path.isAbsolute(value) && !path.win32.isAbsolute(value) && /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)
}

export function resourcePathToUri(value: string): vscode.Uri {
  if (isUriPath(value)) return vscode.Uri.parse(value)
  const root = vscode.workspace.workspaceFolders?.[0]?.uri
  return vscode.Uri.file(path.isAbsolute(value) ? value : path.resolve(root?.fsPath || '.', value))
}

export function uriKey(uri: vscode.Uri): string {
  let normalized = uri.path.replace(/\/+$/, '') || '/'
  if (/^\/[a-z]:$/i.test(normalized)) normalized += '/'
  const key = isFileSystemUri(uri) ? uri.with({ path: normalized, query: '', fragment: '' }).toString() : uri.toString()
  return process.platform === 'win32' && isFileSystemUri(uri) ? key.toLowerCase() : key
}

export function isEqualOrParent(uri: vscode.Uri, parent: vscode.Uri): boolean {
  const childKey = uriKey(uri)
  const parentKey = uriKey(parent).replace(/\/$/, '')
  return childKey === parentKey || childKey.startsWith(parentKey + '/')
}

export function isFileSystemUri(uri: vscode.Uri): boolean {
  return uri.scheme === 'file' || uri.scheme === 'vscode-remote'
}

export function serializeFavoriteUri(uri: vscode.Uri, original: string): string {
  if (isUriPath(original) || uri.scheme !== 'file') return uri.toString()
  const root = vscode.workspace.workspaceFolders?.[0]?.uri
  if (!path.isAbsolute(original) && root && isEqualOrParent(uri, root)) {
    return path.relative(root.fsPath, uri.fsPath) || '.'
  }
  return uri.fsPath
}

export function newFavoritePath(uri: vscode.Uri): string {
  return serializeFavoriteUri(uri, (vscode.workspace.workspaceFolders?.length || 0) === 1 ? '.' : uri.fsPath)
}

export function parentDirectory(uri: vscode.Uri): vscode.Uri {
  const current = uri.path.replace(/\/+$/, '') || '/'
  if (/^\/[a-z]:$/i.test(current)) return uri.with({ path: current + '/' })
  if (uri.scheme === 'file' && uri.authority && current.split('/').filter(Boolean).length <= 1) {
    return uri.with({ path: current + '/' })
  }
  let parent = path.posix.dirname(current)
  if (/^\/[a-z]:$/i.test(parent)) parent += '/'
  return uri.with({ path: parent })
}

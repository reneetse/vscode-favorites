import * as vscode from 'vscode'
import * as path from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import type { GitExtension, Repository } from '../git'
import type { Resource } from '../provider/FavoritesProvider'
import { getSelectedUris } from '../helper/selection'
import { getGitApi } from '../helper/util'

const execFileAsync = promisify(execFile)

export function stage(force = false) {
  return vscode.commands.registerCommand(
    force ? 'favorites.forceStage' : 'favorites.stage',
    async (value?: Resource, selected?: readonly Resource[]) => {
      try {
        const uris = getSelectedUris(value, selected)
        if (!uris.length) {
          return vscode.window.showWarningMessage('Please select files to stage.')
        }
        const extension = vscode.extensions.getExtension<GitExtension>('vscode.git')
        if (!extension) {
          throw new Error('The built-in Git extension is not available.')
        }
        await extension.activate()
        const git = getGitApi()
        if (!git) {
          throw new Error('The built-in Git extension is not enabled.')
        }

        const repositories = new Map<Repository, vscode.Uri[]>()
        for (const uri of uris) {
          if (uri.scheme !== 'file' || !((await vscode.workspace.fs.stat(uri)).type & vscode.FileType.File)) {
            throw new Error(
              'Only files on this VS Code host can be staged. Please exclude folders and virtual resources.',
            )
          }
          const repository = git.getRepository(uri)
          if (!repository) {
            throw new Error(`No open Git repository contains ${uri.fsPath}.`)
          }
          const relative = path.relative(repository.rootUri.fsPath, uri.fsPath)
          if (
            !relative ||
            relative === '..' ||
            relative.startsWith('..' + path.sep) ||
            path.isAbsolute(relative)
          ) {
            throw new Error(`File is outside its Git repository: ${uri.fsPath}`)
          }
          const files = repositories.get(repository) || []
          files.push(uri)
          repositories.set(repository, files)
        }

        let completed = 0
        const failures: string[] = []
        const refreshFailures: string[] = []
        for (const [repository, files] of repositories) {
          for (const uri of files) {
            try {
              await execFileAsync(
                git.git.path,
                [
                  '--literal-pathspecs',
                  'add',
                  ...(force ? ['-f'] : []),
                  '--',
                  path.relative(repository.rootUri.fsPath, uri.fsPath),
                ],
                { cwd: repository.rootUri.fsPath },
              )
              completed++
            } catch (error) {
              console.error('Error staging file:', uri.fsPath, error)
              const message =
                (error as { stderr?: string; message?: string }).stderr || (error as Error).message
              failures.push(`${path.basename(uri.fsPath)}: ${message}`)
            }
          }
          try {
            await repository.status()
          } catch (error) {
            console.error('Error refreshing Git status:', repository.rootUri.fsPath, error)
            refreshFailures.push(repository.rootUri.fsPath)
          }
        }
        if (failures.length || refreshFailures.length) {
          const refreshMessage = refreshFailures.length
            ? ` Git status refresh failed for: ${refreshFailures.join(', ')}.`
            : ''
          vscode.window.showWarningMessage(
            `Git staging completed for ${completed} file(s); ${failures.length} failed. ${failures[0] || ''}${refreshMessage}`,
          )
        } else {
          vscode.window.showInformationMessage(`Git staging completed for ${completed} file(s).`)
        }
      } catch (error) {
        console.error('Error staging favorites:', error)
        vscode.window.showErrorMessage(`Failed to stage favorites: ${(error as Error).message}`)
      }
    },
  )
}

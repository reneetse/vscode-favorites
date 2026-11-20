import { t } from '../helper/i18n'
import * as vscode from 'vscode'

import { Resource, FavoritesProvider } from '../provider/FavoritesProvider'
import configMgr from '../helper/configMgr'
import { DEFAULT_GROUP } from '../enum'
import { getFirstGitRepository, getGitBranchName } from '../helper/util'

export function addNewGroup(favoritesProvider: FavoritesProvider) {
  return vscode.commands.registerCommand('favorites.group.newGroup', async function (value: Resource) {
    const isGitUsed = !!getFirstGitRepository()

    let branchName: string = 'no_git_master'
    if (isGitUsed) {
      const gitBranchName = getGitBranchName()
      branchName = gitBranchName || branchName
    }

    const groups = (await configMgr.get('groups')) as string[]
    const previousGroups = Array.from(new Set((groups || []).concat([DEFAULT_GROUP])))

    vscode.window
      .showQuickPick(
        [t('Input new group name')].concat(!isGitUsed ? [] : [t('Create group with current branch name')]),
      )
      .then(async (label) => {
        if (label == t('Input new group name')) {
          vscode.window.showInputBox({ title: t('Input a name for new group') }).then(async (input) => {
            if (input) {
              await addNewGroupInConfig(input, previousGroups)
            }
          })
        } else if (label == t('Create group with current branch name')) {
          await addNewGroupInConfig(branchName, previousGroups)
        }
      })
  })
}

async function addNewGroupInConfig(name: string, previousGroups: Array<string>) {
  if (previousGroups.indexOf(name) === -1) {
    await configMgr.save('groups', previousGroups.concat([name]))
    await configMgr.save('currentGroup', name)
  } else {
    vscode.window.showErrorMessage(t('The group "{0}" already exists.', name))
  }
}

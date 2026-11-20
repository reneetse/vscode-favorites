import * as vscode from 'vscode'
import * as path from 'path'

import { getCurrentResources, isMultiRoots } from '../helper/util'
import configMgr from '../helper/configMgr'
import { resourcePathToUri, serializeFavoriteUri, uriKey, isEqualOrParent } from '../helper/resourcePaths'
import { moveResources, moveOutcomeMessage } from '../helper/fileOperations'
import { t, getLanguage } from '../helper/i18n'
import { getSortOrder } from '../helper/sortOrder'
import type { FileActivity } from '../helper/fileActivity'
import { DEFAULT_GROUP, FileStat } from '../enum'
import { Item, ItemInSettingsJson } from '../model'

const FAVORITES_MIME = 'application/vnd.howardzuo.vscode-favorites.resources+json'

export class FavoritesProvider
  implements vscode.TreeDataProvider<Resource>, vscode.TreeDragAndDropController<Resource>
{
  private _onDidChangeTreeData = new vscode.EventEmitter<Resource | void>()
  readonly onDidChangeTreeData: vscode.Event<Resource | void> = this._onDidChangeTreeData.event
  private parents = new Map<string, Resource | undefined>()
  private epoch = 0

  // Use for detecting doubleclick
  public lastOpened: { uri: vscode.Uri; date: Date } | undefined

  // Drag and drop mime types
  readonly dragMimeTypes = [FAVORITES_MIME]
  readonly dropMimeTypes = [FAVORITES_MIME, 'application/vnd.code.tree.uri', 'text/uri-list', 'text/plain']

  constructor(private activity?: FileActivity) {
    // Listen for changes to files.exclude configuration
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('files.exclude')) {
        this.refresh()
      }
    })
  }

  refresh(element?: Resource): void {
    this.epoch++
    this.parents.clear()
    if (element) {
      // Incremental update, only update the specified element
      this._onDidChangeTreeData.fire(element)
    } else {
      // Full update, update the entire tree
      this._onDidChangeTreeData.fire()
    }
  }

  getTreeItem(element: Resource): vscode.TreeItem {
    return element
  }

  private async descend(uri: vscode.Uri, root: Resource, cache = new Map<string, Promise<Resource[]>>(), epoch = this.epoch): Promise<Resource | undefined> {
    if (!isEqualOrParent(uri, root.resourceUri)) return
    let current = root
    const segments = uri.path.slice(root.resourceUri.path.replace(/\/+$/, '').length).split('/').filter(Boolean)
    for (const segment of segments) {
      if (epoch !== this.epoch) return
      const key = uriKey(current.resourceUri)
      let children = cache.get(key)
      if (!children) {
        children = this.getChildren(current)
        cache.set(key, children)
      }
      const nextUri = vscode.Uri.joinPath(current.resourceUri, segment)
      const next = (await children).find((child) => uriKey(child.resourceUri) === uriKey(nextUri))
      if (epoch !== this.epoch) return
      if (!next) return
      current = next
    }
    return current
  }

  async findResource(uri: vscode.Uri): Promise<Resource | undefined> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const epoch = this.epoch
      const roots = await this.getChildren()
      if (epoch !== this.epoch) continue
      const exact = roots.find((root) => uriKey(root.resourceUri) === uriKey(uri))
      if (exact) return exact
      const candidates = roots.filter((root) => root.contextValue.endsWith('.dir') && isEqualOrParent(uri, root.resourceUri))
        .sort((a, b) => b.resourceUri.path.length - a.resourceUri.path.length)
      const cache = new Map<string, Promise<Resource[]>>()
      for (const root of candidates) {
        const resource = await this.descend(uri, root, cache, epoch)
        if (resource) return resource
        if (epoch !== this.epoch) break
      }
      if (epoch === this.epoch) return
    }
  }

  async getParent(element: Resource): Promise<Resource | undefined> {
    const key = uriKey(element.resourceUri)
    if (!this.parents.has(key)) await this.findResource(element.resourceUri)
    return this.parents.get(key)
  }

  async getChildren(element?: Resource): Promise<Resource[]> {
    const epoch = this.epoch
    const currentGroup = ((await configMgr.get('currentGroup')) as string) || DEFAULT_GROUP
    if (element) {
      const children = await this.getChildrenResources({ filePath: element.value, group: currentGroup })
      const pinned = new Set((await getCurrentResources()).filter((item) => item.group === currentGroup)
        .map((item) => uriKey(resourcePathToUri(item.filePath))))
      for (const child of children) {
        if (pinned.has(uriKey(child.resourceUri))) child.contextValue = child.contextValue.replace(/(\.dir)?$/, '.pinned$1')
        if (epoch === this.epoch) this.parents.set(uriKey(child.resourceUri), element)
      }
      return children
    }
    const resources = (await getCurrentResources()).filter((item) => item.group === currentGroup)
    const sort = await getSortOrder()
    const items = await this.sortResources(resources, sort)
    const valid = items.filter((item) => item.stat !== FileStat.NEITHER)
    const unique = [...new Map(valid.map((item) => [uriKey(item.uri!), item])).values()]
    const roots: Item[] = []
    const cache = new Map<string, Promise<Resource[]>>()
    for (const item of unique) {
      let nested = false
      for (const parent of unique) {
        if (parent !== item && parent.stat === FileStat.DIRECTORY && isEqualOrParent(item.uri!, parent.uri!)) {
          if (await this.descend(item.uri!, this.createResource(parent, 'resource'), cache, epoch)) { nested = true; break }
        }
      }
      if (!nested) roots.push(item)
    }
    const result = this.data2Resource(roots, 'resource')
    if (epoch === this.epoch) for (const root of result) this.parents.set(uriKey(root.resourceUri), undefined)
    return result
  }

  private async getChildrenResources(item: ItemInSettingsJson): Promise<Array<Resource>> {
    const sort = await getSortOrder()

    const uri = resourcePathToUri(item.filePath)

    // Get files.exclude configuration
    const filesExclude =
      (vscode.workspace.getConfiguration('files').get('exclude') as Record<
        string,
        boolean | { when: string }
      >) || {}

    return vscode.workspace.fs
      .readDirectory(uri)
      .then((entries) => {
        // Filter out files excluded by files.exclude
        const filteredEntries = entries.filter(([name, type]) => {
          const entryPath = path.join(uri.fsPath, name)
          // Check if the file is excluded
          for (const [pattern, excludeConfig] of Object.entries(filesExclude)) {
            let shouldExclude = false

            if (typeof excludeConfig === 'boolean') {
              shouldExclude = excludeConfig
            } else if (typeof excludeConfig === 'object' && excludeConfig.when) {
              // Handle when clause
              const whenClause = excludeConfig.when
              // Simple implementation for $(basename) variable
              const basename = path.basename(entryPath, path.extname(entryPath))
              const extension = path.extname(entryPath)
              const resolvedWhenClause = whenClause.replace('$(basename)', basename)

              // For when clause, we need to check if the referenced file exists
              // e.g., "when": "$(basename).ts" means check if basename.ts exists
              const whenFilePath = path.join(path.dirname(entryPath), resolvedWhenClause)

              // Check if the referenced file exists
              try {
                const fs = require('fs')
                shouldExclude = fs.existsSync(whenFilePath)
              } catch (e) {
                shouldExclude = false
              }
            }

            if (shouldExclude && this.matchesPattern(entryPath, pattern)) {
              return false
            }
          }
          return true
        })
        const resources = filteredEntries.map((e) => {
          const entryUri = vscode.Uri.joinPath(uri, e[0])
          // Determine if the original item was a relative path
          const isOriginalRelative =
            !path.isAbsolute(item.filePath) && !item.filePath.match(/^[A-Za-z][A-Za-z0-9+-.]*:/)

          let entryPath: string
          if (
            isOriginalRelative &&
            vscode.workspace.workspaceFolders &&
            vscode.workspace.workspaceFolders.length > 0
          ) {
            const workspacePath = vscode.workspace.workspaceFolders[0].uri.fsPath
            // Use relative path based on the original item's path
            if (item.filePath === '') {
              // Root of workspace
              entryPath = e[0]
            } else {
              // Relative to the original item
              entryPath = path.join(item.filePath, e[0])
            }
          } else {
            entryPath = item.filePath.match(/^[A-Za-z][A-Za-z0-9+-.]*:/) && !path.isAbsolute(item.filePath)
              ? entryUri.toString()
              : entryUri.fsPath
          }
          return { filePath: entryPath, group: '' }
        })
        return this.sortResources(resources, sort === 'MANUAL' ? 'ASC' : sort)
      })
      .then((items) => {
        // For resource children, we don't need to handle duplicates as they're in different directories
        return this.data2Resource(items, 'resourceChild')
      })
      .then(
        (result) => {
          return result
        },
        (error) => {
          return []
        },
      )
  }

  private matchesPattern(filePath: string, pattern: string): boolean {
    // Convert Windows path separators to forward slashes
    const normalizedFilePath = filePath.replace(/\\/g, '/')

    // Convert pattern to regex
    let regexPattern = pattern.replace(/\./g, '\\.').replace(/\*/g, '.*').replace(/\?/g, '.')

    // Handle ** patterns
    regexPattern = regexPattern.replace(/\*\*\//g, '(.*/)?')
    regexPattern = regexPattern.replace(/\*\*/g, '.*')

    // For patterns that don't start with /, make them match anywhere in the path
    if (!pattern.startsWith('/')) {
      regexPattern = regexPattern.replace(/^\^/, '')
      regexPattern = '.*' + regexPattern
    }

    // Add end anchor if it doesn't have one
    if (!regexPattern.endsWith('$')) {
      regexPattern = regexPattern + '$'
    }

    const regex = new RegExp(regexPattern)
    return regex.test(normalizedFilePath)
  }

  private compareByFileType(a: Item, b: Item): number {
    const aStat = a.stat
    const bStat = b.stat

    if (aStat === FileStat.DIRECTORY && bStat === FileStat.FILE) {
      return -1
    }
    if (aStat === FileStat.FILE && bStat === FileStat.DIRECTORY) {
      return 1
    }

    if (aStat === FileStat.DIRECTORY && bStat === FileStat.DIRECTORY) {
      const aName = path.basename(a.filePath).toLowerCase()
      const bName = path.basename(b.filePath).toLowerCase()
      return aName.localeCompare(bName)
    }

    const aExt = path.extname(a.filePath).toLowerCase()
    const bExt = path.extname(b.filePath).toLowerCase()

    if (aExt !== bExt) {
      return aExt.localeCompare(bExt)
    }

    const aName = path.basename(a.filePath).toLowerCase()
    const bName = path.basename(b.filePath).toLowerCase()
    return aName.localeCompare(bName)
  }

  private compareByName(a: Item, b: Item, isAsc: boolean): number {
    const folderOrder = Number(b.stat === FileStat.DIRECTORY) - Number(a.stat === FileStat.DIRECTORY)
    if (folderOrder) return folderOrder
    const aName = path.posix.basename(a.uri?.path || a.filePath)
    const bName = path.posix.basename(b.uri?.path || b.filePath)
    return aName.localeCompare(bName, getLanguage(), { numeric: true, sensitivity: 'base' }) * (isAsc ? 1 : -1)
  }

  private async sortResources(resources: Array<ItemInSettingsJson>, sort: string): Promise<Array<Item>> {
    const items = await Promise.all(resources.map((resource) => this.getResourceStat(resource)))
    if (sort === 'MANUAL') return items
    return items.sort((a, b) => {
      if (sort === 'FILETYPE') return this.compareByFileType(a, b)
      if (sort === 'MTIME_ASC' || sort === 'MTIME_DESC') {
        const folderOrder = Number(b.stat === FileStat.DIRECTORY) - Number(a.stat === FileStat.DIRECTORY)
        const delta = ((a.mtime || 0) - (b.mtime || 0)) * (sort === 'MTIME_ASC' ? 1 : -1)
        return folderOrder || delta || this.compareByName(a, b, true)
      }
      return this.compareByName(a, b, sort !== 'DESC')
    })
  }

  private checkExternalFile(uri: vscode.Uri, item: ItemInSettingsJson): Item {
    try {
      const fs = require('fs')
      const fsPath = uri.fsPath
      if (fs.existsSync(fsPath)) {
        const stats = fs.statSync(fsPath)
        if (stats.isFile()) {
          return {
            filePath: item.filePath,
            stat: FileStat.FILE,
            mtime: stats.mtimeMs,
            uri,
            group: item.group,
          }
        }
        if (stats.isDirectory()) {
          return {
            filePath: item.filePath,
            stat: FileStat.DIRECTORY,
            mtime: stats.mtimeMs,
            uri,
            group: item.group,
          }
        }
      }
    } catch (e) {
      // Ignore errors
    }
    return {
      filePath: item.filePath,
      stat: FileStat.NEITHER,
      group: item.group,
    }
  }

  private getResourceStat(item: ItemInSettingsJson): Thenable<Item> {
    return new Promise((resolve) => {
      const uri = resourcePathToUri(item.filePath)

      vscode.workspace.fs.stat(uri).then(
        (fileStat) => {
          if (fileStat.type & vscode.FileType.File) {
            return resolve({
              filePath: item.filePath,
              stat: FileStat.FILE,
              mtime: fileStat.mtime,
              uri,
              group: item.group,
            })
          }
          if (fileStat.type & vscode.FileType.Directory) {
            return resolve({
              filePath: item.filePath,
              stat: FileStat.DIRECTORY,
              mtime: fileStat.mtime,
              uri,
              group: item.group,
            })
          }
          return resolve({
            filePath: item.filePath,
            stat: FileStat.NEITHER,
            uri,
            group: item.group,
          })
        },
        (error) => {
          // For external files, try to check if they exist using Node.js fs
          return resolve(this.checkExternalFile(uri, item))
        },
      )
    })
  }

  private createResource(item: Item, contextValue: string, fileNameCounts?: Map<string, number>): Resource {
    const uri = item.uri || resourcePathToUri(item.filePath)
    const isDirectory = item.stat === FileStat.DIRECTORY
    const collapsibleState = isDirectory
      ? vscode.TreeItemCollapsibleState.Collapsed
      : vscode.TreeItemCollapsibleState.None

    let finalContextValue = contextValue
    if (item.uri) {
      finalContextValue = 'uri.' + contextValue
    }
    if (isDirectory) {
      finalContextValue += '.dir'
    }

    const command = isDirectory
      ? undefined
      : {
          command: 'favorites.open',
          title: '',
          arguments: [uri],
        }

    // Generate label with directory information for duplicate filenames
    let label = path.basename(item.filePath)
    if (!isDirectory && fileNameCounts) {
      const fileName = path.basename(item.filePath)
      if (fileNameCounts.get(fileName) && fileNameCounts.get(fileName)! > 1) {
        const dirName = path.basename(path.dirname(item.filePath))
        if (dirName && dirName !== '.') {
          label = `${dirName}/${fileName}`
        }
      }
    }

    const resource = new Resource(label, collapsibleState, item.filePath, finalContextValue, command, uri)
    if (!isDirectory) {
      const standalone = !contextValue.includes('resourceChild')
      const isNew = this.activity?.isNew(uri)
      const directory = standalone ? path.dirname(vscode.workspace.asRelativePath(uri, false)) : ''
      resource.description = [isNew ? 'NEW' : '', directory === '.' ? '' : directory].filter(Boolean).join(' · ')
      if (isNew) {
        resource.iconPath = new vscode.ThemeIcon('new-file', new vscode.ThemeColor('list.highlightForeground'))
        resource.tooltip = `${item.filePath}\n${t('New file — not opened yet')}`
      }
    }
    return resource
  }

  private data2Resource(data: Array<Item>, contextValue: string): Array<Resource> {
    // contextValue set on Resource gets a 'uri.' prefix if the favorite is specified as a uri,
    //   and a '.dir' suffix if it represents a directory rather than a file.
    // The when-clauses on our contributions to the 'view/item/context' menu use these modifiers
    //   to be smarter about which commands to offer.

    // Count occurrences of each filename to detect duplicates
    const fileNameCounts = new Map<string, number>()
    data.forEach((item) => {
      if (item.stat === FileStat.FILE) {
        const fileName = path.basename(item.filePath)
        fileNameCounts.set(fileName, (fileNameCounts.get(fileName) || 0) + 1)
      }
    })

    return data.map((item) => this.createResource(item, contextValue, fileNameCounts))
  }

  handleDrag(
    source: readonly Resource[],
    dataTransfer: vscode.DataTransfer,
    token: vscode.CancellationToken,
  ): void {
    dataTransfer.set(
      FAVORITES_MIME,
      new vscode.DataTransferItem(JSON.stringify(source.map((item) => item.resourceUri.toString()))),
    )
  }

  async handleDrop(
    target: Resource | undefined,
    source: vscode.DataTransfer,
    token: vscode.CancellationToken,
  ): Promise<void> {
    try {
      let sourcePaths: string[] = []

      // Check if dragging from within favorites (internal drag)
      const resourceData = source.get(FAVORITES_MIME)
      if (resourceData) {
        sourcePaths = JSON.parse(await resourceData.asString()) as string[]
      }
      // Check if dragging from editor tab or explorer (external drag)
      else {
        const uriData = source.get('application/vnd.code.tree.uri')
        if (uriData) {
          const uriString = await uriData.asString()
          sourcePaths = [uriString]
        } else {
          // Try other common URI formats
          const textData = source.get('text/uri-list')
          if (textData) {
            const text = await textData.asString()
            sourcePaths = text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('#'))
          }
        }
      }

      if (!sourcePaths.length) {
        if (!token.isCancellationRequested) {
          vscode.window.showWarningMessage(t('No resource paths were provided. Use Add to Favorites in Explorer first.'))
        }
        return
      }

      // Older Explorer versions omit folders from external URI lists. Only our
      // own drag payload has a complete selection suitable for filesystem moves.
      if (resourceData && target?.contextValue.endsWith('.dir')) {
        const result = await moveResources(sourcePaths.map(resourcePathToUri), target.resourceUri, token)
        this.refresh()
        if (!result.cancelled) {
          if (result.warnings.length) vscode.window.showWarningMessage(moveOutcomeMessage(result))
          else vscode.window.showInformationMessage(moveOutcomeMessage(result))
        }
        return
      }

      // Root drops and drops onto files reorder/add shortcuts using URI identity.
      const incoming = [...new Map(sourcePaths.map((value) => {
        const uri = resourcePathToUri(value)
        return [uriKey(uri), uri] as const
      })).values()]
      const sourceKeys = new Set(incoming.map(uriKey))
      const currentResources = await getCurrentResources()
      const currentGroup = ((await configMgr.get('currentGroup')) as string) || DEFAULT_GROUP

      // Filter resources to only those in the current group
      const currentGroupResources = currentResources.filter((item) => item.group === currentGroup)
      const otherGroupResources = currentResources.filter((item) => item.group !== currentGroup)

      // Remove source items from current group resources (for internal drag)
      const remainingResources = currentGroupResources.filter((item) => !sourceKeys.has(uriKey(resourcePathToUri(item.filePath))))

      // Determine insertion point
      let insertIndex = remainingResources.length
      if (target) {
        const targetIndex = remainingResources.findIndex((item) => uriKey(resourcePathToUri(item.filePath)) === uriKey(target.resourceUri))
        if (targetIndex !== -1) {
          insertIndex = targetIndex
        }
      }

      // Create new items for source paths
      const sourceItems = incoming.map((uri) => currentGroupResources.find((item) =>
        uriKey(resourcePathToUri(item.filePath)) === uriKey(uri),
      ) || ({ filePath: serializeFavoriteUri(uri, isMultiRoots() ? uri.fsPath : '.'), group: currentGroup }))

      // Insert source items at the determined position
      const newResources = [
        ...remainingResources.slice(0, insertIndex),
        ...sourceItems,
        ...remainingResources.slice(insertIndex),
        ...otherGroupResources,
      ]

      // Update the configuration
      await configMgr.save('resources', newResources)
      // Set sort order to MANUAL when drag and drop occurs
      await configMgr.save('sortOrder', 'MANUAL')

      // Refresh the tree view
      this.refresh()
      if (!resourceData && target?.contextValue.endsWith('.dir')) {
        vscode.window.showInformationMessage(t('Added favorites. To move files, select them in Favorites and use Move to Folder.'))
      }
    } catch (error) {
      console.error('Error handling drop:', error)
      this.refresh()
      vscode.window.showErrorMessage(t('Failed to handle drop: {0}', (error as Error).message))
    }
  }
}

export class Resource extends vscode.TreeItem {
  public resourceUri: vscode.Uri

  constructor(
    public label: string,
    public collapsibleState: vscode.TreeItemCollapsibleState,
    public value: string,
    public contextValue: string,
    public command?: vscode.Command,
    public uri?: vscode.Uri,
  ) {
    super(label, collapsibleState)

    this.resourceUri = uri ? uri : vscode.Uri.file(value)
    this.id = uriKey(this.resourceUri)
    this.tooltip = value
  }
}

import * as vscode from 'vscode'
import * as path from 'path'

import { getCurrentResources, isMultiRoots } from '../helper/util'
import configMgr from '../helper/configMgr'
import { resourcePathToUri, serializeFavoriteUri, uriKey, isEqualOrParent } from '../helper/resourcePaths'
import { moveResources, moveOutcomeMessage } from '../helper/fileOperations'
import { t, getLanguage } from '../helper/i18n'
import { logOperation } from '../helper/diagnostics'
import { getSortOrder } from '../helper/sortOrder'
import type { FileActivity } from '../helper/fileActivity'
import { DEFAULT_GROUP, FileStat } from '../enum'
import { Item, ItemInSettingsJson } from '../model'

const FAVORITES_MIME = 'application/vnd.howardzuo.vscode-favorites.resources+json'

export class FavoritesProvider
  implements vscode.TreeDataProvider<Resource>, vscode.TreeDragAndDropController<Resource>
{
  private _onDidChangeTreeData = new vscode.EventEmitter<Resource | Resource[] | void>()
  readonly onDidChangeTreeData: vscode.Event<Resource | Resource[] | void> = this._onDidChangeTreeData.event
  private branches = new Map<string, { parent?: Resource; rows: Resource[] }>()
  private pendingRefresh?: Promise<void>
  private needsRefresh = false
  private moveInProgress = false
  private moveCompletion?: Promise<unknown>
  private epoch = 0

  // Use for detecting doubleclick
  public lastOpened: { uri: vscode.Uri; date: Date } | undefined

  // Drag and drop mime types
  readonly dragMimeTypes = [FAVORITES_MIME]
  readonly dropMimeTypes = [FAVORITES_MIME, 'application/vnd.code.tree.uri', 'text/uri-list', 'text/plain']

  constructor(private activity?: FileActivity) {}

  refresh(): Promise<void> {
    this.needsRefresh = true
    if (this.moveInProgress) return Promise.resolve()
    if (!this.pendingRefresh) {
      this.epoch++
      this.pendingRefresh = new Promise<void>((resolve) => setTimeout(resolve, 20))
        .then(async () => {
          while (this.needsRefresh && !this.moveInProgress) {
            this.needsRefresh = false
            await this.refreshBranches()
          }
        })
        .catch((error) => console.error('Error refreshing favorites:', error))
        .finally(() => { this.pendingRefresh = undefined })
    }
    return this.pendingRefresh
  }

  moveItems(uris: readonly vscode.Uri[], destination: vscode.Uri, token?: vscode.CancellationToken) {
    if (this.moveInProgress) return Promise.reject(new Error(t('Another move is in progress. Please wait.')))
    this.moveInProgress = true
    this.epoch++
    const operation = moveResources(uris, destination, token).finally(async () => {
      this.moveInProgress = false
      const started = Date.now()
      await this.refresh()
      logOperation('move.treeRefreshed', { elapsedMs: Date.now() - started })
      if (this.moveCompletion === operation) this.moveCompletion = undefined
    })
    this.moveCompletion = operation
    return operation
  }

  async waitForMove(): Promise<void> {
    await this.moveCompletion?.catch(() => {})
  }

  removeDeletedRows(uris: readonly vscode.Uri[]): void {
    if (!uris.length) return
    this.epoch++
    const removed = (row: Resource) => uris.some((uri) => isEqualOrParent(row.resourceUri, uri))
    const changed: Resource[] = []
    let rootsChanged = false
    for (const [id, branch] of this.branches) {
      if (branch.parent && removed(branch.parent)) {
        this.branches.delete(id)
        continue
      }
      const remaining = branch.rows.filter((row) => !removed(row))
      if (remaining.length === branch.rows.length) continue
      branch.rows = remaining
      if (branch.parent) changed.push(branch.parent)
      else rootsChanged = true
    }
    if (rootsChanged) this._onDidChangeTreeData.fire()
    else if (changed.length) this._onDidChangeTreeData.fire(changed.length === 1 ? changed[0] : changed)
  }

  private async refreshBranches(): Promise<void> {
    const epoch = this.epoch
    const visible = [...this.branches.values()]
    const roots = visible.find(({ parent }) => !parent)
    const state = await this.readTreeState()
    const nextRoots = await this.readChildren(undefined, state)
    if (epoch !== this.epoch) return
    if (!roots || this.updateBranch(undefined, nextRoots)) {
      this.branches.clear()
      this._onDidChangeTreeData.fire()
      return
    }

    const folders = visible.filter(({ parent }) => parent !== undefined)
    const next = await Promise.all(folders.map(async ({ parent }) => ({ parent, rows: await this.readChildren(parent, state) })))
    if (epoch !== this.epoch) return
    const changed = next.flatMap(({ parent, rows }) => parent && this.updateBranch(parent, rows) ? [parent] : [])
    const changedIds = new Set(changed.map((node) => node.id))
    const highest = changed.filter((node) => {
      for (let parent = node.parent; parent; parent = parent.parent) {
        if (changedIds.has(parent.id)) return false
      }
      return true
    })
    // Drop cached branches whose parent rows no longer exist after a move.
    for (const [id, { parent }] of this.branches) {
      if (parent && !this.branches.get(parent.parent?.id || '')?.rows.some((row) => row.id === id)) {
        this.branches.delete(id)
      }
    }
    if (highest.length) this._onDidChangeTreeData.fire(highest.length === 1 ? highest[0] : highest)
  }

  private updateBranch(parent: Resource | undefined, rows: Resource[]): boolean {
    const id = parent?.id || ''
    const previous = this.branches.get(id)?.rows || []
    const changed = previous.length !== rows.length || rows.some((row, index) =>
      row.presentationKey() !== previous[index].presentationKey(),
    )
    const byId = new Map(previous.map((row) => [row.id, row]))
    const stable = rows.map((row) => {
      const original = byId.get(row.id)
      if (!original) return row
      Object.assign(original, row)
      return original
    })
    this.branches.set(id, { parent, rows: stable })
    return changed
  }

  getTreeItem(element: Resource): vscode.TreeItem {
    return element
  }

  private existingRow(row: Resource): Resource {
    const existing = this.branches.get(row.parent?.id || '')?.rows.find((entry) => entry.id === row.id)
    return existing?.parent === row.parent && existing?.presentationKey() === row.presentationKey() ? existing : row
  }

  async findResource(uri: vscode.Uri): Promise<Resource | undefined> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const epoch = this.epoch
      const state = await this.readTreeState()
      const roots = await this.readChildren(undefined, state)
      if (epoch !== this.epoch) continue
      const exact = roots.find((root) => uriKey(root.resourceUri) === uriKey(uri))
      if (exact) return this.existingRow(exact)
      const candidates = roots.filter((root) => root.contextValue.endsWith('.dir') && isEqualOrParent(uri, root.resourceUri))
        .sort((a, b) => b.resourceUri.path.length - a.resourceUri.path.length)
      for (const root of candidates) {
        let current: Resource | undefined = this.existingRow(root)
        while (current && epoch === this.epoch) {
          const [child] = await this.readChildren(current, state, uri)
          current = child && this.existingRow(child)
          if (current && epoch === this.epoch && uriKey(current.resourceUri) === uriKey(uri)) return current
        }
        if (epoch !== this.epoch) break
      }
      if (epoch === this.epoch) return
    }
  }

  getParent(element: Resource): Resource | undefined {
    return element.parent
  }

  private async readTreeState() {
    const [group, resources, sort] = await Promise.all([
      configMgr.get('currentGroup'), getCurrentResources(), getSortOrder(),
    ])
    const current = resources.filter((item) => item.group === (group || DEFAULT_GROUP))
    return { resources: current, sort, pinned: new Set(current.map((item) => uriKey(resourcePathToUri(item.filePath)))) }
  }

  async getChildren(element?: Resource): Promise<Resource[]> {
    const epoch = this.epoch
    const rows = await this.readChildren(element, await this.readTreeState())
    if (epoch !== this.epoch) return rows
    this.updateBranch(element, rows)
    return this.branches.get(element?.id || '')!.rows
  }

  private async readChildren(
    element: Resource | undefined,
    state: Awaited<ReturnType<FavoritesProvider['readTreeState']>>,
    target?: vscode.Uri,
  ): Promise<Resource[]> {
    const { resources, sort, pinned } = state
    if (element) {
      const children = await this.getChildrenResources(element, sort, target)
      for (const child of children) {
        if (pinned.has(uriKey(child.resourceUri))) child.contextValue = child.contextValue.replace(/(\.dir)?$/, '.pinned$1')
      }
      return children
    }
    const items = await this.sortResources(resources, sort)
    const valid = items.filter((item) => item.stat !== FileStat.NEITHER)
    const unique = [...new Map(valid.map((item) => [uriKey(item.uri!), item])).values()]
    const directories = unique.filter((item) => item.stat === FileStat.DIRECTORY)
    const entries = new Map<string, Promise<Set<string>>>()
    const covered = await Promise.all(unique.map(async (item) => {
      for (const parent of directories) {
        if (parent === item || !isEqualOrParent(item.uri!, parent.uri!)) continue
        if (await this.reachable(item.uri!, parent.uri!, entries)) return true
      }
      return false
    }))
    return this.data2Resource(unique.filter((_, i) => !covered[i]), 'resource')
  }

  private async reachable(uri: vscode.Uri, root: vscode.Uri, cache: Map<string, Promise<Set<string>>>): Promise<boolean> {
    const segments = uri.path.slice(root.path.replace(/\/+$/, '').length).split('/').filter(Boolean)
    let current = root
    for (const segment of segments) {
      const key = uriKey(current)
      let entries = cache.get(key)
      if (!entries) {
        entries = this.listDirectory(current).then(
          (rows) => new Set(rows.map(([name]) => uriKey(vscode.Uri.joinPath(current, name)))),
          () => new Set<string>(),
        )
        cache.set(key, entries)
      }
      const next = vscode.Uri.joinPath(current, segment)
      if (!(await entries).has(uriKey(next))) return false
      current = next
    }
    return true
  }

  private async listDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
    // Get files.exclude configuration
    const filesExclude =
      (vscode.workspace.getConfiguration('files', uri).get('exclude') as Record<
        string,
        boolean | { when: string }
      >) || {}

    const entries = await vscode.workspace.fs.readDirectory(uri)
    return entries.filter(([name]) => {
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
  }

  private async getChildrenResources(parent: Resource, sort: string, target?: vscode.Uri): Promise<Resource[]> {
    const uri = parent.resourceUri
    try {
      const entries = await this.listDirectory(uri)
      const items = await Promise.all(entries.flatMap(([name, type]): (Item | Thenable<Item>)[] => {
        const child = vscode.Uri.joinPath(uri, name)
        if (target && !isEqualOrParent(target, child)) return []
        const item = { filePath: serializeFavoriteUri(child, parent.value), group: '' }
        if (target || sort.startsWith('MTIME_') || (type !== vscode.FileType.File && type !== vscode.FileType.Directory)) {
          return [this.getResourceStat(item)]
        }
        return [{ ...item, uri: child, stat: type === vscode.FileType.Directory ? FileStat.DIRECTORY : FileStat.FILE }]
      }))
      this.sortItems(items, sort === 'MANUAL' ? 'ASC' : sort)
      return this.data2Resource(items.filter((item) => item.stat !== FileStat.NEITHER), 'resourceChild', parent)
    } catch {
      return []
    }
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

  private compareByName(a: Item, b: Item, isAsc: boolean, collator: Intl.Collator): number {
    const folderOrder = Number(b.stat === FileStat.DIRECTORY) - Number(a.stat === FileStat.DIRECTORY)
    if (folderOrder) return folderOrder
    const aName = path.posix.basename(a.uri?.path || a.filePath)
    const bName = path.posix.basename(b.uri?.path || b.filePath)
    return collator.compare(aName, bName) * (isAsc ? 1 : -1)
  }

  private async sortResources(resources: Array<ItemInSettingsJson>, sort: string): Promise<Array<Item>> {
    const items = await Promise.all(resources.map((resource) => this.getResourceStat(resource)))
    return this.sortItems(items, sort)
  }

  private sortItems(items: Item[], sort: string): Item[] {
    if (sort === 'MANUAL') return items
    const collator = new Intl.Collator(getLanguage(), { numeric: true, sensitivity: 'base' })
    return items.sort((a, b) => {
      if (sort === 'FILETYPE') return this.compareByFileType(a, b)
      if (sort === 'MTIME_ASC' || sort === 'MTIME_DESC') {
        const folderOrder = Number(b.stat === FileStat.DIRECTORY) - Number(a.stat === FileStat.DIRECTORY)
        const delta = ((a.mtime || 0) - (b.mtime || 0)) * (sort === 'MTIME_ASC' ? 1 : -1)
        return folderOrder || delta || this.compareByName(a, b, true, collator)
      }
      return this.compareByName(a, b, sort !== 'DESC', collator)
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

  private createResource(item: Item, contextValue: string, fileNameCounts?: Map<string, number>, parent?: Resource): Resource {
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

    const resource = new Resource(label, collapsibleState, item.filePath, finalContextValue, command, uri, parent)
    if (!isDirectory) {
      const standalone = !contextValue.includes('resourceChild')
      const isNew = this.activity?.isNew(uri)
      const directory = standalone ? path.dirname(vscode.workspace.asRelativePath(uri, false)) : ''
      resource.description = [isNew ? 'NEW' : '', directory === '.' ? '' : directory].filter(Boolean).join(' · ')
      resource.iconPath = undefined
      if (isNew) {
        resource.iconPath = new vscode.ThemeIcon('new-file', new vscode.ThemeColor('list.highlightForeground'))
        resource.tooltip = `${item.filePath}\n${t('New file — not opened yet')}`
      }
    }
    return resource
  }

  private data2Resource(data: Array<Item>, contextValue: string, parent?: Resource): Array<Resource> {
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

    return data.map((item) => this.createResource(item, contextValue, fileNameCounts, parent))
  }

  handleDrag(
    source: readonly Resource[],
    dataTransfer: vscode.DataTransfer,
    token: vscode.CancellationToken,
  ): void {
    const paths = source.map((item) => item.resourceUri.toString())
    logOperation('drag.started', { sources: paths })
    dataTransfer.set(
      FAVORITES_MIME,
      new vscode.DataTransferItem(JSON.stringify(paths)),
    )
  }

  async handleDrop(
    target: Resource | undefined,
    source: vscode.DataTransfer,
    token: vscode.CancellationToken,
  ): Promise<void> {
    try {
      logOperation('drop.received', { target: target?.resourceUri.toString(), context: target?.contextValue, internal: !!source.get(FAVORITES_MIME) })
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
        const result = await this.moveItems(sourcePaths.map(resourcePathToUri), target.resourceUri, token)
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

      if (!resourceData && target?.contextValue.endsWith('.dir')) {
        vscode.window.showInformationMessage(t('Added favorites. To move files, select them in Favorites and use Move to Folder.'))
      }
    } catch (error) {
      console.error('Error handling drop:', error)
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
    public parent?: Resource,
  ) {
    super(label, collapsibleState)

    this.resourceUri = uri ? uri : vscode.Uri.file(value)
    this.id = (parent?.id ? parent.id + '\n' : '') + uriKey(this.resourceUri)
    this.tooltip = value
  }
  presentationKey(): string {
    return JSON.stringify([this.id, this.label, this.description, this.tooltip, this.contextValue, this.value, this.collapsibleState])
  }

}

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { test } = require('node:test')
const { fixture, Uri } = require('./fixture.cjs')

test('opening a nested favorite selects its real row with a complete parent chain without editor focus loss', async (t) => {
  const f = await fixture(t)
  const file = f.file('docs/jack/nested/a.md')
  f.config.resources = ['docs/jack', 'docs/jack/nested/a.md']
  const provider = f.views.get('favorites').treeDataProvider
  const [jack] = await provider.getChildren()
  const [nested] = await provider.getChildren(jack)
  const [visibleRow] = await provider.getChildren(nested)
  await f.activateEditor(file)
  assert.equal(f.revealed.length, 2)
  const row = f.revealed[0].target
  assert.strictEqual(row, visibleRow)
  assert.equal(row.resourceUri.toString(), file.toString())
  assert.equal(f.revealed[0].options.select, true)
  assert.equal(f.revealed[0].options.focus, false)
  const parent = await provider.getParent(row)
  assert.equal(parent.label, 'nested')
  const root = await provider.getParent(parent)
  assert.equal(root.label, 'jack')
  assert.equal(await provider.getParent(root), undefined)
  assert.equal((await provider.getChildren()).length, 1)
})

test('files outside favorites and disabled auto-reveal do not change the tree selection', async (t) => {
  const f = await fixture(t)
  const file = f.file('jack/a.md'), other = f.file('outside/b.md')
  f.config.resources = ['jack']
  await f.activateEditor(other)
  assert.equal(f.revealed.length, 0)
  await f.changeConfig('autoReveal', false)
  await f.activateEditor(file)
  assert.equal(f.revealed.length, 0)
})

test('a hidden favorite view locates the active file when it becomes visible', async (t) => {
  const f = await fixture(t)
  const file = f.file('jack/a.md')
  f.config.resources = ['jack']
  for (const view of f.treeViews.values()) view.visible = false
  await f.activateEditor(file)
  assert.equal(f.revealed.length, 0)
  await f.showView('favorites-full-view', true)
  assert.equal(f.revealed.length, 1)
  assert.equal(f.revealed[0].view, 'favorites-full-view')
  assert.equal(f.revealed[0].target.resourceUri.toString(), file.toString())
})

test('a non-favorited excluded child is not sent to the native tree for reveal', async (t) => {
  const f = await fixture(t)
  const file = f.file('jack/hide.md')
  f.config.resources = ['jack']
  f.settings.filesExclude = { '**/hide.md': true }
  await f.activateEditor(file)
  assert.equal(f.revealed.length, 0)
})

test('a failed reveal in one view does not block the other visible view', async (t) => {
  const f = await fixture(t)
  const file = f.file('jack/a.md')
  f.config.resources = ['jack']
  f.treeViews.get('favorites').reveal = async () => { throw new Error('View closed') }
  await f.activateEditor(file)
  assert.equal(f.revealed.length, 1)
  assert.equal(f.revealed[0].view, 'favorites-full-view')
})

test('an independently reachable nested root is tried when its containing root excludes it', async (t) => {
  const f = await fixture(t)
  const file = f.file('A/hidden/x.md')
  f.config.resources = ['A', 'A/hidden']
  f.settings.filesExclude = { '**/hidden': true }
  await f.activateEditor(file)
  assert.equal(f.revealed.length, 2)
  const parent = await f.views.get('favorites').treeDataProvider.getParent(f.revealed[0].target)
  assert.equal(parent.label, 'hidden')
})

test('a slow old-group read cannot overwrite the active group parent chain', async (t) => {
  const f = await fixture(t, { currentGroup: 'One' })
  const file = f.file('A/sub/x.md')
  f.config.resources = [{ filePath: 'A/sub', group: 'One' }, { filePath: 'A', group: 'Two' }]
  const provider = f.views.get('favorites').treeDataProvider
  const stat = f.vscode.workspace.fs.stat
  let release, entered, blocked = false
  const wait = new Promise((resolve) => { release = resolve })
  const inspecting = new Promise((resolve) => { entered = resolve })
  f.vscode.workspace.fs.stat = async (uri) => {
    if (!blocked && uri.fsPath.endsWith('/A/sub')) { blocked = true; entered(); await wait }
    return stat(uri)
  }
  const old = provider.getChildren()
  await inspecting
  await f.changeConfig('currentGroup', 'Two')
  const row = await provider.findResource(file)
  release()
  await old
  const parent = await provider.getParent(row)
  assert.equal(parent.label, 'sub')
  assert.equal((await provider.getParent(parent)).label, 'A')
})

test('periodic refresh during a pending reveal retries the current editor lookup', async (t) => {
  const f = await fixture(t)
  const file = f.file('jack/a.md')
  f.config.resources = ['jack']
  const stat = f.vscode.workspace.fs.stat
  let release, entered, blocked = false
  const wait = new Promise((resolve) => { release = resolve })
  const inspecting = new Promise((resolve) => { entered = resolve })
  f.vscode.workspace.fs.stat = async (uri) => {
    if (!blocked) { blocked = true; entered(); await wait }
    return stat(uri)
  }
  const opening = f.activateEditor(file)
  await inspecting
  f.views.get('favorites').treeDataProvider.refresh()
  release()
  await opening
  assert.equal(f.revealed.length, 2)
})

test('locating an active file only stats its ancestor chain and the file', async (t) => {
  const f = await fixture(t, { refreshInterval: 0 })
  await f.views.get('favorites').treeDataProvider.refresh()
  const file = f.file('jack/sub/a.md')
  const unrelated = f.file('jack/sub/other.md')
  f.config.resources = ['jack']
  const stat = f.vscode.workspace.fs.stat
  const inspected = []
  f.vscode.workspace.fs.stat = async (uri) => {
    inspected.push(uri.fsPath)
    return stat(uri)
  }
  await f.activateEditor(file)
  assert.equal(f.revealed.length, 2)
  assert.ok(inspected.includes(file.fsPath))
  assert.ok(!inspected.includes(unrelated.fsPath))
})

test('move completion selects the new path when VS Code updates the active editor', async (t) => {
  const f = await fixture(t, { refreshInterval: 0 })
  const file = f.file('jack/1231/note.md')
  f.config.resources = ['jack']
  await f.activateEditor(file)
  f.revealed.length = 0
  f.vscode.workspace.applyEdit = async ({ renames: [{ oldUri, newUri }] }) => {
    fs.renameSync(oldUri.fsPath, newUri.fsPath)
    f.vscode.window.activeTextEditor = { document: { uri: newUri } }
    await f.rename([{ oldUri, newUri }])
    return true
  }
  await f.run('favorites.moveToParentFolder', f.item(file, true))
  const target = Uri.file(path.join(f.root, 'jack/note.md'))
  assert.equal(f.revealed.length, 2)
  assert.ok(f.revealed.every(({ target: row, options }) => row.resourceUri.toString() === target.toString() && !options.focus))
})

test('switching editors during a slow lookup selects only the latest file', async (t) => {
  const f = await fixture(t, { refreshInterval: 0 })
  await f.views.get('favorites').treeDataProvider.refresh()
  const first = f.file('jack/first.md'), latest = f.file('jack/latest.md')
  f.config.resources = ['jack']
  const stat = f.vscode.workspace.fs.stat
  let entered, release
  const inspecting = new Promise((resolve) => { entered = resolve })
  const gate = new Promise((resolve) => { release = resolve })
  f.vscode.workspace.fs.stat = async (uri) => {
    if (uri.fsPath === first.fsPath) { entered(); await gate }
    return stat(uri)
  }
  const opening = f.activateEditor(first)
  await inspecting
  try {
    await f.activateEditor(latest)
  } finally {
    release()
    await opening
  }
  assert.equal(f.revealed.length, 2)
  assert.ok(f.revealed.every(({ target }) => target.resourceUri.toString() === latest.toString()))
})

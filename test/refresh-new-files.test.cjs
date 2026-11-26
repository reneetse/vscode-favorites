const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { test } = require('node:test')
const { fixture, Uri } = require('./fixture.cjs')

test('without a saved sort preference the newest modified file is shown first', async (t) => {
  const f = await fixture(t, { sortOrder: undefined })
  const older = f.file('a.md'), newer = f.file('b.md')
  fs.utimesSync(older.fsPath, 100, 100); fs.utimesSync(newer.fsPath, 200, 200)
  f.config.resources = ['a.md', 'b.md']
  assert.deepEqual(Array.from(await f.views.get('favorites').treeDataProvider.getChildren(), (item) => item.label), ['b.md', 'a.md'])
})

test('periodic refresh discovers unopened new files and opening clears their NEW icon', async (t) => {
  const f = await fixture(t)
  f.file('jack/existing.md')
  f.config.resources = [{ filePath: 'jack', group: 'Default' }]
  await f.tick()
  const provider = f.views.get('favorites').treeDataProvider
  const [jack] = await provider.getChildren()
  const before = await provider.getChildren(jack)
  assert.ok(!before[0].iconPath)
  const added = f.file('jack/new.md')
  let refreshed = false
  provider.onDidChangeTreeData(() => { refreshed = true })
  await f.tick()
  assert.equal(refreshed, true)
  const child = (await provider.getChildren(jack)).find((item) => item.label === 'new.md')
  assert.equal(child.iconPath?.id, 'new-file')
  assert.match(child.description, /NEW/)
  await f.showEditors(added)
  const opened = (await provider.getChildren(jack)).find((item) => item.label === 'new.md')
  assert.ok(!opened.iconPath)
  assert.ok(!opened.description?.includes('NEW'))
})

test('an unopened new marker follows a file move instead of being lost', async (t) => {
  const f = await fixture(t)
  f.file('jack/existing.md')
  fs.mkdirSync(path.join(f.root, 'jack/sub'))
  f.config.resources = [{ filePath: 'jack', group: 'Default' }]
  await f.tick()
  const file = f.file('jack/new.md')
  await f.tick()
  f.input.folder = Uri.file(path.join(f.root, 'jack/sub'))
  await f.run('favorites.moveToFolder', f.item(file, true))
  await f.tick()
  const provider = f.views.get('favorites').treeDataProvider
  const [jack] = await provider.getChildren()
  const sub = (await provider.getChildren(jack)).find((item) => item.label === 'sub')
  const children = await provider.getChildren(sub)
  assert.equal(children[0].iconPath?.id, 'new-file')
})

test('refresh interval can be changed or disabled without leaving duplicate timers', async (t) => {
  const f = await fixture(t)
  assert.equal(f.timers.size, 1)
  assert.equal([...f.timers][0].delay, 30000)
  await f.changeConfig('refreshInterval', 10)
  assert.equal(f.timers.size, 1)
  assert.equal([...f.timers][0].delay, 10000)
  await f.changeConfig('refreshInterval', 0)
  assert.equal(f.timers.size, 0)
})

test('periodic refresh publishes no tree update when files and markers do not change', async (t) => {
  const f = await fixture(t)
  f.file('jack/existing.md')
  f.config.resources = ['jack']
  await f.tick()
  const provider = f.views.get('favorites').treeDataProvider
  const [jack] = await provider.getChildren()
  await provider.getChildren(jack)
  const updates = []
  provider.onDidChangeTreeData((value) => updates.push(value))
  await f.tick()
  await f.tick()
  assert.deepEqual(updates, [])
})

test('a temporary root stat failure preserves NEW through recovery', async (t) => {
  const f = await fixture(t)
  f.file('jack/existing.md')
  f.config.resources = ['jack']
  await f.tick()
  f.file('jack/new.md')
  await f.tick()
  const stat = f.vscode.workspace.fs.stat
  f.vscode.workspace.fs.stat = async (uri) => {
    if (uri.fsPath === path.join(f.root, 'jack')) throw Object.assign(new Error('Temporarily unavailable'), { code: 'Unavailable' })
    return stat(uri)
  }
  await f.tick()
  f.vscode.workspace.fs.stat = stat
  await f.tick()
  const provider = f.views.get('favorites').treeDataProvider
  const [jack] = await provider.getChildren()
  assert.equal((await provider.getChildren(jack)).find((item) => item.label === 'new.md').iconPath?.id, 'new-file')
})

test('manual refresh joins an old scan and then rescans new disk entries', async (t) => {
  const f = await fixture(t)
  f.file('jack/existing.md')
  f.config.resources = ['jack']
  await f.tick()
  const read = f.vscode.workspace.fs.readDirectory
  let release, entered, paused = false
  const wait = new Promise((resolve) => { release = resolve })
  const reading = new Promise((resolve) => { entered = resolve })
  f.vscode.workspace.fs.readDirectory = async (uri) => {
    const entries = await read(uri)
    if (!paused) { paused = true; entered(); await wait }
    return entries
  }
  const timer = f.tick()
  await reading
  f.file('jack/new.md')
  const manual = f.run('favorites.nav.refresh')
  release()
  await Promise.all([timer, manual])
  const provider = f.views.get('favorites').treeDataProvider
  const [jack] = await provider.getChildren()
  assert.equal((await provider.getChildren(jack)).find((item) => item.label === 'new.md').iconPath?.id, 'new-file')
})

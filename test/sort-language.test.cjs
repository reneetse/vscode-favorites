const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { test } = require('node:test')
const { fixture, Uri } = require('./fixture.cjs')

test('changing groups in VS Code settings registers the new group command', async (t) => {
  const f = await fixture(t)
  const file = f.file('note.md')
  await f.changeConfig('groups', ['Default', 'Reviews'])
  await f.run('favorites.addToFavorites.Reviews', file)
  assert.deepEqual(f.config.resources, [{ filePath: 'note.md', group: 'Reviews' }])
})

test('create and switch group commands show only the selected group bookmarks', async (t) => {
  const f = await fixture(t)
  const file = f.file('review.md')
  f.file('default.md')
  f.config.resources = ['default.md']
  f.vscode.window.showQuickPick = async (items) => items.find((item) => item === 'Input new group name')
  f.input.name = 'Reviews'
  await f.run('favorites.group.newGroup')
  assert.deepEqual(f.config.groups, ['Default', 'Other', 'Reviews'])
  assert.equal(f.config.currentGroup, 'Reviews')
  await f.run('favorites.addToFavorites.Reviews', file)
  const provider = f.views.get('favorites').treeDataProvider
  assert.deepEqual(Array.from(await provider.getChildren(), (row) => row.label), ['review.md'])
  f.vscode.window.showQuickPick = async (items) => items.find((item) => item === 'Default')
  await f.run('favorites.group.changeGroup')
  assert.equal(f.config.currentGroup, 'Default')
  assert.deepEqual(Array.from(await provider.getChildren(), (row) => row.label), ['default.md'])
})

test('file type sort groups equal extensions after directories', async (t) => {
  const f = await fixture(t, { sortOrder: 'FILETYPE' })
  for (const name of ['a.ts', 'z.MD', 'b.md', 'notes/keep.txt']) f.file(name)
  f.config.resources = ['a.ts', 'z.MD', 'b.md', 'notes']
  const provider = f.views.get('favorites').treeDataProvider
  assert.deepEqual(Array.from(await provider.getChildren(), (row) => row.label), ['notes', 'b.md', 'z.MD', 'a.ts'])
})

test('folder refresh in manual order does not stat every listed child', async (t) => {
  const f = await fixture(t, { refreshInterval: 0 })
  await f.views.get('favorites').treeDataProvider.refresh()
  const file = f.file('jack/note.md')
  f.file('jack/sub/keep.md')
  f.config.resources = ['jack']
  const provider = f.views.get('favorites').treeDataProvider
  const [jack] = await provider.getChildren()
  const stat = f.vscode.workspace.fs.stat
  const inspected = []
  f.vscode.workspace.fs.stat = async (uri) => { inspected.push(uri.fsPath); return stat(uri) }
  assert.deepEqual(Array.from(await provider.getChildren(jack), (row) => row.label), ['sub', 'note.md'])
  assert.ok(!inspected.includes(file.fsPath))
  assert.ok(!inspected.includes(path.join(f.root, 'jack/sub')))
})

test('auto language follows the VS Code locale in both views', async (t) => {
  const f = await fixture(t)
  f.vscode.env.language = 'zh-cn'
  await f.changeConfig('language', 'auto')
  assert.ok([...f.treeViews.values()].every((view) => view.title === '收藏'))
  f.vscode.env.language = 'en-gb'
  await f.changeConfig('language', 'en')
  await f.changeConfig('language', 'auto')
  assert.ok([...f.treeViews.values()].every((view) => view.title === 'Favorites'))
})

test('modified-time sorting works in both directions with folders first', async (t) => {
  const f = await fixture(t)
  const older = f.file('a.md'), newer = f.file('b.md')
  f.file('docs/child.md')
  fs.utimesSync(older.fsPath, 100, 100)
  fs.utimesSync(newer.fsPath, 200, 200)
  fs.utimesSync(path.join(f.root, 'docs'), 50, 50)
  f.config.resources = ['a.md', 'docs', 'b.md']
  const provider = f.views.get('favorites').treeDataProvider
  f.config.sortOrder = 'MTIME_DESC'
  assert.deepEqual(Array.from(await provider.getChildren(), (item) => item.label), ['docs', 'b.md', 'a.md'])
  f.config.sortOrder = 'MTIME_ASC'
  assert.deepEqual(Array.from(await provider.getChildren(), (item) => item.label), ['docs', 'a.md', 'b.md'])
})

test('folder children use modified timestamps and retain directory identities', async (t) => {
  const f = await fixture(t, { sortOrder: 'MTIME_DESC' })
  const older = f.file('jack/old.md'), newer = f.file('jack/new.md')
  f.file('jack/nested/child.md')
  fs.utimesSync(older.fsPath, 100, 100)
  fs.utimesSync(newer.fsPath, 200, 200)
  f.config.resources = ['jack']
  const provider = f.views.get('favorites').treeDataProvider
  const children = await provider.getChildren(f.item(Uri.file(path.join(f.root, 'jack'))))
  assert.deepEqual(Array.from(children, (item) => item.label), ['nested', 'new.md', 'old.md'])
  assert.ok(children[0].contextValue.endsWith('.dir'))
  assert.equal(children[0].collapsibleState, 1)
})

test('name sorting uses natural numbers and timestamp ties fall back to names', async (t) => {
  const f = await fixture(t)
  for (const name of ['note10.md', 'note2.md', 'note1.md']) {
    const uri = f.file(name)
    fs.utimesSync(uri.fsPath, 100, 100)
  }
  f.config.resources = ['note10.md', 'note2.md', 'note1.md']
  const provider = f.views.get('favorites').treeDataProvider
  for (const sort of ['ASC', 'MTIME_DESC', 'MTIME_ASC']) {
    f.config.sortOrder = sort
    assert.deepEqual(Array.from(await provider.getChildren(), (item) => item.label), ['note1.md', 'note2.md', 'note10.md'])
  }
  f.config.sortOrder = 'DESC'
  assert.deepEqual(Array.from(await provider.getChildren(), (item) => item.label), ['note10.md', 'note2.md', 'note1.md'])
})

test('sort picker persists the chosen mode and cancellation preserves it', async (t) => {
  const f = await fixture(t)
  f.input.pick = 'MTIME_DESC'
  await f.run('favorites.nav.sort')
  assert.equal(f.config.sortOrder, 'MTIME_DESC')
  f.input.pick = 'cancel'
  await f.run('favorites.nav.sort')
  assert.equal(f.config.sortOrder, 'MTIME_DESC')
})

test('Chinese is the default and language changes update both views and prompts', async (t) => {
  const f = await fixture(t, { language: undefined })
  await f.run('favorites.newFolder')
  assert.match(f.messages.at(-1)[1], /请先选择/)
  assert.equal(f.contexts.get('ext:favoritesEnglish'), false)
  await f.changeConfig('language', 'en')
  await f.run('favorites.localized.en.newFolder')
  assert.match(f.messages.at(-1)[1], /choose a resource/)
  assert.equal(f.contexts.get('ext:favoritesEnglish'), true)
  for (const view of f.treeViews.values()) assert.equal(view.title, 'Favorites')
  f.vscode.env.language = 'zh-cn'
  await f.changeConfig('language', 'auto')
  await f.run('favorites.newFolder')
  assert.match(f.messages.at(-1)[1], /请先选择/)
  for (const view of f.treeViews.values()) assert.equal(view.title, '收藏')
})

test('sort picker and expanded children use the separate configuration when enabled', async (t) => {
  const f = await fixture(t, { saveSeparated: true })
  for (const [name, time] of [['jack/a.md', 100], ['jack/b.md', 200]]) {
    const file = f.file(name)
    fs.utimesSync(file.fsPath, time, time)
  }
  fs.writeFileSync(path.join(f.root, '.vscfavoriterc'), JSON.stringify({
    resources: ['jack/a.md', 'jack/b.md'], groups: ['Default'], currentGroup: 'Default', sortOrder: 'ASC',
  }))
  f.input.pick = 'MTIME_DESC'
  await f.run('favorites.nav.sort')
  const provider = f.views.get('favorites').treeDataProvider
  assert.deepEqual(Array.from(await provider.getChildren(), (item) => item.label), ['b.md', 'a.md'])
  assert.deepEqual(Array.from(await provider.getChildren(f.item(Uri.file(path.join(f.root, 'jack')))), (item) => item.label), ['b.md', 'a.md'])
  assert.equal(f.config.sortOrder, 'MANUAL')
})

test('legacy separate files without a sort key retain the existing settings sort order', async (t) => {
  const f = await fixture(t, { saveSeparated: true, sortOrder: 'DESC' })
  f.file('a.md'); f.file('b.md')
  fs.writeFileSync(path.join(f.root, '.vscfavoriterc'), JSON.stringify({ resources: ['a.md', 'b.md'], currentGroup: 'Default' }))
  const provider = f.views.get('favorites').treeDataProvider
  assert.deepEqual(Array.from(await provider.getChildren(), (item) => item.label), ['b.md', 'a.md'])
})

test('separate-file group changes update the group message in both views', async (t) => {
  const f = await fixture(t, { saveSeparated: true })
  const file = f.file('a.md')
  fs.writeFileSync(path.join(f.root, '.vscfavoriterc'), JSON.stringify({ resources: [], currentGroup: 'Default', groups: ['Default', 'Other'] }))
  await f.run('favorites.addToFavoritesGroup', file)
  for (const view of f.treeViews.values()) assert.equal(view.message, 'Current Group: Other')
})

test('manual movement overrides a separate-file time sort so the reordered row is visible', async (t) => {
  const f = await fixture(t, { saveSeparated: true })
  const a = f.file('a.md'), b = f.file('b.md')
  fs.utimesSync(a.fsPath, 100, 100)
  fs.utimesSync(b.fsPath, 200, 200)
  fs.writeFileSync(path.join(f.root, '.vscfavoriterc'), JSON.stringify({
    resources: [{ filePath: 'a.md', group: 'Default' }, { filePath: 'b.md', group: 'Default' }],
    groups: ['Default'], sortOrder: 'MTIME_ASC',
  }))
  await f.run('favorites.moveUp', f.item(b))
  const provider = f.views.get('favorites').treeDataProvider
  assert.deepEqual(Array.from(await provider.getChildren(), (item) => item.label), ['b.md', 'a.md'])
})

test('manual reordering starts from the visible modified-time order', async (t) => {
  const f = await fixture(t, { sortOrder: 'MTIME_DESC' })
  const a = f.file('a.md'), b = f.file('b.md')
  fs.utimesSync(a.fsPath, 100, 100)
  fs.utimesSync(b.fsPath, 200, 200)
  f.config.resources = [{ filePath: 'a.md', group: 'Default' }, { filePath: 'b.md', group: 'Default' }]
  const provider = f.views.get('favorites').treeDataProvider
  assert.deepEqual(Array.from(await provider.getChildren(), (item) => item.label), ['b.md', 'a.md'])
  await f.run('favorites.moveUp', f.item(a))
  assert.deepEqual(Array.from(await provider.getChildren(), (item) => item.label), ['a.md', 'b.md'])
  assert.equal(f.config.sortOrder, 'MANUAL')
})

test('reordering preserves a favorite added while the visible rows are being read', async (t) => {
  const f = await fixture(t, { sortOrder: 'DESC' })
  const a = f.file('a.md'); f.file('b.md')
  const added = f.file('c.md')
  f.config.resources = [{ filePath: 'a.md', group: 'Default' }, { filePath: 'b.md', group: 'Default' }]
  let release, entered, blocked = false
  const wait = new Promise((resolve) => { release = resolve })
  const inspecting = new Promise((resolve) => { entered = resolve })
  const stat = f.vscode.workspace.fs.stat
  f.vscode.workspace.fs.stat = async (uri) => {
    if (!blocked) { blocked = true; entered(); await wait }
    return stat(uri)
  }
  const reordering = f.run('favorites.moveUp', f.item(a))
  await inspecting
  await f.run('favorites.addToFavorites', added)
  release()
  await reordering
  assert.deepEqual(f.config.resources.map((item) => item.filePath), ['a.md', 'b.md', 'c.md'])
})

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { test } = require('node:test')
const { fixture, Uri } = require('./fixture.cjs')

test('moving an already-contained pinned file into jack folds its root display without deleting bookmark data', async (t) => {
  const f = await fixture(t)
  const uri = f.file('docs/jack/待办_零碎代码治理.md')
  f.config.resources = [
    { filePath: 'docs/jack', group: 'Default' },
    { filePath: 'docs/jack/待办_零碎代码治理.md', group: 'Default' },
    { filePath: 'docs/jack/待办_零碎代码治理.md', group: 'Other' },
  ]
  f.input.folder = Uri.file(path.dirname(uri.fsPath))
  await f.run('favorites.moveToFolder', f.item(uri))
  assert.equal(fs.readFileSync(uri.fsPath, 'utf8'), 'docs/jack/待办_零碎代码治理.md')
  assert.deepEqual(f.config.resources, [
    { filePath: 'docs/jack', group: 'Default' },
    { filePath: 'docs/jack/待办_零碎代码治理.md', group: 'Default' },
    { filePath: 'docs/jack/待办_零碎代码治理.md', group: 'Other' },
  ])
  assert.deepEqual(Array.from(await f.views.get('favorites').treeDataProvider.getChildren(), (item) => item.label), ['jack'])
  assert.equal(f.appliedEdits.length, 0)
})

test('explicit favorites excluded from folder contents keep their independent root entry', async (t) => {
  const f = await fixture(t)
  const file = f.file('jack/hide.md')
  f.config.resources = ['jack', 'jack/hide.md']
  f.settings.filesExclude = { '**/hide.md': true }
  const provider = f.views.get('favorites').treeDataProvider
  assert.ok((await provider.getChildren()).some((item) => item.resourceUri.toString() === file.toString()))
  assert.ok(await provider.findResource(file))
})

test('an explicitly bookmarked nested child can be unpinned without deleting its file', async (t) => {
  const f = await fixture(t)
  const file = f.file('jack/a.md')
  f.config.resources = ['jack', 'jack/a.md']
  const provider = f.views.get('favorites').treeDataProvider
  const [jack] = await provider.getChildren()
  const [child] = await provider.getChildren(jack)
  assert.match(child.contextValue, /\.pinned/)
  await f.run('favorites.deleteFavorite', child)
  assert.equal(fs.existsSync(file.fsPath), true)
  assert.equal(f.config.resources.length, 1)
  assert.equal(f.config.resources[0].filePath, 'jack')
})

test('a Windows pinned child is removable when configured and actual filename casing differ', async (t) => {
  const f = await fixture(t, {}, { platform: 'win32' })
  const file = f.file('jack/foo.md')
  f.config.resources = ['jack', 'jack/Foo.md']
  const provider = f.views.get('favorites').treeDataProvider
  const [jack] = await provider.getChildren()
  const [child] = await provider.getChildren(jack)
  assert.match(child.contextValue, /\.pinned/)
  await f.run('favorites.deleteFavorite', child)
  assert.equal(f.config.resources.length, 1)
  assert.equal(fs.existsSync(file.fsPath), true)
})

test('a moved child excluded at its destination stays accessible as an independent favorite', async (t) => {
  const f = await fixture(t)
  const file = f.file('src/a.md')
  fs.mkdirSync(path.join(f.root, 'dst'))
  f.config.resources = ['src', 'dst']
  f.settings.filesExclude = { 'dst/a.md': true }
  f.input.folder = Uri.file(path.join(f.root, 'dst'))
  await f.run('favorites.moveToFolder', f.item(file, true))
  const provider = f.views.get('favorites').treeDataProvider
  assert.ok((await provider.getChildren()).some((item) => item.resourceUri.fsPath === path.join(f.root, 'dst/a.md')))
})

test('a multi-root move stores new independent favorites as absolute paths', async (t) => {
  const f = await fixture(t)
  const second = f.addRepository('second')
  f.vscode.workspace.workspaceFolders.push({ uri: second.rootUri })
  const file = f.file('jack/a.md')
  fs.mkdirSync(path.join(f.root, 'outside'))
  f.config.resources = [{ filePath: path.join(f.root, 'jack'), group: 'Default' }]
  f.input.folder = Uri.file(path.join(f.root, 'outside'))
  await f.run('favorites.moveToFolder', f.item(file, true))
  assert.ok(f.config.resources.some((item) => item.filePath === path.join(f.root, 'outside/a.md')))
})

test('moving a Windows drive-root child upward refuses to drop the drive prefix', async (t) => {
  const f = await fixture(t)
  await f.run('favorites.moveToParentFolder', f.item(Uri.parse('file:///d:/foo.md')))
  assert.equal(f.appliedEdits.length, 0)
  assert.match(f.messages.at(-1)[1], /no parent destination/i)
})

test('equivalent trailing-slash folder bookmarks retain one visible root', async (t) => {
  const f = await fixture(t)
  const file = f.file('jack/a.md')
  const directory = Uri.file(path.dirname(file.fsPath))
  f.config.resources = [directory.toString(), directory.toString() + '/']
  const roots = await f.views.get('favorites').treeDataProvider.getChildren()
  assert.equal(roots.length, 1)
  assert.equal(roots[0].label, 'jack')
})

test('a file can move out of 1231 into its parent without choosing its current directory again', async (t) => {
  const f = await fixture(t)
  const name = '木桩训练场伤害统计时间对齐改造设计.md'
  const uri = f.file('docs/jack/1231/' + name)
  f.config.resources = [{ filePath: 'docs/jack', group: 'Default' }, { filePath: 'docs/jack/1231/' + name, group: 'Default' }]
  await f.run('favorites.moveToParentFolder', f.item(uri, true))
  assert.equal(fs.existsSync(uri.fsPath), false)
  assert.ok(fs.existsSync(path.join(f.root, 'docs/jack', name)))
  assert.deepEqual(f.config.resources, [{ filePath: 'docs/jack', group: 'Default' }, { filePath: 'docs/jack/' + name, group: 'Default' }])
  const provider = f.views.get('favorites').treeDataProvider
  const [jack] = await provider.getChildren()
  assert.ok((await provider.getChildren(jack)).some((child) => child.label === name))
})

test('moving a folder child outside all favorite folders keeps it accessible as a standalone favorite', async (t) => {
  const f = await fixture(t)
  const uri = f.file('jack/a.md')
  fs.mkdirSync(path.join(f.root, 'outside'))
  f.config.resources = [{ filePath: 'jack', group: 'Default' }]
  f.input.folder = Uri.file(path.join(f.root, 'outside'))
  await f.run('favorites.moveToFolder', f.item(uri, true))
  assert.ok(f.config.resources.some((item) => item.filePath === 'outside/a.md'))
})

test('moving without a covering favorite keeps the standalone bookmark', async (t) => {
  const f = await fixture(t)
  const uri = f.file('from/a.md')
  fs.mkdirSync(path.join(f.root, 'target'))
  f.config.resources = [{ filePath: 'from/a.md', group: 'Default' }]
  f.input.folder = Uri.file(path.join(f.root, 'target'))
  await f.run('favorites.moveToFolder', f.item(uri))
  assert.deepEqual(f.config.resources, [{ filePath: 'target/a.md', group: 'Default' }])
})

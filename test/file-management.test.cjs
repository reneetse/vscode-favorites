const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { test } = require('node:test')
const { fixture, Uri } = require('./fixture.cjs')

test('batch move puts real files back into jack and updates favorites in all groups', async (t) => {
  const f = await fixture(t)
  const a = f.file('elsewhere/中文 待办.md'), b = f.file('elsewhere/b.md')
  const jack = Uri.file(path.join(f.root, 'jack'))
  fs.mkdirSync(jack.fsPath)
  f.input.folder = jack
  f.config.resources = [
    { filePath: 'elsewhere/中文 待办.md', group: 'Default' },
    { filePath: 'elsewhere/中文 待办.md', group: 'Other' },
    'elsewhere/b.md',
    { filePath: 'jack', group: 'Default' },
  ]
  const selected = [f.item(a), f.item(b, true), f.item(a)]
  await f.run('favorites.moveToFolder', selected[0], selected)
  assert.equal(fs.existsSync(a.fsPath), false)
  assert.equal(fs.existsSync(b.fsPath), false)
  assert.equal(fs.readFileSync(path.join(jack.fsPath, '中文 待办.md'), 'utf8'), 'elsewhere/中文 待办.md')
  assert.deepEqual(f.config.resources, [
    { filePath: 'jack/中文 待办.md', group: 'Default' },
    { filePath: 'jack/中文 待办.md', group: 'Other' },
    'jack/b.md',
    { filePath: 'jack', group: 'Default' },
  ])
})

test('moving a batch rejects a destination collision before moving any file', async (t) => {
  const f = await fixture(t)
  const a = f.file('from/a.md'), b = f.file('from/b.md')
  const existing = f.file('jack/b.md')
  f.input.folder = Uri.file(path.dirname(existing.fsPath))
  await f.run('favorites.moveToFolder', f.item(a), [f.item(a), f.item(b)])
  assert.ok(fs.existsSync(a.fsPath) && fs.existsSync(b.fsPath))
  assert.equal(fs.existsSync(path.join(f.root, 'jack/a.md')), false)
  assert.equal(fs.readFileSync(existing.fsPath, 'utf8'), 'jack/b.md')
  assert.equal(f.appliedEdits.length, 0)
  assert.equal(f.messages.at(-1)[0], 'error')
})

test('moving duplicate basenames from different directories never overwrites either file', async (t) => {
  const f = await fixture(t)
  const a = f.file('one/a.md'), b = f.file('two/a.md')
  f.input.folder = Uri.file(f.root)
  await f.run('favorites.moveToFolder', f.item(a), [f.item(a), f.item(b)])
  assert.ok(fs.existsSync(a.fsPath) && fs.existsSync(b.fsPath))
  assert.equal(f.appliedEdits.length, 0)
})

test('dropping selected files onto a directory moves disk files instead of adding child favorites', async (t) => {
  const f = await fixture(t)
  const a = f.file('outside/a.md'), b = f.file('outside/b.md')
  const jack = Uri.file(path.join(f.root, 'jack'))
  fs.mkdirSync(jack.fsPath)
  f.config.resources = [{ filePath: 'jack', group: 'Default' }]
  const controller = f.views.get('favorites').dragAndDropController
  const transfer = new Map()
  controller.handleDrag([f.item(a, true), f.item(b, true)], transfer, {})
  await controller.handleDrop({ ...f.item(jack), contextValue: 'uri.resource.dir' }, transfer, {})
  assert.equal(fs.existsSync(a.fsPath), false)
  assert.ok(fs.existsSync(path.join(jack.fsPath, 'a.md')) && fs.existsSync(path.join(jack.fsPath, 'b.md')))
  assert.deepEqual(f.config.resources, [{ filePath: 'jack', group: 'Default' }])
  assert.equal(f.config.sortOrder, 'MANUAL')
})

test('folder moves update descendant favorites without changing similarly prefixed siblings', async (t) => {
  const f = await fixture(t)
  const child = f.file('folder/nested/a.md')
  f.file('folder-other/b.md')
  const target = Uri.file(path.join(f.root, 'jack'))
  fs.mkdirSync(target.fsPath)
  f.input.folder = target
  f.config.resources = ['folder/nested/a.md', 'folder-other/b.md']
  const folder = { ...f.item(Uri.file(path.join(f.root, 'folder'))), contextValue: 'uri.resource.dir' }
  await f.run('favorites.moveToFolder', folder, [folder, f.item(child, true)])
  assert.deepEqual(f.config.resources, ['jack/folder/nested/a.md', 'folder-other/b.md'])
  assert.ok(fs.existsSync(path.join(target.fsPath, 'folder/nested/a.md')))
})

test('moving a directory into itself or its descendants is rejected', async (t) => {
  const f = await fixture(t)
  const child = f.file('folder/nested/a.md')
  f.input.folder = Uri.file(path.dirname(child.fsPath))
  await f.run('favorites.moveToFolder', f.item(Uri.file(path.join(f.root, 'folder'))))
  assert.equal(f.appliedEdits.length, 0)
  assert.ok(fs.existsSync(child.fsPath))
})

test('new folder uses the selected directory or the selected file parent', async (t) => {
  const f = await fixture(t)
  const file = f.file('jack/note.md')
  f.input.name = '新建目录'
  await f.run('favorites.newFolder', f.item(file, true))
  assert.ok(fs.statSync(path.join(f.root, 'jack/新建目录')).isDirectory())
  f.input.name = 'nested'
  await f.run('favorites.newFolder', { ...f.item(Uri.file(path.join(f.root, 'jack/新建目录'))), contextValue: 'uri.resourceChild.dir' })
  assert.ok(fs.statSync(path.join(f.root, 'jack/新建目录/nested')).isDirectory())
})

test('new folder rejects path traversal and existing names without changing files', async (t) => {
  const f = await fixture(t)
  const file = f.file('jack/note.md')
  for (const name of ['../escape', 'a/b', '..', 'note.md']) {
    f.input.name = name
    await f.run('favorites.newFolder', f.item(file))
  }
  assert.deepEqual(fs.readdirSync(path.join(f.root, 'jack')), ['note.md'])
  assert.equal(f.messages.filter(([kind]) => kind === 'error').length, 4)
})

test('cancelled and same-directory moves leave the disk and configuration untouched', async (t) => {
  const f = await fixture(t)
  const file = f.file('jack/a.md')
  await f.run('favorites.moveToFolder', f.item(file))
  f.input.folder = Uri.file(path.dirname(file.fsPath))
  await f.run('favorites.moveToFolder', f.item(file))
  assert.ok(fs.existsSync(file.fsPath))
  assert.equal(f.appliedEdits.length, 0)
  assert.equal(f.writes.length, 0)
})

test('a runtime partial move updates favorites for files that actually moved', async (t) => {
  const f = await fixture(t)
  const a = f.file('from/a.md'), b = f.file('from/b.md')
  fs.mkdirSync(path.join(f.root, 'jack'))
  f.input.folder = Uri.file(path.join(f.root, 'jack'))
  f.config.resources = ['from/a.md', 'from/b.md']
  f.vscode.workspace.applyEdit = async (edit) => {
    const { oldUri, newUri } = edit.renames[0]
    fs.renameSync(oldUri.fsPath, newUri.fsPath)
    return false
  }
  await f.run('favorites.moveToFolder', f.item(a), [f.item(a), f.item(b)])
  assert.ok(fs.existsSync(path.join(f.root, 'jack/a.md')) && fs.existsSync(b.fsPath))
  assert.deepEqual(f.config.resources, ['jack/a.md', 'from/b.md'])
  assert.equal(f.messages.at(-1)[0], 'error')
  assert.match(f.messages.at(-1)[1], /Completed 1 of 2/)
})

test('external directory renames and undo update URI and relative favorites at segment boundaries', async (t) => {
  const f = await fixture(t)
  const file = f.file('jack/中文 待办.md')
  f.file('jack-other/a.md')
  f.config.resources = [file.toString(), 'jack/中文 待办.md', 'jack-other/a.md']
  const oldUri = Uri.file(path.join(f.root, 'jack')), newUri = Uri.file(path.join(f.root, 'moved'))
  fs.renameSync(oldUri.fsPath, newUri.fsPath)
  await f.rename([{ oldUri, newUri }])
  assert.deepEqual(f.config.resources, [Uri.file(path.join(f.root, 'moved/中文 待办.md')).toString(), 'moved/中文 待办.md', 'jack-other/a.md'])
  fs.renameSync(newUri.fsPath, oldUri.fsPath)
  await f.rename([{ oldUri: newUri, newUri: oldUri }])
  assert.deepEqual(f.config.resources, [file.toString(), 'jack/中文 待办.md', 'jack-other/a.md'])
})

test('remote URI folder children retain the URI authority and can be moved', async (t) => {
  const f = await fixture(t)
  const file = f.file('remote/old/a.md')
  fs.mkdirSync(path.join(f.root, 'remote/jack'))
  const parent = Uri.parse('vscode-remote://ssh-remote+dev' + path.dirname(file.fsPath))
  const destination = Uri.parse('vscode-remote://ssh-remote+dev' + path.join(f.root, 'remote/jack'))
  f.config.resources = [parent.toString()]
  const provider = f.views.get('favorites').treeDataProvider
  const [parentItem] = await provider.getChildren()
  const children = await provider.getChildren(parentItem)
  assert.equal(children[0].resourceUri.scheme, 'vscode-remote')
  assert.equal(children[0].resourceUri.authority, 'ssh-remote+dev')
  f.input.folder = destination
  await f.run('favorites.moveToFolder', children[0])
  assert.ok(fs.existsSync(path.join(destination.fsPath, 'a.md')))
})

test('root drops reorder existing absolute favorites without duplicating them', async (t) => {
  const f = await fixture(t)
  const file = f.file('a.md')
  f.config.resources = [{ filePath: file.fsPath, group: 'Default' }]
  const controller = f.views.get('favorites').dragAndDropController
  const transfer = new Map()
  controller.handleDrag([f.item(file)], transfer, {})
  await controller.handleDrop(undefined, transfer, {})
  assert.equal(f.config.resources.length, 1)
  assert.ok(fs.existsSync(file.fsPath))
})

test('root drops preserve virtual favorites that differ only by query or fragment', async (t) => {
  const f = await fixture(t)
  const one = Uri.parse('git:/repo/note.md?ref=one'), two = Uri.parse('git:/repo/note.md?ref=two')
  f.config.resources = [
    { filePath: one.toString(), group: 'Default' },
    { filePath: two.toString(), group: 'Default' },
  ]
  const controller = f.views.get('favorites').dragAndDropController
  const transfer = new Map()
  controller.handleDrag([f.item(one)], transfer, {})
  await controller.handleDrop(undefined, transfer, {})
  assert.deepEqual(f.config.resources.map((item) => item.filePath), [two.toString(), one.toString()])
})

test('a partial-move recovery keeps the move lock until favorites are reconciled', async (t) => {
  const f = await fixture(t)
  const a = f.file('from/a.md'), b = f.file('from/b.md')
  fs.mkdirSync(path.join(f.root, 'jack'))
  fs.mkdirSync(path.join(f.root, 'later'))
  const moved = Uri.file(path.join(f.root, 'jack/a.md'))
  f.config.resources = ['from/a.md', 'from/b.md']
  f.input.folder = Uri.file(path.dirname(moved.fsPath))
  const apply = f.vscode.workspace.applyEdit
  let partial = false, blocked = false
  f.vscode.workspace.applyEdit = async (edit) => {
    if (partial) return apply(edit)
    const first = edit.renames[0]
    fs.renameSync(first.oldUri.fsPath, first.newUri.fsPath)
    partial = true
    return false
  }
  let release, entered
  const wait = new Promise((resolve) => { release = resolve })
  const inspecting = new Promise((resolve) => { entered = resolve })
  const stat = f.vscode.workspace.fs.stat
  f.vscode.workspace.fs.stat = async (uri) => {
    if (partial && !blocked && uri.fsPath === moved.fsPath) {
      blocked = true
      entered()
      await wait
    }
    return stat(uri)
  }
  const firstMove = f.run('favorites.moveToFolder', f.item(a), [f.item(a), f.item(b)])
  await inspecting
  try {
    f.input.folder = Uri.file(path.join(f.root, 'later'))
    await f.run('favorites.moveToFolder', f.item(moved))
    assert.ok(fs.existsSync(moved.fsPath))
    assert.match(f.messages.at(-1)[1], /Another move is in progress/)
  } finally {
    release()
    await firstMove
  }
  assert.deepEqual(f.config.resources, ['jack/a.md', 'from/b.md'])
})

test('case-only destination names are rejected before any file is moved', async (t) => {
  const f = await fixture(t)
  const a = f.file('one/a.md'), b = f.file('two/A.md')
  fs.mkdirSync(path.join(f.root, 'jack'))
  f.input.folder = Uri.file(path.join(f.root, 'jack'))
  await f.run('favorites.moveToFolder', f.item(a), [f.item(a), f.item(b)])
  assert.ok(fs.existsSync(a.fsPath) && fs.existsSync(b.fsPath))
  assert.equal(f.appliedEdits.length, 0)
})

test('external Explorer drops add favorites without moving an incomplete drag selection', async (t) => {
  const f = await fixture(t)
  const a = f.file('outside/a.md')
  fs.mkdirSync(path.join(f.root, 'jack'))
  const jack = Uri.file(path.join(f.root, 'jack'))
  const transfer = new Map([['text/uri-list', new f.vscode.DataTransferItem(a.toString())]])
  const controller = f.views.get('favorites').dragAndDropController
  await controller.handleDrop({ ...f.item(jack), contextValue: 'uri.resource.dir' }, transfer, {})
  assert.ok(fs.existsSync(a.fsPath))
  assert.equal(fs.existsSync(path.join(jack.fsPath, 'a.md')), false)
  assert.deepEqual(f.config.resources, [{ filePath: 'outside/a.md', group: 'Default' }])
})

test('another tree using a generic resource payload cannot trigger a physical move', async (t) => {
  const f = await fixture(t)
  const a = f.file('outside/a.md')
  fs.mkdirSync(path.join(f.root, 'jack'))
  const jack = Uri.file(path.join(f.root, 'jack'))
  const transfer = new Map([['resource', new f.vscode.DataTransferItem(JSON.stringify([a.toString()]))]])
  await f.views.get('favorites').dragAndDropController.handleDrop({ ...f.item(jack), contextValue: 'uri.resource.dir' }, transfer, {})
  assert.ok(fs.existsSync(a.fsPath))
  assert.equal(f.appliedEdits.length, 0)
})

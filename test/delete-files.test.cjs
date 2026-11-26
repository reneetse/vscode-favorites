const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { test } = require('node:test')
const { fixture, Uri } = require('./fixture.cjs')

test('deleting a selected folder removes disk contents and bookmarks across groups', async (t) => {
  const f = await fixture(t)
  const nested = f.file('jack/sub/a.md'), keep = f.file('jack/keep.md')
  f.config.resources = [
    { filePath: 'jack', group: 'Default' },
    { filePath: 'jack/sub/a.md', group: 'Default' },
    { filePath: 'jack/sub/a.md', group: 'Other' },
    'jack/keep.md',
  ]
  f.input.confirm = true
  const sub = f.item(Uri.file(path.dirname(nested.fsPath)), true)
  await f.run('favorites.deleteFiles', sub, [sub, f.item(nested, true)])
  assert.equal(fs.existsSync(path.dirname(nested.fsPath)), false)
  assert.equal(fs.existsSync(keep.fsPath), true)
  assert.deepEqual(f.config.resources, [{ filePath: 'jack', group: 'Default' }, 'jack/keep.md'])
})

test('cancelling physical deletion keeps files and favorite entries', async (t) => {
  const f = await fixture(t)
  const file = f.file('jack/a.md')
  f.config.resources = ['jack/a.md']
  await f.run('favorites.deleteFiles', f.item(file))
  assert.ok(fs.existsSync(file.fsPath))
  assert.deepEqual(f.config.resources, ['jack/a.md'])
})

test('physical deletion refuses an entire workspace even after confirmation', async (t) => {
  const f = await fixture(t)
  f.file('a.md')
  f.input.confirm = true
  await f.run('favorites.deleteFiles', f.item(Uri.file(f.root)))
  assert.ok(fs.existsSync(path.join(f.root, 'a.md')))
  assert.equal(f.messages.at(-1)[0], 'error')
})

test('trash failure does not permanently delete without a second confirmation', async (t) => {
  const f = await fixture(t)
  const file = f.file('jack/a.md')
  f.config.resources = ['jack/a.md']
  let attempts = 0
  f.vscode.workspace.fs.delete = async (uri, options) => {
    attempts++
    if (options.useTrash) throw Object.assign(new Error('Trash unavailable'), { code: 'Unavailable' })
    fs.rmSync(uri.fsPath)
  }
  let confirmations = 0
  f.vscode.window.showWarningMessage = async (message, options, ...items) => ++confirmations === 1 ? items[0] : undefined
  await f.run('favorites.deleteFiles', f.item(file))
  assert.ok(fs.existsSync(file.fsPath))
  assert.equal(attempts, 1)
  assert.deepEqual(f.config.resources, ['jack/a.md'])
})

test('a file replaced by a directory during confirmation is not recursively deleted', async (t) => {
  const f = await fixture(t)
  const file = f.file('jack/a.md')
  let replaced = false
  f.vscode.window.showWarningMessage = async (message, options, ...items) => {
    if (options?.modal && !replaced) {
      replaced = true
      fs.unlinkSync(file.fsPath)
      fs.mkdirSync(file.fsPath)
      fs.writeFileSync(path.join(file.fsPath, 'keep.md'), 'keep')
    }
    return items[0]
  }
  await f.run('favorites.deleteFiles', f.item(file))
  assert.equal(fs.readFileSync(path.join(file.fsPath, 'keep.md'), 'utf8'), 'keep')
})

test('a workspace opened through a symlink cannot be deleted by its real path', async (t) => {
  const f = await fixture(t)
  const file = f.file('a.md')
  const alias = path.join(path.dirname(f.root), 'alias')
  fs.symlinkSync(f.root, alias, 'dir')
  f.vscode.workspace.workspaceFolders = [{ uri: Uri.file(alias) }]
  f.input.confirm = true
  await f.run('favorites.deleteFiles', f.item(Uri.file(f.root)))
  assert.ok(fs.existsSync(file.fsPath))
  assert.equal(f.messages.at(-1)[0], 'error')
})

test('permanent fallback rechecks identity after the second confirmation', async (t) => {
  const f = await fixture(t)
  const file = f.file('jack/a.md')
  f.vscode.workspace.fs.delete = async () => { throw new Error('Trash unsupported') }
  let confirmations = 0
  f.vscode.window.showWarningMessage = async (message, options, ...items) => {
    confirmations++
    if (confirmations === 2) {
      fs.unlinkSync(file.fsPath)
      fs.mkdirSync(file.fsPath)
      fs.writeFileSync(path.join(file.fsPath, 'keep.md'), 'keep')
    }
    return items[0]
  }
  await f.run('favorites.deleteFiles', f.item(file))
  assert.ok(fs.existsSync(path.join(file.fsPath, 'keep.md')))
})

test('a metadata save failure reports disk deletion separately and still clears NEW state', async (t) => {
  const f = await fixture(t)
  f.file('jack/existing.md')
  f.config.resources = ['jack']
  await f.tick()
  const file = f.file('jack/new.md')
  f.config.resources.push('jack/new.md')
  await f.tick()
  const configuration = f.vscode.workspace.getConfiguration
  f.vscode.workspace.getConfiguration = (section) => ({ ...configuration(section), update: async () => { throw new Error('Read-only configuration') } })
  f.input.confirm = true
  await f.run('favorites.deleteFiles', f.item(file))
  assert.equal(fs.existsSync(file.fsPath), false)
  assert.match(f.messages.at(-1)[1], /Disk deletion completed/)
  assert.ok(f.diagnostics.some(([message]) => message.startsWith('delete.completed')))
  fs.writeFileSync(file.fsPath, 'recreated')
  await f.tick()
  const provider = f.views.get('favorites').treeDataProvider
  const [jack] = await provider.getChildren()
  assert.equal((await provider.getChildren(jack)).find((item) => item.label === 'new.md').iconPath?.id, 'new-file')
})

test('deleted rows are invalidated before a slow bookmarks save completes', async (t) => {
  const f = await fixture(t, { refreshInterval: 0 })
  const file = f.file('jack/sub/a.md')
  f.file('jack/keep.md')
  f.config.resources = ['jack', 'jack/sub/a.md']
  const provider = f.views.get('favorites').treeDataProvider
  await provider.refresh()
  const [jack] = await provider.getChildren()
  await provider.getChildren(jack)
  f.input.confirm = true
  const configuration = f.vscode.workspace.getConfiguration
  let saving, release
  const entered = new Promise((resolve) => { saving = resolve })
  const gate = new Promise((resolve) => { release = resolve })
  f.vscode.workspace.getConfiguration = (section) => {
    const settings = configuration(section)
    return { ...settings, update: async (key, value) => { saving(); await gate; await settings.update(key, value) } }
  }
  const changes = []
  provider.onDidChangeTreeData((item) => changes.push(item))
  const deleting = f.run('favorites.deleteFiles', f.item(Uri.file(path.dirname(file.fsPath)), true))
  try {
    await entered
    assert.equal(fs.existsSync(file.fsPath), false)
    assert.deepEqual(changes, [jack])
  } finally {
    release()
    await deleting
  }
})

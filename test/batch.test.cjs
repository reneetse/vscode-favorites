const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { test } = require('node:test')
const { fixture, Uri } = require('./fixture.cjs')

test('both Favorites views enable native multi-selection', async (t) => {
  const f = await fixture(t)
  assert.equal(f.views.size, 2)
  for (const view of f.views.values()) assert.equal(view.canSelectMany, true)
})

test('copy filename uses the URI name including its extension instead of the display label', async (t) => {
  const f = await fixture(t)
  const target = { ...f.item(f.file('docs/中文 待办.md')), label: 'docs/中文 待办.md' }
  await f.run('favorites.copyFileName', target)
  assert.deepEqual(f.copied, ['中文 待办.md'])
})

test('copy path uses absolute paths for files and folder children', async (t) => {
  const f = await fixture(t)
  const uri = f.file('docs/中文 待办.md')
  await f.run('favorites.copyFilePath', f.item(uri, true))
  assert.deepEqual(f.copied, [uri.fsPath])
})

test('copy commands support folders and deduplicate multiple selections in order', async (t) => {
  const f = await fixture(t)
  const uri = f.file('docs/a.md')
  const file = f.item(uri, true)
  const folder = { ...f.item(Uri.file(path.dirname(uri.fsPath))), contextValue: 'uri.resource.dir' }
  await f.run('favorites.copyFileName', folder, [file, folder, file])
  await f.run('favorites.copyFilePath', folder, [file, folder, file])
  assert.deepEqual(f.copied, [
    ['a.md', 'docs'].join(os.EOL),
    [uri.fsPath, path.dirname(uri.fsPath)].join(os.EOL),
  ])
})

test('copy commands handle remote filesystem paths and preserve web URIs', async (t) => {
  const f = await fixture(t)
  const remote = Uri.parse('vscode-remote://ssh-remote+dev/home/user/中文%20待办.md')
  const web = Uri.parse('https://example.com/docs/note%20one.md?version=2#section')
  const selected = [f.item(remote), f.item(web)]
  await f.run('favorites.copyFileName', selected[0], selected)
  await f.run('favorites.copyFilePath', selected[0], selected)
  assert.deepEqual(f.copied, [
    ['中文 待办.md', 'note one.md'].join(os.EOL),
    [remote.fsPath, web.toString()].join(os.EOL),
  ])
})

test('copying an unselected target ignores the previous selection', async (t) => {
  const f = await fixture(t)
  const target = f.item(f.file('target.md'))
  await f.run('favorites.copyFileName', target, [f.item(f.file('other.md'))])
  assert.deepEqual(f.copied, ['target.md'])
})

test('copy commands warn on an empty target without overwriting the clipboard', async (t) => {
  const f = await fixture(t)
  await f.run('favorites.copyFileName')
  await f.run('favorites.copyFilePath')
  assert.deepEqual(f.copied, [])
  assert.equal(f.messages.length, 2)
  assert.ok(f.messages.every(([kind, message]) => kind === 'warning' && /choose a resource/.test(message)))
})

test('Explorer batch add deduplicates and saves resources once', async (t) => {
  const f = await fixture(t)
  const a = f.file('中文 待办.md'),
    b = f.file('another.md')
  f.config.resources = [{ filePath: a.fsPath, group: 'Default' }]
  await f.run('favorites.addToFavorites', a, [a, b, b])
  assert.equal(f.config.resources.length, 2)
  assert.equal(f.config.resources[1].filePath, 'another.md')
  assert.deepEqual(f.writes, ['resources'])
})

test('batch add to group and dynamic group commands handle the entire selection', async (t) => {
  const f = await fixture(t)
  const a = f.file('a.md'),
    b = f.file('b.md')
  await f.run('favorites.addToFavoritesGroup', a, [a, b])
  assert.equal(f.config.currentGroup, 'Other')
  assert.deepEqual(
    f.config.resources.map((r) => r.group),
    ['Other', 'Other'],
  )
  await f.run('favorites.addToFavorites.Default', a, [a, b])
  assert.equal(f.config.resources.length, 4)
  assert.equal(f.config.currentGroup, 'Default')
})

test('right-click outside the selection operates only on the clicked resource', async (t) => {
  const f = await fixture(t)
  const a = f.file('a.md'),
    b = f.file('b.md'),
    c = f.file('c.md')
  await f.run('favorites.addToFavorites', c, [a, b])
  assert.deepEqual(f.config.resources, [{ filePath: 'c.md', group: 'Default' }])
})

test('batch removal preserves other groups, legacy entries and physical files', async (t) => {
  const f = await fixture(t)
  const a = f.file('a.md'),
    b = f.file('b.md')
  const remote = Uri.parse('https://example.com/note')
  f.config.resources = [
    'a.md',
    { filePath: 'b.md', group: 'Default' },
    { filePath: 'a.md', group: 'Other' },
    { filePath: remote.toString(), group: 'Default' },
    { filePath: remote.toString(), group: 'Other' },
  ]
  const selected = [f.item(a), f.item(b), f.item(remote)]
  await f.run('favorites.deleteFavorite', selected[0], selected)
  assert.deepEqual(f.config.resources, [
    { filePath: 'a.md', group: 'Other' },
    { filePath: remote.toString(), group: 'Other' },
  ])
  assert.ok(fs.existsSync(a.fsPath) && fs.existsSync(b.fsPath))
  assert.deepEqual(f.writes, ['resources'])
})

test('folder children mixed into removal prevent partial removal', async (t) => {
  const f = await fixture(t)
  const a = f.item(f.file('a.md')),
    child = f.item(f.file('folder/b.md'), true)
  f.config.resources = [{ filePath: 'a.md', group: 'Default' }]
  await f.run('favorites.deleteFavorite', a, [a, child])
  assert.equal(f.config.resources.length, 1)
  assert.equal(f.writes.length, 0)
  assert.match(f.messages[0][1], /top-level/)
})

test('all four movement commands reject multi-selection without writing settings', async (t) => {
  const f = await fixture(t)
  const a = f.item(f.file('a.md')),
    b = f.item(f.file('b.md'))
  f.config.resources = [
    { filePath: 'a.md', group: 'Default' },
    { filePath: 'b.md', group: 'Default' },
  ]
  for (const command of ['moveUp', 'moveDown', 'moveToTop', 'moveToBottom']) {
    await f.run('favorites.' + command, a, [a, b])
  }
  assert.equal(f.messages.length, 4)
  assert.ok(f.messages.every(([, message]) => /Batch moving is not supported/.test(message)))
  assert.equal(f.writes.length, 0)
})

test('single selection retains the existing movement behavior', async (t) => {
  const f = await fixture(t)
  const a = f.item(f.file('a.md')),
    b = f.item(f.file('b.md'))
  f.config.resources = [
    { filePath: 'a.md', group: 'Default' },
    { filePath: 'b.md', group: 'Default' },
  ]
  await f.run('favorites.moveDown', a, [a])
  assert.deepEqual(
    f.config.resources.map((r) => r.filePath),
    ['b.md', 'a.md'],
  )
  await f.run('favorites.moveUp', a)
  assert.deepEqual(
    f.config.resources.map((r) => r.filePath),
    ['a.md', 'b.md'],
  )
  await f.run('favorites.moveToTop', b)
  assert.deepEqual(
    f.config.resources.map((r) => r.filePath),
    ['b.md', 'a.md'],
  )
  await f.run('favorites.moveToBottom', b)
  assert.deepEqual(
    f.config.resources.map((r) => r.filePath),
    ['a.md', 'b.md'],
  )
})

test('batch open keeps all selected files as non-preview tabs', async (t) => {
  const f = await fixture(t)
  const a = f.item(f.file('a.md')),
    b = f.item(f.file('b.md'))
  await f.run('favorites.openToSide', a, [a, b])
  assert.equal(f.opened.length, 2)
  assert.ok(f.opened.every(([, options]) => !options.preview && options.preserveFocus))
})

test('normal staging respects ignores, literal filenames and reports partial failure', async (t) => {
  const f = await fixture(t)
  fs.writeFileSync(path.join(f.root, '.gitignore'), 'private/\n')
  const a = f.item(f.file('中文 待办.md')),
    ignored = f.item(f.file('private/note.md'))
  const literal = f.item(f.file('note[1].md'))
  f.file('note1.md')
  await f.run('favorites.stage', a, [a, ignored, literal])
  assert.deepEqual(f.indexed(), ['note[1].md', '中文 待办.md'].sort())
  assert.match(f.messages.at(-1)[1], /2 file\(s\); 1 failed/)
  assert.equal(f.repository.statusCalls, 1)
})

test('force staging adds only selected ignored files across their own repositories', async (t) => {
  const f = await fixture(t)
  const second = f.addRepository('second')
  fs.writeFileSync(path.join(f.root, '.gitignore'), 'private/\n')
  const a = f.item(f.file('private/中文 [1].md'))
  const b = f.item(f.file('second.md', second))
  f.file('private/中文 1.md')
  f.file('private/unselected.md')
  await f.run('favorites.forceStage', a, [a, b, a])
  assert.deepEqual(f.indexed(), ['private/中文 [1].md'])
  assert.deepEqual(f.indexed(second), ['second.md'])
  assert.match(f.messages.at(-1)[1], /2 file\(s\)/)
  assert.equal(f.repository.statusCalls, 1)
  assert.equal(second.statusCalls, 1)
})

test('staging preflight rejects folders and repository-external files before any index write', async (t) => {
  const f = await fixture(t)
  const a = f.item(f.file('a.md')),
    folder = f.item(Uri.file(f.root))
  await f.run('favorites.forceStage', a, [a, folder])
  assert.deepEqual(f.indexed(), [])
  const outside = f.file('../outside.md')
  await f.run('favorites.forceStage', a, [a, f.item(outside)])
  assert.deepEqual(f.indexed(), [])
  await f.run('favorites.forceStage', a, [a, f.item(Uri.parse('https://example.com/note'))])
  assert.deepEqual(f.indexed(), [])
  assert.equal(f.messages.filter(([kind]) => kind === 'error').length, 3)
})

test('empty selection and unavailable Git extension never stage the whole repository', async (t) => {
  const f = await fixture(t)
  const a = f.item(f.file('a.md'))
  await f.run('favorites.stage')
  f.vscode.extensions.getExtension = () => undefined
  await f.run('favorites.stage', a)
  assert.deepEqual(f.indexed(), [])
  assert.match(f.messages.at(-1)[1], /Git extension is not available/)
})

test('Git status refresh failure does not stop staging the remaining repositories', async (t) => {
  const f = await fixture(t)
  const second = f.addRepository('second')
  const a = f.item(f.file('a.md')),
    b = f.item(f.file('b.md', second))
  f.repository.status = async () => {
    throw new Error('Refresh failed')
  }
  await f.run('favorites.stage', a, [a, b])
  assert.deepEqual(f.indexed(), ['a.md'])
  assert.deepEqual(f.indexed(second), ['b.md'])
  assert.match(f.messages.at(-1)[1], /2 file\(s\); 0 failed/)
  assert.match(f.messages.at(-1)[1], /Git status refresh failed/)
})

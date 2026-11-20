const fs = require('node:fs')
const path = require('node:path')

// VS Code resolves contributed menu titles before extension activation. Keep the
// public command IDs, and provide English aliases selected by a runtime context.
function syncMenus() {
  const root = path.resolve(__dirname, '..')
  const read = (name) => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'))
  const write = (name, value) => fs.writeFileSync(path.join(root, name), JSON.stringify(value, null, 2) + '\n')
  const manifest = read('package.json')
  const english = read('src/i18n/titles.en.json')
  const chinese = read('src/i18n/zh-CN.json')
  const englishWhen = '(config.favorites.language == en || (config.favorites.language == auto && ext:favoritesEnglish))'
  const chineseWhen = '(config.favorites.language != en && (config.favorites.language != auto || !ext:favoritesEnglish))'
  const translate = (text) => {
    if (!chinese[text]) throw new Error(`Missing Chinese translation: ${text}`)
    return chinese[text]
  }
  const commands = manifest.contributes.commands.filter((command) => !command.command.endsWith('.en') && !command.command.startsWith('favorites.localized.en.'))
  manifest.contributes.commands = commands.flatMap((command) => {
    const key = /^%(.+)%$/.exec(command.title)?.[1]
    const title = key ? english[key] : command.title
    if (!title) throw new Error(`Missing command title: ${command.command}`)
    return [command, { ...command, command: 'favorites.localized.en.' + command.command.slice('favorites.'.length), title }]
  })
  for (const [location, entries] of Object.entries(manifest.contributes.menus)) {
    const original = entries.filter((entry) => !entry.command?.endsWith('.en') && !entry.command?.startsWith('favorites.localized.en.'))
    if (location === 'commandPalette') {
      for (const command of commands) {
        if (!original.some((entry) => entry.command === command.command)) original.push({ command: command.command })
      }
    }
    manifest.contributes.menus[location] = original.flatMap((entry) => {
      if (!entry.command) return [entry]
      let when = entry.when
      for (const condition of ['!ext:favoritesEnglish', chineseWhen]) {
        if (when === condition) when = undefined
        else if (when?.endsWith(' && ' + condition)) when = when.slice(0, -(' && ' + condition).length)
      }
      const visibility = (english) => when === 'false' ? 'false' : [when, english ? englishWhen : chineseWhen].filter(Boolean).join(' && ')
      return [
        { ...entry, when: visibility(false) },
        { ...entry, command: 'favorites.localized.en.' + entry.command.slice('favorites.'.length), when: visibility(true) },
      ]
    })
  }
  write('package.json', manifest)
  write('package.nls.json', Object.fromEntries(Object.entries(english).map(([key, text]) => [key, translate(text)])))
  write('src/i18n/commands.json', commands.map((command) => command.command))
}

module.exports = syncMenus
if (require.main === module) syncMenus()

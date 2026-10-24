const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const { name, version } = require('../package.json')
const output = path.join(root, 'releases', `${name}-${version}.vsix`)

function run(script, ...args) {
  execFileSync(process.execPath, [script, ...args], { cwd: root, stdio: 'inherit' })
}

try {
  run(require.resolve('typescript/bin/tsc'), '--noEmit')
  run(path.join(root, 'esbuild.js'), '--production')
  fs.mkdirSync(path.dirname(output), { recursive: true })
  run(require.resolve('@vscode/vsce/vsce'), 'package', '--no-dependencies', '--out', output)
  console.log(`VSIX: ${output}`)
} catch (error) {
  console.error('Packaging failed:', error.message)
  process.exitCode = error.status || 1
}

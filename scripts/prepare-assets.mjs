import { copyFile, mkdir, readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const source = path.join(root, 'node_modules', 'pyodide')
const destination = path.join(root, 'public', 'vendor', 'pyodide')
const wheel = path.join(root, 'public', 'vendor', 'sqlglot', 'sqlglot-30.20.0-py3-none-any.whl')
const expectedWheelSha256 = '886fd92eba9bf944dee97164b16760f21576a7f55ef4a9211337903442e8aded'
const assets = ['pyodide.js', 'pyodide.asm.js', 'pyodide.asm.wasm', 'python_stdlib.zip', 'pyodide-lock.json']

const actualWheelSha256 = createHash('sha256').update(await readFile(wheel)).digest('hex')
if (actualWheelSha256 !== expectedWheelSha256) {
  throw new Error('The vendored SQLGlot wheel does not match its expected SHA-256.')
}

await mkdir(destination, { recursive: true })
await Promise.all(assets.map(asset => copyFile(path.join(source, asset), path.join(destination, asset))))

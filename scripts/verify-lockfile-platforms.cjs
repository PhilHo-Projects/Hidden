const fs = require('node:fs')
const path = require('node:path')

const lockfilePath = path.resolve(__dirname, '..', 'package-lock.json')
const lockfile = JSON.parse(fs.readFileSync(lockfilePath, 'utf8'))
const packageEntries = Object.keys(lockfile.packages ?? {})
const requiredEntrySuffixes = [
  'node_modules/@rolldown/binding-linux-x64-musl',
  'node_modules/@rolldown/binding-win32-x64-msvc',
]

const missing = requiredEntrySuffixes.filter(
  (suffix) => !packageEntries.some((entry) => entry.endsWith(suffix)),
)

if (missing.length > 0) {
  for (const suffix of missing) {
    console.error(`package-lock.json is missing required package entry suffix: ${suffix}`)
  }
  process.exitCode = 1
} else {
  console.log('package-lock.json includes required Linux musl and Windows Rolldown bindings')
}

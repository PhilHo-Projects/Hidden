const fs = require('node:fs')
const path = require('node:path')

/*
 * CLAUDE.md and AGENTS.md carry the same contributor rules for two different
 * tools: Claude Code reads CLAUDE.md, Codex reads AGENTS.md. Neither can be
 * reduced to a pointer at the other, because each tool reads only its own file
 * and would silently lose every rule in it.
 *
 * Duplication is therefore the design, and drift is the only real failure mode.
 * This guard makes divergence a test failure instead of a rule that quietly
 * applies to one tool and not the other.
 *
 * Line endings are normalised so a CRLF checkout cannot report a false
 * difference; only content is compared.
 */

const repoRoot = path.resolve(__dirname, '..')
const files = ['CLAUDE.md', 'AGENTS.md']

const [claudeLines, agentsLines] = files.map((name) =>
  fs.readFileSync(path.join(repoRoot, name), 'utf8').split(/\r?\n/),
)

if (claudeLines.length === agentsLines.length) {
  const divergentIndex = claudeLines.findIndex(
    (line, index) => line !== agentsLines[index],
  )

  if (divergentIndex === -1) {
    console.log(`${files.join(' and ')} are in sync`)
    return
  }

  reportDivergence(divergentIndex)
} else {
  const shared = Math.min(claudeLines.length, agentsLines.length)
  const divergentIndex = claudeLines
    .slice(0, shared)
    .findIndex((line, index) => line !== agentsLines[index])

  reportDivergence(divergentIndex === -1 ? shared : divergentIndex)
}

function reportDivergence(index) {
  console.error(
    `${files.join(' and ')} have diverged. They must stay identical: each tool reads only its own file.`,
  )
  console.error(`First difference at line ${index + 1}:`)
  console.error(`  CLAUDE.md: ${describe(claudeLines[index])}`)
  console.error(`  AGENTS.md: ${describe(agentsLines[index])}`)
  console.error('Copy the intended version over the other file and re-run.')
  process.exitCode = 1
}

function describe(line) {
  return line === undefined ? '<end of file>' : JSON.stringify(line)
}

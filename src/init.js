// Provision the team binding, append-only log and judging toolkit.
const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { toolkit, teamNamePattern, directory, stat, readFile } = require('./paths')
const rules = require('./rules')
const { version, name } = require('../package.json')

function createOnce(file, text) {
  const temporary = path.join(path.dirname(file), '.init-' + randomUUID())
  fs.writeFileSync(temporary, text, { flag: 'wx' })
  try {
    fs.linkSync(temporary, file)
  } catch (error) {
    if (error.code !== 'EEXIST' || !stat(file)?.isFile()) throw error
  } finally {
    fs.unlinkSync(temporary)
  }
}

function init(root, teamName) {
  if (!teamNamePattern.test(teamName || '')) {
    throw new Error('Usage: hackaudit init <teamname> (2–64 letters, digits, dots, underscores or hyphens)')
  }
  const hack = path.join(root, '.hack')
  directory(hack, true)
  const binding = {
    team_name: teamName,
    initialized_at: new Date().toISOString(),
    init_version: version,
    init_command: 'npx ' + name + ' init ' + teamName,
    schema: 'hackaudit/team@1',
  }
  createOnce(path.join(hack, 'team.json'), JSON.stringify(binding, null, 2) + '\n')
  const saved = JSON.parse(readFile(hack, 'team.json'))
  if (saved?.team_name !== teamName) throw new Error('.hack/team.json is bound to another team')
  createOnce(path.join(hack, 'audit.log'), '')
  createOnce(path.join(hack, 'usage.jsonl'), '')
  const rulesFile = path.join(hack, 'agent-rules.md')
  const directive = rules(teamName)
  createOnce(rulesFile, directive)
  const legacyDirective = directive.split('\n## RECORD BOTH LOGS\n', 1)[0]
  if (readFile(hack, 'agent-rules.md') === legacyDirective) {
    const temporary = path.join(hack, '.rules-' + randomUUID())
    fs.writeFileSync(temporary, directive, { flag: 'wx' })
    try {
      fs.renameSync(temporary, rulesFile)
    } finally {
      if (stat(temporary)) fs.unlinkSync(temporary)
    }
  }
  for (const file of toolkit) {
    directory(path.join(hack, path.dirname(file)), true)
    createOnce(path.join(hack, file), fs.readFileSync(path.join(__dirname, 'toolkit', file)))
  }
  console.log(teamName + ": .hack/ initialized (team.json, audit.log, usage.jsonl, agent-rules.md and three toolkit files).")
  console.log("paste .hack/agent-rules.md into your agent's system prompt")
}

module.exports = init

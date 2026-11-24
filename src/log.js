// Append one forensic record and refresh its readable token-usage projection.
const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { appendEntry, usageText } = require('./chain')
const { inspectLog, validEntry } = require('./audit')
const { directory, readFile, stat, teamNamePattern } = require('./paths')

function parseOptions(args) {
  const allowed = new Set(['--input', '--output', '--total', '--source', '--ts'])
  const values = new Map()
  for (let i = 0; i < args.length; i += 2) {
    const [flag, value] = args.slice(i, i + 2)
    if (!allowed.has(flag) || values.has(flag) || value === undefined || value.startsWith('--')) {
      throw new Error('Invalid or repeated log option: ' + flag)
    }
    values.set(flag, value)
  }
  return values
}

function tokenCounts(options) {
  const available = ['--input', '--output', '--total'].some(flag => options.has(flag))
  const source = options.get('--source') ?? (available ? 'api' : 'absent')
  if (!['api', 'estimate', 'absent'].includes(source) ||
      (source === 'absent' ? available : !options.has('--input') || !options.has('--output'))) {
    throw new Error('Supply input and output counts for api or estimate, or omit all counts when absent')
  }
  const count = flag => {
    const raw = options.get(flag)
    if (raw === undefined) return 0
    const value = Number(raw)
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value)) {
      throw new Error(flag + ' must be a nonnegative safe integer')
    }
    return value
  }
  const prompt = count('--input')
  const completion = count('--output')
  const total = options.has('--total') ? count('--total') : prompt + completion
  if (!Number.isSafeInteger(total)) throw new Error('Token total exceeds the safe integer range')
  return { tokens: { prompt, completion, total }, source }
}

function writeUsage(root, text, previous) {
  if (text === previous) return
  const temporary = path.join(root, '.usage-' + randomUUID())
  fs.writeFileSync(temporary, text, { flag: 'wx' })
  try {
    fs.renameSync(temporary, path.join(root, 'usage.jsonl'))
  } finally {
    if (stat(temporary)) fs.unlinkSync(temporary)
  }
}

function log(root, [file, model, ...args]) {
  if (!file || !model) throw new Error('Usage: hackaudit log <repo-relative-path> <declared-model> [options]')
  const options = parseOptions(args)
  const { tokens, source } = tokenCounts(options)
  const ts = options.get('--ts') ?? new Date().toISOString()
  const hack = path.join(root, '.hack')
  directory(hack)
  const team = JSON.parse(readFile(hack, 'team.json'))?.team_name
  if (typeof team !== 'string' || !teamNamePattern.test(team)) throw new Error('Run hackaudit init with your team first')
  const candidate = { n: 0, team_id: team, model, path: file, tokens, ts, tokens_source: source }
  if (!validEntry(candidate)) throw new Error('Expected a repo-relative POSIX path, model and UTC timestamp with milliseconds')

  const lock = path.join(hack, '.log.lock')
  try {
    fs.mkdirSync(lock)
  } catch (error) {
    if (error.code !== 'EEXIST') throw error
    throw new Error('Another log write holds .hack/.log.lock. Retry once that writer finishes.')
  }

  try {
    const auditText = readFile(hack, 'audit.log')
    const usage = readFile(hack, 'usage.jsonl')
    if (auditText === null) throw new Error('Missing or invalid .hack/audit.log')
    if (usage === null && stat(path.join(hack, 'usage.jsonl'))) throw new Error('Expected a regular .hack/usage.jsonl file')

    const result = inspectLog(auditText, team)
    if (result.violations.length) throw new Error('Existing audit log failed verification. Run hackaudit audit for details.')

    const records = result.decoded
    const sameEdit = records.find(record => record.path === file && record.ts === ts)
    if (sameEdit) {
      if (sameEdit.model !== model || (sameEdit.tokens_source ?? 'api') !== source ||
          Object.keys(tokens).some(key => sameEdit.tokens[key] !== tokens[key])) {
        throw new Error('This path and timestamp already identify a different audit record')
      }
      writeUsage(hack, usageText(records, auditText), usage)
      console.log('Confirmed audit and usage records for ' + JSON.stringify(file))
      return
    }

    candidate.n = (result.byPath.get(file)?.n ?? -1) + 1
    if (!Number.isSafeInteger(candidate.n)) throw new Error('Audit sequence exceeds the safe integer range')
    const { line, newText } = appendEntry(auditText, candidate)
    const updatedRecords = [...records, { ...candidate, index: records.length }]
    const updatedUsage = usageText(updatedRecords, newText)
    fs.appendFileSync(path.join(hack, 'audit.log'), line + '\n', {
      flag: fs.constants.O_WRONLY | fs.constants.O_APPEND | (fs.constants.O_NOFOLLOW || 0),
    })
    writeUsage(hack, updatedUsage, usage)
    console.log('Recorded audit and usage for ' + JSON.stringify(file) + ' (n=' + candidate.n + ')')
  } finally {
    fs.rmdirSync(lock)
  }
}

module.exports = log

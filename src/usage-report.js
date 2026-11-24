const { GENESIS, hashLine, parseLine, canonical } = require('./chain')
const path = require('node:path')
const { readFile, stat } = require('./paths')

const fields = ['input', 'output', 'cache_read', 'cache_write']
const nonempty = value => typeof value === 'string' && value.trim().length > 0
const count = value => value === null || (Number.isSafeInteger(value) && value >= 0)
const identity = entry => canonical([entry.agent, entry.session_id, entry.model, entry.id])
const content = ({ n, ts, ...entry }) => canonical(entry)

function validUsage(entry) {
  return entry?.schema === 'hackaudit/usage@1' && ['claude', 'gigacode', 'codex'].includes(entry.agent) &&
    nonempty(entry.id) && nonempty(entry.source) && nonempty(entry.team_id) &&
    Number.isSafeInteger(entry.n) && entry.n >= 0 && typeof entry.ts === 'string' &&
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(entry.ts) &&
    Number.isFinite(Date.parse(entry.ts)) && new Date(entry.ts).toISOString() === entry.ts &&
    (entry.tokens === null
      ? nonempty(entry.reason) && (entry.session_id === null || nonempty(entry.session_id)) &&
        (entry.model === null || nonempty(entry.model)) && entry.scope === null
      : nonempty(entry.session_id) && nonempty(entry.model) &&
        ['turn', 'session'].includes(entry.scope) && fields.every(key => count(entry.tokens?.[key])) &&
        entry.tokens.input !== null && entry.tokens.output !== null)
}

function add(left, right) {
  if (left === null || right === null) return null
  const total = left + right
  if (!Number.isSafeInteger(total)) throw new Error('Token total exceeds the safe integer range')
  return total
}

function inspectUsage(text, team) {
  const report = { status: text === null ? 'ABSENT' : 'VERIFIED', path: '.hack/usage.log',
    record_count: 0, first_break_index: null, sessions: [], gaps: [], totals: null,
    provenance: 'agent-reported; source authenticity and capture completeness are not independently verified' }
  const records = []
  const seen = new Set()
  const sessions = new Map()
  const lines = text ? text.replace(/\n$/, '').split('\n') : []
  for (const [index, line] of lines.entries()) {
    try {
      const { json: entry, prevHash, ok } = parseLine(line)
      if (!ok || !validUsage(entry) || entry.n !== index || entry.team_id !== team ||
          line.includes('\r') || !text.endsWith('\n') || seen.has(identity(entry)) ||
          prevHash !== (index ? hashLine(lines[index - 1]) : GENESIS)) {
        throw new Error('Invalid usage record or chain link')
      }
      seen.add(identity(entry))
      if (entry.tokens === null) {
        report.gaps.push({ agent: entry.agent, session_id: entry.session_id, ts: entry.ts, reason: entry.reason })
      } else {
        const key = canonical([entry.agent, entry.session_id, entry.model])
        const previous = sessions.get(key)
        if (previous && previous.scope !== entry.scope) throw new Error('Cannot mix turn and session counts for the same session and model')
        if (previous && entry.scope === 'session' && fields.some(key =>
          previous.tokens[key] !== null && (entry.tokens[key] === null || entry.tokens[key] < previous.tokens[key]))) {
          throw new Error('Cumulative usage regressed; use a new session ID after a counter reset')
        }
        const tokens = Object.fromEntries(fields.map(key => [key,
          previous && entry.scope === 'turn' ? add(previous.tokens[key], entry.tokens[key]) : entry.tokens[key]]))
        sessions.set(key, { agent: entry.agent, session_id: entry.session_id, model: entry.model, scope: entry.scope, tokens })
      }
      records.push(entry)
    } catch (error) {
      return { report: { ...report, status: 'BROKEN', record_count: lines.length,
        first_break_index: index, error: error.message, sessions: [], gaps: [], totals: null }, records }
    }
  }
  report.record_count = records.length
  try {
    report.sessions = [...sessions.values()].map(session => ({ ...session,
      total: fields.reduce((total, key) => add(total, session.tokens[key]), 0) }))
    if (sessions.size) {
      const totals = Object.fromEntries(fields.map(key => [key,
        report.sessions.reduce((total, session) => add(total, session.tokens[key]), 0)]))
      report.totals = { ...totals, total: fields.reduce((total, key) => add(total, totals[key]), 0) }
    }
  } catch (error) {
    return { report: { ...report, status: 'BROKEN', first_break_index: lines.length - 1,
      error: error.message, sessions: [], gaps: [], totals: null }, records }
  }
  return { report, records }
}

function usageReport(root) {
  const teamFile = stat(path.join(root, 'hackathon.json')) ? 'hackathon.json' : '.hack/team.json'
  const team = JSON.parse(readFile(root, teamFile))?.team_name
  return inspectUsage(readFile(root, '.hack/usage.log'), team).report
}

if (require.main === module) {
  try {
    const report = usageReport(process.cwd())
    console.log(JSON.stringify(report, null, 2))
    process.exitCode = report.status === 'VERIFIED' ? 0 : 1
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}

module.exports = { validUsage, inspectUsage, usageReport, identity, content }

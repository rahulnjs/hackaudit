// Encode, parse and hash forensic records and report bodies.
const { createHash } = require('node:crypto')

const GENESIS = 'GENESIS_HASH'
const encodeEntry = entry => Buffer.from(JSON.stringify(entry), 'utf8').toString('base64')
const hashLine = line => createHash('sha256').update(line, 'utf8').digest('hex')
const lastLine = text => text.replace(/\n+$/, '').split('\n').pop() || null

function parseLine(line) {
  const separator = line.lastIndexOf(':')
  const payload = separator < 0 ? line : line.slice(0, separator)
  const prevHash = separator < 0 ? null : line.slice(separator + 1)
  let json = null
  try {
    const bytes = Buffer.from(payload, 'base64')
    const decoded = bytes.toString('utf8')
    if (payload && bytes.toString('base64') === payload && Buffer.from(decoded).equals(bytes)) {
      const value = JSON.parse(decoded)
      if (value && typeof value === 'object' && !Array.isArray(value)) json = value
    }
  } catch {
    // A malformed payload is reported at its physical line number.
  }
  return { payload, json, prevHash, ok: json !== null && separator >= 0 }
}

function appendEntry(text, entry) {
  const previous = lastLine(text)
  const line = encodeEntry(entry) + ':' + (previous ? hashLine(previous) : GENESIS)
  return { line, newText: text + (text && !text.endsWith('\n') ? '\n' : '') + line + '\n' }
}

function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}'
}

function usageText(records, auditText) {
  const lines = auditText.split('\n')
  return records.map(record => JSON.stringify({
    n: record.n,
    team_id: record.team_id,
    model: record.model,
    path: record.path,
    ts: record.ts,
    tokens: { input: record.tokens.prompt, output: record.tokens.completion, total: record.tokens.total },
    tokens_source: record.tokens_source ?? 'api',
    audit_line_sha256: hashLine(lines[record.index]),
  }) + '\n').join('')
}

module.exports = { GENESIS, encodeEntry, hashLine, parseLine, lastLine, appendEntry, canonical, usageText }

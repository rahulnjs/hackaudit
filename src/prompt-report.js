const { GENESIS, hashLine } = require('./chain')

function inspectPrompts(text, team) {
  const lines = text ? text.replace(/\n$/, '').split('\n') : []
  const result = { status: text === null ? 'ABSENT' : 'VERIFIED', total_lines: lines.length,
    first_break_index: null, entries: [] }
  const ids = new Set()
  for (const [index, line] of lines.entries()) {
    try {
      const entry = JSON.parse(line)
      const bytes = Buffer.from(entry.prompt, 'base64')
      if (entry.n !== index || typeof entry.team_id !== 'string' || typeof entry.model !== 'string' ||
          !entry.model.trim() || typeof entry.id !== 'string' || !entry.id || ids.has(entry.id) ||
          entry.encoding !== 'base64' || !bytes.toString('utf8').trim() ||
          bytes.toString('base64') !== entry.prompt || !Buffer.from(bytes.toString('utf8')).equals(bytes) ||
          typeof entry.ts !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(entry.ts) ||
          new Date(entry.ts).toISOString() !== entry.ts ||
          line.includes('\r') || (index === lines.length - 1 && !text.endsWith('\n'))) throw new Error('Invalid prompt record')
      ids.add(entry.id)
      let state = result.status === 'BROKEN' ? 'UNVERIFIED' : 'VERIFIED'
      if (entry.team_id !== team || entry.prev_hash !== (index ? hashLine(lines[index - 1]) : GENESIS)) {
        result.status = 'BROKEN'
        result.first_break_index ??= index
        state = 'BROKEN'
      }
      result.entries.push({ index, id: entry.id, team_id: entry.team_id, model: entry.model,
        ts: entry.ts, text: bytes.toString('utf8'), state })
    } catch {
      result.status = 'BROKEN'
      result.first_break_index ??= index
      result.entries.push({ index, state: 'INVALID' })
    }
  }
  return result
}


module.exports = { inspectPrompts }

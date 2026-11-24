// Verify the forensic trail and write the organizer's machine-readable report.
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { randomUUID } = require('node:crypto')
const { GENESIS, hashLine, parseLine, canonical } = require('./chain')
const { toolkit, teamNamePattern, stat, readFile, directory, validLogPath } = require('./paths')
const { renderHtml, reportMarker } = require('./report-html')
const { inspectPrompts } = require('./prompt-report')
const { inspectUsage } = require('./usage-report')
const { validateReport, template } = require('./report-contract')
const { version } = require('../package.json')

const skipped = new Set(['.git', '.hack', 'node_modules', '.venv', 'dist', 'build',
  'audit-reports', 'package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml',
  'yarn.lock', 'bun.lock', 'bun.lockb', 'Cargo.lock', 'poetry.lock', 'uv.lock'])
const headerForms = [
  /^\/\/\s*audit:\s*(.+)$/,
  /^#\s*audit:\s*(.+)$/,
  /^\/\*\s*audit:\s*(.+)\s*\*\/$/,
  /^<!--\s*audit:\s*(.+)\s*-->$/,
]

function validEntry(entry) {
  return entry && Number.isSafeInteger(entry.n) && entry.n >= 0 &&
    typeof entry.team_id === 'string' && typeof entry.model === 'string' && entry.model.trim() &&
    validLogPath(entry.path) &&
    typeof entry.ts === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(entry.ts) &&
    Number.isFinite(Date.parse(entry.ts)) && new Date(entry.ts).toISOString() === entry.ts
}

function inspectLog(log, team) {
  const lines = log ? log.replace(/\n$/, '').split('\n') : []
  const chain = { status: log === null ? 'ABSENT' : 'VERIFIED', verified_lines: 0,
    total_lines: lines.length, first_break_index: null, entries: [] }
  const decode = { invalid_indexes: [] }
  const decoded = []
  const violations = []
  const findings = []
  const byPath = new Map()
  let lastTimestamp = null
  for (const [index, line] of lines.entries()) {
    const { json, prevHash, ok } = parseLine(line)
    const valid = ok && validEntry(json) && !line.includes('\r') &&
      (index < lines.length - 1 || log.endsWith('\n'))
    const expected = index === 0 ? GENESIS : hashLine(lines[index - 1])
    const state = !valid ? 'INVALID' : chain.first_break_index !== null ? 'UNVERIFIED' :
      expected !== prevHash ? 'BROKEN' : index === 0 ? 'GENESIS' : 'OK'
    if (!valid) decode.invalid_indexes.push(index)
    const record = { index, n: valid ? json.n : null, path: valid ? json.path : null,
      model: valid ? json.model : null,
      ts: valid ? json.ts : null, state }
    if (state === 'GENESIS' || state === 'OK') chain.verified_lines++
    if (chain.first_break_index === null && (state === 'BROKEN' || state === 'INVALID')) {
      chain.status = 'BROKEN'
      chain.first_break_index = index
      record.expected = expected
      record.actual = prevHash
      violations.push({ kind: 'chain_break', index, expected, actual: prevHash })
    }
    chain.entries.push(record)
    if (!valid) continue
    decoded.push({ ...json, index, chain: state })
    const previous = byPath.get(json.path)
    const addFinding = (kind, detail, severity = 'advisory') =>
      findings.push({ kind, path: json.path, detail, severity })
    if (json.team_id !== team) {
      violations.push({ kind: 'log_team_mismatch', index, path: json.path, found: json.team_id, expected: team })
    }
    if (!previous && json.n !== 0) addFinding('nonzero_start', 'First sequence is ' + json.n, 'info')
    if (previous && json.n < previous.n) violations.push({ kind: 'sequence_regression', index, path: json.path })
    if (previous && json.model !== previous.model) {
      addFinding('model_switch', previous.model + ' → ' + json.model)
    }
    if (lastTimestamp && json.ts < lastTimestamp) addFinding('ts_out_of_order', 'Timestamp precedes the prior entry')
    lastTimestamp = json.ts
    byPath.set(json.path, json)
  }
  return { chain, decode, decoded, violations, findings, byPath }
}

function walk(root, parent = '') {
  const files = []
  for (const entry of fs.readdirSync(path.join(root, parent), { withFileTypes: true })) {
    if (skipped.has(entry.name)) continue
    const relative = parent ? parent + '/' + entry.name : entry.name
    if (entry.isDirectory()) files.push(...walk(root, relative))
    if (entry.isFile()) files.push(relative)
  }
  return files
}

function sourceFiles(root) {
  const git = spawnSync('git', ['ls-files', '--cached', '-z', '--', '.'],
    { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, windowsHide: true })
  if (git.status === 0) {
    const files = git.stdout.split('\0').filter(Boolean)
    return files.length ? files : walk(root)
  }
  if (!stat(path.join(root, '.git')) &&
      (git.error?.code === 'ENOENT' || /not a git repository/.test(git.stderr || ''))) {
    return walk(root)
  }
  throw new Error('Could not enumerate tracked files with git ls-files')
}

function sourceHeader(root, relative) {
  let parent = root
  const parts = relative.split('/')
  for (const part of parts.slice(0, -1)) {
    parent = path.join(parent, part)
    if (!stat(parent)?.isDirectory()) return null
  }
  const file = path.join(parent, parts[parts.length - 1])
  if (!stat(file)?.isFile()) return null
  const handle = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0))
  const buffer = Buffer.alloc(8192)
  try {
    const count = fs.readSync(handle, buffer)
    const firstLine = buffer.toString('utf8', 0, count).split(/\r?\n/, 1)[0]
    for (const form of headerForms) {
      const match = form.exec(firstLine)
      if (!match) continue
      try {
        const body = match[1].replace(/([{,]\s*)(team|model|ts)(\s*:)/g, '$1"$2"$3')
        const header = JSON.parse(body)
        if (typeof header?.team === 'string' && typeof header.model === 'string' &&
            typeof header.ts === 'string') return header
      } catch {
        return null
      }
    }
    return null
  } finally {
    fs.closeSync(handle)
  }
}

function reconcile(root, byPath, team) {
  const result = { matched: [], header_only: [], log_only: [], team_mismatch: [] }
  const headers = new Set()
  const files = [...new Set(sourceFiles(root))].sort()
  for (const file of files) {
    if (!validLogPath(file) || file.split('/').some(part => skipped.has(part))) continue
    const header = sourceHeader(root, file)
    if (!header) continue
    headers.add(file)
    result[byPath.has(file) ? 'matched' : 'header_only'].push(file)
    if (header.team !== team) result.team_mismatch.push({ path: file, found: header.team, expected: team })
  }
  result.log_only = [...byPath.keys()].filter(file => !headers.has(file)).sort()
  return result
}

function outputDirectory(root, destination) {
  const parsed = path.parse(path.resolve(root, destination))
  const parts = parsed.dir.slice(parsed.root.length).split(path.sep).filter(Boolean)
  if (parsed.base) parts.push(parsed.base)
  let current = parsed.root
  for (const part of parts) {
    if (['.hack', '.git'].includes(part.toLowerCase())) throw new Error('Reports cannot be written under .hack or .git')
    current = path.join(current, part)
    if (stat(current)?.isSymbolicLink()) {
      current = fs.realpathSync(current)
      if (current.split(path.sep).some(segment => ['.hack', '.git'].includes(segment.toLowerCase()))) {
        throw new Error('Reports cannot be written under .hack or .git')
      }
    }
    directory(current, true)
  }
  return current
}

function reportProject(root) {
  let project
  try {
    project = JSON.parse(readFile(root, 'package.json'))?.name
  } catch {
    // A missing or invalid package.json is optional metadata.
  }
  const slug = value => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 100)
  return (typeof project === 'string' && slug(project)) || slug(path.basename(root)) || 'project'
}

function saveReport(root, out, report, html) {
  validateReport(report)
  const projectName = report.project_name
  const dir = outputDirectory(root, out)
  const basename = report.team.team_name + '-' + projectName + '-hackaudit-report'
  const filename = path.join(dir, basename + '.json')
  const htmlName = basename + '.html'
  const htmlPath = path.join(dir, htmlName)
  if (stat(filename)) {
    const old = JSON.parse(readFile(dir, path.basename(filename)))
    const { chain_link: link, ...body } = old || {}
    if (body.schema !== report.schema || body.team?.team_name !== report.team.team_name ||
        link?.body_sha256 !== hashLine(canonical(body))) {
      throw new Error('Report path already contains a different file: ' + filename)
    }
  }
  if (html && stat(htmlPath) && !readFile(dir, htmlName)?.startsWith('<!doctype html>\n' + reportMarker + '\n')) {
    throw new Error('Report path already contains a different file: ' + htmlPath)
  }
  const outputs = [
    { target: filename, content: JSON.stringify(report, null, 2) + '\n' },
  ]
  if (html) outputs.push({ target: htmlPath, content: renderHtml(report, projectName) })
  const staged = []
  try {
    for (const [index, output] of outputs.entries()) {
      const file = path.join(dir, '.report-' + report.report_id + '-' + index)
      const handle = fs.openSync(file, 'wx')
      staged.push({ file, target: output.target })
      try {
        fs.writeFileSync(handle, output.content)
      } finally {
        fs.closeSync(handle)
      }
    }
    for (const { file, target } of staged) fs.renameSync(file, target)
  } finally {
    for (const { file } of staged) {
      if (stat(file)) fs.unlinkSync(file)
    }
  }
  return { filename, htmlPath: html ? htmlPath : null }
}

function printReport(report, decoded, selected, filename) {
  if (!selected.size) {
    console.log(JSON.stringify(report, null, 2))
    return
  }
  for (const section of selected) {
    if (section !== 'decode') {
      console.log(JSON.stringify({ [section]: report[section] }, null, 2))
      continue
    }
    for (const entry of decoded) console.log(JSON.stringify(entry, null, 2))
    console.log('n | path | model | ts | chain')
    for (const entry of report.chain.entries) {
      console.log([entry.n ?? entry.index, entry.path, entry.model === null ? null : JSON.stringify(entry.model),
        entry.ts, entry.state].map(value => value ?? '-').join(' | '))
    }
  }
  console.error('Report: ' + filename)
}

function audit(root, out, selected, html = false) {
  let saved
  const teamFile = stat(path.join(root, 'hackathon.json')) || !stat(path.join(root, '.hack/team.json')) ? 'hackathon.json' : '.hack/team.json'
  try {
    saved = JSON.parse(readFile(root, teamFile))
  } catch {
    // Report the missing binding with the other required artifacts below.
  }
  const validTeam = typeof saved?.team_name === 'string' && teamNamePattern.test(saved.team_name)
  const teamName = validTeam ? saved.team_name : 'unknown-team'
  const log = readFile(root, '.hack/audit.log')
  const rulesPresent = readFile(root, '.hack/agent-rules.md') !== null
  const toolkitPresent = toolkit.every(file => readFile(root, '.hack/' + file) !== null)
  const result = inspectLog(log, teamName)
  const reconciliation = reconcile(root, result.byPath, teamName)
  const violations = [...result.violations]
  const usageResult = inspectUsage(readFile(root, '.hack/usage.log'), teamName)
  const tokenUsage = usageResult.report
  if (tokenUsage.status === 'BROKEN') {
    violations.push({ kind: 'usage_chain_break', artifact: 'usage.log', index: tokenUsage.first_break_index })
  }
  const prompts = inspectPrompts(readFile(root, '.hack/prompts.jsonl'), teamName)
  if (prompts.status === 'BROKEN') {
    violations.push({ kind: 'prompt_chain_break', artifact: 'prompts.jsonl', index: prompts.first_break_index })
  }
  for (const [present, artifact] of [[validTeam, path.basename(teamFile)], [log !== null, 'audit.log'],
    [rulesPresent, 'agent-rules.md']]) {
    if (!present) violations.push({ kind: 'missing_or_invalid_artifact', artifact })
  }
  for (const mismatch of reconciliation.team_mismatch) {
    violations.push({ kind: 'header_team_mismatch', ...mismatch })
  }
  const report = {
    schema: 'hackaudit/report@1',
    ui_template: template,
    assessment: null,
    project_name: reportProject(root),
    tool_version: version,
    report_id: randomUUID(),
    audited_at: new Date().toISOString(),
    team: { team_name: teamName, initialized_at: typeof saved?.initialized_at === 'string' ? saved.initialized_at : null,
      init_version: typeof saved?.init_version === 'string' ? saved.init_version : null },
    artifacts: { audit_log_present: log !== null, line_count: result.chain.total_lines,
      agent_rules_present: rulesPresent, toolkit_present: toolkitPresent },
    chain: result.chain,
    decode: result.decode,
    token_usage: tokenUsage,
    usage_records: usageResult.records,
    prompt_log: { ...prompts, path: '.hack/prompts.jsonl' },
    file_evidence: [...new Set([...result.byPath.keys(), ...reconciliation.header_only])].sort().map(file =>
      ({ path: file, header: sourceHeader(root, file), latest_record: result.byPath.get(file) ?? null })),
    reconcile: reconciliation,
    fingerprint: { findings: result.findings, advisory: true },
    verdict: { ok: violations.length === 0, violations, notes: 'machine-generated integrity evidence; rubric scores, when supplied, come from the reviewing agent and judge' },
  }
  report.chain_link = { algorithm: 'sha256', prev: null, body_sha256: hashLine(canonical(report)), seq: null }
  const { filename, htmlPath } = saveReport(root, out, report, html)
  printReport(report, result.decoded, selected, filename)
  if (htmlPath) console.error('HTML report: ' + htmlPath)
  return report.verdict.ok ? 0 : 1
}

module.exports = { audit, inspectLog, validEntry, saveReport }

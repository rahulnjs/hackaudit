const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { createHash } = require('node:crypto')
const { appendEntry, hashLine, parseLine } = require('../src/chain')

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hackaudit-'))
const cli = path.resolve(__dirname, '../bin/hackaudit.js')
const log = path.join(root, '.hack/audit.log')
const team = 'team-nova'
const toolkit = ['auditor/SKILL.md', 'leaderboard/SKILL.md', 'manifest/schema.json']
const ts = '2026-11-23T00:00:00.000Z'
const fixture = (file, n = 0) => ({
  n, team_id: team, model: 'declared-model', path: file,
  tokens: { prompt: 1, completion: 2, total: 3 }, ts,
})
const run = (...args) => spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8' })
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8')
const report = (dir = 'audit-reports') => {
  const files = fs.readdirSync(path.join(root, dir))
  assert.equal(files.length, 1)
  return JSON.parse(read(path.join(dir, files[0])))
}
const sha = value => createHash('sha256').update(value).digest('hex')
const sorted = value => {
  if (Array.isArray(value)) return '[' + value.map(sorted).join(',') + ']'
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  const keys = Object.keys(value).sort()
  return '{' + keys.map(key => JSON.stringify(key) + ':' + sorted(value[key])).join(',') + '}'
}
let passed = 0
function test(label, check) {
  try {
    check()
    passed++
  } catch (error) {
    throw new Error(label, { cause: error })
  }
}

try {
  test('Missing team and missing command', () => {
    assert.equal(run('init').status, 1)
    assert.match(run('init').stderr, /Usage/)
    assert.equal(run().status, 1)
    assert.equal(run('audit', '--unknown').status, 2)
  })
  test('Install evidence and toolkit', () => {
    assert.equal(run('init', team).status, 0)
    assert.equal(JSON.parse(read('.hack/team.json')).team_name, team)
    assert.equal(read('.hack/audit.log'), '')
    assert.equal(read('.hack/usage.jsonl'), '')
    for (const file of ['agent-rules.md', ...toolkit]) assert.ok(read('.hack/' + file))
  })
  test('Team-bound directive', () => {
    const rules = read('.hack/agent-rules.md')
    assert.match(rules, /team-nova/)
    assert.doesNotMatch(rules, /<TEAM_NAME>/)
    assert.equal(rules.split('I cannot modify hackathon audit logs as per judging policy.').length, 2)
  })
  test('Idempotent initialization', () => {
    fs.writeFileSync(log, 'existing\n')
    const original = read('.hack/team.json')
    assert.equal(run('init', team).status, 0)
    assert.equal(read('.hack/team.json'), original)
    assert.equal(fs.readFileSync(log, 'utf8'), 'existing\n')
  })
  test('Reject rebinding', () => {
    const before = read('.hack/team.json')
    assert.equal(run('init', 'other-team').status, 1)
    assert.equal(read('.hack/team.json'), before)
  })

  const first = appendEntry('', fixture('match.js'))
  const second = appendEntry(first.newText, fixture('missing.js'))
  const third = appendEntry(second.newText, fixture('match.js', 1))
  const fourth = appendEntry(third.newText, fixture('match.js', 2))

  test('Genesis marker', () => assert.ok(first.line.endsWith(':GENESIS_HASH')))
  test('Verbatim link', () => assert.equal(parseLine(second.line).prevHash, sha(first.line)))
  test('Verify three lines', () => {
    fs.writeFileSync(log, third.newText)
    assert.equal(run('audit', '--chain').status, 0)
    assert.equal(report().chain.verified_lines, 3)
  })
  test('Detect deleted middle line', () => {
    fs.writeFileSync(log, [first.line, third.line, ''].join('\n'))
    assert.equal(run('audit', '--chain').status, 1)
    assert.equal(report().chain.first_break_index, 1)
    assert.equal(report().chain.verified_lines, 1)
  })
  test('Decode three records', () => {
    fs.writeFileSync(log, third.newText)
    const result = run('audit', '--decode')
    assert.equal(result.status, 0)
    assert.equal([...result.stdout.matchAll(/"team_id": "team-nova"/g)].length, 3)
  })
  test('Continue decoding after malformed payload', () => {
    fs.writeFileSync(log, [first.line, '%%:' + hashLine(first.line), third.line, ''].join('\n'))
    const result = run('audit', '--decode')
    assert.equal(result.status, 1)
    assert.deepEqual(report().decode.invalid_indexes, [1])
    assert.match(result.stdout, /INVALID/)
    assert.match(result.stdout, /UNVERIFIED/)
  })
  test('Write a matching, escaped HTML preview from a project without Git', () => {
    const directory = path.join(root, 'html-preview')
    const source = 'html-source.js'
    const model = '<script>alert("demo")</script>'
    fs.writeFileSync(path.join(root, source), '// audit: { team: "' + team + '", model: "fixture", ts: "' + ts + '" }\n')
    fs.writeFileSync(log, appendEntry('', { ...fixture(source), model }).newText)
    const args = ['audit', '--html', '--chain', '--out', directory]
    assert.equal(run(...args).status, 0)
    const files = fs.readdirSync(directory)
    assert.equal(files.length, 2)
    const json = JSON.parse(fs.readFileSync(path.join(directory, files.find(file => file.endsWith('.json'))), 'utf8'))
    const htmlFile = path.join(directory, files.find(file => file.endsWith('.html')))
    const html = fs.readFileSync(htmlFile, 'utf8')
    assert.equal(json.chain.verified_lines, 1)
    assert.deepEqual(json.reconcile.matched, [source])
    assert.ok(html.includes(json.chain_link.body_sha256))
    assert.ok(html.includes(json.report_id))
    assert.ok(html.includes('&lt;script&gt;alert(&quot;demo&quot;)&lt;/script&gt;'))
    assert.ok(!html.includes(model))

    fs.writeFileSync(log, 'malformed\n')
    assert.equal(run(...args).status, 1)
    assert.match(fs.readFileSync(htmlFile, 'utf8'), /First chain break at log line 1/)

    fs.writeFileSync(htmlFile, 'user-owned content')
    assert.equal(run(...args).status, 1)
    assert.equal(fs.readFileSync(htmlFile, 'utf8'), 'user-owned content')
    assert.deepEqual(fs.readdirSync(directory), files)
    fs.unlinkSync(path.join(root, source))
  })
  test('Reconcile tracked and logged paths', () => {
    fs.writeFileSync(log, third.newText)
    const header = '// audit: { team: "' + team + '", model: "declared-model", ts: "' + ts + '" }\n'
    for (const file of ['match.js', 'header-only.js', 'untracked.js']) {
      fs.writeFileSync(path.join(root, file), header)
    }
    const git = (...args) => spawnSync('git', args, { cwd: root, encoding: 'utf8' })
    assert.equal(git('init', '-q').status, 0)
    assert.equal(git('add', '--', 'match.js', 'header-only.js').status, 0)
    assert.equal(run('audit', '--reconcile').status, 0)
    assert.deepEqual(report().reconcile, {
      matched: ['match.js'], header_only: ['header-only.js'], log_only: ['missing.js'], team_mismatch: [],
    })
  })
  test('Audit keeps evidence untouched and rejects output under .hack', () => {
    const before = fs.statSync(log)
    const dir = fs.statSync(path.dirname(log))
    for (const flag of ['--chain', '--decode', '--reconcile', '--fingerprint']) {
      assert.equal(run('audit', flag).status, 0)
    }
    assert.equal(run('audit', '--out', '.hack/no').status, 1)
    assert.equal(fs.statSync(log).mtimeMs, before.mtimeMs)
    assert.equal(fs.statSync(path.dirname(log)).mtimeMs, dir.mtimeMs)
    assert.equal(fs.readFileSync(log, 'utf8'), third.newText)
  })
  test('Later links are unverified after an earlier break', () => {
    fs.writeFileSync(log, [first.line, third.line, fourth.line, ''].join('\n'))
    assert.equal(run('audit', '--decode').status, 1)
    assert.deepEqual(report().chain.entries.map(x => x.state), ['GENESIS', 'BROKEN', 'UNVERIFIED'])
    fs.writeFileSync(log, [second.line, third.line, ''].join('\n'))
    assert.equal(run('audit', '--chain').status, 1)
    assert.equal(report().chain.first_break_index, 0)
  })
  test('Write a full report and verify its canonical body', () => {
    fs.writeFileSync(log, third.newText)
    assert.equal(run('audit', '--chain', '--out', 'results').status, 0)
    const { chain_link: link, ...body } = report('results')
    assert.equal(link.body_sha256, sha(sorted(body)))
    for (const field of ['chain', 'decode', 'reconcile', 'fingerprint']) assert.ok(body[field])
  })
  test('Sequence starts above zero are advisory', () => {
    fs.writeFileSync(log, appendEntry('', fixture('match.js', 1)).newText)
    assert.equal(run('audit').status, 0)
    assert.equal(report().fingerprint.findings[0].kind, 'nonzero_start')
  })
  test('Record input and output tokens in both logs', () => {
    fs.writeFileSync(log, '')
    assert.equal(run('log', 'match.js', 'fixture-model', '--ts', ts, '--input', '120', '--output', '48').status, 0)
    const usage = JSON.parse(read('.hack/usage.jsonl'))
    assert.deepEqual(usage.tokens, { input: 120, output: 48, total: 168 })
    assert.equal(usage.audit_line_sha256, sha(read('.hack/audit.log').trimEnd()))
    assert.equal(run('audit', '--chain').status, 0)
    assert.equal(report().usage_log.status, 'VERIFIED')
  })
  test('Recover usage after an interrupted write without a duplicate event', () => {
    const original = read('.hack/audit.log')
    fs.writeFileSync(path.join(root, '.hack/usage.jsonl'), '')
    assert.equal(run('audit', '--chain').status, 0)
    assert.equal(report().usage_log.status, 'OUT_OF_SYNC')
    assert.equal(run('log', 'match.js', 'fixture-model', '--ts', ts, '--input', '120', '--output', '48').status, 0)
    assert.equal(read('.hack/audit.log'), original)
    assert.equal(JSON.parse(read('.hack/usage.jsonl')).tokens.total, 168)
  })
  test('Record missing usage and preserve customized agent rules', () => {
    const secondTimestamp = '2026-11-23T00:00:01.000Z'
    assert.equal(run('log', 'match.js', 'fixture-model', '--ts', secondTimestamp).status, 0)
    const rows = read('.hack/usage.jsonl').trimEnd().split('\n').map(JSON.parse)
    assert.deepEqual(rows[1].tokens, { input: 0, output: 0, total: 0 })
    assert.equal(rows[1].tokens_source, 'absent')
    assert.equal(rows[1].n, 1)
    const directive = read('.hack/agent-rules.md')
    const directiveFile = path.join(root, '.hack/agent-rules.md')
    fs.writeFileSync(directiveFile, directive.split('\n## RECORD BOTH LOGS\n', 1)[0])
    assert.equal(run('init', team).status, 0)
    assert.equal(read('.hack/agent-rules.md'), directive)
    fs.writeFileSync(directiveFile, 'custom directive\n')
    assert.equal(run('init', team).status, 0)
    assert.equal(read('.hack/agent-rules.md'), 'custom directive\n')
  })
  console.log('PASS ' + passed + '/20')
} finally {
  fs.rmSync(root, { recursive: true, force: true })
}

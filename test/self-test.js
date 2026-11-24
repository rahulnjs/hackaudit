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

fs.mkdirSync(path.join(root, '.hack'))
fs.writeFileSync(path.join(root, '.hack/team.json'), JSON.stringify({ team_name: team, initialized_at: ts, init_version: '1.0.0' }))
fs.writeFileSync(path.join(root, '.hack/agent-rules.md'), 'Participant logging instructions\n')
for (const name of ['audit.log', 'usage.log', 'prompts.jsonl']) fs.writeFileSync(path.join(root, '.hack', name), '')

try {
  test('Reject participant commands and invalid audit options', () => {
    assert.equal(run('init').status, 1)
    assert.match(run('init').stderr, /Usage/)
    assert.equal(run().status, 1)
    assert.equal(run('audit', '--unknown').status, 2)
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

  console.log('PASS ' + passed + '/13')
} finally {
  fs.rmSync(root, { recursive: true, force: true })
}

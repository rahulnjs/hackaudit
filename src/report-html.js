// Render the forensic report as a standalone, print-friendly HTML document.
const reportMarker = '<!-- hackaudit:forensic-report@1 -->'

const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
const escape = value => String(value ?? '—').replace(/[&<>"']/g, char => entities[char])
const label = value => value.toLowerCase().replaceAll('_', ' ').replace(/^./, char => char.toUpperCase())

function list(items, render) {
  return items.length ? '<ul>' + items.map(item => '<li>' + render(item) + '</li>').join('') + '</ul>' :
    '<p class="empty">None recorded.</p>'
}

function table(caption, columns, rows) {
  if (!rows.length) return '<p class="empty">None recorded.</p>'
  const headings = columns.map(column => '<th scope="col">' + escape(column) + '</th>').join('')
  const body = rows.map(row => '<tr>' + row.map(cell => '<td>' + escape(cell) + '</td>').join('') + '</tr>').join('')
  return '<div class="table"><table><caption>' + escape(caption) + '</caption><thead><tr>' +
    headings + '</tr></thead><tbody>' + body + '</tbody></table></div>'
}

function renderHtml(report, project) {
  const { chain, decode, reconcile, usage_log: usage, verdict } = report
  const summary = verdict.ok ? 'No audit violations' : 'Audit violations found'
  const evidenceBuckets = [
    ['Matched', reconcile.matched],
    ['Source headers without log entries', reconcile.header_only],
    ['Log entries without source headers', reconcile.log_only],
  ]
  const reconciliation = evidenceBuckets.map(([title, files]) =>
    '<details><summary>' + escape(title) + ' (' + files.length + ')</summary>' +
    list(files, file => '<code>' + escape(file) + '</code>') + '</details>').join('')
  const violationRows = verdict.violations.map(item => [
    label(item.kind), item.path ?? item.artifact ?? (item.index == null ? null : 'Log line ' + (item.index + 1)),
    item.expected, item.found ?? item.actual,
  ])
  const logRows = chain.entries.map(entry => [
    entry.index + 1, entry.state, entry.path, entry.model, entry.tokens_total, entry.ts,
  ])
  const advisoryRows = report.fingerprint.findings.map(item => [
    label(item.kind), item.path, item.detail,
  ])
  const brokenLine = chain.first_break_index === null ? '' :
    '<p>First chain break at log line ' + (chain.first_break_index + 1) + '.</p>'
  const malformed = decode.invalid_indexes.length ? '<p>Invalid log lines: ' +
    decode.invalid_indexes.map(index => index + 1).join(', ') + '.</p>' : ''
  return `<!doctype html>
${reportMarker}
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>${escape(project)} · Hackaudit</title>
<style>
  :root { color-scheme: light; font: 16px/1.55 system-ui, sans-serif; color: #172523; background: #f3f6f5; }
  body { max-width: 68rem; margin: 0 auto; padding: clamp(1rem, 4vw, 3rem); }
  header, section { background: white; border: 1px solid #dce5e2; border-radius: .75rem; padding: clamp(1rem, 3vw, 2rem); }
  header { border-top: .3rem solid #226c5b; }
  section { margin-top: 1rem; }
  h1 { margin: .2rem 0; font-size: clamp(1.8rem, 5vw, 3rem); line-height: 1.1; }
  h2 { margin: 0 0 .75rem; font-size: 1.3rem; }
  p { margin: .6rem 0; }
  .muted, .empty, dt { color: #4d625d; }
  .status { display: inline-block; padding: .25rem .6rem; border-radius: .35rem; background: #e2f2ec; color: #155545; font-weight: 650; }
  .failed { background: #fbeae6; color: #8c3022; }
  dl { display: grid; grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr)); gap: 1rem; margin: 1.25rem 0 0; }
  dl div { border-top: 1px solid #dce5e2; padding-top: .65rem; }
  dd { margin: 0; font-weight: 650; }
  code, dd, td, h1 { overflow-wrap: anywhere; }
  .table { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; text-align: left; }
  caption { text-align: left; margin: 0 0 .5rem; }
  th, td { padding: .55rem; border-bottom: 1px solid #dce5e2; vertical-align: top; }
  th { background: #f1f6f4; }
  details { border-bottom: 1px solid #dce5e2; padding: .6rem 0; }
  summary { cursor: pointer; font-weight: 600; }
  footer { padding: 1rem .25rem; }
  @media print {
    :root { background: white; font-size: 11pt; }
    body { padding: 0; }
    tr { break-inside: avoid; }
    .table { overflow: visible; }
  }
</style>
</head>
<body>
<header>
<p class="muted">Hackaudit forensic report</p>
<h1>${escape(project)}</h1>
<p>${escape(report.team.team_name)} · <time datetime="${escape(report.audited_at)}">${escape(report.audited_at)}</time></p>
<p class="status${verdict.ok ? '' : ' failed'}">${summary}</p>
<dl>
  <div><dt>Audit chain</dt><dd>${escape(label(chain.status))}</dd></div>
  <div><dt>Verified records</dt><dd>${chain.verified_lines} of ${chain.total_lines}</dd></div>
  <div><dt>Usage log</dt><dd>${escape(label(usage.status))}</dd></div>
  <div><dt>Matched source files</dt><dd>${reconcile.matched.length}</dd></div>
</dl>
</header>
<main>
<section><h2>Violations</h2>${table('Audit violations', ['Type', 'Location', 'Expected', 'Found'], violationRows)}</section>
<section><h2>Source reconciliation</h2>${reconciliation}</section>
<section><h2>Audit trail</h2>${brokenLine}${malformed}
${table('Recorded edits', ['Log line', 'State', 'Path', 'Declared model', 'Tokens', 'Timestamp'], logRows)}</section>
<section><h2>Advisory findings</h2>${table('Advisory findings', ['Type', 'Path', 'Detail'], advisoryRows)}</section>
</main>
<footer class="muted">
<p>Report digest <code>${escape(report.chain_link.body_sha256)}</code></p>
<p>Report ID <code>${escape(report.report_id)}</code> · Hackaudit ${escape(report.tool_version)}</p>
</footer>
</body>
</html>
`
}

module.exports = { renderHtml, reportMarker }

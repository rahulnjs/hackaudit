const fs = require('node:fs')
const path = require('node:path')
const { hashLine } = require('./chain')
const rubric = require('./toolkit/auditor/rubric.json')

const reportMarker = '<!-- hackaudit:forensic-report@1 -->'
const styles = fs.readFileSync(path.join(__dirname, 'report.css'), 'utf8')
const script = fs.readFileSync(path.join(__dirname, 'report-client.js'), 'utf8')
const scriptHash = Buffer.from(hashLine(script), 'hex').toString('base64')
const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
const escape = value => String(value ?? '—').replace(/[&<>"']/g, char => entities[char])
const label = value => String(value).toLowerCase().replaceAll('_', ' ').replace(/^./, char => char.toUpperCase())
const number = value => value == null ? 'Unavailable' : Number(value).toLocaleString('en-US')
const date = value => value && Number.isFinite(Date.parse(value))
  ? new Date(value).toISOString().replace('T', ' ').replace('Z', ' UTC') : value ?? 'Unavailable'
const badge = (value, tone = '') => `<span class="badge ${tone}">${escape(label(value))}</span>`
const state = value => badge(value, ['VERIFIED', 'OK', 'GENESIS'].includes(value) ? 'good' : 'attention')
const empty = text => `<div class="empty">${escape(text)}</div>`

function table(id, caption, columns, rows) {
  return `<div class="table-wrap"><table id="${id}"><caption>${escape(caption)}</caption>
<thead><tr>${columns.map(column => `<th scope="col">${escape(column)}</th>`).join('')}</tr></thead>
<tbody>${rows.map(row => `<tr data-filter-row>${row.map(cell => `<td>${escape(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
<p class="filter-empty" data-empty-for="${id}" hidden>No matching records. Try another search.</p>`
}

function search(id, placeholder) {
  return `<label class="search"><span class="sr-only">${escape(placeholder)}</span><span aria-hidden="true">⌕</span><input type="search" data-filter="${id}" placeholder="${escape(placeholder)}" autocomplete="off"></label>`
}

function citations(items) {
  return items.length ? `<ul class="citation-list">${items.map(item => `<li><code>${escape(item.path)}${item.line == null ? '' : ':' + item.line}</code><span>${escape(item.detail)}</span></li>`).join('')}</ul>` : empty('No supporting citations were supplied.')
}

function renderHtml(report, project) {
  const { chain, reconcile, verdict } = report
  const prompts = report.prompt_log ?? { status: 'ABSENT', total_lines: 0, entries: [] }
  const usage = report.token_usage ?? { status: 'ABSENT', record_count: 0, sessions: [], gaps: [], totals: null }
  const usageRecords = report.usage_records ?? []
  const assessment = report.assessment
  const demo = assessment?.criteria[6]
  const scoreRows = rubric.criteria.map((criterion, index) => {
    const row = assessment?.criteria[index]
    return [`${criterion.id}. ${criterion.name}`, `${criterion.weight}%`, row?.score == null ? 'Pending' : `${row.score} / 5`,
      row?.score == null ? 'Pending' : `${number(row.weighted_points)} / ${criterion.weight}`, row?.confidence ?? 'Not assessed',
      criterion.id === 7 ? 'Judge-owned' : row?.score == null ? 'Awaiting evidence' : 'Agent-assessed']
  })
  const entries = chain.entries
  const files = [...new Set([...entries.map(entry => entry.path).filter(Boolean), ...reconcile.header_only])].sort()
  const models = [...new Set(entries.map(entry => entry.model).filter(Boolean))]
  const observations = report.fingerprint.findings
  const attentionCount = verdict.violations.length + reconcile.header_only.length + reconcile.log_only.length + usage.gaps.length
  const nav = [['overview', 'Overview', null], ['scoring', 'Rubric assessment', null], ['prompts', 'Prompt history', prompts.total_lines], ['files', 'File evidence', files.length],
    ['activity', 'Edit timeline', chain.total_lines], ['usage', 'Token consumption', usage.record_count],
    ['integrity', 'Integrity & findings', verdict.violations.length], ['provenance', 'Report provenance', null]]
  const fileRows = files.map(file => {
    const edits = entries.filter(entry => entry.path === file)
    const evidence = report.file_evidence?.find(entry => entry.path === file)
    const header = evidence?.header
    const latest = evidence?.latest_record
    const status = reconcile.team_mismatch.some(entry => entry.path === file) ? 'Team mismatch' :
      reconcile.matched.includes(file) ? 'Header + log' : reconcile.header_only.includes(file) ? 'Header only' : 'Log only'
    const differences = header && latest ? ['team', 'model', 'ts'].filter(key =>
      header[key] !== latest[key === 'team' ? 'team_id' : key]).join(', ') : ''
    return [file, status, edits.length, [...new Set(edits.map(entry => entry.model))].join(', ') || 'Unavailable',
      date(edits[0]?.ts), date(edits.at(-1)?.ts), header ? `${header.team} · ${header.model} · ${date(header.ts)}` : 'No readable first-line header',
      differences ? `Header / latest log differences: ${differences}` : '—']
  })
  const cues = []
  if (verdict.violations.length) cues.push(['Integrity requires review', `${verdict.violations.length} violation(s). Inspect findings before relying on model declarations.`, 'integrity'])
  if (!chain.total_lines) cues.push(['No edit evidence', 'No file edits were recorded. A consistent empty chain does not establish audit coverage.', 'activity'])
  if (!prompts.total_lines) cues.push(['Prompt capture unavailable', 'Ask how prompts were captured and identify missing work.', 'prompts'])
  if (reconcile.log_only.length) cues.push(['Reconcile log-only files', `${reconcile.log_only.length} path(s) have no reconciled header. Check format exceptions, removed or untracked files, and generated output.`, 'files'])
  if (reconcile.header_only.length) cues.push(['Uncorroborated declarations', `${reconcile.header_only.length} header(s) have no edit record. Ask for supporting evidence.`, 'files'])
  if (models.length > 1) cues.push(['Explain model choices', `${models.length} declared models appear in the log. Ask where each was used and why.`, 'activity'])
  if (usage.gaps.length || !usage.sessions.length) cues.push(['Usage coverage needs review', 'Inspect missing-data observations. Unavailable usage is not zero consumption.', 'usage'])
  cues.push(assessment ? ['Review the agent assessment', 'Inspect evidence, rationales, score caps and open questions. The live demo and final sign-off belong to the judge.', 'scoring'] :
    ['Scoring awaits auditor review', 'An organizer-authorized agent follows the auditor skill to assess the code. This evidence collector does not choose scores.', 'scoring'])
  const promptCards = (prompts.entries ?? []).map(entry => `<article class="prompt-card" data-filter-row>
<div class="prompt-heading"><div><span class="eyebrow">PROMPT ${entry.index + 1}</span><h3>${escape(entry.model ?? 'Malformed record')}</h3></div>${state(entry.state)}</div>
<div class="meta-line"><span>${escape(date(entry.ts))}</span><span>Team: ${escape(entry.team_id)}</span></div>
${entry.text == null ? empty('This record could not be decoded. See integrity findings.') : `<pre class="prompt-text">${escape(entry.text)}</pre>`}
<details class="record-detail"><summary>Record details</summary><dl class="metadata"><div><dt>Prompt ID</dt><dd><code>${escape(entry.id)}</code></dd></div><div><dt>Physical log line</dt><dd>${entry.index + 1}</dd></div><div><dt>Source</dt><dd><code>.hack/prompts.jsonl</code></dd></div></dl></details></article>`).join('')
  const editRows = entries.map(entry => [entry.index + 1, entry.state, entry.path, entry.n, entry.model, date(entry.ts), entry.expected, entry.actual])
  const violationRows = verdict.violations.map(item => [label(item.kind), item.path ?? item.artifact ?? 'Audit log', item.index == null ? '—' : item.index + 1, item.expected, item.found ?? item.actual])
  const sessionRows = usage.sessions.map(session => [session.agent, session.session_id, session.model,
    session.scope === 'session' ? 'Latest cumulative snapshot' : 'Sum of unique turns', number(session.tokens.input), number(session.tokens.output), number(session.tokens.cache_read), number(session.tokens.cache_write), number(session.total)])
  const snapshotRows = usageRecords.map(record => [date(record.ts), record.agent, record.session_id, record.model,
    record.tokens === null ? 'Unavailable' : record.scope, record.id, record.source,
    record.tokens === null ? record.reason : `Input ${number(record.tokens.input)} / output ${number(record.tokens.output)} / cache read ${number(record.tokens.cache_read)} / cache write ${number(record.tokens.cache_write)}`])
  const artifacts = [['Team binding', report.team.team_name !== 'unknown-team', 'hackathon.json (legacy: .hack/team.json)'],
    ['Edit log', report.artifacts.audit_log_present, '.hack/audit.log'], ['Agent instructions', report.artifacts.agent_rules_present, '.hack/agent-rules.md'],
    ['Prompt log', prompts.status !== 'ABSENT', '.hack/prompts.jsonl'], ['Usage log', usage.status !== 'ABSENT', '.hack/usage.log']]
  const json = JSON.stringify(report).replaceAll('<', '\\u003c')
  return `<!doctype html>
${reportMarker}
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'sha256-${scriptHash}'; base-uri 'none'; form-action 'none'">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&amp;family=JetBrains+Mono:wght@400;500;600&amp;display=swap" rel="stylesheet">
<title>${escape(project)} · Hackaudit review</title><style>${styles}</style></head>
<body><a class="skip-link" href="#overview">Skip to report</a>
<div class="reading-progress" id="reading-progress" aria-hidden="true"></div>
<div class="workspace"><header class="topbar"><a class="brand" href="#overview"><span class="brand-mark">H</span><span>AI Hackathon <span class="brand-detail">/ Forensic review</span></span></a><div class="actions"><button type="button" id="download-json">Export JSON</button><button type="button" id="print-report">Print</button><button type="button" id="theme-toggle" aria-pressed="false">Theme</button></div></header>
<main><section id="overview"><div class="heading-row"><div><div class="eyebrow">SUBMISSION EVIDENCE <span class="separator">/</span> HACKAUDIT ${escape(report.tool_version)}</div><h1>${escape(project)}</h1><p class="subtitle">Submission evidence, prompt history and AI usage — prepared for human judgment.</p></div>${badge(verdict.ok ? 'No recorded violations' : 'Integrity issues found', verdict.ok ? 'good' : 'danger')}</div>
<div class="report-meta"><span>TEAM <strong>${escape(report.team.team_name)}</strong></span><span>CHAIN <strong>SHA-256</strong></span><span>GENERATED <strong>${escape(date(report.audited_at))}</strong></span><span class="metadata-state">● FORENSIC / ${escape(report.schema)}</span></div>
<nav class="report-nav" aria-label="Report sections">${nav.map(([id, title, count], index) => `<a href="#${id}"${index === 0 ? ' class="active" aria-current="location"' : ''}><span class="nav-index">${String(index).padStart(2, '0')}</span><span class="nav-title">${title}</span><span class="nav-count">${count === null ? 'REPORT' : number(count) + ' RECORDS'}</span></a>`).join('')}</nav>
<div class="metrics"><div class="metric"><span>Verified edit records</span><strong>${number(chain.verified_lines)}<small> / ${number(chain.total_lines)}</small></strong><p>${escape(label(chain.status))} edit chain</p></div>
<div class="metric"><span>Captured prompts</span><strong>${number(prompts.total_lines)}</strong><p>${escape(label(prompts.status))} prompt log</p></div>
<div class="metric"><span>Files with edit records</span><strong>${number(new Set(entries.map(entry => entry.path).filter(Boolean)).size)}</strong><p>${number(reconcile.matched.length)} reconciled with headers</p></div>
<div class="metric"><span>Reported tokens</span><strong class="token-number">${number(usage.totals?.total)}</strong><p>Recorded usage · completeness unverified</p></div></div>
<div class="panel review-panel"><div class="section-heading"><div><span class="eyebrow">JUDGE BRIEF</span><h2>Focus your review</h2></div>${badge(`${attentionCount} evidence items to inspect`, attentionCount ? 'attention' : '')}</div>
<div class="review-cues">${cues.map(([title, detail, target], index) => `<a class="review-cue" href="#${target}"><span class="cue-index">${String(index + 1).padStart(2, '0')}</span><div><h3>${escape(title)}</h3><p>${escape(detail)}</p></div><span aria-hidden="true">↗</span></a>`).join('')}</div></div>
<div class="evidence-note"><strong>What “verified” establishes</strong><p>Log structure and internal hash links are consistent. Model identities, prompt completeness, actual token consumption and source-code contents are not independently authenticated. Integrity checks are separate from the agent's rubric assessment.</p></div></section>
<section id="scoring"><div class="section-heading"><div><span class="eyebrow">01 / AGENT-LED REVIEW</span><h2>The 100-point rubric</h2><p>Seven criteria, scored 1–5 against cited evidence. The reviewing agent supplies scores; the judge owns Live Demo and Q&A.</p></div>${badge(assessment?.status ?? 'Not assessed', assessment?.status === 'final' ? 'good' : 'attention')}</div>
<div class="score-summary"><div><span>Code assessment</span><strong>${assessment?.code_subtotal == null ? 'Pending' : number(assessment.code_subtotal)}${assessment?.code_subtotal == null ? '' : `<small> / ${number(assessment.code_available)} assessed</small>`}</strong><p>${assessment ? `${number(assessment.code_available)} of 80 weighted points assessed. Partial scores are not normalized.` : '80 weighted points · awaiting auditor review'}</p></div><div><span>Live Demo & Q&A</span><strong>${demo?.score == null ? 'Pending' : number(demo.weighted_points)}<small> / 20</small></strong><p>Judge-provided demonstration and Q&A evidence</p></div><div><span>Final score</span><strong>${assessment?.final_total == null ? 'Pending' : number(assessment.final_total)}<small> / 100</small></strong><p>Requires all criteria, demo evidence and sign-off</p></div></div>
<div class="panel">${table('score-table', 'Weighted rubric assessment', ['Criterion', 'Weight', 'Score', 'Awarded points', 'Confidence', 'Authority'], scoreRows)}</div>
${assessment ? `<div class="assessment-meta">Reviewed by <strong>${escape(assessment.assessor)}</strong> · ${escape(date(assessment.assessed_at))} · ${escape(assessment.rubric)}</div>
${assessment.criteria.map(row => `<details class="panel disclosure criterion-detail"><summary>${row.id}. ${escape(row.name)} <span>${row.score == null ? 'UNSCORED' : `${row.score}/5 · ${number(row.weighted_points)} POINTS`}</span></summary><div class="criterion-body"><p>${escape(row.rationale)}</p><div class="criterion-labels">${badge(row.confidence)}${row.score_cap == null ? '' : badge(`Score cap ${row.score_cap}/5`, 'attention')}</div><h3>Supporting evidence</h3>${citations(row.citations)}${row.gate_reasons.length ? `<h3>Integrity gates</h3><ul>${row.gate_reasons.map(reason => `<li>${escape(reason)}</li>`).join('')}</ul>` : ''}${row.gaps.length ? `<h3>Evidence gaps</h3><ul>${row.gaps.map(gap => `<li>${escape(gap)}</li>`).join('')}</ul>` : ''}</div></details>`).join('')}
<div class="panel"><div class="panel-title"><h3>Judge Q&A</h3>${badge('Evidence-backed questions')}</div>${assessment.questions.map((item, index) => `<article class="judge-question"><h3>${index + 1}. ${escape(item.question)}</h3>${citations(item.citations)}</article>`).join('')}</div>
<details class="panel disclosure"><summary>Assessment provenance, review & overrides</summary><dl class="metadata"><div><dt>Pinned commit</dt><dd><code>${escape(assessment.evidence.commit)}</code></dd></div><div><dt>Basis report SHA-256</dt><dd><code>${escape(assessment.basis_report_sha256)}</code></dd></div><div><dt>Tree SHA-256</dt><dd><code>${escape(assessment.evidence.tree_sha256)}</code></dd></div><div><dt>Problem statement SHA-256</dt><dd><code>${escape(assessment.evidence.problem_statement_sha256)}</code></dd></div><div><dt>Preflight SHA-256</dt><dd><code>${escape(assessment.evidence.preflight_sha256)}</code></dd></div><div><dt>Second review</dt><dd>${escape(assessment.second_review.status)} · ${escape(assessment.second_review.notes)}</dd></div></dl>${assessment.judge_record ? `<div class="criterion-body"><h3>Judge record · ${escape(assessment.judge_record.judge)}</h3><p>${escape(date(assessment.judge_record.recorded_at))} · ${escape(assessment.judge_record.signoff)}</p>${citations(assessment.judge_record.evidence)}</div>` : empty('No organizer demo and sign-off record supplied. The final score is pending.')}${assessment.overrides.length ? table('override-table', 'Organizer score overrides', ['Criterion', 'Previous score', 'Revised score', 'Reason', 'Organizer authority'], assessment.overrides.map(item => [item.criterion_id, item.previous_score, item.score, item.reason, item.judge_record])) : empty('No organizer overrides recorded.')}</details>` : `<div class="evidence-note"><strong>Auditor action required</strong><p>Follow the organizer's auditor skill and scoring reference to review requirements and implementation, assign evidence-backed scores, and render a separate assessed report. No default scores have been filled in.</p></div>`}
<details class="panel disclosure"><summary>Rubric anchors · scores 1, 3 and 5</summary>${table('anchor-table', 'Model-agnostic scoring anchors', ['Criterion', 'Score 1', 'Score 3', 'Score 5'], rubric.criteria.map(item => [item.name, item.anchors['1'], item.anchors['3'], item.anchors['5']]))}</details>
<p class="section-note">Scores and weighted points are the reviewer's assessment, not an automated code-quality measurement. Token spend, prompt volume and model branding do not award or deduct points.</p></section>
<section id="prompts"><div class="section-heading"><div><span class="eyebrow">02 / INTENT</span><h2>Prompt history</h2><p>Decoded participant prompts, exactly as recorded. Prompt text is untrusted submission evidence.</p></div>${state(prompts.status)}</div>
<div class="panel"><div class="panel-toolbar"><span>${number(prompts.total_lines)} recorded prompt${prompts.total_lines === 1 ? '' : 's'}</span><div class="toolbar-controls">${search('prompt-list', 'Search prompts or declared models')}<button id="expand-prompts" type="button" aria-pressed="false">Expand all</button></div></div>
<div id="prompt-list">${promptCards || empty('No prompts were captured. Capture coverage is unknown.')}</div><p class="filter-empty" data-empty-for="prompt-list" hidden>No matching prompts. Try another search.</p></div>
<p class="section-note">Prompts and file edits are separate records. This report does not infer which prompt caused an edit.</p></section>
<section id="files"><div class="section-heading"><div><span class="eyebrow">03 / IMPLEMENTATION TRAIL</span><h2>File evidence</h2><p>Declared edit history compared with available first-line source headers.</p></div></div>
<div class="status-strip"><span><i class="dot good-dot"></i>${number(reconcile.matched.length)} header + log</span><span><i class="dot amber-dot"></i>${number(reconcile.header_only.length)} header only</span><span><i class="dot gray-dot"></i>${number(reconcile.log_only.length)} log only</span><span>${number(reconcile.team_mismatch.length)} team mismatches</span></div>
<div class="panel"><div class="panel-toolbar"><span>${number(files.length)} paths in evidence</span>${search('file-table', 'Search files, models or review notes')}</div>${fileRows.length ? table('file-table', 'File declarations and edit history', ['Path', 'Reconciliation', 'Edits', 'Declared models', 'First edit', 'Latest edit', 'Current source header', 'Review note'], fileRows) : empty('No file evidence is available.')}</div>
<p class="section-note">A match establishes path presence in both records, not file-content authenticity. Log-only paths may be format exceptions, untracked, removed or generated files. The inventory uses Git-tracked paths when available.</p></section>
<section id="activity"><div class="section-heading"><div><span class="eyebrow">04 / CHANGE HISTORY</span><h2>Edit timeline</h2><p>Physical log order is preserved. Sequence numbers count edits separately for each path.</p></div>${state(chain.status)}</div>
<div class="panel"><div class="panel-toolbar"><span>${number(chain.total_lines)} records · ${number(models.length)} declared models</span>${search('edit-table', 'Search edits, models or chain states')}</div>${editRows.length ? table('edit-table', 'Append-only audit trail', ['Log line', 'Chain state', 'Path', 'File sequence', 'Declared model', 'Timestamp', 'Expected previous hash', 'Recorded previous hash'], editRows) : empty('No edit records are available.')}</div></section>
<section id="usage"><div class="section-heading"><div><span class="eyebrow">05 / RESOURCE USE</span><h2>Token consumption</h2><p>Agent-reported observations, calculated independently of file and prompt counts.</p></div>${state(usage.status)}</div>
<div class="token-breakdown">${[['input', 'Uncached input'], ['output', 'Output'], ['cache_read', 'Cache read'], ['cache_write', 'Cache write']].map(([key, title]) => `<div><span>${title}</span><strong>${number(usage.totals?.[key])}</strong></div>`).join('')}</div>
<div class="panel">${sessionRows.length ? table('session-table', 'Usage by session and model', ['Agent', 'Session', 'Model', 'Calculation', 'Uncached input', 'Output', 'Cache read', 'Cache write', 'Total'], sessionRows) : empty('No usable token counts were recorded. Consumption is unavailable, not zero.')}</div>
<div class="evidence-note"><strong>Reported observations</strong><p>Cumulative snapshots use the latest counters; turn records are summed once. Unknown cache counts make the total unavailable. Final responses and later work may occur after the last snapshot. Reasoning is not added again when included in output.</p></div>
${usage.gaps.length ? `<div class="panel gap-panel"><h3>Capture gaps</h3>${table('gap-table', 'Unavailable usage observations', ['Agent', 'Session', 'Recorded at', 'Reason'], usage.gaps.map(gap => [gap.agent, gap.session_id, date(gap.ts), gap.reason]))}</div>` : '<p class="section-note">No explicit capture gaps were reported. This does not establish complete coverage.</p>'}
<details class="panel disclosure"><summary>Usage observations & source references <span>${number(usageRecords.length)} records</span></summary>${snapshotRows.length ? table('snapshot-table', 'Usage observations', ['Recorded at', 'Agent', 'Session', 'Model', 'Scope', 'Record ID', 'Reported source', 'Observation'], snapshotRows) : empty('No decodable usage observations are available.')}</details></section>
<section id="integrity"><div class="section-heading"><div><span class="eyebrow">06 / TRUST & EXCEPTIONS</span><h2>Integrity & findings</h2><p>Deterministic checks and advisory observations. Advisory findings do not change scores.</p></div></div>
<div class="integrity-grid">${[['Edit chain', chain.status], ['Prompt chain', prompts.status], ['Usage chain', usage.status]].map(([title, status]) => `<div class="panel integrity-card"><span>${title}</span>${state(status)}</div>`).join('')}</div>
${chain.first_break_index === null ? '' : `<div class="alert">First chain break at log line ${chain.first_break_index + 1}. Later records are not corroborated by an intact chain.</div>`}
${prompts.first_break_index == null ? '' : `<div class="alert">First prompt-chain break at log line ${prompts.first_break_index + 1}. Content after the break remains unverified.</div>`}
${usage.first_break_index == null ? '' : `<div class="alert">Usage validation failed at log line ${usage.first_break_index + 1}: ${escape(usage.error)}</div>`}
${report.decode.invalid_indexes.length ? `<div class="alert">Invalid edit-log lines: ${report.decode.invalid_indexes.map(index => index + 1).join(', ')}.</div>` : ''}
<div class="panel"><div class="panel-title"><h3>Audit violations</h3>${badge(verdict.violations.length, verdict.violations.length ? 'danger' : 'good')}</div>${violationRows.length ? table('violation-table', 'Integrity violations', ['Type', 'Location', 'Log line', 'Expected', 'Found'], violationRows) : '<div class="empty success-empty"><strong>No recorded audit violations</strong><p>The available evidence passed these checks. Coverage and declarations still require review.</p></div>'}</div>
<div class="panel"><div class="panel-title"><h3>Advisory findings</h3>${badge(observations.length)}</div>${observations.length ? table('finding-table', 'Advisory observations', ['Type', 'Severity', 'Path', 'Detail'], observations.map(item => [label(item.kind), item.severity, item.path, item.detail])) : empty('No advisory findings were recorded.')}</div></section>
<section id="provenance"><div class="section-heading"><div><span class="eyebrow">07 / REVIEW RECORD</span><h2>Report provenance</h2><p>Identifiers, artifact availability and the limits of this evidence.</p></div></div>
<div class="panel">${table('artifact-table', 'Required and supporting artifacts', ['Artifact', 'Availability', 'Location'], artifacts.map(([title, present, location]) => [title, present ? 'Present' : 'Missing or invalid', location]))}
<dl class="metadata provenance"><div><dt>Report ID</dt><dd><code>${escape(report.report_id)}</code></dd></div><div><dt>Schema / tool</dt><dd>${escape(report.schema)} / Hackaudit ${escape(report.tool_version)}</dd></div><div><dt>UI template</dt><dd><code>${escape(report.ui_template)}</code></dd></div><div><dt>Project identifier</dt><dd>${escape(report.project_name)}</dd></div><div><dt>Team initialized</dt><dd>${escape(date(report.team.initialized_at))}</dd></div><div><dt>Initialization version</dt><dd>${escape(report.team.init_version)}</dd></div><div class="wide"><dt>Canonical JSON body · SHA-256</dt><dd><code>${escape(report.chain_link.body_sha256)}</code></dd></div><div><dt>Previous report digest</dt><dd>${escape(report.chain_link.prev ?? 'Not linked to a previous report')}</dd></div><div><dt>Report chain sequence</dt><dd>${escape(report.chain_link.seq ?? 'Not assigned')}</dd></div></dl></div>
<div class="review-limitations"><h3>Human judgment and evidence limits</h3><p>Rubric scores, when present, are supplied by the reviewing agent using cited organizer and code evidence. Unscored criteria remain pending; finalization requires judge-provided live demo evidence and sign-off. Prompt volume, token consumption and capture gaps are not performance scores.</p><p>Without an organizer-held checkpoint, complete local rewrites or deletions may remain undetected. The digest covers the JSON body with <code>chain_link</code> omitted; it is not an external signature or an HTML-file digest.</p></div></section>
<footer><span>HACKAUDIT / ${escape(report.tool_version)}<span class="footer-caption">Evidence for human judgment.</span></span><span>${escape(report.team.team_name)} · ${escape(report.report_id)}<br>All timestamps UTC</span></footer></main></div>
<div id="announcement" class="sr-only" role="status" aria-live="polite"></div>
<script type="application/json" id="report-data">${json}</script><script>${script}</script></body></html>
`
}

module.exports = { renderHtml, reportMarker }

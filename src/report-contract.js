const schema = require('./toolkit/report/schema.json')
const { canonical, hashLine, appendEntry } = require('./chain')
const { inspectUsage } = require('./usage-report')

function check(value, rule, location) {
  if (rule.$ref) return check(value, schema.$defs[rule.$ref.slice('#/$defs/'.length)], location)
  if (rule.anyOf && !rule.anyOf.some(option => check(value, option, location) === null)) return location + ': invalid value'
  for (const option of rule.allOf ?? []) {
    const error = check(value, option, location)
    if (error) return error
  }
  if (Object.hasOwn(rule, 'const') && value !== rule.const) return location + ': expected ' + JSON.stringify(rule.const)
  if (rule.enum && !rule.enum.includes(value)) return location + ': unexpected value'
  const type = rule.type
  const valid = !type || (type === 'null' ? value === null : type === 'array' ? Array.isArray(value) :
    type === 'object' ? value !== null && typeof value === 'object' && !Array.isArray(value) :
    type === 'integer' ? Number.isSafeInteger(value) : type === 'number' ? Number.isFinite(value) : typeof value === type)
  if (!valid) return location + ': expected ' + type
  if (type === 'string' && ((rule.minLength && value.length < rule.minLength) ||
      (rule.pattern && !new RegExp(rule.pattern).test(value)))) return location + ': invalid string'
  if (['integer', 'number'].includes(type) && (value < (rule.minimum ?? -Infinity) || value > (rule.maximum ?? Infinity))) return location + ': out of range'
  if (type === 'array') {
    if (value.length < (rule.minItems ?? 0) || value.length > (rule.maxItems ?? Infinity)) return location + ': invalid item count'
    for (let index = 0; index < value.length; index++) {
      const error = check(value[index], rule.prefixItems?.[index] ?? rule.items, location + '[' + index + ']')
      if (error) return error
    }
  }
  if (type === 'object') {
    for (const key of rule.required ?? []) {
      if (!Object.hasOwn(value, key)) return location + '.' + key + ': required field is missing'
    }
    for (const key of Object.keys(value)) {
      if (!Object.hasOwn(rule.properties, key)) {
        if (rule.additionalProperties === false) return location + '.' + key + ': unexpected field'
      } else {
        const error = check(value[key], rule.properties[key], location + '.' + key)
        if (error) return error
      }
    }
  }
  return null
}

function validateReport(report) {
  const error = check(report, schema, 'report')
  if (error) throw new Error(error)
  const { chain_link: link, ...body } = report
  if (link.body_sha256 !== hashLine(canonical(body))) throw new Error('Report body SHA-256 does not match chain_link.body_sha256')
  if (report.assessment && (link.prev !== report.assessment.basis_report_sha256 || link.seq === null)) {
    throw new Error('An assessed report must link to its recorded basis report')
  }
  if (report.chain.total_lines !== report.chain.entries.length ||
      report.chain.verified_lines !== report.chain.entries.filter(entry => ['OK', 'GENESIS'].includes(entry.state)).length ||
      report.artifacts.line_count !== report.chain.total_lines ||
      report.prompt_log.total_lines !== report.prompt_log.entries.length ||
      report.verdict.ok !== (report.verdict.violations.length === 0)) {
    throw new Error('Report counts or verdict are inconsistent with their source records')
  }
  for (const [log, length] of [[report.chain, report.chain.total_lines],
    [report.prompt_log, report.prompt_log.total_lines], [report.token_usage, report.token_usage.record_count]]) {
    if ((log.status === 'BROKEN' && (log.first_break_index === null || log.first_break_index >= length || report.verdict.ok)) ||
        (log.status !== 'BROKEN' && log.first_break_index !== null) || (log.status === 'ABSENT' && length !== 0)) {
      throw new Error('Log verification status is inconsistent with the report evidence')
    }
  }
  if ((report.chain.status === 'VERIFIED' && report.chain.verified_lines !== report.chain.total_lines) ||
      (report.prompt_log.status === 'VERIFIED' && report.prompt_log.entries.some(entry => entry.state !== 'VERIFIED'))) {
    throw new Error('A verified log contains unverified records')
  }
  if (report.token_usage.status === 'VERIFIED') {
    const text = report.usage_records.reduce((text, entry) => appendEntry(text, entry).newText, '')
    const calculated = inspectUsage(text, report.team.team_name).report
    if (calculated.status !== 'VERIFIED' || ['record_count', 'sessions', 'gaps', 'totals'].some(key =>
      canonical(calculated[key]) !== canonical(report.token_usage[key]))) {
      throw new Error('Token totals or sessions do not match the usage observations')
    }
  }
}

module.exports = { validateReport, template: schema.properties.ui_template.const }

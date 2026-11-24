const path = require('node:path')
const fs = require('node:fs')
const { readFile } = require('./paths')
const { saveReport } = require('./audit')

function render(root, args) {
  if ((args.length !== 1 && args.length !== 3) || (args.length === 3 && args[1] !== '--out')) {
    throw new Error('Usage: hackaudit render <report.json> [--out <dir>]')
  }
  const source = path.resolve(root, args[0])
  const text = readFile(fs.realpathSync(path.dirname(source)), path.basename(source))
  if (text === null) throw new Error('Expected a regular report JSON file, not a symlink')
  const report = JSON.parse(text)
  const result = saveReport(root, args[2] ?? 'audit-reports', report, true)
  console.log(result.htmlPath)
}

module.exports = render

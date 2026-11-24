// Parse CLI options and dispatch each command.
const fs = require('node:fs')
const { audit } = require('./audit')
const { usageReport } = require('./usage-report')
const render = require('./render')
const { version } = require('../package.json')

const usage = 'Usage: hackaudit audit [--chain] [--decode] [--reconcile] [--fingerprint] [--html] [--out <dir>] | hackaudit usage [--report] | hackaudit render <report.json> [--out <dir>]'
const sections = ['chain', 'decode', 'reconcile', 'fingerprint']

function main([command, ...args]) {
  if (command === '--help' || command === '-h') {
    console.log(usage)
    return 0
  }
  if (command === '--version') {
    console.log(version)
    return 0
  }
  try {
    const root = fs.realpathSync(process.cwd())
    if (command === 'render') {
      render(root, args)
      return 0
    }
    if (command === 'usage') {
      if (args.length && (args.length !== 1 || args[0] !== '--report')) throw new Error('Usage: hackaudit usage [--report]')
      const report = usageReport(root)
      console.log(JSON.stringify(report, null, 2))
      return report.status === 'VERIFIED' ? 0 : 1
    }
    if (command === 'audit') {
      const selected = new Set()
      let out = 'audit-reports'
      let html = false
      for (let i = 0; i < args.length; i++) {
        const flag = args[i]
        if (flag === '--out' && args[i + 1] && !args[i + 1].startsWith('-')) {
          out = args[++i]
        } else if (flag === '--html') {
          html = true
        } else if (flag.startsWith('--') && sections.includes(flag.slice(2))) {
          selected.add(flag.slice(2))
        } else {
          console.error('Invalid audit option: ' + flag + '\n' + usage)
          return 2
        }
      }
      return audit(root, out, selected, html)
    }
    throw new Error(usage)
  } catch (error) {
    console.error(error.message)
    return 1
  }
}

module.exports = { main }

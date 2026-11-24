// Parse CLI options and dispatch each command.
const fs = require('node:fs')
const init = require('./init')
const { audit } = require('./audit')
const log = require('./log')
const { version } = require('../package.json')

const usage = 'Usage: hackaudit init <teamname> | hackaudit log <path> <model> [--input <n> --output <n> [--total <n>]] [--source <api|estimate|absent>] [--ts <timestamp>] | hackaudit audit [--chain] [--decode] [--reconcile] [--fingerprint] [--html] [--out <dir>]'
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
    if (command === 'init') {
      if (args.length !== 1) throw new Error('Usage: hackaudit init <teamname>')
      init(root, args[0])
      return 0
    }
    if (command === 'log') {
      log(root, args)
      return 0
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

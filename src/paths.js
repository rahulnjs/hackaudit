// Resolve workspace paths without following participant-controlled symlinks.
const fs = require('node:fs')
const path = require('node:path')

const toolkit = ['auditor/SKILL.md', 'leaderboard/SKILL.md', 'manifest/schema.json']
const teamNamePattern = /^[A-Za-z0-9._-]{2,64}$/

function stat(file) {
  try {
    return fs.lstatSync(file)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    return null
  }
}

function readFile(root, relative) {
  let current = root
  const segments = relative.split('/')
  for (let i = 0; i < segments.length; i++) {
    current = path.join(current, segments[i])
    const info = stat(current)
    const valid = i === segments.length - 1 ? info?.isFile() : info?.isDirectory()
    if (!valid) return null
  }
  return fs.readFileSync(current, 'utf8')
}

function directory(dir, create = false) {
  const state = stat(dir)
  if (state?.isDirectory()) return
  if (!state && create) {
    try {
      fs.mkdirSync(dir)
    } catch (error) {
      if (error.code !== 'EEXIST' || !stat(dir)?.isDirectory()) throw error
    }
    return
  }
  throw new Error('Expected a real directory: ' + dir)
}

function validLogPath(value) {
  return typeof value === 'string' && !/[\\\u0000-\u001f:]/.test(value) &&
    value.split('/').every(part => part && part !== '.' && part !== '..') &&
    !['.hack', '.git'].includes(value.split('/')[0].toLowerCase())
}

module.exports = { toolkit, teamNamePattern, stat, readFile, directory, validLogPath }

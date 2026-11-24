#!/usr/bin/env node
// Keep this CLI entry point executable (mode 0755).
process.exitCode = require('../src/cli').main(process.argv.slice(2))

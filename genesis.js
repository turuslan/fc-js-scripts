#!/usr/bin/env node

const {
  asyncMain,
  die,
  killOnExit,
  logIfError,
  LOTUS,
  mkdir,
  opts,
  repoApi,
  rm,
  waitExit,
} = require('./common.js')
const { spawn } = require('child_process')
const { existsSync, readFileSync, writeFileSync } = require('fs')
const { join } = require('path')

const sectorSize = process.env.SECTOR_SIZE || '2KiB'
const networkVersion = 13

asyncMain(module, async () => {
  const { arg, argv } = opts()
  const _dir = arg('dir')
  const counts = argv.map(arg => parseInt(arg))
  if (counts.some(isNaN)) {
    die(`invalid count ${JSON.stringify(arg)}`)
  }
  await makeGenesis(_dir, counts)
})

async function makeGenesis(_dir, counts) {
  const lotusSeed = `${LOTUS}-seed`
  const preseals = counts.map((count, i) => [genesisMiner(i), count])
  if (!preseals.length) {
    die('no preseals')
  }
  mkdir(_dir)
  const _json = join(_dir, 'genesis.json')
  const _car = join(_dir, 'genesis.car')
  async function runSeed(...argv) {
    const p = spawn(lotusSeed, argv)
    killOnExit(p)
    if (!await logIfError(p)) {
      process.exit(-1)
    }
  }
  rm(_json, _car)
  await runSeed('genesis', 'new', _json)
  await runSeed('genesis', 'set-network-version', _json, networkVersion)
  for (const [miner, count] of preseals) {
    const _preseal = presealDir(_dir, miner)
    const _meta = join(_preseal, `pre-seal-${miner}.json`)
    // may reuse: --sector-offset --num-sectors --key
    const meta = existsSync(_meta) ? JSON.parse(readFileSync(_meta)) : null
    const metaMiner = meta && meta[miner]
    const metaSectors = metaMiner && metaMiner.Sectors
    if (metaSectors && metaSectors.length <= count) {
      metaSectors.splice(count)
      writeFileSync(_meta, JSON.stringify(meta))
    } else {
      await runSeed('--sector-dir', _preseal, 'pre-seal', '--miner-addr', miner, '--num-sectors', count, '--sector-size', sectorSize, '--network-version', networkVersion)
    }
    await runSeed('genesis', 'add-miner', _json, join(_preseal, `pre-seal-${miner}.json`))
  }
  await runSeed('genesis', 'car', '--out', _car, _json)
}

function genesisMiner(i) { return `t0${1000 + i}` }
function presealDir(_dir, miner) { return join(_dir, `preseal-${miner}`) }
function presealKey(miner) { return `pre-seal-${miner}.key` }
function presealJson(miner) { return `pre-seal-${miner}.json` }

module.exports = {
  genesisMiner,
  makeGenesis,
  presealDir,
  presealJson,
  presealKey,
  sectorSize,
}

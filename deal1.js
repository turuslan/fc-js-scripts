#!/usr/bin/env node

const {
  asyncMain,
  killOnExit,
  LOTUS,
  mkdir,
  repoApi,
  rm,
  waitExit,
  logsStd,
  logs,
  lotusMiner,
  fromFil,
  sleep,
} = require('./common')
const {
  genesisMiner,
  makeGenesis,
  presealDir,
  presealJson,
  presealKey,
  sectorSize,
} = require('./genesis')
const { spawn } = require('child_process')
const {
  readFileSync,
  createWriteStream,
  writeFileSync,
  statSync,
  copyFileSync,
} = require('fs')
const { join } = require('path')

function todoDebug(tag, program, args) {
  console.log([
    `start ${tag} manually`,
    `  Program: ${program}`,
    `  Program arguments: ${args.join(' ')}`,
    `  Working directory: ${process.cwd()}`,
  ].join('\n'))
}

async function importPresealKey(api, _dir, i) {
  const miner = genesisMiner(i)
  const _preseal = presealDir(_dir, miner)
  const key = JSON.parse(Buffer.from(readFileSync(join(_preseal, presealKey(miner))).toString(), 'hex').toString())
  const addr = await api.call('WalletImport', key)
  await api.call('WalletSetDefault', addr)
  return addr
}

// TODO
const FUHON_SRC = '/Users/tushov/d/fc1'
const FUHON_BUILD = '/Users/tushov/d/build/fc1'
const FUHON = join(FUHON_BUILD.slice(0, -1) + '3', 'core/node/main/node')
const FUHON_MINER = join(FUHON_BUILD, 'core/miner/main/miner_main')
async function runFuhon(_dir, tag, _api, _port, { debug=false }={}) {
  // {
  //   const ninja = spawn('ninja', ['-C', FUHON_BUILD, 'node'])
  //   killOnExit(ninja)
  //   logsStd(ninja, `${tag}-ninja`)
  //   if (await waitExit(ninja) !== 0) throw 'ninja'
  // }
  const repo = join(_dir, `repo-${tag}`)
  rm(repo)
  mkdir(repo)
  const args = [
    '--repo', repo,
    '--genesis', join(_dir, 'genesis.car'),
    '--config', join(FUHON_SRC, '/core/node/main/mainnet.cfg'),
    '--api', _api,
    '--port', _port,
    '--profile', '2k',
  ]
  let p = null
  if (debug) {
    todoDebug(tag, FUHON, [JSON.stringify(args.map(x => `${x}`))])//args)
  } else {
    const log = createWriteStream(join(repo, 'log.log'), { flags: 'a' })
    p = spawn(FUHON, args)
    killOnExit(p)
    logsStd(p, tag)
    logs(p, log)
  }
  const api = await repoApi.waitApi(repo)
  async function stop() {
    if (p) {
      p.kill()
      await waitExit(p)
    } else {
      process.kill(+readFileSync(join(repo, '.pid'), 'utf8'))
    }
  }
  // debug && process.once('exit', stop)
  return {
    api,
    p,
    repo,
    stop,
  }
}

async function runFuhonMinerPreseal(_dir, tag, i, node, _api, { debug=false }={}) {
  const minerRepo = join(_dir, `miner-repo-${tag}`)
  rm(minerRepo)
  mkdir(minerRepo)
  copyFileSync('/Users/tushov/d/fc1/core/proofs/parameters.json', join(minerRepo, 'proof-params.json'))
  await importPresealKey(node.api, _dir, i)
  const miner = genesisMiner(i)
  const _preseal = presealDir(_dir, miner)
  const args = [
    '--repo', node.repo,
    '--miner-repo', minerRepo,
    '--miner-api', _api,
    '--sector-size', sectorSize,
    '--actor', miner,
    '--pre-sealed-sectors', _preseal, 
    '--profile', '2k',
  ]
  let p = null
  if (debug) {
    todoDebug(tag, FUHON_MINER, [JSON.stringify(args.map(x => `${x}`))])//args)
  } else {
    const log = createWriteStream(join(minerRepo, 'log.log'), { flags: 'a' })
    p = spawn(FUHON_MINER, args)
    killOnExit(p)
    logsStd(p, tag)
    logs(p, log)
  }
  const api = await repoApi.waitApi(minerRepo)
  async function stop() {
    if (p) {
      p.kill()
      await waitExit(p)
    } else {
      process.kill(+readFileSync(join(minerRepo, '.pid'), 'utf8'))
    }
  }
  const info = await node.api.call('StateMinerInfo', miner, [])
  return {
    api,
    miner,
    minerRepo,
    owner: info.Owner,
    peer: info.PeerId,
    p,
    stop,
    worker: info.Worker,
  }
}
async function createFuhonMiner(_dir, tag, node, _api) {
  throw new Error('TODO')
}

async function runLotus(_dir, tag, _api, { debug=false, clear=true }={}) {
  const repo = join(_dir, `repo-${tag}`)
  if (clear) {
    rm(repo)
  }
  mkdir(repo)
  const args = [
    '--repo', repo,
    'daemon',
    '--profile', 'bootstrapper',
    '--genesis', join(_dir, 'genesis.car'),
    '--api', _api,
  ]
  let p = null
  if (debug) {
    todoDebug(tag, LOTUS, args)
  } else {
    const log = createWriteStream(join(repo, 'log.log'), { flags: 'a' })
    p = spawn(LOTUS, args)
    killOnExit(p)
    logsStd(p, tag)
    logs(p, log)
  }
  const api = await repoApi.waitApi(repo)
  async function stop() {
    await api.call('Shutdown')
    if (p) {
      await waitExit(p)
    }
  }
  debug && process.once('exit', stop)
  return {
    api,
    p,
    repo,
    stop,
  }
}

function patchLotusMinerConfig(path) {
  console.warn('DISABLED patchLotusMinerConfig'); return

  const lines = readFileSync(path, 'utf8').split('\n')
  function patch(key, value) {
    const i = lines.findIndex(x => x.trim().startsWith(`#  ${key} =`))
    if (i === -1) throw `patch ${key}`
    lines.splice(i, 1, `  ${key} = ${value}`)
  }
  patch('ExpectedSealDuration', '"5m0s"')
  patch('PublishMsgPeriod', '"1s"')
  patch('AggregateCommits', 'false')
  patch('BatchPreCommits', 'false')
  writeFileSync(path, lines.join('\n'))
}

async function _runLotusMiner(node, minerRepo, tag, _api, args1, { debug1=false, debug2 }) {
  rm(minerRepo)
  mkdir(minerRepo)
  args1 = [
    '--repo', node.repo,
    '--miner-repo', minerRepo,
    'init',
    '--nosync',
    '--sector-size', sectorSize,
    ...args1,
  ]
  function spawn2(args) {
    const p = spawn(lotusMiner(LOTUS), args)
    killOnExit(p)
    logsStd(p, tag)
    logs(p, log)
    return p
  }
  const log = createWriteStream(join(minerRepo, 'log.log'), { flags: 'a' })
  let p1
  if (debug1) {
    todoDebug(tag, lotusMiner(LOTUS), args1)
    await new Promise(r => null)
  } else {
    p1 = spawn2(args1)
    const exit1 = await waitExit(p1)
    if (exit1) {
      throw new Error(`${tag} ${exit1}`)
    }
  }
  patchLotusMinerConfig(join(minerRepo, 'config.toml'))
  const args2 = [
    '--repo', node.repo,
    '--miner-repo', minerRepo,
    'run',
    '--nosync',
    '--miner-api', _api,
  ]
  let p2
  if (debug2) {
    todoDebug(tag, lotusMiner(LOTUS), args2)
  } else {
    p2 = spawn2(args2)
  }
  const api = await repoApi.waitApi(minerRepo)
  async function stop() {
    await api.call('Shutdown')
    if (p2) {
      await waitExit(p2)
    }
  }
  debug2 && process.once('exit', stop)
  const miner = await api.call('ActorAddress')
  const info = await node.api.call('StateMinerInfo', miner, [])
  return {
    api,
    miner,
    minerRepo,
    owner: info.Owner,
    peer: info.PeerId,
    p2,
    stop,
    worker: info.Worker,
  }
}

async function runLotusMinerPreseal(_dir, tag, i, node, _api, { debug1=false, debug2=false }={}) {
  await importPresealKey(node.api, _dir, i)
  const minerRepo = join(_dir, `miner-repo-${tag}`)
  const miner = genesisMiner(i)
  const _preseal = presealDir(_dir, miner)
  return await _runLotusMiner(node, minerRepo, tag, _api, [
    '--genesis-miner',
    '--actor', miner,
    '--pre-sealed-sectors', _preseal,
    '--pre-sealed-metadata', join(_preseal, presealJson(miner)),
  ], { debug1, debug2 })
}

async function createLotusMiner(_dir, tag, node, _api, { debug1=false, debug2=false }={}) {
  const owner = await node.api.call('WalletDefaultAddress')
  const minerRepo = join(_dir, `miner-repo-${tag}`)
  return await _runLotusMiner(node, minerRepo, tag, _api, [
    '--owner', owner,
    '--sector-size', sectorSize,
  ], { debug1, debug2 })
}

const _StorageDealStatus = 'StorageDealUnknown StorageDealProposalNotFound StorageDealProposalRejected StorageDealProposalAccepted StorageDealStaged StorageDealSealing StorageDealFinalizing StorageDealActive StorageDealExpired StorageDealSlashed StorageDealRejecting StorageDealFailing StorageDealFundsEnsured StorageDealCheckForAcceptance StorageDealValidating StorageDealAcceptWait StorageDealStartDataTransfer StorageDealTransferring StorageDealWaitingForData StorageDealVerifyData StorageDealEnsureProviderFunds StorageDealEnsureClientFunds StorageDealProviderFunding StorageDealClientFunding StorageDealPublish StorageDealPublishing StorageDealError StorageDealProviderTransferAwaitRestart StorageDealClientTransferRestart StorageDealAwaitingPreCommit'.split(' ')

const print = (...a) => console.log('\x1b[32m' + '- -', ...a, '\x1b[0m')
asyncMain(module, async () => {
  let port = 3010
  const _dir = 'tmp-deal'
  rm(_dir)
  await makeGenesis(_dir, [1])

  async function makeAccount(node, amount) {
    const owner = await node.api.call('WalletNew', 'bls')
    const smsg = await genesisNode.api.call('MpoolPushMessage', {
      Version: 0,
      To: owner,
      From: await genesisNode.api.call('WalletDefaultAddress'),
      Nonce: 0,
      Value: amount,
      GasLimit: 0, GasFeeCap: '0', GasPremium: '0',
      Method: 0, Params: '',
    }, null)
    await genesisNode.api.call('StateWaitMsg', smsg.CID, 1, 10, false)
    await node.api.call('StateWaitMsg', smsg.CID, 1, 10, false)
    return owner
  }

  const lotus1 = await runFuhon(_dir, 'fuhon1', port++, port++, { debug: 'DF1' in process.env })
  // const lotus1 = await runLotus(_dir, 'lotus1', port++, { debug: 'DL1' in process.env }); ++port
  const genesisNode = lotus1

  // const lotus2 = await runFuhon(_dir, 'fuhon2', port++, port++, { debug: 'DF2' in process.env })
  const lotus2 = await runLotus(_dir, 'lotus2', port++, { debug: 'DL2' in process.env }); ++port
  await lotus2.api.call('NetConnect', await lotus1.api.call('NetAddrsListen'))
  lotus2.api.chainNotify(ts => print(`HEIGHT ${ts.Blocks[0].Height} (${ts.Blocks.length})`))

  print('start genesis miner1')
  const miner1 = await runFuhonMinerPreseal(_dir, 'miner1', 0, lotus1, port++, { debug: 'DM1' in process.env })
  // const miner1 = await runLotusMinerPreseal(_dir, 'miner1', 0, lotus1, port++, { debug1: 'D1M1' in process.env, debug2: 'D2M1' in process.env })

  const F = 18, L = (c, n, s) => typeof s !== 'string' || typeof c !== 'string' ? L('' + c, n, '' + s) : s.length < n ? c.repeat(n - s.length) + s : s

  async function trackSector(m, i) {
    while (!(await m.api.call('SectorsList')).includes(i)) {
      await sleep(1000)
    }
    let _s, s
    while (true) {
      const r = await m.api.call('SectorsStatus', i, false)
      s = r.State
      if (s !== _s) {
        _s = s
        print(`SECTOR ${i}: ${s}`)
        if (s === 'Proving') return
        if (/fail/i.test(s)) return console.log(`\x1b[31mSECTOR: ${s}\x1b[0m`)
      }
      await sleep(1000)
    }
  }
  if ('TEST-MINING') {
    print('TEST-MINING')
    await new Promise(() => print('IDLE'))
  }
  if ('TEST-PLEDGE') {
    print('TEST-PLEDGE')
    await miner1.api.call('PledgeSector')
    await trackSector(miner1, 1)
    print('TEST-PLEDGE DONE')
    return
  }

  print('create miner2 owner')
  await makeAccount(lotus2, fromFil(100000))
  print('create miner2')
  // const miner2 = await createFuhonMiner(_dir, 'miner2', lotus2, port++)
  const miner2 = await createLotusMiner(_dir, 'miner2', lotus2, port++)

  throw new Error('TODO')
})

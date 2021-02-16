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
  const lines = readFileSync(path, 'utf8').split('\n')
  function patch(key, value) {
    const i = lines.findIndex(x => x.trim().startsWith(`#  ${key} =`))
    if (i === -1) throw `patch ${key}`
    lines.splice(i, 1, `  ${key} = ${JSON.stringify(value)}`)
  }
  patch('ExpectedSealDuration', '5m0s')
  patch('PublishMsgPeriod', '1s')
  writeFileSync(path, lines.join('\n'))
}

async function _runLotusMiner(node, minerRepo, tag, _api, args1, { debug2 }) {
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
  const p1 = spawn2(args1)
  const exit1 = await waitExit(p1)
  if (exit1) {
    throw new Error(`${tag} ${exit1}`)
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

async function runLotusMinerPreseal(_dir, tag, i, node, _api, { debug2=false }={}) {
  await importPresealKey(node.api, _dir, i)
  const minerRepo = join(_dir, `miner-repo-${tag}`)
  const miner = genesisMiner(i)
  const _preseal = presealDir(_dir, miner)
  return await _runLotusMiner(node, minerRepo, tag, _api, [
    '--genesis-miner',
    '--actor', miner,
    '--pre-sealed-sectors', _preseal,
    '--pre-sealed-metadata', join(_preseal, presealJson(miner)),
  ], { debug2 })
}

async function createLotusMiner(_dir, tag, node, _api, { debug2=false }={}) {
  const owner = await node.api.call('WalletDefaultAddress')
  const minerRepo = join(_dir, `miner-repo-${tag}`)
  return await _runLotusMiner(node, minerRepo, tag, _api, [
    '--owner', owner,
    '--sector-size', sectorSize,
  ], { debug2 })
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
      From: await genesisNode.api.call('WalletDefaultAddress'),
      To: owner,
      Value: amount,
    }, null)
    await genesisNode.api.call('StateWaitMsg', smsg.CID, 1)
    await node.api.call('StateWaitMsg', smsg.CID, 1)
    return owner
  }

  const lotus1 = await runLotus(_dir, 'lotus1', port++)
  const genesisNode = lotus1

  const lotus2 = await runLotus(_dir, 'lotus2', port++)
  await lotus2.api.call('NetConnect', await lotus1.api.call('NetAddrsListen'))
  lotus2.api.chainNotify(ts => print(`HEIGHT ${ts.Blocks[0].Height} (${ts.Blocks.length})`))

  print('start genesis miner1')
  const miner1 = await runLotusMinerPreseal(_dir, 'miner1', 0, lotus1, port++)

  print('create miner2 owner')
  await makeAccount(lotus2, fromFil(100))
  print('create miner2')
  const miner2 = await createLotusMiner(_dir, 'miner2', lotus2, port++)

  print('create client1')
  const client1 = await makeAccount(lotus2, fromFil(10))

  const storageDealDone = new Promise((resolve, reject) => lotus2.api.chan('ClientGetDealUpdates', deal => {
    const state = _StorageDealStatus[deal.State]
    print(`STORAGE DEAL ${state} ${deal.Message}`)
    if (state === 'StorageDealActive') {
      return resolve()
    }
    if (['StorageDealFailing'].includes(state)) {
      return reject(JSON.stringify(deal))
    }
  }))

  const _file = join(_dir, 'file.txt')
  writeFileSync(_file, 'a'.repeat(1931))
  const _car = `${_file}.car`
  await lotus2.api.call('ClientGenCar', { Path: _file }, _car)
  const _payload = (await lotus2.api.call('ClientImport', { Path: _file })).Root

  print('start storage deal')
  await lotus2.api.call('ClientStartDeal', {
    Data: { TransferType: 'graphsync', Root: _payload },
    Wallet: client1,
    Miner: miner2.miner,
    EpochPrice: '1000',
    MinBlocksDuration: 180 * 2880,
    DealStartEpoch: await lotus2.api.height() + 220,
  })

  await storageDealDone
  print('STORAGE DEAL DONE')

  const offers = await lotus2.api.call('ClientFindData', _payload, null), [offer] = offers
  const order = {
		Root:                    offer.Root,
		Piece:                   offer.Piece,
		Size:                    offer.Size,
		Total:                   offer.MinPrice,
		UnsealPrice:             offer.UnsealPrice,
		PaymentInterval:         offer.PaymentInterval,
		PaymentIntervalIncrease: offer.PaymentIntervalIncrease,
		Client:                  client1,
		Miner:                   offer.Miner,
		MinerPeer:               offer.MinerPeer,
  }
  print('start retrieval deal')
  await lotus2.api.call('ClientRetrieve', order, { Path: join(_dir, 'retrieved-file.txt') })
  print('RETRIEVAL DEAL DONE')
})

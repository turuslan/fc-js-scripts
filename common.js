#!/usr/bin/env node

const {
  existsSync,
  mkdirSync,
  readFileSync,
  rmdirSync,
  statSync,
  unlinkSync,
} = require('fs')
const { Api } = require('./api')
const {
  createConnection,
} = require('net')
const {
  join,
} = require('path')

function die(...args) {
  console.error(...args, new Error().stack.slice(5))
  process.exit(-1)
}

function existing(...paths) {
  for (const path of paths) {
    if (existsSync(path)) {
      return p
    }
  }
  throw new Error('not found')
}

function mkdir(...paths) {
  for (const path of paths) {
    mkdirSync(path, { recursive: true })
  }
}

function enoent(error) {
  if (error.code !== 'ENOENT') {
    throw error
  }
}

function rm(...paths) {
  for (const path of paths) {
    try {
      if (statSync(path).isDirectory()) {
        rmdirSync(path, { recursive: true })
      } else {
        unlinkSync(path)
      }
    } catch (error) {
      enoent(error)
    }
  }
}

const logs = (p, out, err) => {
  p.stdout.pipe(out, { end: false })
  p.stderr.pipe(err || out, { end: false })
}
function logsStd(p, tag) {
  if (!tag) {
    return logs(p, process.stdout, process.stderr)
  }
  const pipe = (from, to) => {
    let queue = ''
    function write(line) {
      to.write(`[${tag}] ${line}`)
    }
    from.on('end', () => write(queue + '\n'))
    from.on('data', data => {
      queue += data
      while (true) {
        i = queue.indexOf('\n')
        if (i === -1) {
          break
        }
        ++i
        write(queue.slice(0, i))
        queue = queue.slice(i)
      }
    })
  }
  pipe(p.stdout, process.stdin)
  pipe(p.stderr, process.stderr)
}
const waitExit = p => new Promise(r => p.once('exit', (c, s) => r(c === null ? s : c)))
const killOnExit = p => process.once('exit', () => p.kill('SIGKILL'))
const asyncMain = (module, main) => module === require.main && main().catch(console.error).then(() => process.exit())
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

async function logIfError(p, tag=null, expected=0) {
  let output = ''
  p.stdout.on('data', data => output += data)
  p.stderr.on('data', data => output += data)
  const exit = await waitExit(p)
  if (exit !== expected) {
    if (tag === null) tag = `${p.spawnfile} ${p.spawnargs.join(' ')}`
    const lines = output.split('\n').filter(a => a)
    console.error(`ERROR: ${exit}: ${tag}\n${lines.map(line => `| ${line}`).join('\n')}\n`)
    return false
  }
  return true
}

function repoApi(repo) {
  try {
    const match = readFileSync(join(repo, 'api'), 'utf8').match(/\/ip4\/([^/]+)\/tcp\/([^/]+)(\/http|$)/)
    const token = readFileSync(join(repo, 'token'), 'utf8')
    const headers = { Authorization: `Bearer ${token}` }
    const host = match[1]
    const port = +match[2]
    const url = `ws://${host}:${port}/rpc/v0`
    return {
      headers,
      host,
      port,
      token,
      url,
      async api() {
        const WebSocket = require('ws')
        const ws = new WebSocket(url, { headers })
        await new Promise(resolve => ws.onopen = resolve)
        return new Api(ws)
      },
      tcp: () => new Promise(resolve => {
        const socket = createConnection(port, host, () => {
          socket.destroy()
          resolve(true)
        })
        socket.once('error', () => resolve(false))
      }),
    }
  } catch (error) {
    return null
  }
}
repoApi.wait = async repo => {
  let api
  while (!(api = repoApi(repo)) || !await api.tcp()) {
    await sleep(100)
  }
  return api
}
repoApi.waitApi = async repo => await (await repoApi.wait(repo)).api()

function opts(argv=null) {
  if (argv === null) {
    argv = process.argv.slice(2)
  }
  function arg(name) {
    if (!argv.length || argv[0].startsWith('--')) {
      die(`missing arg ${name}`)
    }
    return argv.shift()
  }
  function opt(name, required=true) {
    const i = argv.indexOf(name)
    if (argv.length && i === argv.length - 1) {
      die(`incomplete arg ${name}`)
    }
    if (i !== -1) {
      const arg1 = argv.splice(i, 2)
      const arg2 = opt(name, false)
      return arg2.length ? arg2 : arg1
    }
    if (required) {
      die(`missing arg ${name}`)
    }
    return []
  }
  function flag(name) {
    const i = argv.indexOf(name)
    if (i !== -1) {
      const arg = argv.splice(i, 1)
      flag(name)
      return arg
    }
    return []
  }
  return {
    arg,
    argv,
    flag,
    opt,
  }
}

const _0_18 = '0'.repeat(18)
const fromFil = fil => `${fil}${_0_18}`

const { HOME } = process.env
const GOPATH = process.env.GOPATH || join(HOME, 'go')
const LOTUS = process.env.LOTUS || join(GOPATH, 'src/github.com/filecoin-project/lotus/lotus')
const lotusMiner = lotus => `${lotus}-miner`

module.exports = {
  asyncMain,
  die,
  existing,
  fromFil,
  GOPATH,
  HOME,
  killOnExit,
  logIfError,
  logs,
  logsStd,
  LOTUS,
  lotusMiner,
  mkdir,
  opts,
  repoApi,
  rm,
  sleep,
  waitExit,
}

process.once('SIGTERM', () => process.exit())
process.once('SIGINT', () => {
  console.log()
  process.exit()
})

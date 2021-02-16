
class Api {
  constructor(ws) {
    this._ws = ws
    this._id = 0
    this._calls = {}
    this._chans = {}
    this._chain = null
    ws.onmessage = ({ data }) => {
      const { id, error, result, method, params } = JSON.parse(data)
      if (method === 'xrpc.ch.close') {
        delete this._chans[params[0]]
      } else if (method === 'xrpc.ch.val') {
        const cb = this._chans[params[0]]
        cb && cb(params[1])
      } else {
        this._calls[id](error && new Error(`[${error.code}] ${error.message}`), result)
        delete this._calls[id]
      }
    }
  }
  call(method, ...params) {
    const id = this._id++
    method = `Filecoin.${method}`
    if (this._ws.readyState !== this._ws.OPEN) {
      return Promise.reject('WebSocket not writable')
    }
    this._ws.send(JSON.stringify({ jsonrpc: '2.0', method, id, params }))
    return new Promise((resolve, reject) => this._calls[id] = (error, result) => error ? reject(error) : resolve(result))
  }
  async chan(method, cb, ...params) {
    const id = await this.call(method, ...params)
    this._chans[id] = cb
  }
  async chainNotify(cb) {
    if (!this._chain) {
      this._chain = []
      await this.chan('ChainNotify', changes => {
        for (const change of changes) {
          if (change.Type === 'revert') continue
          const remove = []
          for (const cb of this._chain) {
            if (cb(change.Val) === false) {
              remove.push(cb)
            }
          }
          for (const cb of remove) {
            const i = this._chain.indexOf(cb)
            if (i !== -1) this._chain.splice(i, 1)
          }
        }
      })
    }
    this._chain.push(cb)
  }
  waitHeight(height) {
    return new Promise(resolve => this.chainNotify(ts => {
      if (ts.Height >= height) {
        resolve()
        return false
      }
    }))
  }
  async height() {
    return (await this.call('ChainHead')).Height
  }
}

function apiReconnect(path, onClose, cb) {
  apiConnect(path, () => {
    setTimeout(() => apiReconnect(path, onClose, cb), 2000)
    onClose && onClose()
  }).then(cb)
}

async function apiConnect(path, onClose) {
  const ws = new WebSocket(`ws://${location.hostname}:${location.port}/${path}`)
  const open = await new Promise(resolve => {
    ws.onopen = () => resolve(true)
    ws.onerror = () => resolve(false)
  })
  if (!open) {
    return null
  }
  ws.onclose = onClose
  return new Api(ws)
}

function onTsSlow(cb) {
  let latest, current
  async function onTs(ts) {
    latest = ts
    if (!current) {
      current = ts
      await cb(ts)
      current = null
      if (latest !== ts) {
        onTs(latest)
      }
    }
  }
  return onTs
}

const Out = id => {
  const pre = document.getElementById(id)
  let text = ''
  function out(...a) {
    text += a.join(' ') + '\n'
    return out
  }
  out.flush = () => {
    pre.textContent = text
    return out
  }
  out.clear = () => {
    text = ''
    return out
  }
  return out
}

if (typeof module !== 'undefined') {
  module.exports = { Api }
}

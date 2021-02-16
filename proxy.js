#!/usr/bin/env node

const { createServer, request } = require('http')
const { join } = require('path')
const { repoApi } = require('./common')
const { createHash } = require('crypto')
const { existsSync, readFileSync, statSync } = require('fs')

function doProxy(req1, res1, key) {
  function emptySession() {
    res1.writeHead(101, 'Switching Protocols', {
      'Upgrade': 'websocket',
      'Connection': 'Upgrade',
      'Sec-WebSocket-Accept': createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest().toString('base64'),
    })
    res1.flushHeaders()
    res1.socket.end()
  }
  const api = repoApi(join(__dirname, req1.url))
  if (!api) {
    return emptySession()
  }
  function onRes(res2) {
    if (res2.statusCode === 200) {
      return emptySession()
    }
    res1.writeHead(res2.statusCode, res2.statusMessage, res2.headers)
    res1.flushHeaders()
    res2.socket.pipe(res1.socket)
  }
  const req2 = request({
    method: req1.method,
    hostname: api.host,
    port: api.port,
    path: '/rpc/v0',
    headers: {
      ...req1.headers,
      ...api.headers,
    },
  }, onRes)
  req2.once('upgrade', onRes)
  req2.once('error', emptySession)
  req2.once('socket', () => {
    req2.flushHeaders()
    req1.socket.pipe(req2.socket)
  })
}

function proxy(req, res) {
  const key = req.headers['sec-websocket-key']
  if (key) {
    doProxy(req, res, key)
    return true
  }
  return false
}

if (module === require.main) {
  process.stdin.once('data', () => process.exit())
  createServer((req, res) => {
    if (proxy(req, res)) {
      return
    }
    if (req.url === '/q') {
      console.log(req.headers)
      console.log(req.headers.connection)
      process.exit(-1)
    }
    const _file = join(__dirname, req.url)
    if (existsSync(_file) && statSync(_file).isFile()) {
      res.setHeader('Content-Type', _file.endsWith('.html') ? 'text/html' : _file.endsWith('.js') ? 'application/javascript' : 'text/plain')
      return res.end(readFileSync(_file))
    }
    res.statusCode = 404
    res.end('404')
  }).listen(process.env.PORT || 3000)
}

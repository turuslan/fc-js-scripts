#!/usr/bin/env node

const {
  asyncMain,
  opts,
  repoApi,
  sleep,
} = require('./common.js')

asyncMain(module, async () => {
  const { arg } = opts()
  const repo = arg('repo')
  while (true) {
    console.log('connecting')
    const api = await repoApi.waitApi(repo)
    await api.chainNotify(ts => console.log(`height ${ts.Height}: ${ts.Blocks.map(b => b.Miner).join(' ')}`))
    while (true) {
      await sleep(1000)
      try {
        await api.call('Version')
      } catch (e) {
        console.log()
        break
      }
    }
  }
})

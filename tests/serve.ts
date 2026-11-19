import { existsSync, mkdtempSync, readFileSync, rmdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseEnv } from 'node:util'
import { loadAllTestAccounts, pickTestAccounts } from 'deepspace/testing'
import { createServer } from 'vite'

const port = Number(process.argv[2] ?? 5173)
const stage = mkdtempSync(join(tmpdir(), 'access-review-playwright-'))
const configPath = join(stage, 'wrangler.toml')
function cleanStage() {
  rmSync(configPath, { force: true })
  rmSync(join(stage, '.dev.vars'), { force: true })
  rmdirSync(stage)
}

try {
  const appPath = (path: string) => JSON.stringify(resolve(path).replaceAll('\\', '/'))
  const config = readFileSync('wrangler.toml', 'utf8')
    .replace(/^main = "worker\.ts"/m, `main = ${appPath('worker.ts')}`)
    .replace(/^directory = "dist"/m, `directory = ${appPath('dist')}`)
  writeFileSync(configPath, config)
  const dev = existsSync('.dev.vars') ? parseEnv(readFileSync('.dev.vars', 'utf8')) : {}
  // The isolated Worker only needs public auth connection settings. Its owner
  // is the same first local test account returned by users(2).
  const publicBindings = ['AUTH_WORKER_URL', 'AUTH_JWT_ISSUER', 'AUTH_JWT_PUBLIC_KEY', 'API_WORKER_URL', 'PLATFORM_WORKER_URL']
  const variables = publicBindings.flatMap(name => dev[name] ? [`${name}='${dev[name]}'`] : [])
  const owner = loadAllTestAccounts().length ? pickTestAccounts(1)[0].userId : undefined
  if (owner) variables.push(`OWNER_USER_ID='${owner}'`)
  writeFileSync(join(stage, '.dev.vars'), variables.join('\n'))
  process.env.ACCESS_REVIEW_PLAYWRIGHT_CONFIG = configPath
  const server = await createServer({ mode: 'test', server: { host: '127.0.0.1', port, strictPort: true } })
  await server.listen()
  server.printUrls()
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, async () => {
      await server.close()
      cleanStage()
      process.exit(0)
    })
  }
} catch (error) {
  cleanStage()
  throw error
}

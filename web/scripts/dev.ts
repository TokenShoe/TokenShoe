/**
 * `bun run dev`: start Next.js (Turbopack) and pre-compile the main pages in the background,
 * so the first time you open the site in a browser it loads instantly instead of compiling on demand.
 *
 *   PORT=3001 bun run dev     # other port
 *   bun run dev:webpack       # fallback to the classic webpack dev server
 */
export {}

const port = process.env.PORT ?? '3000'
const base = `http://localhost:${port}`
const PAGES = ['/', '/create', '/claim', '/projects', '/explore', '/test-token', '/api/stats']

const child = Bun.spawn(['./node_modules/.bin/next', 'dev', '--turbo', '-p', port], {
  stdout: 'pipe',
  stderr: 'inherit',
  stdin: 'inherit',
  env: process.env,
})

// Forward Ctrl+C / termination to Next
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    child.kill(sig)
    process.exit(0)
  })
}

let warmed = false
async function warmUp() {
  const started = Date.now()
  console.log(`\n  ⏳ Pre-compiling pages so the first visit is fast…`)
  for (const path of PAGES) {
    try {
      await fetch(base + path)
    } catch {
      // Server not answering yet or route failed; the page will just compile on first visit
    }
  }
  console.log(`  ✅ Ready to use: ${base}  (pre-compiled ${PAGES.length} routes in ${((Date.now() - started) / 1000).toFixed(1)}s)\n`)
}

// Pass Next's output through, and start warming up once it reports ready
const decoder = new TextDecoder()
const reader = child.stdout.getReader()
for (;;) {
  const { value, done } = await reader.read()
  if (done) break
  const text = decoder.decode(value)
  process.stdout.write(text)
  if (!warmed && /Ready in/.test(text)) {
    warmed = true
    void warmUp()
  }
}
process.exit(await child.exited)

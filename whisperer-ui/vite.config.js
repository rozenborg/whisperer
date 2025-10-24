import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { cwd, env as nodeEnv } from 'node:process'

function anthropicProxyPlugin(env) {
  return {
    name: 'anthropic-proxy',
    configureServer(server) {
      server.middlewares.use(createAnthropicMiddleware(env))
    },
    configurePreviewServer(server) {
      server.middlewares.use(createAnthropicMiddleware(env))
    },
  }
}

function createAnthropicMiddleware(env = {}) {
  return async (req, res, next) => {
    if (!req.url?.startsWith('/api/anthropic/messages')) {
      next()
      return
    }

    if (req.method !== 'POST') {
      res.statusCode = 405
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ error: 'Method not allowed' }))
      return
    }

    const apiKey =
      env.ANTHROPIC_API_KEY ||
      env.VITE_ANTHROPIC_KEY ||
      nodeEnv.ANTHROPIC_API_KEY ||
      nodeEnv.VITE_ANTHROPIC_KEY ||
      ''

    if (!apiKey) {
      res.statusCode = 500
      res.setHeader('Content-Type', 'application/json')
      res.end(
        JSON.stringify({
          error: 'Missing ANTHROPIC_API_KEY. Set it in your environment before starting the dev server.',
        }),
      )
      return
    }

    try {
      const rawBody = await readBody(req)
      const upstream = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: rawBody,
      })

      const text = await upstream.text()
      res.statusCode = upstream.status
      res.setHeader('Content-Type', 'application/json')
      res.end(text)
    } catch (error) {
      console.error('[anthropic-proxy]', error)
      res.statusCode = 500
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ error: 'Anthropic proxy error', message: error.message }))
    }
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (chunk) => {
      data += chunk
    })
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, cwd(), '')

  return {
    plugins: [react(), anthropicProxyPlugin(env)],
  }
})

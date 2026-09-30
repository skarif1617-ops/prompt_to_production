import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { once } from 'node:events'
import process from 'node:process'
import { app } from '../server/app.js'
import tools from '../src/data/tools.json' with { type: 'json' }

const toolIds = new Set(tools.map((tool) => tool.id))

let server
let baseUrl
let originalApiKey

before(async () => {
  originalApiKey = process.env.GEMINI_API_KEY
  delete process.env.GEMINI_API_KEY
  server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  baseUrl = `http://127.0.0.1:${server.address().port}`
})

after(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  if (originalApiKey === undefined) delete process.env.GEMINI_API_KEY
  else process.env.GEMINI_API_KEY = originalApiKey
})

async function post(path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: response.status, body: await response.json() }
}

test('tool catalog is complete and structurally valid', () => {
  assert.ok(tools.length >= 60)
  const ids = new Set()
  for (const tool of tools) {
    assert.ok(tool.id && !ids.has(tool.id), `duplicate or missing id: ${tool.id}`)
    ids.add(tool.id)
    assert.ok(tool.name && tool.category && tool.bestFor && tool.samplePrompt)
    assert.ok(['Free', 'Freemium', 'Paid'].includes(tool.pricing))
    assert.ok(tool.stages.length > 0)
    assert.equal(tool.howToUse.length, 3)
    assert.ok(tool.tags.length > 0)
    assert.ok(tool.learnGuide)
    assert.equal(new URL(tool.url).protocol, 'https:')
  }
  for (const name of ['ChatGPT', 'Gemini', 'Claude', 'Groq', 'Kimi', 'Xiaomi MiMo', 'Hugging Face', 'DeepSeek', 'Mistral']) {
    assert.ok(tools.some((tool) => tool.name === name || tool.name.startsWith(`${name} `)), `${name} is missing`)
  }
})

test('recommendation fallback returns only valid catalog IDs', async () => {
  const { status, body } = await post('/api/recommend', { query: 'Make a science class presentation, stage UG' })
  assert.equal(status, 200)
  assert.deepEqual(Object.keys(body).sort(), ['alternatives', 'fallback', 'noMatch', 'reason', 'topPick'])
  assert.equal(body.noMatch, false)
  assert.equal(body.fallback, true)
  assert.ok(toolIds.has(body.topPick))
  assert.ok(body.alternatives.every((id) => toolIds.has(id) && id !== body.topPick))
  assert.equal(typeof body.reason, 'string')
})

test('unmatched fallback reports that no catalog tool is a close match', async () => {
  const { status, body } = await post('/api/recommend', { query: 'quasar nebula spectroscopy' })
  assert.equal(status, 200)
  assert.equal(body.noMatch, true)
})

test('student task aliases match presentation, calculus, and interview concepts', async () => {
  for (const query of ['Make a PPT', 'Explain calculus', 'Prepare for interviews']) {
    const { status, body } = await post('/api/recommend', { query: `${query}. Student stage: UG.` })
    assert.equal(status, 200)
    assert.equal(body.noMatch, false, `${query} should match a catalog concept`)
    assert.ok(toolIds.has(body.topPick))
  }
})

test('unknown AI tools receive a complete fallback guide', async () => {
  const { status, body } = await post('/api/guide', { name: 'Example Study Agent' })
  assert.equal(status, 200)
  assert.equal(body.generated, true)
  assert.equal(body.fallback, true)
  for (const key of ['what', 'who', 'freeTierNotes']) assert.equal(typeof body.guide[key], 'string')
  for (const [key, minimum] of [['setup', 3], ['firstResult', 5], ['prompts', 5], ['tips', 1], ['mistakes', 1], ['alternatives', 0]]) {
    assert.ok(Array.isArray(body.guide[key]), `${key} must be a list`)
    assert.ok(body.guide[key].length >= minimum, `${key} needs at least ${minimum} entries`)
  }
})

test('every known tool has a local guide seed for offline use', () => {
  for (const tool of tools) {
    assert.equal(typeof tool.learnGuide.what, 'string')
    assert.equal(typeof tool.learnGuide.who, 'string')
    assert.equal(typeof tool.learnGuide.freeTierNotes, 'string')
    assert.ok(Array.isArray(tool.learnGuide.setup))
    assert.ok(Array.isArray(tool.learnGuide.alternatives))
  }
})

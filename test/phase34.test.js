import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { after, before, test } from 'node:test'
import { once } from 'node:events'
import process from 'node:process'
import { app } from '../server/app.js'
import interviewData from '../src/data/interviews.json' with { type: 'json' }

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

test('interview roadmaps cover the required stages and domains', () => {
  assert.ok(interviewData.domains.length >= 8)
  const expectedStages = ['basics', 'core-skills', 'projects', 'practice-problems', 'mock-interviews', 'applying']
  for (const domain of interviewData.domains) {
    assert.ok(domain.stages.length >= expectedStages.length)
    assert.deepEqual(domain.stages.map((stage) => stage.id), expectedStages)
    assert.ok(domain.channels.length > 0)
    assert.ok(domain.resources.length > 0)
    for (const resource of [...domain.channels, ...domain.resources]) assert.equal(new URL(resource.url).protocol, 'https:')
  }
  assert.ok(interviewData.companies.length >= 8)
  for (const company of interviewData.companies) assert.equal(new URL(company.practiceUrl).protocol, 'https:')
})

test('company practice falls back to an original company-tagged exercise', async () => {
  const { status, body } = await post('/api/company-practice', { company: 'TCS', companyId: 'tcs', domain: 'Aptitude & HR', topics: ['Reasoning'] })
  assert.equal(status, 200)
  assert.equal(body.fallback, true)
  assert.ok(body.problem.companies.includes('tcs'))
  assert.ok(body.problem.hints.length >= 3)
  assert.ok(body.problem.solution)
  assert.ok(body.problem.complexity)
})

test('thinking evaluator returns six bounded scores and a three-step plan', async () => {
  const { status, body } = await post('/api/evaluate', {
    problem: 'Find a repeated event ID.',
    approach: 'I would scan once and track the IDs in a set. I will test empty input and duplicates.',
    answer: 'For each ID, check the set before adding it. Return a duplicate or null. This is O(n) time and O(n) space.',
  })
  assert.equal(status, 200)
  assert.equal(body.fallback, true)
  assert.deepEqual(Object.keys(body.scores).sort(), ['approachQuality', 'clarity', 'codeCorrectness', 'complexity', 'edgeCases', 'problemUnderstanding'].sort())
  for (const score of Object.values(body.scores)) assert.ok(Number.isInteger(score) && score >= 1 && score <= 10)
  assert.ok(body.strengths.length > 0)
  assert.ok(body.gaps.length > 0)
  assert.ok(body.jobLevelThinking.length > 0)
  assert.equal(body.improvementPlan.length, 3)
  assert.ok(body.followUp)
})

test('communication coach fallback returns the complete feedback contract', async () => {
  const { status, body } = await post('/api/coach', { scenario: 'Behavioral (STAR method)', transcript: 'The situation was a missed deadline. I organized tasks, communicated early, and we delivered the revised work on time.' })
  assert.equal(status, 200)
  assert.equal(body.fallback, true)
  assert.ok(Number.isInteger(body.score) && body.score >= 1 && body.score <= 10)
  for (const field of ['structure', 'clarity', 'fillerWords', 'length', 'confidence', 'vocabulary', 'grammar']) assert.equal(typeof body.feedback[field], 'string')
  assert.ok(body.improvedSample)
  assert.ok(body.exercise)
  const lowercaseAnswer = await post('/api/coach', { scenario: 'Tell me about yourself', transcript: 'my name is Arif. i am from Nellore.' })
  assert.match(lowercaseAnswer.body.feedback.grammar, /Capitalize the first word/)
})

test('communication coach rejects an empty transcript', async () => {
  const { status, body } = await post('/api/coach', { scenario: 'Tell me about yourself', transcript: '  ' })
  assert.equal(status, 400)
  assert.equal(typeof body.error, 'string')
})

test('audio transcription validates content type and reports an unconfigured server', async () => {
  const unsupported = await fetch(`${baseUrl}/api/transcribe`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'not audio' })
  assert.equal(unsupported.status, 415)
  const unconfigured = await fetch(`${baseUrl}/api/transcribe`, { method: 'POST', headers: { 'Content-Type': 'audio/webm' }, body: Buffer.from('audio') })
  assert.equal(unconfigured.status, 200)
  const fallback = await unconfigured.json()
  assert.equal(fallback.fallback, true)
  assert.equal(typeof fallback.error, 'string')
})

import express from 'express'
import { Buffer } from 'node:buffer'
import { rateLimit } from 'express-rate-limit'
import { GoogleGenAI } from '@google/genai'
import process from 'node:process'
import tools from '../src/data/tools.json' with { type: 'json' }
import interviewData from '../src/data/interviews.json' with { type: 'json' }
import { coachFallback, evaluateFallback, guideFallback, recommendFallback } from '../src/lib/fallbacks.js'

export const app = express()
app.set('trust proxy', 1)
app.use(express.json({ limit: '1mb' }))
app.use('/api', rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Practice limit reached. Please try again in a few minutes.' },
}))

const toolIds = new Set(tools.map((tool) => tool.id))
let aiClient
function getClient() {
  if (!process.env.GEMINI_API_KEY) return null
  aiClient ||= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
  return aiClient
}

async function generateJson(prompt) {
  const client = getClient()
  if (!client) throw new Error('Gemini is not configured')
  const result = await client.models.generateContent({
    model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    contents: prompt,
    config: { responseMimeType: 'application/json', abortSignal: AbortSignal.timeout(25000) },
  })
  const content = result.text
  if (!content) throw new Error('Gemini returned no content')
  return JSON.parse(content)
}

function normalizeRecommendation(value) {
  if (!value || !toolIds.has(value.topPick) || !Array.isArray(value.alternatives) || typeof value.reason !== 'string') return null
  return {
    topPick: value.topPick,
    alternatives: [...new Set(value.alternatives.filter((id) => toolIds.has(id) && id !== value.topPick))].slice(0, 3),
    reason: value.reason.slice(0, 700),
    noMatch: false,
  }
}

const scoreFields = ['problemUnderstanding', 'approachQuality', 'edgeCases', 'codeCorrectness', 'complexity', 'clarity']
function normalizeEvaluation(value) {
  if (!value?.scores || !scoreFields.every((key) => Number.isFinite(value.scores[key]))) return null
  const bounded = Object.fromEntries(scoreFields.map((key) => [key, Math.max(1, Math.min(10, Math.round(value.scores[key])))]))
  const list = (input) => Array.isArray(input) ? input.filter((item) => typeof item === 'string').slice(0, 5) : []
  if (!list(value.strengths).length || !list(value.gaps).length || !list(value.improvementPlan).length) return null
  return {
    scores: bounded,
    strengths: list(value.strengths),
    gaps: list(value.gaps),
    jobLevelThinking: list(value.jobLevelThinking),
    improvementPlan: list(value.improvementPlan),
    followUp: typeof value.followUp === 'string' ? value.followUp.slice(0, 600) : '',
  }
}

function normalizeCoach(value) {
  if (!Number.isFinite(value?.score) || !value.feedback || typeof value.improvedSample !== 'string' || typeof value.exercise !== 'string') return null
  const feedbackFields = ['structure', 'clarity', 'fillerWords', 'length', 'confidence', 'vocabulary', 'grammar']
  if (!feedbackFields.every((key) => typeof value.feedback[key] === 'string')) return null
  return { score: Math.max(1, Math.min(10, Math.round(value.score))), feedback: Object.fromEntries(feedbackFields.map((key) => [key, value.feedback[key].slice(0, 500)])), improvedSample: value.improvedSample.slice(0, 1400), exercise: value.exercise.slice(0, 500) }
}

function normalizeGuide(value) {
  const arrays = ['setup', 'firstResult', 'prompts', 'tips', 'mistakes', 'alternatives']
  if (!value || !['what', 'who', 'freeTierNotes'].every((key) => typeof value[key] === 'string') || !arrays.every((key) => Array.isArray(value[key]))) return null
  const limited = Object.fromEntries(arrays.map((key) => [key, value[key].filter((item) => typeof item === 'string').slice(0, key === 'prompts' ? 5 : 8)]))
  if (limited.prompts.length < 5 || limited.setup.length < 3 || limited.firstResult.length < 5) return null
  return { what: value.what.slice(0, 700), who: value.who.slice(0, 500), ...limited, freeTierNotes: value.freeTierNotes.slice(0, 500) }
}

app.post('/api/recommend', async (req, res) => {
  const query = typeof req.body?.query === 'string' ? req.body.query.slice(0, 500) : ''
  const catalog = tools.map(({ id, name, category, pricing, bestFor, tags }) => ({ id, name, category, pricing, bestFor, tags }))
  try {
    const candidate = await generateJson(`Recommend tools for a student's task. Return ONLY JSON: {"topPick":"existing id","alternatives":["existing id"],"reason":"one concise reason"}. Select IDs only from this catalog. Consider the user's stage and free options.\nTask: ${query}\nCatalog: ${JSON.stringify(catalog)}`)
    const valid = normalizeRecommendation(candidate)
    if (valid) return res.json({ ...valid, fallback: false })
  } catch (error) {
    console.warn('Recommendation fallback:', error.message)
  }
  return res.json({ ...recommendFallback(query), fallback: true })
})

app.post('/api/guide', async (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.slice(0, 100) : ''
  if (!name) return res.status(400).json({ error: 'A tool name is required.' })
  try {
    const candidate = await generateJson(`Create a safe, practical student guide for the AI tool or agent named ${JSON.stringify(name)}. Never claim exact pricing unless certain; say to check official docs. Return JSON only with string fields what, who, freeTierNotes; arrays setup (3 steps), firstResult (5 steps), prompts (5), tips, mistakes, alternatives.`)
    const valid = normalizeGuide(candidate)
    if (valid) return res.json({ guide: valid, generated: true })
  } catch (error) {
    console.warn('Guide fallback:', error.message)
  }
  return res.json({ guide: guideFallback(name), generated: true, fallback: true })
})

app.post('/api/evaluate', async (req, res) => {
  const { problem = '', approach = '', answer = '' } = req.body || {}
  const input = { problem: String(problem).slice(0, 5000), approach: String(approach).slice(0, 5000), answer: String(answer).slice(0, 12000) }
  try {
    const candidate = await generateJson(`Review how a student thinks, not just whether their answer is right. Evaluate their approach and answer for this problem. Return JSON only with scores (problemUnderstanding, approachQuality, edgeCases, codeCorrectness, complexity, clarity), each 1-10; arrays strengths, gaps, jobLevelThinking, improvementPlan (3 actions); and strings followUp. Be kind, specific, and honest. Problem: ${input.problem}\nApproach: ${input.approach}\nAnswer: ${input.answer}`)
    const valid = normalizeEvaluation(candidate)
    if (valid) return res.json(valid)
  } catch (error) {
    console.warn('Evaluation fallback:', error.message)
  }
  return res.json({ ...evaluateFallback(input), fallback: true })
})

app.post('/api/company-practice', async (req, res) => {
  const company = typeof req.body?.company === 'string' ? req.body.company.slice(0, 80) : 'a target company'
  const domain = typeof req.body?.domain === 'string' ? req.body.domain.slice(0, 100) : 'software development'
  const topics = Array.isArray(req.body?.topics) ? req.body.topics.filter((item) => typeof item === 'string').slice(0, 10) : []
  try {
    const candidate = await generateJson(`Write ONE original interview practice problem for a student preparing for ${company} in ${domain}. Use common interview skill areas, but do not copy or closely imitate a question from LeetCode or any website. Return JSON only: {"title":"short title","difficulty":"Easy|Medium|Hard|Practice","prompt":"fully specified original exercise","hints":["3 progressive hints"],"solution":"optimal solution explanation","complexity":"time and space complexity or N/A for non-coding"}. Focus areas: ${topics.join(', ')}`)
    if (typeof candidate?.title === 'string' && typeof candidate.prompt === 'string' && Array.isArray(candidate.hints) && candidate.hints.length >= 3 && candidate.hints.every((hint) => typeof hint === 'string') && typeof candidate.solution === 'string' && typeof candidate.complexity === 'string') {
      return res.json({ problem: { title: candidate.title.slice(0, 100), difficulty: ['Easy', 'Medium', 'Hard', 'Practice'].includes(candidate.difficulty) ? candidate.difficulty : 'Practice', prompt: candidate.prompt.slice(0, 1600), hints: candidate.hints.slice(0, 4).map((hint) => hint.slice(0, 350)), solution: candidate.solution.slice(0, 1600), complexity: candidate.complexity.slice(0, 250) } })
    }
  } catch (error) {
    console.warn('Company practice fallback:', error.message)
  }
  const companyId = typeof req.body?.companyId === 'string' ? req.body.companyId : ''
  const problem = interviewData.problems.find((item) => item.companies.includes(companyId)) || interviewData.problems.find((item) => item.domain === 'software-development')
  return res.json({ problem, fallback: true })
})

app.post('/api/coach', async (req, res) => {
  const scenario = typeof req.body?.scenario === 'string' ? req.body.scenario.slice(0, 120) : 'Tell me about yourself'
  const transcript = typeof req.body?.transcript === 'string' ? req.body.transcript.slice(0, 7000) : ''
  if (!transcript.trim()) return res.status(400).json({ error: 'Add an answer before requesting feedback.' })
  try {
    const candidate = await generateJson(`Review this student's interview answer in scenario ${JSON.stringify(scenario)}. Return JSON only with integer score 1-10, feedback strings structure, clarity, fillerWords, length, confidence, vocabulary, grammar; improvedSample (must be a fill-in template, never invent student credentials); and one exercise. Be actionable and supportive. In grammar feedback, check sentence-start capitalization and punctuation, but do not mistake unfamiliar names or places for spelling errors. Transcript: ${transcript}`)
    const valid = normalizeCoach(candidate)
    if (valid) return res.json(valid)
  } catch (error) {
    console.warn('Coach fallback:', error.message)
  }
  return res.json({ ...coachFallback({ scenario, transcript }), fallback: true })
})

app.post('/api/transcribe', express.raw({ type: '*/*', limit: '6mb' }), async (req, res) => {
  const mimeType = String(req.headers['content-type'] || '').split(';', 1)[0].trim().toLowerCase()
  const supportedTypes = new Set(['audio/webm', 'audio/ogg', 'audio/wav', 'audio/mp4', 'audio/mpeg', 'audio/aac', 'audio/flac'])
  if (!supportedTypes.has(mimeType)) return res.status(415).json({ error: 'This audio format is not supported. Try Chrome or Edge, or type your answer.' })
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) return res.status(400).json({ error: 'No audio was received. Check your microphone and try again.' })
  const client = getClient()
  if (!client) return res.json({ transcript: '', fallback: true, error: 'Server transcription is not configured. Type your answer instead.' })
  try {
    const result = await client.models.generateContent({
      model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
      contents: [{
        role: 'user',
        parts: [
          { text: 'Transcribe the spoken words in this audio faithfully. Return only the transcript, with no commentary.' },
          { inlineData: { mimeType, data: req.body.toString('base64') } },
        ],
      }],
      config: { abortSignal: AbortSignal.timeout(40000) },
    })
    const transcript = typeof result.text === 'string' ? result.text.trim().slice(0, 7000) : ''
    if (!transcript) return res.status(502).json({ error: 'The audio could not be transcribed. Please type your answer.' })
    return res.json({ transcript })
  } catch (error) {
    console.warn('Audio transcription failed:', error.message)
    return res.json({ transcript: '', fallback: true, error: 'Audio transcription is temporarily unavailable. Please type your answer.' })
  }
})

app.get('/api/health', (_req, res) => res.json({ ok: true, geminiConfigured: Boolean(process.env.GEMINI_API_KEY) }))

app.use((error, _req, res, _next) => {
  void _next
  console.error('API error:', error.message)
  res.status(400).json({ error: 'The request could not be processed. Check the input and try again.' })
})

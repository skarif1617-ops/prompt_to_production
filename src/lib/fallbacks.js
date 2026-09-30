import tools from '../data/tools.json' with { type: 'json' }

const text = (value) => String(value || '').toLowerCase()

export function recommendFallback(query, catalog = tools) {
  const ignoredTerms = new Set(['a', 'an', 'and', 'build', 'explain', 'for', 'from', 'help', 'i', 'make', 'me', 'my', 'need', 'or', 'pg', 'prepare', 'stage', 'student', 'the', 'to', 'ug', 'want', 'with'])
  const synonyms = { calculus: ['math', 'study'], explain: ['concept'], interviews: ['interview', 'career'], learning: ['study'], ppt: ['presentation', 'slides'], studying: ['study'] }
  const rawTerms = (text(query).match(/[a-z0-9+#.-]+/g) || []).map((term) => term.replace(/^[.-]+|[.-]+$/g, ''))
  const terms = [...new Set(rawTerms.flatMap((term) => [term, ...(synonyms[term] || [])]))].filter((term) => term.length > 1 && !ignoredTerms.has(term))
  const ranked = catalog.map((tool) => {
    const haystack = [tool.name, tool.category, tool.bestFor, ...tool.tags].join(' ').toLowerCase()
    const matches = terms.reduce((score, term) => score + (haystack.includes(term) ? (tool.name.toLowerCase().includes(term) ? 4 : 1) : 0), 0)
    return { tool, score: matches }
  }).sort((a, b) => b.score - a.score)
  const chosen = ranked[0]?.score > 0 ? ranked : catalog.map((tool) => ({ tool, score: 0 }))
  const topPick = chosen[0].tool
  const alternatives = chosen.slice(1).filter((item) => item.tool.category === topPick.category || item.score > 0).slice(0, 3).map(({ tool }) => tool.id)
  return { topPick: topPick.id, alternatives, reason: `${topPick.name} is a good starting point for ${query.trim() || 'your task'} because it is designed for ${topPick.bestFor.toLowerCase()}. Start with its free option where available, and verify important information.`, noMatch: ranked[0]?.score === 0 }
}

export function evaluateFallback({ approach = '', answer = '', problem = '' }) {
  const combined = `${approach} ${answer}`.trim()
  const hasApproach = approach.trim().length > 30
  const hasAnswer = answer.trim().length > 30
  const hasEdge = /edge|empty|null|boundary|case|constraint/i.test(combined)
  const hasComplexity = /o\(|complexity|time|space|memory/i.test(combined)
  const base = Math.min(8, Math.max(2, Math.round(combined.length / 100) + 3))
  const score = (increment) => Math.min(10, base + increment)
  const gaps = [!hasApproach && 'Explain your plan before writing code.', !hasEdge && 'Name at least two edge cases and how your solution handles them.', !hasComplexity && 'State time and space complexity and justify each one.', !hasAnswer && 'Add a complete answer or code sample so correctness can be reviewed.'].filter(Boolean)
  if (gaps.length === 0) gaps.push('Strengthen your explanation by comparing your approach with one alternative and explaining the trade-off.')
  return {
    scores: {
      problemUnderstanding: score(hasApproach ? 1 : 0),
      approachQuality: score(hasApproach ? 1 : 0),
      edgeCases: score(hasEdge ? 2 : 0),
      codeCorrectness: score(hasAnswer ? 1 : 0),
      complexity: score(hasComplexity ? 2 : 0),
      clarity: score(approach.trim().length > 80 ? 2 : 0),
    },
    strengths: combined.length > 100 ? ['You made a concrete attempt and gave the reviewer material to evaluate.'] : ['You have started the exercise; make your reasoning more explicit to get useful feedback.'],
    gaps,
    jobLevelThinking: ['Restate the input, output, and constraints before solving.', 'Start with a simple correct approach, then explain the bottleneck before optimizing.', 'Test a normal case and edge cases aloud, then state complexity.'],
    improvementPlan: ['Clarify the requirements and write down assumptions.', 'Work one small example by hand, including an edge case.', 'Explain complexity and revise the solution after testing.'],
    followUp: `Try a variation of ${problem || 'the problem'} with empty input and duplicate values.`,
    note: 'Offline feedback uses a simple heuristic and is not a full code execution or expert review.',
  }
}

export function coachFallback({ scenario = 'Tell me about yourself', transcript = '' }) {
  const trimmedTranscript = transcript.trim()
  const words = trimmedTranscript.split(/\s+/).filter(Boolean)
  const fillers = (transcript.match(/\b(um|uh|like|basically|actually|you know)\b/gi) || []).length
  const hasStructure = /situation|task|action|result|first|then|because|therefore/i.test(transcript)
  const hasLowercaseSentenceStart = /(?:^|[.!?]\s+)[a-z]/.test(trimmedTranscript)
  const grammar = trimmedTranscript.length > 20 && /[.!?]$/.test(trimmedTranscript)
  const score = Math.max(2, Math.min(9, 5 + (hasStructure ? 2 : 0) + (fillers < 3 ? 1 : 0) + (words.length > 35 ? 1 : 0)))
  return {
    score,
    feedback: {
      structure: hasStructure ? 'Your answer has a recognizable sequence. Make the result explicit.' : 'Give your answer a clear beginning, middle and outcome; use STAR for behavioral examples.',
      clarity: words.length > 25 ? 'You shared enough detail to assess. Keep each point tied to the question.' : 'Add one specific example so the listener can understand your contribution.',
      fillerWords: `${fillers} likely filler word${fillers === 1 ? '' : 's'} detected. A short pause is often clearer than filling silence.`,
      length: words.length < 35 ? 'This answer may be too brief for a full interview response.' : words.length > 170 ? 'This answer may run long; keep context brief and focus on your actions.' : 'The answer length is workable; rehearse it aloud and keep it conversational.',
      confidence: 'Use direct first-person language for your contribution, while crediting collaborators accurately.',
      vocabulary: 'Prefer concrete verbs and specific examples over broad claims.',
      grammar: hasLowercaseSentenceStart
        ? 'Capitalize the first word of each sentence. Add final punctuation and check proper names.'
        : grammar ? 'The transcript reads clearly; proofread names and technical terms.' : 'Use complete sentences, capitalize sentence starts, and add final punctuation.',
    },
    improvedSample: transcript.trim() ? `For ${scenario.toLowerCase()}, organize your real example like this: “The situation was [brief context]. I was responsible for [task]. I [specific actions], while coordinating with [people if relevant]. The result was [truthful outcome]. I learned [reflection].” Replace every bracket with your own details.` : 'Start with one relevant detail about your background, connect it to a real example, and close with why it fits this opportunity.',
    exercise: 'Record or type a 60-second answer. Remove one unnecessary detail, add a specific outcome, then practice it once more without memorizing it.',
    note: 'Offline feedback uses a lightweight text heuristic; Gemini feedback is unavailable until the server has a valid key.',
  }
}

export function guideFallback(name) {
  return {
    what: `${name} is an AI tool or agent. Its features and policies may change, so confirm details in its official documentation.`,
    who: 'Students and job seekers who want to explore this tool for a specific learning or career task.',
    setup: [`Open the official ${name} website and create an account if required.`, 'Review privacy, data-use, and plan information before uploading material.', 'Start with a small, non-sensitive task and check the result carefully.'],
    firstResult: ['Choose one task and define what a useful result looks like.', 'Gather permitted source material and remove private data.', 'Write a prompt with context, constraints and output format.', 'Review the result and verify factual claims.', 'Revise the prompt and save what worked.'],
    prompts: [`Explain [topic] at my current level and ask one question to check my understanding.`, `Turn these notes into a concise outline without adding unsupported facts: [notes]`, `Give me feedback on this draft while preserving my own ideas: [draft]`, `Show two approaches to [task] and explain trade-offs.`, `Quiz me on [topic] one question at a time; do not show the answer until I try.`],
    tips: ['Give context and constraints.', 'Ask for uncertainty and source links.', 'Iterate in small steps and verify important claims.'],
    mistakes: ['Treating generated text as automatically correct.', 'Sharing private or restricted information.', 'Submitting generated work as your own when course rules prohibit it.'],
    freeTierNotes: 'Check the official pricing page for current limits and feature availability.',
    alternatives: [],
  }
}

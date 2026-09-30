export async function postJSON(path, body, { timeoutMs = 30000, retries = 1 } = {}) {
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs)
    let response
    let payload
    try {
      response = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
      payload = await response.json().catch(() => ({}))
    } catch (error) {
      if (attempt < retries && error.name !== 'AbortError') continue
      if (error.name === 'AbortError') throw new Error('The request timed out. Please try again.', { cause: error })
      throw new Error('Could not connect to the service. Check your connection and try again.', { cause: error })
    } finally {
      window.clearTimeout(timeoutId)
    }
    if (response.ok) return payload
    if (response.status >= 500 && attempt < retries) continue
    throw new Error(typeof payload.error === 'string' ? payload.error : 'The request could not be completed. Please try again.')
  }
  throw new Error('The request could not be completed. Please try again.')
}

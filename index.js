/**
 * Edit Last Turn — Host half.
 *
 * Rewrites the tail of the live Session surface in place: the last user
 * message (and everything the model produced after it) is replaced by an
 * edited user message, then the Agent is woken with a message the loop will
 * not re-append (an owned runtime-context snapshot). The next LLM request is
 * therefore built from the rewritten surface, which is exactly "edit the
 * previous message and re-think".
 *
 * Exposed over a loopback-only HTTP route because Remote methods require the
 * Typert service decorators, which are impractical to hand-write in JS.
 */
import { randomUUID } from 'node:crypto'

export const name = 'dsh-edit-last-turn'

/** Host services this plugin needs. */
export const inject = ['webServer', 'sessionController', 'sessions']

const ROUTE_PREFIX = '/dsh-edit-last-turn'
const MAX_TEXT = 200_000
const MAX_BODY = 512 * 1024

/** @type {Map<string, Promise<unknown>>} */
const inFlight = new Map()

export function apply(ctx) {
  const log = (message) => {
    try {
      ctx.logger?.info?.(message)
    } catch {}
  }

  /** Resolve one Session's live Agent, resuming a cold Session when asked. */
  async function resolveAgent(sessionId) {
    const controller = ctx.sessionController
    if (controller === undefined) throw httpError(503, 'session controller unavailable')
    let result
    try {
      result = await controller.resolveAgent(sessionId)
    } catch (error) {
      throw toHttpError(error)
    }
    if (result !== null && typeof result === 'object' && 'error' in result) {
      throw toHttpError(result.error)
    }
    const agent = (result && result.agent) ?? result
    if (agent === undefined || agent === null || agent.session === undefined) {
      throw httpError(404, `session "${sessionId}" is not attached`)
    }
    return agent
  }

  /** Every surface node carrying a user-authored message, oldest first. */
  function findUserNodes(session) {
    const nodes = session.surface.nodes
    const found = []
    for (let index = 0; index < nodes.length; index += 1) {
      const event = session.eventAt(nodes[index])
      if (event !== undefined && event.type === 'user/message' && event.data?.source?.kind === 'user') {
        found.push({ index, seq: nodes[index], event })
      }
    }
    return found
  }

  function textOf(event) {
    const content = event?.data?.content
    if (!Array.isArray(content)) return ''
    const parts = []
    for (const block of content) {
      if (block?.type === 'text' && typeof block.text === 'string') parts.push(block.text)
    }
    return parts.join('\n')
  }

  /** GET /dsh-edit-last-turn/state?sessionId=…&resume=1 */
  async function handleState(res, url) {
    const sessionId = url.searchParams.get('sessionId') ?? ''
    if (sessionId === '') return sendJson(res, 400, { ok: false, error: 'sessionId is required' })
    const resume = url.searchParams.get('resume') === '1'
    let session
    let running = false
    const attached = ctx.sessions?.get?.(sessionId)
    if (attached !== undefined) {
      session = attached
      running = ctx.sessionController?.liveAgent?.(sessionId)?.status === 'running'
    } else if (resume) {
      const agent = await resolveAgent(sessionId)
      session = agent.session
      running = agent.status === 'running'
    } else {
      return sendJson(res, 200, { ok: true, live: false, text: '', running: false, editable: false })
    }
    const targets = findUserNodes(session)
    const last = targets[targets.length - 1]
    return sendJson(res, 200, {
      ok: true,
      live: true,
      editable: last !== undefined,
      running,
      text: last === undefined ? '' : textOf(last.event),
      seq: last === undefined ? null : last.seq,
      messages: targets.map((target) => {
        const text = textOf(target.event)
        return { seq: target.seq, text, preview: text.length > 120 ? `${text.slice(0, 120)}…` : text }
      }),
      turns: session.surface.nodes.length,
    })
  }

  /** POST /dsh-edit-last-turn/apply {sessionId, text, clientTimeZone} */
  async function handleApply(res, req) {
    const body = await readBody(req)
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
    const text = typeof body.text === 'string' ? body.text : ''
    const timeZone = typeof body.clientTimeZone === 'string' && body.clientTimeZone !== ''
      ? body.clientTimeZone
      : 'UTC'
    if (sessionId === '') return sendJson(res, 400, { ok: false, error: 'sessionId is required' })
    if (text.trim() === '') return sendJson(res, 400, { ok: false, error: 'edited text is empty' })
    if (text.length > MAX_TEXT) return sendJson(res, 413, { ok: false, error: 'edited text is too long' })
    if (inFlight.has(sessionId)) return sendJson(res, 409, { ok: false, error: 'another edit is already running for this session' })

    const job = (async () => {
      const agent = await resolveAgent(sessionId)
      // Stop the answer that is in progress; queued messages stay queued.
      if (agent.status === 'running') {
        agent.cancel({ kind: 'user' }, { keepInbox: true })
        await agent.whenIdle()
      }
      const session = agent.session
      const targets = findUserNodes(session)
      if (targets.length === 0) {
        throw httpError(409, 'this session has no user message to edit')
      }
      const wanted = Number.isInteger(body.seq) ? body.seq : null
      const target = wanted === null ? targets[targets.length - 1] : targets.find((entry) => entry.seq === wanted)
      if (target === undefined) {
        throw httpError(409, `user message with seq ${wanted} is no longer on the surface`)
      }
      const nodes = [...session.surface.nodes]
      const startSeq = target.seq
      const endSeq = nodes[nodes.length - 1]
      const shadowed = nodes.slice(target.index)
      if (shadowed.length === 0 || !shadowed.includes(endSeq)) {
        throw httpError(500, 'surface range is inconsistent')
      }
      const message = {
        role: 'user',
        id: randomUUID(),
        content: [{ type: 'text', text }],
        source: { kind: 'user', rpcId: randomUUID(), clientTimeZone: timeZone },
      }
      const event = session.append('user/message', message, {
        surfaceOp: { op: 'replace', startSeq, endSeq },
        sourceEventSeqs: shadowed,
      })
      // Invisible wake: the loop claims this message, never appends it, and
      // derives the request from the surface we just rewrote.
      agent.followup({
        role: 'user',
        id: randomUUID(),
        content: [],
        source: { kind: 'runtime-context', form: 'snapshot', sections: [] },
      })
      log(`edit-last-turn: rewrote seq ${startSeq}..${endSeq} as ${event.seq} (${shadowed.length} node(s) shadowed)`)
      return {
        ok: true,
        seq: event.seq,
        startSeq,
        endSeq,
        shadowed: shadowed.length,
      }
    })()

    inFlight.set(sessionId, job)
    try {
      return sendJson(res, 200, await job)
    } catch (error) {
      const status = Number.isInteger(error?.status) ? error.status : 500
      return sendJson(res, status, { ok: false, error: error instanceof Error ? error.message : String(error) })
    } finally {
      inFlight.delete(sessionId)
    }
  }

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: ROUTE_PREFIX,
    handler: async (req, res) => {
      try {
        if (!isLoopback(req.socket?.remoteAddress ?? '')) {
          return sendJson(res, 403, { ok: false, error: 'loopback clients only' })
        }
        const port = typeof ctx.webServer.port === 'number' ? ctx.webServer.port : 0
        if (port > 0 && !allowedHosts(port).has(String(req.headers?.host ?? ''))) {
          return sendJson(res, 403, { ok: false, error: 'host check failed' })
        }
        const method = req.method ?? 'GET'
        if (method !== 'GET' && method !== 'HEAD' && !writeOriginOk(req, port)) {
          return sendJson(res, 403, { ok: false, error: 'cross-site request rejected' })
        }
        const url = new URL(req.url ?? '/', `http://127.0.0.1:${port || 80}`)
        const sub = url.pathname.slice(ROUTE_PREFIX.length)
        if (method === 'GET' && (sub === '/state' || sub === '/state/')) return await handleState(res, url)
        if (method === 'POST' && (sub === '/apply' || sub === '/apply/')) return await handleApply(res, req)
        return sendJson(res, 404, { ok: false, error: `unknown route: ${method} ${url.pathname}` })
      } catch (error) {
        return sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
      }
    },
  }), 'edit-last-turn: routes')
}

function httpError(status, message) {
  const error = new Error(message)
  error.status = status
  return error
}

function toHttpError(error) {
  const code = typeof error?.code === 'string' ? error.code : ''
  const message = error instanceof Error ? error.message : String(error)
  if (code === 'session/not-found') return httpError(404, message)
  if (code === 'session/writer-held' || code === 'session/agent-busy') return httpError(409, message)
  return httpError(500, message)
}

function isLoopback(address) {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

function allowedHosts(port) {
  return new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`])
}

function writeOriginOk(req, port) {
  const site = typeof req.headers?.['sec-fetch-site'] === 'string' ? req.headers['sec-fetch-site'] : null
  if (site !== null && site !== 'same-origin' && site !== 'none') return false
  const origin = typeof req.headers?.origin === 'string' ? req.headers.origin : ''
  if (origin === '') return true
  return [...allowedHosts(port)].some((entry) => origin === `http://${entry}`)
}

function sendJson(res, status, body) {
  if (res.writableEnded) return
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(body))
}

async function readBody(req, maxBytes = MAX_BODY) {
  const chunks = []
  let total = 0
  for await (const chunk of req) {
    total += chunk.length
    if (total > maxBytes) throw httpError(413, 'request body is too large')
    chunks.push(chunk)
  }
  if (chunks.length === 0) return {}
  const raw = Buffer.concat(chunks).toString('utf8')
  try {
    const parsed = JSON.parse(raw)
    return parsed !== null && typeof parsed === 'object' ? parsed : {}
  } catch {
    throw httpError(400, 'request body is not valid JSON')
  }
}

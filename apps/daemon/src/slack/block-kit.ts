import { SLACK_MAX_BLOCKS } from '../plugins/slack'

/** Serialised blocks; well under what Slack accepts, so a refusal here is ours rather than an opaque invalid_blocks. */
export const SLACK_BLOCKS_JSON_MAX = 30_000
export const SLACK_FALLBACK_TEXT_MAX = 3_000
const DEPTH_MAX = 12
const ID_MAX = 255

/** Block types a message may carry; input and file blocks belong to modals and remote files. */
export const SLACK_MESSAGE_BLOCK_TYPES = ['actions', 'context', 'divider', 'header', 'image', 'markdown', 'rich_text', 'section'] as const

/** Prefix of the daemon's own interactive ids; a bot-made button with one could pass for a decision prompt. */
export const SLACK_RESERVED_ID_PREFIX = 'cm-'

const POST_KEYS = new Set(['text', 'blocks', 'channel', 'thread_ts'])

const SECRET_PATTERNS: readonly RegExp[] = [
  /xox[abeoprs]-[\w-]{6,}/i,
  /xapp-\d-[\w-]{6,}/i,
  /\bgh[opsu]_\w{20,}/,
  /\bgithub_pat_\w{20,}/,
  /\bsk-(?:ant-)?[\w-]{20,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
]

/** They notify the whole channel, which is outside the thread. */
const BROADCAST_MENTION = /<!(?:channel|here|everyone)(?:\|[^>]*)?>/i

export interface SlackThreadTarget {
  channel: string
  threadTs: string
}

export interface SlackBlocksPost {
  channel: string
  thread_ts: string
  text: string
  blocks: Record<string, unknown>[]
}

export type SlackBlocksValidation = { ok: true, post: SlackBlocksPost } | { ok: false, reason: string }

class Refusal extends Error {}

const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)

function refuse(reason: string): never {
  throw new Refusal(reason)
}

function textObject(value: unknown, at: string, max: number, plainOnly = false): void {
  if (!isObject(value)) refuse(`${at} must be a text object`)
  const types = plainOnly ? ['plain_text'] : ['plain_text', 'mrkdwn']
  if (!types.includes(value.type as string)) refuse(`${at}.type must be ${types.join(' or ')}`)
  if (typeof value.text !== 'string' || !value.text.length) refuse(`${at}.text must be non-empty text`)
  if (value.text.length > max) refuse(`${at}.text is longer than ${max} characters`)
}

function elementList(value: unknown, at: string, max: number): Record<string, unknown>[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > max) refuse(`${at} must list 1 to ${max} elements`)
  value.forEach((element, index) => {
    if (!isObject(element) || typeof element.type !== 'string') refuse(`${at}[${index}] must be an element with a type`)
  })
  return value as Record<string, unknown>[]
}

function checkBlock(block: unknown, at: string): void {
  if (!isObject(block)) refuse(`${at} must be an object`)
  const type = block.type
  if (typeof type !== 'string' || !(SLACK_MESSAGE_BLOCK_TYPES as readonly string[]).includes(type)) refuse(`${at}.type must be one of ${SLACK_MESSAGE_BLOCK_TYPES.join(', ')}`)
  switch (type) {
    case 'section':
      if (block.text === undefined && block.fields === undefined) refuse(`${at} needs text or fields`)
      if (block.text !== undefined) textObject(block.text, `${at}.text`, 3000)
      if (block.fields !== undefined) {
        if (!Array.isArray(block.fields) || block.fields.length === 0 || block.fields.length > 10) refuse(`${at}.fields must list 1 to 10 text objects`)
        block.fields.forEach((field, index) => textObject(field, `${at}.fields[${index}]`, 2000))
      }
      if (block.accessory !== undefined && (!isObject(block.accessory) || typeof block.accessory.type !== 'string')) refuse(`${at}.accessory must be an element with a type`)
      break
    case 'header':
      textObject(block.text, `${at}.text`, 150, true)
      break
    case 'context':
      elementList(block.elements, `${at}.elements`, 10)
      break
    case 'actions':
      elementList(block.elements, `${at}.elements`, 25)
      break
    case 'rich_text':
      elementList(block.elements, `${at}.elements`, 50)
      break
    case 'image':
      if (typeof block.image_url !== 'string' && !isObject(block.slack_file)) refuse(`${at} needs image_url or slack_file`)
      if (typeof block.alt_text !== 'string' || !block.alt_text.length || block.alt_text.length > 2000) refuse(`${at}.alt_text must be 1 to 2000 characters`)
      break
    case 'markdown':
      if (typeof block.text !== 'string' || !block.text.length || block.text.length > 12_000) refuse(`${at}.text must be 1 to 12000 characters`)
      break
  }
}

/** Every value, at any depth: ids, secrets, broadcasts. */
function scan(value: unknown, at: string, depth: number): void {
  if (depth > DEPTH_MAX) refuse(`${at} is nested too deeply`)
  if (typeof value === 'string') {
    if (SECRET_PATTERNS.some(pattern => pattern.test(value))) refuse(`${at} looks like a credential; tokens are never posted`)
    if (BROADCAST_MENTION.test(value)) refuse(`${at} mentions the whole channel, which reaches outside the thread`)
    return
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => scan(item, `${at}[${index}]`, depth + 1))
    return
  }
  if (!isObject(value)) return
  for (const [key, nested] of Object.entries(value)) {
    const path = `${at}.${key}`
    if (key === 'action_id' || key === 'block_id') {
      if (typeof nested !== 'string' || !nested.length || nested.length > ID_MAX) refuse(`${path} must be 1 to ${ID_MAX} characters`)
      if (nested.startsWith(SLACK_RESERVED_ID_PREFIX)) refuse(`${path} uses an id reserved for the daemon's own buttons`)
    }
    if (key === 'type' && nested === 'broadcast') refuse(`${path} mentions the whole channel, which reaches outside the thread`)
    scan(nested, path, depth + 1)
  }
}

/** Checks a bot's Block Kit post and pins it to the thread the bot is answering. */
export function validateSlackBlocksPost(input: Record<string, unknown>, target: SlackThreadTarget): SlackBlocksValidation {
  try {
    const extra = Object.keys(input).filter(key => !POST_KEYS.has(key))
    if (extra.length) refuse(`Only text, blocks, channel and thread_ts may be set; ${extra.join(', ')} ${extra.length > 1 ? 'are' : 'is'} refused`)
    if (input.channel !== undefined && input.channel !== target.channel) refuse(`The post names channel ${JSON.stringify(input.channel)}, but this session may only post in its own thread`)
    if (input.thread_ts !== undefined && input.thread_ts !== target.threadTs) refuse(`The post names thread ${JSON.stringify(input.thread_ts)}, but this session may only post in its own thread`)
    if (typeof input.text !== 'string' || !input.text.trim()) refuse('text is required: it is the notification and screen-reader fallback')
    if (input.text.length > SLACK_FALLBACK_TEXT_MAX) refuse(`text is longer than ${SLACK_FALLBACK_TEXT_MAX} characters`)
    const blocks = input.blocks
    if (!Array.isArray(blocks) || blocks.length === 0 || blocks.length > SLACK_MAX_BLOCKS) refuse(`blocks must list 1 to ${SLACK_MAX_BLOCKS} blocks`)
    if (JSON.stringify(blocks).length > SLACK_BLOCKS_JSON_MAX) refuse(`blocks are larger than ${SLACK_BLOCKS_JSON_MAX} characters of JSON`)
    blocks.forEach((block, index) => checkBlock(block, `blocks[${index}]`))
    scan(input.text, 'text', 0)
    scan(blocks, 'blocks', 0)
    return { ok: true, post: { channel: target.channel, thread_ts: target.threadTs, text: input.text, blocks: blocks as Record<string, unknown>[] } }
  }
  catch (error) {
    if (error instanceof Refusal) return { ok: false, reason: error.message }
    throw error
  }
}

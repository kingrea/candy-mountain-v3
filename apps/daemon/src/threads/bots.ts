import type { BotSessionService } from '../bot-sessions/service'
import { serviceKey } from '../capabilities/definition'

/** What the thread service needs of a bot session service; the capability that owns bots binds its service to the key. */
export type ThreadBots = Pick<BotSessionService, 'start' | 'prompt' | 'lease' | 'closeSession'>

export const THREAD_BOTS = serviceKey<ThreadBots>('threads.bots')

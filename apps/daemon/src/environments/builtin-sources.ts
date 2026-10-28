import { CUSTOM_ENDPOINT_SOURCE } from './custom-endpoint'
import { HEROKU_SOURCE, NETLIFY_SOURCE } from './plugin-sources'
import { createLiveVersionSourceRegistry, type LiveVersionSource } from './sources'

export const LIVE_VERSION_SOURCES: readonly LiveVersionSource[] = [CUSTOM_ENDPOINT_SOURCE, NETLIFY_SOURCE, HEROKU_SOURCE]

export const LIVE_VERSION_SOURCE_REGISTRY = createLiveVersionSourceRegistry(LIVE_VERSION_SOURCES)

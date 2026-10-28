import { z } from 'zod'
import { degraded, down, probe, up, type MonitorCheck, type ProbeResponse, type Verdict } from './check'

const isRedirect = (status: number) => status >= 300 && status < 400

export const checkHttp: MonitorCheck = (context) => {
  const expected = Number(context.options.expectedStatus ?? 200)
  const needle = typeof context.options.responseContains === 'string' ? context.options.responseContains : ''
  return probe(context, async (response) => {
    if (response.status !== expected) return down(`Expected status ${expected}, got ${response.status}.`)
    if (needle && !(await response.text()).includes(needle)) return down('The response does not contain the expected text.')
    return up()
  }, { followRedirects: !isRedirect(expected) })
}

/** Vendor feeds answer 200 whatever the vendor's state, so health is read out of the body. */
function readFeed<T>(schema: z.ZodType<T>, judge: (feed: T) => Verdict) {
  return async (response: ProbeResponse): Promise<Verdict> => {
    if (response.status < 200 || response.status >= 300) return down(`The status feed returned ${response.status}.`)
    const feed = schema.safeParse(await response.json())
    if (!feed.success) return down('The status feed has an unexpected shape.')
    return judge(feed.data)
  }
}

const humanise = (status: string) => status.replace(/_/g, ' ')

const STATUSPAGE_FEED = z.object({ components: z.array(z.object({ id: z.string(), status: z.string() })) })

/** Statuspage component statuses; maintenance is announced, not an outage. */
const STATUSPAGE_STATUS: Record<string, Verdict['status']> = {
  operational: 'up',
  under_maintenance: 'up',
  degraded_performance: 'degraded',
  partial_outage: 'degraded',
  major_outage: 'down',
}

export const checkStatuspage: MonitorCheck = (context) => {
  const componentId = String(context.options.componentId)
  return probe(context, readFeed(STATUSPAGE_FEED, (feed) => {
    const component = feed.components.find(c => c.id === componentId)
    if (!component) return down(`Component ${componentId} is not in the feed.`)
    const status = STATUSPAGE_STATUS[component.status]
    if (status === 'up') return up()
    if (status === 'down') return down(humanise(component.status))
    return degraded(status ? humanise(component.status) : `Unrecognised status '${component.status}'.`)
  }))
}

const STATUSIO_ENTRY = z.object({ status: z.string(), status_code: z.number() })
const STATUSIO_FEED = z.object({
  result: z.object({ status: z.array(STATUSIO_ENTRY.extend({ id: z.string(), containers: z.array(STATUSIO_ENTRY.extend({ id: z.string() })) })) }),
})

/** Status.io codes: 100 operational, 200 planned maintenance, 300 degraded, 400 partial disruption, 500 disruption, 600 security event. */
function statusioStatus(code: number): Verdict['status'] {
  if (code < 300) return 'up'
  return code < 500 ? 'degraded' : 'down'
}

export const checkStatusio: MonitorCheck = (context) => {
  const componentId = String(context.options.componentId)
  const containerId = String(context.options.containerId)
  return probe(context, readFeed(STATUSIO_FEED, (feed) => {
    const component = feed.result.status.find(c => c.id === componentId)
    if (!component) return down(`Component ${componentId} is not in the feed.`)
    const container = component.containers.find(c => c.id === containerId)
    if (!container) return down(`Container ${containerId} is not in component ${componentId}.`)
    const status = statusioStatus(container.status_code)
    return status === 'up' ? up() : { status, detail: `${container.status} (${container.status_code})` }
  }))
}

const STATPING_SERVICE = z.object({ id: z.number(), online: z.boolean(), last_success: z.string().optional() })

/** Accepts the services list or a single service, so the target may be `/api/services` or `/api/services/<id>`. */
const STATPING_FEED = z.union([z.array(STATPING_SERVICE), STATPING_SERVICE])

export const checkStatping: MonitorCheck = (context) => {
  const serviceId = Number(context.options.serviceId)
  return probe(context, readFeed(STATPING_FEED, (feed) => {
    const service = (Array.isArray(feed) ? feed : [feed]).find(s => s.id === serviceId)
    if (!service) return down(`Service ${serviceId} is not in the feed.`)
    if (service.online) return up()
    // Statping's last_error is a timestamp, not a message, so the last success is the useful hint.
    return down(service.last_success ? `Offline (last success ${service.last_success}).` : 'Offline.')
  }))
}

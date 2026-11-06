import { checkHttp, checkStatping, checkStatuspage, checkStatusio } from './checkers'
import { createMonitorSourceRegistry, defineMonitorSource, type MonitorSource } from './sources'

const VENDOR_ID_PATTERN = '[A-Za-z0-9_-]+'

export const HTTP_SOURCE = defineMonitorSource({
  id: 'http',
  label: 'HTTP',
  description: 'Requests the target URL and checks the response status and, optionally, its body.',
  targetLabel: 'URL',
  targetPlaceholder: 'https://example.com/health',
  fields: [
    { kind: 'integer', name: 'expectedStatus', label: 'Expected status', min: 100, max: 599, default: 200 },
    { kind: 'string', name: 'responseContains', label: 'Response contains', description: 'Text the response body must include.', maxLength: 500 },
  ],
  check: checkHttp,
})

export const STATUSPAGE_SOURCE = defineMonitorSource({
  id: 'statuspage',
  label: 'Statuspage',
  description: 'Reads one component from an Atlassian Statuspage public feed; maintenance counts as up.',
  targetLabel: 'Components feed URL',
  targetPlaceholder: 'https://status.example.com/api/v2/components.json',
  fields: [
    { kind: 'string', name: 'componentId', label: 'Component id', description: 'The component\'s id in the components feed.', required: true, pattern: VENDOR_ID_PATTERN, maxLength: 64 },
  ],
  check: checkStatuspage,
})

export const STATUSIO_SOURCE = defineMonitorSource({
  id: 'statusio',
  label: 'Status.io',
  description: 'Reads one component in one region from a Status.io public feed; maintenance counts as up.',
  targetLabel: 'Status feed URL',
  targetPlaceholder: 'https://api.status.io/1.0/status/<status page id>',
  fields: [
    { kind: 'string', name: 'componentId', label: 'Component id', required: true, pattern: VENDOR_ID_PATTERN, maxLength: 64 },
    { kind: 'string', name: 'containerId', label: 'Container id', description: 'The region (container) of the component to read.', required: true, pattern: VENDOR_ID_PATTERN, maxLength: 64 },
  ],
  check: checkStatusio,
})

export const STATPING_SOURCE = defineMonitorSource({
  id: 'statping',
  label: 'Statping',
  description: 'Reads one service from a Statping page, which probes the service itself.',
  targetLabel: 'Services feed URL',
  targetPlaceholder: 'https://status.example.com/api/services',
  fields: [
    { kind: 'integer', name: 'serviceId', label: 'Service id', description: 'The service\'s numeric id in the services feed.', required: true, min: 0 },
  ],
  check: checkStatping,
})

export const MONITOR_SOURCES: readonly MonitorSource[] = [HTTP_SOURCE, STATUSPAGE_SOURCE, STATUSIO_SOURCE, STATPING_SOURCE]

export const MONITOR_SOURCE_REGISTRY = createMonitorSourceRegistry(MONITOR_SOURCES)

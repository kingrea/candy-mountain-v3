export default defineEventHandler(event =>
  proxyToDaemon(event, resolveDaemonUrl(useRuntimeConfig(event).daemonUrl)),
)

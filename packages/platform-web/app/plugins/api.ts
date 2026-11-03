export default defineNuxtPlugin(() => {
  // During SSR the proxy is called in-process, so the browser's cookies must be passed on explicitly.
  const headers = useRequestHeaders(['cookie'])
  const { status } = useDaemonStatus()
  const api = $fetch.create({
    baseURL: '/api',
    headers,
    onResponseError: ({ response }) => reportDaemonError(status, { response, data: response._data }),
  })
  return { provide: { api } }
})

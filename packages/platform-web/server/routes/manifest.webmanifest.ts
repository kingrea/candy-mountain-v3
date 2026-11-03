import { setResponseHeader } from 'h3'

export default defineEventHandler((event) => {
  setResponseHeader(event, 'content-type', WEB_MANIFEST_CONTENT_TYPE)
  return JSON.stringify(webManifest(PRODUCT))
})

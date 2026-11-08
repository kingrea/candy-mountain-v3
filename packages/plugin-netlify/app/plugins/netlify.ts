import netlifyIcon from '#layers/netlify/app/assets/icons/netlify.svg?url'

export default defineNuxtPlugin(() => {
  // The white backing keeps the dark brand mark legible in either theme.
  registerPluginIcon('netlify', { src: netlifyIcon, class: 'rounded-sm bg-white p-0.5' })
})

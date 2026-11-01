import herokuIcon from '#layers/deployments/app/assets/icons/heroku.svg?url'
import netlifyIcon from '#layers/deployments/app/assets/icons/netlify.svg?url'

// The white backing keeps the dark brand marks legible in either theme.
const BACKED = 'rounded-sm bg-white p-0.5'

export default defineNuxtPlugin(() => {
  registerPluginIcon('netlify', { src: netlifyIcon, class: BACKED })
  registerPluginIcon('heroku', { src: herokuIcon, class: BACKED })
})

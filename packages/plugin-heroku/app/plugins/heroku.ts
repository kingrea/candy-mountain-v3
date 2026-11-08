import herokuIcon from '#layers/heroku/app/assets/icons/heroku.svg?url'

export default defineNuxtPlugin(() => {
  // The white backing keeps the dark brand mark legible in either theme.
  registerPluginIcon('heroku', { src: herokuIcon, class: 'rounded-sm bg-white p-0.5' })
})

import slackIcon from '#layers/slack/app/assets/icons/slack.svg?url'

export default defineNuxtPlugin(() => {
  registerPluginIcon('slack', { src: slackIcon })
})

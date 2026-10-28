import type { PluginInstance, PluginTypeId } from '@candy-mountain/shared'
import { createHerokuOperations, herokuConfig, herokuPluginType } from '../plugins/heroku'
import { resolvePluginInstance, type PluginInstanceDeps } from '../plugins/instances/instances'
import { createNetlifyOperations, netlifyConfig, netlifyPluginType } from '../plugins/netlify'
import { createPluginSecrets } from '../plugins/secrets'
import { defineLiveVersionSource, type LiveVersionValidateContext } from './sources'

type Resolved = { instance: PluginInstance, problem?: undefined } | { instance?: undefined, problem: string }

/** Untested counts as unusable, matching readiness, since any config change clears the stored health. */
function resolveHealthyPlugin(deps: PluginInstanceDeps, projectId: string, typeId: PluginTypeId, name: string): Resolved {
  const instance = resolvePluginInstance(deps, projectId, typeId)
  if (!instance) return { problem: `The ${name} plugin is not set up for this project; add it on the Plugins page.` }
  if (!instance.health) return { problem: `The ${name} plugin has not been tested since it last changed; test it on the Plugins page.` }
  if (!instance.health.healthy) return { problem: `The ${name} plugin is unhealthy: ${instance.health.reason}` }
  return { instance }
}

function healthyPlugin(deps: PluginInstanceDeps, projectId: string, typeId: PluginTypeId, name: string): PluginInstance {
  const { instance, problem } = resolveHealthyPlugin(deps, projectId, typeId, name)
  if (!instance) throw new Error(problem)
  return instance
}

function requireHealthyPlugin(typeId: PluginTypeId, name: string) {
  return (_settings: unknown, { projectId, deps }: LiveVersionValidateContext) => {
    const { problem } = resolveHealthyPlugin(deps, projectId, typeId, name)
    return problem ? [{ field: '', message: problem }] : []
  }
}

export const NETLIFY_SOURCE = defineLiveVersionSource({
  id: 'netlify',
  label: 'Netlify',
  description: 'The production deploy of the project\'s Netlify site, read through its Netlify plugin.',
  fields: [],
  validate: requireHealthyPlugin('netlify', 'Netlify'),
  async read({ project, signal, fetch, deps }) {
    const instance = healthyPlugin(deps, project.id, 'netlify', 'Netlify')
    const netlify = createNetlifyOperations(netlifyConfig(instance.config), createPluginSecrets(deps.secretsReader, instance.id, netlifyPluginType), { signal, fetch })
    const deploy = await netlify.getCurrentDeploy()
    if (!deploy) return {}
    return {
      version: deploy.commitSha ?? undefined,
      branch: deploy.branch ?? undefined,
      deployedAt: deploy.deployedAt ?? undefined,
      // The deploy permalink pins the exact build that is live; the site URL is only a fallback.
      link: deploy.deployUrl ?? (await netlify.getSite()).url ?? undefined,
    }
  },
})

export const HEROKU_SOURCE = defineLiveVersionSource({
  id: 'heroku',
  label: 'Heroku',
  description: 'The current release of the project\'s Heroku app, read through its Heroku plugin.',
  fields: [],
  validate: requireHealthyPlugin('heroku', 'Heroku'),
  async read({ project, signal, fetch, deps }) {
    const instance = healthyPlugin(deps, project.id, 'heroku', 'Heroku')
    const heroku = createHerokuOperations(herokuConfig(instance.config), createPluginSecrets(deps.secretsReader, instance.id, herokuPluginType), { signal, fetch })
    const release = await heroku.getCurrentRelease()
    if (!release) return {}
    // Heroku releases carry no branch, and a release without a build commit is still named by its number.
    return { version: release.commitSha ?? `v${release.version}`, deployedAt: release.createdAt, link: release.appUrl ?? undefined }
  },
})

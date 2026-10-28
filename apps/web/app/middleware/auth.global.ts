import { AUTH_STRATEGY_PATH, type Actor, type AuthStrategyName, type AuthStrategyResponse } from '@candy-mountain/shared'

export default defineNuxtRouteMiddleware(async (to) => {
  const { user, loaded, fetchUser } = useCurrentUser()
  const { $api } = useNuxtApp()

  let actor: Actor | null
  try {
    actor = loaded.value ? user.value : await fetchUser()
  }
  catch {
    // Daemon unreachable or failing: app.vue shows that state, so do not bounce to login.
    return
  }

  let strategy: AuthStrategyName | null = null
  if (!actor) {
    try {
      strategy = (await $api<AuthStrategyResponse>(AUTH_STRATEGY_PATH)).strategy
    }
    catch {
      return
    }
  }

  const target = decideAuthRedirect({
    path: to.path,
    fullPath: to.fullPath,
    signedIn: Boolean(actor),
    strategy,
    redirectQuery: to.query[LOGIN_REDIRECT_QUERY],
  })
  if (target) return navigateTo(target, { replace: true })
})

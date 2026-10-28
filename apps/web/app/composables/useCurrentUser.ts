import { ME_PATH, type Actor, type MeResponse } from '@candy-mountain/shared'

export function useCurrentUser() {
  const user = useState<Actor | null>('current-user', () => null)
  // Separate from `user` so a signed-out null is not refetched on every navigation.
  const loaded = useState('current-user-loaded', () => false)

  // Resolves to null when signed out; other errors (daemon down) propagate.
  async function fetchUser(): Promise<Actor | null> {
    try {
      const { actor } = await useNuxtApp().$api<MeResponse>(ME_PATH)
      user.value = actor
    }
    catch (error) {
      if ((error as { response?: { status?: number } }).response?.status !== 401) throw error
      user.value = null
    }
    loaded.value = true
    return user.value
  }

  function setUser(actor: Actor | null) {
    user.value = actor
    loaded.value = true
  }

  return { user, loaded, fetchUser, setUser }
}

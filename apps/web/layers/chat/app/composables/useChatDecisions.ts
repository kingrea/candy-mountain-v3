import { sessionDecisionPath, type AnswerDecisionRequest, type Decision, type DecisionResponse } from '@candy-mountain/shared'

/**
 * Answers decisions on the session each one belongs to. The returned decision is only a receipt: the transcript takes
 * the outcome from the decision rows on the stream, so every surface that answered shows the same thing.
 */
export function useChatDecisions(slug: MaybeRefOrGetter<string | null | undefined>) {
  const { $api } = useNuxtApp()
  const submitting = ref<Record<string, boolean>>({})
  const errors = ref<Record<string, string>>({})

  async function answer(decision: Decision, body: AnswerDecisionRequest): Promise<Decision | null> {
    const current = toValue(slug)
    if (!current || submitting.value[decision.id]) return null
    submitting.value = { ...submitting.value, [decision.id]: true }
    const { [decision.id]: _cleared, ...rest } = errors.value
    errors.value = rest
    try {
      const response = await $api<DecisionResponse>(sessionDecisionPath(current, decision.sessionId, decision.id), { method: 'POST', body })
      return response.decision
    }
    catch (cause) {
      errors.value = { ...errors.value, [decision.id]: toApiError(cause).message }
      return null
    }
    finally {
      const { [decision.id]: _done, ...others } = submitting.value
      submitting.value = others
    }
  }

  return {
    answer,
    submitting: readonly(submitting),
    errors: readonly(errors),
  }
}

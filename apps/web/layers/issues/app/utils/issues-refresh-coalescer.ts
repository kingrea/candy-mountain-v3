export interface IssuesRefreshCoalescer {
  trigger: () => void
  cancel: () => void
}

interface CoalescerOptions {
  delayMs: number
  run: () => Promise<unknown>
  onBusy?: (busy: boolean) => void
}

/** Trailing debounce that never overlaps runs: a trigger during a run schedules exactly one more after it. */
export function issuesCreateRefreshCoalescer({ delayMs, run, onBusy }: CoalescerOptions): IssuesRefreshCoalescer {
  let timer: ReturnType<typeof setTimeout> | null = null
  let running = false
  let again = false
  let cancelled = false

  function schedule() {
    if (timer) clearTimeout(timer)
    timer = setTimeout(start, delayMs)
  }

  async function start() {
    timer = null
    running = true
    again = false
    onBusy?.(true)
    try {
      await run()
    }
    catch {
      // the list keeps its own error state; a failed refetch must not stop later ones
    }
    running = false
    onBusy?.(false)
    if (again && !cancelled) schedule()
  }

  return {
    trigger() {
      cancelled = false
      if (running) again = true
      else schedule()
    },
    cancel() {
      cancelled = true
      again = false
      if (timer) clearTimeout(timer)
      timer = null
    },
  }
}

/** The long-running part: harmless, but it holds a timer, so it shows what start opens and close must stop. */
export interface TemplateTicker {
  readonly ticks: number
  readonly running: boolean
  stop(): void
}

export function startTicker(intervalMs: number): TemplateTicker {
  let ticks = 0
  let timer: ReturnType<typeof setInterval> | undefined = setInterval(() => void ticks++, intervalMs)
  return {
    get ticks() {
      return ticks
    },
    get running() {
      return timer !== undefined
    },
    stop() {
      clearInterval(timer)
      timer = undefined
    },
  }
}

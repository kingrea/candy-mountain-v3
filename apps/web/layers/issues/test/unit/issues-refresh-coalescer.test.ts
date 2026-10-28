import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { issuesCreateRefreshCoalescer } from '../../app/utils/issues-refresh-coalescer'

describe('issuesCreateRefreshCoalescer', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('collapses a burst into one trailing run', async () => {
    const run = vi.fn(async () => {})
    const c = issuesCreateRefreshCoalescer({ delayMs: 300, run })
    c.trigger()
    await vi.advanceTimersByTimeAsync(200)
    c.trigger()
    await vi.advanceTimersByTimeAsync(200)
    expect(run).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(100)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('runs once more after an in-flight run when triggered meanwhile', async () => {
    let release = () => {}
    const run = vi.fn(() => new Promise<void>((resolve) => { release = resolve }))
    const c = issuesCreateRefreshCoalescer({ delayMs: 300, run })
    c.trigger()
    await vi.advanceTimersByTimeAsync(300)
    c.trigger()
    c.trigger()
    await vi.advanceTimersByTimeAsync(1000)
    expect(run).toHaveBeenCalledTimes(1)
    release()
    await vi.advanceTimersByTimeAsync(300)
    expect(run).toHaveBeenCalledTimes(2)
    release()
    await vi.advanceTimersByTimeAsync(1000)
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('reports busy around each run and survives a failing run', async () => {
    const busy: boolean[] = []
    const run = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue(undefined)
    const c = issuesCreateRefreshCoalescer({ delayMs: 10, run, onBusy: value => busy.push(value) })
    c.trigger()
    await vi.advanceTimersByTimeAsync(10)
    c.trigger()
    await vi.advanceTimersByTimeAsync(10)
    expect(run).toHaveBeenCalledTimes(2)
    expect(busy).toEqual([true, false, true, false])
  })

  it('cancel drops a pending run', async () => {
    const run = vi.fn(async () => {})
    const c = issuesCreateRefreshCoalescer({ delayMs: 300, run })
    c.trigger()
    c.cancel()
    await vi.advanceTimersByTimeAsync(1000)
    expect(run).not.toHaveBeenCalled()
  })
})

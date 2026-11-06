import { expect, it, vi } from 'vitest'
import { epsilonFormat } from '../../app/utils/epsilon'

vi.mock('#layers/platform-web/app/utils/core', () => ({ CORE_LIMIT: 1 }))

it('formats', () => {
  expect(epsilonFormat(1)).toBe('1 of 2')
})

import { dataDirName } from '@candy-mountain/platform-config'
import type { ProductConfig } from '@candy-mountain/platform-sdk'

export interface AppLocation {
  entry: string
  cwd: string
}

export interface Distribution {
  product: Pick<ProductConfig, 'name'>
  /** The built bin, which the systemd unit runs. */
  cliEntry: string
  /** The systemd unit's working directory. */
  root: string
  daemon: AppLocation
  web: AppLocation
  dataDir(env: NodeJS.ProcessEnv): string
}

export interface Names {
  product: string
  /** The bin, the systemd unit and the ~/.config folder all share it. */
  command: string
  unit: string
}

export function namesFor(product: Pick<ProductConfig, 'name'>): Names {
  const command = dataDirName(product.name)
  return { product: product.name, command, unit: `${command}.service` }
}

import type { PluginInstance, PluginTypeId, PluginTypeInfo } from '@candy-mountain/shared'
import { markRaw, type Component } from 'vue'

/** Props every plugin panel receives; a panel changes the instance through usePluginActions(), which refreshes the page. */
export interface PluginPanelProps {
  instance: PluginInstance
  type: PluginTypeInfo
}

const pluginPanels = new Map<PluginTypeId, Component>()

/**
 * Adds a type-specific panel under every instance of that type on the Plugins page. Call it from a Nuxt plugin
 * (core's app/plugins/plugin-panels.ts or a layer's own), usually with defineAsyncComponent so the panel loads lazily.
 */
export function registerPluginPanel(typeId: PluginTypeId, component: Component): void {
  pluginPanels.set(typeId, markRaw(component))
}

export function pluginPanelFor(typeId: PluginTypeId): Component | undefined {
  return pluginPanels.get(typeId)
}

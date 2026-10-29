import type { PluginInstance, PluginScope, PluginTypeId, PluginTypeInfo } from '@candy-mountain/shared'
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

/** Props a type-specific setup form receives inside the add/edit modal; it owns the right-hand column and its own actions. */
export interface PluginFormProps {
  type: PluginTypeInfo
  /** Null while adding. */
  instance: PluginInstance | null
  scope: PluginScope
}

/** Events a setup form emits: `saved` once the instance is in its intended state (the modal closes), `close` to dismiss. */
export interface PluginFormEmits {
  saved: [instance: PluginInstance, created: boolean]
  close: []
}

const pluginForms = new Map<PluginTypeId, Component>()

/** Replaces the generic config and secret fields in the add/edit modal for one type, for setups that need more than fields. */
export function registerPluginForm(typeId: PluginTypeId, component: Component): void {
  pluginForms.set(typeId, markRaw(component))
}

export function pluginFormFor(typeId: PluginTypeId): Component | undefined {
  return pluginForms.get(typeId)
}

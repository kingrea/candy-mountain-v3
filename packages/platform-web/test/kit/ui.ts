import { defineComponent, h, toValue, type Component, type VNodeChild } from 'vue'
import type { RouteLocationRaw } from 'vue-router'
import { harness } from './nuxt-app'

type Attrs = Record<string, unknown>

const TEXT_PROPS = ['title', 'label', 'description', 'placeholder'] as const
// Panels that only show when something opens them; a bound `open` decides, an unbound one always shows.
const OPENABLE = new Set(['UModal', 'USlideover', 'UDrawer', 'UPopover', 'UDropdownMenu', 'UContextMenu', 'UTooltip', 'UCollapsible'])

const scalar = (value: unknown) => ['string', 'number', 'boolean'].includes(typeof value)

/** Scalar props become attributes so a test can select on them; listeners pass through so clicks still work. */
function passthrough(attrs: Attrs): Attrs {
  const out: Attrs = {}
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'modelValue' || key.startsWith('onUpdate:')) continue
    if (scalar(value) || (key.startsWith('on') && typeof value === 'function')) out[key] = value
  }
  return out
}

function textNodes(attrs: Attrs): VNodeChild[] {
  return TEXT_PROPS.filter(prop => typeof attrs[prop] === 'string' && attrs[prop]).map(prop => h('span', { 'data-ui-prop': prop }, attrs[prop] as string))
}

function slotNodes(slots: Record<string, undefined | ((props: Attrs) => VNodeChild)>, props: Attrs = {}, only?: string[]): VNodeChild[] {
  return Object.entries(slots)
    .filter(([name, render]) => render && (!only || only.includes(name)))
    .map(([name, render]) => (name === 'default' ? render!(props) : h('div', { 'data-slot': name }, [render!(props)])))
}

function button(name: string, attrs: Attrs, children: VNodeChild[]) {
  const to = attrs.to ?? attrs.href
  const tag = to ? 'a' : 'button'
  return h(tag, {
    'data-ui': name,
    ...passthrough(attrs),
    ...(to ? { href: hrefOf(to) } : { type: (attrs.type as string) ?? 'button' }),
    ...(attrs.loading ? { 'aria-busy': 'true' } : {}),
    ...(attrs.disabled || attrs.loading ? { disabled: true } : {}),
  }, [...textNodes(attrs), ...children])
}

function hrefOf(to: unknown) {
  if (typeof to === 'string') return to
  try {
    return harness().router.resolve(to as RouteLocationRaw).href
  }
  catch {
    return JSON.stringify(to)
  }
}

/** Nuxt UI's `UEmpty`, which the gate's lockout states use: title, description or its slot, and the actions as buttons. */
const empty = defineComponent({
  name: 'UEmpty',
  inheritAttrs: false,
  setup(_, { attrs, slots }) {
    return () => {
      const actions = Array.isArray(attrs.actions) ? (attrs.actions as Attrs[]) : []
      return h('div', { 'data-ui': 'UEmpty', ...passthrough(attrs) }, [
        ...textNodes(attrs),
        ...slotNodes(slots, {}, ['description', 'default', 'actions']),
        ...actions.map(action => button('UButton', action, [])),
      ])
    }
  },
})

const input = (name: string, tag: 'input' | 'textarea') => defineComponent({
  name,
  inheritAttrs: false,
  setup(_, { attrs }) {
    return () => h(tag, {
      'data-ui': name,
      ...passthrough(attrs),
      value: attrs.modelValue ?? '',
      onInput: (event: Event) => (attrs['onUpdate:modelValue'] as ((value: string) => void) | undefined)?.((event.target as HTMLInputElement).value),
    })
  },
})

const toggle = (name: string) => defineComponent({
  name,
  inheritAttrs: false,
  setup(_, { attrs }) {
    return () => h('input', {
      'data-ui': name,
      type: 'checkbox',
      ...passthrough(attrs),
      checked: Boolean(attrs.modelValue),
      onChange: (event: Event) => (attrs['onUpdate:modelValue'] as ((value: boolean) => void) | undefined)?.((event.target as HTMLInputElement).checked),
    })
  },
})

const select = (name: string) => defineComponent({
  name,
  inheritAttrs: false,
  setup(_, { attrs }) {
    return () => {
      const items = Array.isArray(attrs.items) ? (attrs.items as unknown[]) : []
      const valueKey = (attrs.valueKey as string) ?? 'value'
      const labelKey = (attrs.labelKey as string) ?? 'label'
      const options = items.map((item) => {
        const record = typeof item === 'object' && item !== null ? (item as Attrs) : { [valueKey]: item, [labelKey]: String(item) }
        return h('option', { value: String(record[valueKey]), selected: record[valueKey] === attrs.modelValue, disabled: Boolean(record.disabled) }, String(record[labelKey] ?? record[valueKey]))
      })
      return h('select', {
        'data-ui': name,
        ...passthrough(attrs),
        onChange: (event: Event) => {
          const chosen = (event.target as HTMLSelectElement).value
          const item = items.find(candidate => String(typeof candidate === 'object' && candidate !== null ? (candidate as Attrs)[valueKey] : candidate) === chosen)
          const value = typeof item === 'object' && item !== null ? (item as Attrs)[valueKey] : item
          ;(attrs['onUpdate:modelValue'] as ((value: unknown) => void) | undefined)?.(value)
        },
      }, options)
    }
  },
})

/** `UForm` without validation: submitting calls the page's handler with the form state, as a valid submit would. */
const form = defineComponent({
  name: 'UForm',
  inheritAttrs: false,
  setup(_, { attrs, slots, expose }) {
    expose({ setErrors: () => {}, clear: () => {}, validate: () => Promise.resolve(toValue(attrs.state)), submit: () => submit() })
    const submit = () => (attrs.onSubmit as ((event: { data: unknown }) => unknown) | undefined)?.({ data: toValue(attrs.state) })
    return () => h('form', {
      'data-ui': 'UForm',
      ...passthrough(attrs),
      onSubmit: (event: Event) => {
        event.preventDefault()
        return submit()
      },
    }, slotNodes(slots))
  },
})

/** `UTable` as rows of cells: each column's `<id>-cell` slot with `{ row: { original } }`, else the accessor's value. */
const table = defineComponent({
  name: 'UTable',
  inheritAttrs: false,
  setup(_, { attrs, slots }) {
    return () => {
      const rows = (toValue(attrs.data) as Attrs[] | undefined) ?? []
      const columns = ((toValue(attrs.columns) as Attrs[] | undefined) ?? []).map(column => ({
        id: String(column.id ?? column.accessorKey),
        accessor: column.accessorKey as string | undefined,
        header: typeof column.header === 'string' ? column.header : String(column.id ?? column.accessorKey),
      }))
      return h('table', { 'data-ui': 'UTable', ...passthrough(attrs) }, [
        h('thead', [h('tr', columns.map(column => h('th', { 'data-column': column.id }, column.header)))]),
        h('tbody', rows.map((original, index) => h('tr', { 'data-row': index }, columns.map((column) => {
          const cell = slots[`${column.id}-cell`]
          const value = column.accessor ? original[column.accessor] : undefined
          return h('td', { 'data-column': column.id }, cell ? cell({ row: { original, index }, cell: { getValue: () => value } }) : (value == null ? '' : String(value)))
        })))),
        ...(rows.length ? [] : slotNodes(slots, {}, ['empty'])),
      ])
    }
  },
})

function generic(name: string) {
  return defineComponent({
    name,
    inheritAttrs: false,
    setup(_, { attrs, slots }) {
      return () => {
        if (name === 'UButton' || name === 'ULink') return button(name, attrs, slotNodes(slots))
        const open = !OPENABLE.has(name) || attrs.open !== false
        return h('div', { 'data-ui': name, ...passthrough(attrs), ...(OPENABLE.has(name) ? { 'data-open': String(open) } : {}) }, [
          ...textNodes(attrs),
          ...(open ? slotNodes(slots) : slotNodes(slots, {}, ['default'])),
        ])
      }
    },
  })
}

const SPECIAL: Record<string, Component> = {
  UEmpty: empty,
  UForm: form,
  UTable: table,
  UInput: input('UInput', 'input'),
  UTextarea: input('UTextarea', 'textarea'),
  UCheckbox: toggle('UCheckbox'),
  USwitch: toggle('USwitch'),
  USelect: select('USelect'),
  USelectMenu: select('USelectMenu'),
  URadioGroup: select('URadioGroup'),
}

/** A stand-in for a Nuxt UI component: its text props, slots and listeners, none of its behaviour. */
export function uiStub(name: string): Component {
  return SPECIAL[name] ?? generic(name)
}

const link = defineComponent({
  name: 'NuxtLink',
  inheritAttrs: false,
  setup(_, { attrs, slots }) {
    return () => h('a', { ...passthrough(attrs), href: hrefOf(attrs.to ?? attrs.href ?? '') }, slotNodes(slots))
  },
})

const slotOnly = (name: string) => defineComponent({ name, setup: (_, { slots }) => () => slots.default?.() ?? null })
const nothing = (name: string) => defineComponent({ name, setup: () => () => null })
const image = (name: string) => defineComponent({ name, inheritAttrs: false, setup: (_, { attrs }) => () => h('img', passthrough(attrs)) })

/** Nuxt's own components a page may use; none of them does what Nuxt's would. */
export const nuxtComponents: Record<string, Component> = {
  NuxtLink: link,
  ClientOnly: slotOnly('ClientOnly'),
  NuxtLayout: slotOnly('NuxtLayout'),
  NuxtErrorBoundary: slotOnly('NuxtErrorBoundary'),
  ColorScheme: slotOnly('ColorScheme'),
  NuxtPage: nothing('NuxtPage'),
  NuxtLoadingIndicator: nothing('NuxtLoadingIndicator'),
  NuxtRouteAnnouncer: nothing('NuxtRouteAnnouncer'),
  DevOnly: nothing('DevOnly'),
  NuxtImg: image('NuxtImg'),
  NuxtPicture: image('NuxtPicture'),
  Icon: defineComponent({ name: 'Icon', inheritAttrs: false, setup: (_, { attrs }) => () => h('span', { 'data-ui': 'Icon', ...passthrough(attrs) }) }),
}

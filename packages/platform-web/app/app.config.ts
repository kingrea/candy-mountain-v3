import { PRODUCT } from '../shared/utils/product'

export default defineAppConfig({
  ui: {
    colors: {
      primary: PRODUCT.theme.primary,
      neutral: 'neutral',
    },
    dashboardGroup: {
      base: 'bg-canvas',
    },
    dashboardSidebar: {
      slots: {
        root: 'm-2 rounded-xl bg-shell',
        header: 'px-3',
        body: 'gap-6 px-3 py-3',
        footer: 'px-3 py-3',
        // Keep the resize target on the panel edge, inside its outer gutter.
        handle: 'my-2 -ms-2 me-2',
      },
      variants: {
        side: { left: { root: 'border-e-0' } },
      },
    },
    dashboardPanel: {
      slots: {
        root: 'bg-canvas',
        body: 'gap-6 p-4 sm:p-6 lg:p-8',
      },
    },
    dashboardNavbar: {
      // AppHeader owns the mobile sidebar toggle, so page navbars must not render a second one.
      slots: {
        root: 'h-auto min-h-16 flex-wrap gap-3 border-b-0 px-4 py-4 sm:px-6 lg:px-8',
        title: 'text-lg font-semibold tracking-tight',
        right: 'flex-wrap gap-2',
        toggle: 'hidden',
      },
    },
    navigationMenu: {
      slots: {
        label: 'font-medium text-muted',
        link: 'gap-2 font-normal',
        linkLeadingIcon: 'size-4',
      },
    },
    card: {
      slots: {
        root: 'rounded-xl',
        header: 'p-4 sm:p-5',
        body: 'p-4 sm:p-5',
        footer: 'p-4 sm:p-5',
      },
    },
    button: {
      slots: { base: 'rounded-lg' },
    },
    input: {
      slots: { base: 'rounded-lg' },
    },
    select: {
      slots: { base: 'rounded-lg' },
    },
    selectMenu: {
      slots: { base: 'rounded-lg' },
    },
    textarea: {
      slots: { base: 'rounded-lg' },
    },
  },
})

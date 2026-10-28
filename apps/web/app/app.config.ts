export default defineAppConfig({
  ui: {
    colors: {
      primary: 'pink',
      neutral: 'slate',
    },
    dashboardNavbar: {
      // AppHeader owns the mobile sidebar toggle, so page navbars must not render a second one.
      slots: { toggle: 'hidden' },
    },
  },
})

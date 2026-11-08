# Product theme and capability styling: overview

## Goal

A product defines its own look in its product configuration, and a capability styles only what it brings. At the end, a distribution with a brand colour that is not in Tailwind's palette, its own typeface, its own logo and its own default colour mode runs on an unmodified platform, and a capability package that tries to restyle the shell or another capability fails lint before it ships.

This plan is done in this repository before `.ai-docs/plans/platform-package/` phase 1 moves the platform out, so the base ships with a theme contract rather than growing one per product. Phase 3's product scaffold emits the theme fields, and phase 4's home dashboard is the first product to prove them.

Why now: the shell today takes one Nuxt UI colour name from the product and owns everything else. Its neutral palette, radii, typeface and dark values are fixed in the shell's stylesheet, the Candy Mountain logo is hardcoded in the header and login page, and a product's primary colour must be one of Tailwind's built-in palettes because nothing lets a product declare a colour scale of its own. Capability layers inherit the shell's look by convention, and nothing stops a layer shipping a global stylesheet that changes everyone else's. Both gaps bite the first product that is not Candy Mountain.

## Explicit requirements

These are constraints from Jack, not choices to revisit.

- Everything about a product's look is definable in the product: colours, neutral scale, typeface, logo, colour mode, component defaults, and a stylesheet for whatever the named fields do not cover.
- A capability may bring styling for the components it brings. It may rely on the base UI entirely, or override only its own pieces.
- A capability can never change anything globally: no shell variable, no `--ui-` value, no other capability's look. Its CSS is scoped to its own concern, and the platform enforces that rather than trusting the author.

## Decisions

| Decision | Default | Why |
|---|---|---|
| Where the theme lives | The product configuration's theme section grows from one colour to the full set: the Nuxt UI colour aliases (primary, neutral, and the optional secondary, success, info, warning, error), the theme hex for the manifest, the logo, the default colour mode and whether the user may switch it, and a product stylesheet. | The product file already names the product and its scope; the look belongs beside them. Both apps read it, so the manifest, the header and the login page all agree. |
| Custom colours | A colour alias names a Tailwind palette or a scale the product stylesheet declares itself. The stylesheet is a file the distribution owns and hands to the shell the same way it hands over the product configuration; the shell loads it after its own. | Nuxt UI resolves aliases against Tailwind's colour theme, so a brand colour needs a scale declared in CSS. Loading the product's sheet last means it can also override any shell variable without the shell knowing. |
| The shell's variables are the contract | The surface, text, border, radius and app-chrome variables in the shell's stylesheet, in both colour modes, are documented as the token list a product may set. The shell stops treating them as private. | A theme that augments the base needs to know what the base exposes. Documenting the existing set costs nothing and makes a product theme reviewable. |
| Typeface | Set in the product stylesheet through the sans and mono font variables; the fonts module Nuxt UI already brings fetches a named family. | No new field, no new module. |
| Logo | A product field with the shape the plugin icons use: an icon name or an image asset with classes. The shell renders it wherever it renders the product name today; the hardcoded mountain goes. PWA icon files stay in the distribution's public directory as they are. | One shape for "an icon or an image" already exists in the shell. |
| Component defaults | Shell defaults stay in the shell's app config. A product changes them from the distribution's own app config, which Nuxt already lets win over every layer. Documented, not built. | The mechanism exists; it only needs to be named as the product's. |
| Capability styling: what is allowed | Per-instance overrides on Nuxt UI components, components the layer wraps under its own prefix, scoped style blocks, and the layer's own custom properties named with its prefix and set on its own root elements, derived from the shell's variables so a product theme flows through them. | Every one of these reaches only markup the layer renders. Deriving from shell variables keeps a capability inside the product's look instead of beside it. |
| Capability styling: what is forbidden | A stylesheet registered through the layer's config, an unscoped or `:global` style block, selectors on the document root, body or the colour-mode class, assignment of any shell or Tailwind theme variable, Tailwind theme, base-layer or utility declarations, and the Nuxt UI key in a layer's app config. | CSS has no sandbox, so the boundary is what a layer is allowed to write. These are the forms that reach past the layer's own markup. A layer app config may still contribute to the shell's own registration keys, as the chat and project-home contributions do today. |
| Enforcement | The layer-boundaries lint gains a rule for the forbidden forms, covering style blocks, imported stylesheets, layer config and app config, and the fixture app gains a layer that commits each one. | The existing lint already knows which files belong to which layer and runs on every capability package from its own root. A test in the fixture keeps the rule honest. |
| A product restyling a capability | Allowed, through the product stylesheet, by setting the capability's prefixed variables. Nothing else. | The product owns the whole look; the capability's variables are its published knobs. |

## What and why

**The product theme.** Extend the product configuration so a product can say everything about its look, and make the shell read all of it: colour aliases into Nuxt UI's colour config, the hex into the manifest and meta, the logo into the header and login page, the colour mode into the colour-mode module's default and the toggle's visibility. Load the product's stylesheet after the shell's so it can declare colour scales and fonts and override shell variables. Move the Candy Mountain mountain icon out of the shell and into its product file, so the shell names no product. Document the shell's variable set as the theme contract in the web conventions document, with an example product stylesheet that declares a custom colour scale, a typeface and a dark-mode override. Give the platform-web playground product a theme that uses every field, with a colour that is not a Tailwind palette, so the contract has a running example inside the base.

*Human test:* start the playground and see its brand colour on buttons, links and focus rings, its typeface, its logo in the header and on the login page, and its chosen default colour mode, with the manifest reporting its hex. Start Candy Mountain and confirm pink, the mountain and the system font are unchanged and that the shell contains no reference to either. Remove the playground's stylesheet and confirm the build fails naming the undeclared colour.

**Capability-scoped styling.** Write the capability styling rules into the web conventions document: what a layer may do to style its own components, what it may never do, and how to derive a layer's variables from the shell's so a product theme and a product override both reach it. Add the lint rule that refuses the forbidden forms, with a fixture layer that commits each one and a test proving each is named. Apply the convention in one existing capability as the worked example, with a layer variable the product stylesheet can override.

*Human test:* run lint on the fixture and see each forbidden form named with a message pointing at the conventions document. In the worked-example capability, override its variable from the Candy Mountain product stylesheet and confirm only that capability changes; then try a global override from the capability itself and confirm lint refuses it from the capability's own root and from the app.

The two capabilities are independent and can be built alongside each other.

## Human test

With both landed, build a scratch distribution that extends the shell with a custom colour scale, a typeface, a logo, a dark default and one capability whose variable the product overrides. Confirm every element of the look comes from the product's files, the shell's package is untouched, and the capability's package lints clean on its own. Then put a shell variable assignment into that capability's stylesheet and confirm lint names it.

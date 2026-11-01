# Platform package: overview

## Goal

The platform packages leave the Candy Mountain repository, get a name and a version, and are consumed from a private registry by Candy Mountain, a new home dashboard and later the digital hub. The base is proven by a product that is not Candy Mountain, including the single-scope mode the home dashboard needs. At the end, starting a new product or a client-specific capability means a new repo with two short files and a template to copy.

This plan starts where `.ai-docs/plans/platform-extraction/` ends: the repo already has platform packages, capability packages and thin apps, and nothing is published.

## Explicit requirements

These are constraints from Jack, not choices to revisit.

- The base is a separate repository that neither Candy Mountain nor the digital hub is.
- Packages are never public. The registry is private to the company; client-specific capabilities live in client repositories and are installed only by that client's distribution.
- Capabilities stay unpublished workspace packages inside each product. A capability becomes a published package only when a third product wants it, and copy-paste between products is acceptable before then.
- The scope entity stays in the model; single-scope products hide it.
- The base's product name and npm scope are Jack's to choose before phase 1 starts. Phase documents say "the platform" and `@scope/platform-*` until then.

## Decisions

| Decision | Default | Why |
|---|---|---|
| Registry | GitHub Packages under the company organisation, since the repos live on GitHub. Consumers authenticate with a read-only token in their npm config locally and in CI. | Zero infrastructure, private by default, and pnpm treats it as any registry. Verdaccio is the fallback if the token handling grates. |
| Versioning | Changesets. Every platform package shares one version line and releases together. Semver is meant: a breaking change to the SDK is a major. | Lockstep versions mean a consumer pins one number. Independent versions for five packages that always change together is bookkeeping with no benefit. |
| Compatibility | A capability package declares the SDK major it was built against as a peer dependency, and the SDK exports its version. The daemon checks every capability definition against it at boot and refuses to start with a message naming the package and both versions. | Backstage's compatibility table is the reason third-party plugins survive upgrades. A boot-time check is the smallest version of that discipline. |
| Moving the code | Git subtree split of the platform packages so their history comes along; the capability packages stay. | Cheap, and blame survives. A plain copy is acceptable if the split fights back. |
| Developing across repos | A documented script that points a product at a local checkout of the base through pnpm overrides, and undoes it. CI never uses it. | This is the daily tax of separate repos. It must be one command each way or people will stop doing it. |
| What the base repo contains | The platform packages, the template capability, the test kit, the conventions documents, and a development distribution that runs the platform with the template capability alone. | The base must be runnable on its own or it cannot be tested on its own. |
| Standard capabilities | Uptime and the Slack connection plugin type are the first candidates to ship from the base repo as optional packages. Not in this plan. | Decide when the digital hub asks for them. Before that, they are Candy Mountain's. |
| Single-scope mode | Product configuration. The daemon creates the default workspace at boot when none exists; the shell hides the picker, auto-selects the one workspace and redirects the root into it; the scope label is not shown. The URL prefix stays. | Keeping the scope in the model is the requirement; this is the smallest UI that honours it. The URL prefix is cosmetic and is decided after the home dashboard exists. |
| Home dashboard | A new product repo: distribution plus one capability (recipes) built from the template. | The home dashboard is single-scope, has no bots or repos, and wants chat with a native agent, so it exercises exactly the parts of the base Candy Mountain does not. |
| Digital hub | Becomes a distribution of the platform with its capabilities ported one at a time. Scoped loosely here; its own plan when it starts. | The hub's capability and grant model is where the platform's came from, so the port is mostly moving code, but its chat runs on a different stream contract and its uptime differs, and those need their own decisions. |

## Phases

| # | Phase | Depends on | Can run alongside |
|---|---|---|---|
| 1 | The base repository: move, name, release, runnable on its own | — | — |
| 2 | Candy Mountain consumes the release, with a cross-repo development loop | 1 | — |
| 3 | Compatibility contract and new-capability scaffold | 2 | 4 |
| 4 | Home dashboard: the first single-scope product | 2 | 3 |
| 5 | Digital hub as a distribution (loose) | 3, 4 | — |

Each phase document ends with its human test. Decompose phases with the `plan-decomposition-into-beads` skill one at a time, in order. Phases 1 and 2 are small and can be decomposed together.

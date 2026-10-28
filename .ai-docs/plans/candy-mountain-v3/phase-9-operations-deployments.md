# Phase 9: Operations: deployments (loose)

**Capability:** Per project, I can see what is live and kick off a deploy of a branch to an environment through whichever vendor the project uses.

This phase is deliberately open. Jack will refine it when he reaches it; decompose only the parts marked firm.

## What and why

**Netlify and Heroku plugins (firm).** Two more plugin types, per project, each holding an API token as a secret and the site or app identifiers. Health means the token can read the site or app. The Repository plugin already covers GitHub and Bitbucket.

**Live version (firm shape, open sources).** The Deployments page shows, per environment, what is currently live: version or commit, branch, deployed at, and a link. Where it comes from depends on the vendor: Netlify and Heroku both expose the current deploy with its commit through their APIs, so read it from the plugin when present. For projects that expose their own debug or version endpoint, let the project define an environment with a URL and a mapping from that endpoint's JSON to the same fields. Define the common shape once and let each source fill it.

**Deploy zone (open).** A control that lets Jack pick a branch (from the Repository plugin) and an environment and press Deploy. Each vendor needs its own strategy: trigger a Netlify build hook, push a branch to a Heroku app or trigger a pipeline promotion, dispatch a GitHub Actions workflow, trigger a Bitbucket pipeline. Some projects deploy on push to a branch and need no trigger at all, only a record. Build the zone so each environment declares its strategy and the strategies are added one at a time, starting with whichever project Jack wants first. Every deploy attempt writes an activity event with the outcome.

## Human test

Configure Netlify for a project and confirm the live version shows the current deploy's commit and branch. Configure a second environment from a project's own version endpoint and confirm the same fields render. For one environment with a working strategy, pick a branch, deploy, and confirm the vendor shows the build and the activity feed records it.

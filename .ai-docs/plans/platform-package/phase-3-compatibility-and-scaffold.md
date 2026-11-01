# Phase 3: Compatibility contract and scaffold

**Capability:** A capability built against the wrong SDK major is refused at boot with a clear message, and a new capability or a new product starts from a scaffold rather than a blank directory.

## What and why

**The compatibility check.** Each capability package declares the SDK major it targets as a peer dependency and carries that version in its definition. The daemon compares every definition's declared SDK against the SDK it is running and refuses to start when the majors differ, naming the package, its SDK and the platform's. The web side gets the same check at build time through the layer list, so a mismatched layer fails the build rather than the browser. The base's changelog states, for every major, what a capability author must change.

**The scaffold.** The template capability from the extraction plan becomes a generator in the base: a command that creates a new capability package in the current workspace with the chosen id and label, both entry points, a passing test and the README. A second generator creates a new product distribution: a repo skeleton with the two thin apps, product configuration, the pipeline, registry authentication and one capability from the first generator. These are the two things a client engagement starts from, and the second is what the digital hub and the home dashboard are created with.

**Conventions as the contract.** The daemon and web conventions documents move into the base's documentation along with the capability author's guide. They state the directions a capability may import, the contribution points it may use, what the platform promises to keep stable across minors, and what it does not.

## Human test

Generate a capability into Candy Mountain, add it to both apps and see it running. Change its declared SDK major and confirm the daemon refuses to start naming it, and the web build fails naming it. Generate a product distribution into an empty directory, add one generated capability, run its pipeline and start it with the placeholder name and the capability's page showing.

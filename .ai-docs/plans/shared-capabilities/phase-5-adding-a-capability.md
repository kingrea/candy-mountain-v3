# Phase 5: one command adds a capability, and a catalogue lists them

Repositories: `crab-shack/platform` for the command, `crab-shack/capabilities` for the catalogue. Depends on phases 1 and 3. Can run beside phase 4.

## Adding a capability

Adding a capability to a product today is four edits in four files: a dependency in each app, an entry in the daemon's definitions, and ids in the product file. Each is checked, so a missed one names itself, but it is still a chore, and a capability that needs others multiplies it. Picking a capability should feel like installing a package.

Give products one command that adds a published capability by id: it installs the package at its current version, makes every edit the product needs, and does the same for everything that capability needs and the product does not have yet, saying what it added. Afterwards the product's gates pass and the capability's pages are reachable. It refuses, with the reason, a capability that does not exist, one already present, and one whose SDK major is not the product's.

Two things it does not decide for the product: which module a feature appears under, and any setting without a default. It says what is left to do, as `platform-new` does.

The command needs each capability to describe itself well enough to be added without reading its source: its id, its layer, the plugin type it brings, what it needs. Where a published package does not yet carry that, add it in the capabilities repository.

Removing a capability stays the documented reverse. A remove command is out of scope until someone wants it.

## The catalogue

Someone starting a product needs to see what exists before choosing. The capabilities repository's README lists every published capability and connection: what it does in a sentence, what it needs, and its current version. The list is generated from the packages, not written by hand, so it cannot drift. The same list is available from the command line in a product.

## Human test

Generate a product with `platform-new product`. List the available capabilities from inside it. Add the Claude Code chat capability with one command and confirm it brought the ACP runtime and the Claude Code and repository connections with it and said so. Run the gates green, start the product, put the capability in a module, and open its page. Run the same command again and confirm it refuses because the capability is already there.

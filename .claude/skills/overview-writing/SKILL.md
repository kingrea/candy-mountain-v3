---
name: overview-writing
description: "Write a blog-style HTML overview of a slice of migration work (a commit range and its closed beads) into ai-docs/stripe-migration/overviews/, reusing the shared overview.css. Use when asked for an overview, recap, or blog-post-style summary of recent work."
---

# Writing a work overview

An overview is a standalone HTML page that reads like a good engineering blog post: it
tells someone who stepped away what was built, how it works, and why it was built that
way — objectively, including honest criticism. The reader is Jack (or a future dev)
catching up on work that was largely done by agents, so the page must stand on its own
with no access to the chat that produced it.

## Voice — teach, don't sell (the part that matters most)

The register is an explainer: a knowledgeable colleague getting someone up to speed on an
interesting topic, the way a good blog post about someone else's system would. The failure
mode to avoid is the "impressive summary" — triumphant framing, punchy fragments,
adjectives doing the work of explanation. If a sentence exists to make the work sound good
rather than to help the reader understand it, rewrite or cut it. Enthusiasm is fine when
it's the reader's ("here's the neat part"), not the author's ("perhaps the most satisfying
part").

- **Simple model first, then dive.** Before any section gets granular, hand the reader a
  small mental model to hang the detail on — e.g. "when a payment goes wrong, the customer
  ends up in one of three channels: retry here, wait and see, or start over with a fresh
  cart; everything below is plumbing for those three." State the model in a couple of
  sentences, then descend. A reader who got lost in the code should be able to read the
  model paragraph alone and come away with the shape.
- **Use analogies freely** where the mapping is honest — a frozen cart as a signed order
  form, the webhook as the bank's own confirmation letter versus the customer's word, a
  lock TTL as a parking meter. One good analogy per mechanism; drop it once the real terms
  are established.
- **Weave the story.** Where the history has a narrative — something was tried, a test
  found a bug nobody expected, a fix taught a lesson — tell it in order as events, not as
  a bulleted achievements list. Chronology is the most digestible structure there is.
- **Approachable and high-level.** Explain what's happening; never regurgitate code.
  Plain-English mechanism beats function names. Introduce a term of art once, in words,
  then use it freely.
- **Lead with why.** Open with the motivation and the numbers behind it before any
  mechanics. Every section should answer "why did this work exist?" before "what is it?".
- Small code blocks are allowed **only when they say something prose can't** (e.g. a
  before/after of an API contract). Err heavily toward none.
- **Candid weight assessment is mandatory.** Jack explicitly wants a section calling out
  anything verbose, duplicated, or heavier than needed — and, for balance, what is *not*
  bloated despite its size. Be specific (line counts, percentages) and fair.
- Decorative, content-unrelated placeholder images are welcome to break up long text;
  diagrams of real mechanisms are better still. Both are inline SVG (no external assets).
- en-AU spelling in prose (fulfilment, behaviour), matching the plan docs.

## Sourcing — where the story comes from

Mine three sources and reconcile them; the overview's authority comes from doing all
three, not one:

1. **The commit range** — `git log --stat` for shape, plus reading the key files the
   range touched. For a large range, fan out subagents: one to digest the closed beads,
   one to read the implementation and assess verbosity. Don't write from commit messages
   alone.
2. **The beads** — `bd show` every closed bead in scope. Descriptions carry the *why*
   (design constraints, invariants); close notes and comments carry discoveries,
   deviations, and bugs found. Quote-worthy rationale usually lives here.
3. **The plan docs** — `ai-docs/stripe-migration/*.md` for framing, decisions, and the
   phase context the work sits in.

While writing, if you find actionable problems (drift between docs and code, dead code,
untracked follow-ups), **file a bead for each at write time** and cite the bead id in the
overview — a criticism with no tracker entry gets lost (this rule exists because it
happened).

## File conventions

- Page: `ai-docs/stripe-migration/overviews/YYYY-MM-DD-<slug>.html` (date = writing day).
- Stylesheet: link `overview.css` from the same directory. **Reuse it unchanged** so the
  series looks uniform; if a new element genuinely needs styling, extend the shared sheet
  additively — never fork per-page styles and never restyle existing classes.
- Full standalone document: `<!DOCTYPE html>`, `<html lang="en-AU">`, `<title>`, then
  everything inside `<main class="article">`.

## Page structure (the house style)

The stylesheet provides these pieces — use them in roughly this order:

1. **Masthead** (`.masthead`): `.eyebrow` series label ("Stripe migration · overview
   series"), an `<h1>` with a real title (not "Overview of commits"), a `.standfirst`
   that plainly states what the piece covers and what the reader will understand by the
   end, and a `.byline` `<dl>` of pairs: branch, commit range + count, dates,
   epic/phases, beads closed.
2. **Why section** with a `.stat-row` of `.stat` tiles (`.bad` variant for the grim
   numbers) — the motivating metrics up front.
3. **One section per phase/theme**, heading carrying `<span class="phase-no">` when the
   content really is a sequence. `.section-lede` opens with the section's simple mental
   model (see Voice); only then the mechanism, "the guards in plain English", and what
   was deliberately *not* done.
4. **Diagrams** in `<figure><div class="diagram breakout"><svg …>` — hand-authored SVG,
   `currentColor` for strokes/text so both themes work, `var(--accent)`/`var(--decline)`
   only for meaning-carrying marks, `<figcaption>` with `<span class="fig-no">` stating
   the figure's one claim, `role="img"` + `aria-label` on the svg. Draw the mechanism the
   argument hinges on (who talks to whom, what never crosses a boundary), not box art.
5. **Interludes** (`.interlude .breakout` figures): 1–2 decorative abstract SVG images
   with a self-coloured palette (they must sit on both light and dark grounds) and a
   playful caption acknowledging they're placeholders.
6. **Callouts** (`.callout`, variants `.caution`/`.decline`) for postures, decisions, and
   warnings; `.pull` for a single pull-quote if one earns it.
7. **"Honest notes on weight"** — the candid section (see above).
8. **"Where this leaves us"** — progress against the wider plan plus loose ends worth
   keeping visible (owed secrets, deferred beads, open business calls).
9. **Footer** (`<footer>` inside the article): sources (commit range, epic, plan docs),
   the writing date, and a note that styling is shared via `overview.css`.

## Verify before finishing

Screenshot the page headless in **both themes** and look at the result — layout, stat-row
wrapping, diagram legibility, dark-mode contrast. From `apps/baby-bunting` (Playwright
lives there): `npx playwright screenshot --full-page --viewport-size=1280,900
"file://<abs path to page>" <scratch>/light.png`. For dark mode and per-figure close-ups,
a short node script with `colorScheme: 'dark'` against the workspace's playwright package
works. Fix what looks wrong; don't ship unseen.

Optionally publish a private artifact copy for easy sharing: inline `overview.css` into a
`<style>` block, keep only the `<title>` + `<main>` content, and strip repo-relative
links (they can't resolve on the artifact host). Previous overviews' artifact URLs are
listed in the artifact gallery — republish to the same URL only when updating that same
overview, otherwise publish fresh.

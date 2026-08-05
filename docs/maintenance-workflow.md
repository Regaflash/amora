# Upgrading, improving and fixing — the workflow

Written after an audit, not from memory, and re-audited before each revision.
The honest headline is unchanged: this codebase does not need a cleanup wave,
and a workflow that invented one would be busywork. What it needs is a
discipline against **two** failure modes that have now produced fifteen
incidents between them, plus a short backlog that is entirely someone else's
to unblock.

## Status — re-verified 2026-08-05, second pass

| Checked | Result |
| --- | --- |
| `tools/check.sh` | exit 0 — **21 checks plus one phone-format count**, 22 output lines |
| `node tools/verify.mjs` | 43/43 in a real browser |
| `TODO` / `FIXME` / `HACK` in our code | none — every hit is inside vendored three.js |
| `console.log` left in shipped JS | none |
| `<img>` without `alt` | none — the two grep hits are inside HTML comments |
| `[להשלים]` markers | 9, across the three legal pages |
| `mailto:` anywhere on the site | none |
| Rows in `public.leads` | **0** — the three test rows were deleted by id, verified after |

Two of those lines moved since the first revision and both are recorded
rather than quietly overwritten. `public.leads` was 3 and is now 0. The check
count read "22 checks" here and "22 checks + a phone-format count" in
`CLAUDE.md`, which implied 23; the truth is 21 assertions and one
informational count. Off by one, in a document about numbers being wrong.

## Failure mode one — a claim nobody checks

Ten times now, a sentence that read as a guarantee was not one. Every entry
was true-sounding, sat in a document, and was verified by nothing:

1. **The FAQ byte-lock.** `CLAUDE.md` asserted the FAQ answers matched the
   FAQPage JSON-LD long before any script compared them. They happened not to
   have drifted, which was luck rather than a mechanism.
2. **`hide-toolbar`.** Claimed to remove the toolbar; nothing asserted it.
3. **`assistant.js` coverage.** The memory said it loaded on every page. It
   loaded on two.
4. **Lead alerts, "wired, not aspirational".** For months there was no trigger
   and no deployed Edge Function, while the site promised a same-day reply in
   six places.
5. **The column-scoped `INSERT` grant.** Three columns the form posts were
   missing from it. **Every submission from the live form failed for a day**
   while the RLS policy looked perfect and the table sat empty.
6. **"Vercel holds the domain".** It does not. Hostinger does — which made a
   documented instruction impossible to carry out.
7. **"19 checks, 28 runtime checks".** The real numbers were 22 and 43.
8. **"The repo cannot be pushed to from this environment".** Contradicted by an
   entire session of pushes.
9. **`.skip-link`.** Styled globally from the start, emitted on two of seven
   pages. `accessibility.html` shipped without one.
10. **"`gen-sitemap.py` derives `lastmod` from mtime".** It does not — it uses
    `git log -1 --format=%cs`, with mtime only as a fallback. That sentence
    was written **into this document**, whose whole thesis is not to write
    claims you have not verified. The failure mode does not exempt the person
    describing it.

Note what is *not* on that list: a bug someone wrote. Every entry is a claim
that drifted while every existing check kept passing, because no check was
looking.

## Failure mode two — CSS that stops applying without erroring

Newer, and it cost three defects in a single change on 2026-08-05, when the
assistant launcher and the accessibility trigger were moved into the header
bar:

11. **The border vanished.** `border-width` was set without `border-style`, so
    it computed to `0px none`. The style had come from a rule scoped to the
    old ancestor.
12. **The shape stopped tracking the header**, leaving one circle in a row of
    rectangles after the first scroll.
13. **No focus ring was drawn on the accessibility control.**
    `.a11y-fab:focus-visible` still *matched* — but painted
    `var(--a11y-on-accent)`, a custom property **declared on `.a11y-ui`**.
    Outside that subtree it resolved to nothing, the colour was invalid, and no
    outline was painted at all. On the one control whose entire purpose is
    keyboard and assistive access.

**Moving an element out of an ancestor silently drops the rules scoped to it
and the custom properties declared on it.** Nothing errors. The console stays
clean. The element looks plausible.

Two rules follow:

- **After relocating any element in the DOM, read its computed styles** —
  border, radius, colour, background, and the focus ring — and compare them
  against the sibling it is meant to match. `getComputedStyle` in a real
  browser, not a screenshot.
- **Restate what the move dropped explicitly**, rather than relying on a rule
  that used to reach it. Prefer literal values over inherited custom
  properties when the element has left the subtree that declares them.

The screenshots showed all three defects as fine. `verify.mjs` caught the one
that mattered.

## Measure, don't eyeball

Same change, same day, three more findings the eye passed and numbers did not:

- The logo was **crushed to 30px at 360px and to zero at 320px** once two more
  44px controls joined the bar. Invisible at 390px, where it looked correct.
- The launcher sat at **`[-38..6]`** at 320px — entirely off the left edge of
  the screen.
- The centred desktop nav was **35px off the page's true centre at every
  width**, which is exactly half the logo plus the bar's gap. It read as
  centred and was not.

None of these produced an error, a failed check, or an obviously broken
screenshot. All three were one `getBoundingClientRect()` away.

**When a change touches layout, measure it at the widths that matter** — 320,
360, 390 for phones; 761 (the tightest desktop case, just above the breakpoint)
through 1920 for desktop — and assert on positions, not impressions.

## The rule

**A guarantee written down is not a guarantee that runs.**

When you rely on an invariant, one of two things must be true: either a script
enforces it, or you have just verified it yourself in this session. Reading it
in `CLAUDE.md` is neither.

- **Verify the fact first**, with a command whose output you can see. Read the
  file, run the parser, query the database. Cheap, and it is how seven of the
  ten above were caught.
- **If the invariant matters and nothing enforces it, add the enforcement in
  the same change.** That is how `check.sh` grew to 21 checks and `verify.mjs`
  to 43.
- **When a documented fact turns out to be wrong, fix the document in the same
  commit.** Leaving it for later is how it survived long enough to mislead.

Repo state is not deploy state, and neither is database state. `check.sh`
reads files; it cannot see a missing Postgres grant or an undeployed function.
Those need their own verification queries.

## The change loop

1. **Verify what you are about to rely on.** Not from memory, not from this
   file.
2. **Make the change.** Follow the per-page checklist in
   `docs/seo-workflow.md` if it adds or edits a page — every item there is a
   trap already paid for once.
3. **If it moved an element, diff its computed styles against its new
   siblings.** If it touched layout, measure at the widths above.
4. **`tools/check.sh` exits 0** and **`node tools/verify.mjs` passes**. Both,
   every time. `verify.mjs` needs `npm install --no-save playwright-core
   pngjs` — in one command, because with no `package.json` a second
   `--no-save` install removes the first.
5. **Close the gap that let it drift**, if the change revealed one.
6. **Deploy, then fetch the live URL and look at it.** A screen that says
   "success" is not evidence; the page is.
7. **Update `CLAUDE.md`** with anything found to be wrong, in the same commit.

## Committing

`check.sh` can fail for reasons unrelated to what you touched — a
documentation-only commit has already done it. `lastmod` reflects **committed**
history, so committing a change to an HTML file moves that file's date and
leaves a sitemap generated beforehand stale. Regenerate afterwards and amend.

- **Run `check.sh` before every commit**, including ones that touch no site
  file.
- **Never chain it as `check.sh; git commit`.** The semicolon runs the commit
  regardless of the exit code, which is how a failing check has been reported
  as passing **twice** in this project. Use `&&`.
- **`lastmod` is a real SEO signal and it is currently honest.** Google ignores
  the field where it finds it inaccurate. Do not "fix" the generator to stamp
  today's date, and do not hand-edit the file.

## The backlog

**Nothing is left on this side.** The three test leads are deleted and
`public.leads` is empty, so the next row in it is a real enquiry.

**The owner's, and nothing in this repo substitutes for them:**

- **A Google Business Profile.** The largest single lever available, and the
  reason `docs/gbp-workflow.md` exists. The local pack renders above the
  organic results and no code produces it.
- **A business email on the site.** No `mailto:` anywhere in eight HTML files,
  and `privacy.html` and `accessibility.html` both carry `[להשלים]` where a
  contact route belongs. Those two are legal statements that must name one.
- **Legal review of the three drafts.** Nine `[להשלים]` markers and a visible
  banner on each.
- **A logo master of 512px or more.** `assets/img/logo.jpg` is 150×150. This
  used to be cosmetic; it now blocks two visible things — the Business Profile
  image, and installability, since `site.webmanifest` ships without a 512 icon
  because one would be upscaled garbage.
- **Venue names, dated real weddings, and written permission to attribute the
  three testimonials.** This is what unblocks case-study pages, and nothing
  else does.

Four of those five are the same shape: the site is finished around a hole only
the owner can fill. Do not paper over one by inventing content.

## Do not

- **Start a performance project.** Measured, not assumed: LCP 148ms mobile with
  the `<h1>` as the LCP element, CLS 0.001, 570 DOM nodes. There is nothing to
  win.
- **Introduce a framework, a build step or a CDN.** Declined by the owner, on
  the record.
- **Add a cookie banner.** No cookies, no analytics, and `privacy.html` says
  so. A banner would contradict the page it sits on.
- **Hand-edit a generated file.** `sitemap.xml`, the ImageGallery JSON-LD
  block, and the icon set each have a tool. Rerun it and let `check.sh`
  confirm.
- **Put a tag inside `.faq__a`.** It breaks the byte-lock. Links go in
  `.faq__more`.
- **Trust a smoke test run as `postgres`.** It ignores column-level grants
  entirely, which is exactly how the broken form shipped. Use
  `set local role anon`, or submit the real form.
- **Delete a feature to fix a visual complaint.** The hairline crossing the
  hero was the scroll-progress track, not trim; it was hidden over the hero and
  kept everywhere else. Find out what a thing does before removing it.

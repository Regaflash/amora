# Upgrading, improving and fixing — the workflow

Written after an audit, not from memory. The honest headline is that this
codebase does not need a cleanup wave, and a workflow that invented one would
be busywork. What it needs is a discipline against the one failure mode that
has now recurred nine times, plus a short backlog that is almost entirely
someone else's to unblock.

## Status — what an audit today actually finds

| Checked | Result |
| --- | --- |
| `tools/check.sh` | exit 0, 22 checks |
| `node tools/verify.mjs` | 43/43 in a real browser |
| `TODO` / `FIXME` / `HACK` in our code | none — every hit is inside vendored three.js |
| `console.log` left in shipped JS | none |
| `<img>` without `alt` | none — the two grep hits are inside HTML comments |
| `[להשלים]` markers | 9, across the three legal pages |
| `mailto:` anywhere on the site | none |
| Rows in `public.leads` | 3, all test submissions from 2026-08-04 |

Nothing in the first five rows needs work. Do not go looking for a refactor.

## The failure mode that actually matters

Nine times in this project's history, a sentence that read as a guarantee was
not a guarantee. Every one of them was true-sounding, sat in a document, and
was verified by nothing:

1. **The FAQ byte-lock.** `CLAUDE.md` asserted the FAQ answers matched the
   FAQPage JSON-LD long before any script compared them. They happened not to
   have drifted, which was luck rather than a mechanism.
2. **`hide-toolbar`.** Claimed to remove the toolbar; nothing asserted it.
3. **`assistant.js` coverage.** The memory said it loaded on every page. It
   loaded on two.
4. **Lead alerts, "wired, not aspirational".** For months there was no
   trigger and no deployed Edge Function, while the site promised a same-day
   reply in six places.
5. **The column-scoped `INSERT` grant.** Three columns the form posts were
   missing from it. **Every submission from the live form failed for a day**
   while the RLS policy looked perfect and the table sat empty.
6. **"Vercel holds the domain".** It does not. Hostinger does — which meant a
   documented instruction ("add a DNS record in Vercel") could not be carried
   out at all.
7. **"19 checks, 28 runtime checks".** The real numbers were 22 and 43.
8. **"The repo cannot be pushed to from this environment".** Contradicted by
   an entire session of pushes.
9. **`.skip-link`.** Styled globally in `styles.css` from the start, emitted
   on two of seven pages. `accessibility.html` — the page that argues for
   accessibility — shipped without one.

Note what is *not* on that list: a bug someone wrote. Every entry is a claim
that drifted from reality while every existing check kept passing, because no
check was looking.

## The rule

**A guarantee written down is not a guarantee that runs.**

When you rely on an invariant, one of two things must be true: either a script
enforces it, or you have just verified it yourself in this session. Reading it
in `CLAUDE.md` is neither.

Concretely, when a change depends on a documented fact:

- **Verify the fact first**, with a command whose output you can see. Read the
  file, run the parser, query the database. Cheap, and it is how six of the
  nine above were caught.
- **If the invariant matters and nothing enforces it, add the enforcement in
  the same change.** That is how `check.sh` went from 19 to 22 checks and
  `verify.mjs` from 28 to 43.
- **When a documented fact turns out to be wrong, fix the document in the same
  commit.** Leaving it for later is how it survived long enough to mislead.

Repo state is not deploy state, and neither is database state. `check.sh`
reads files; it cannot see a missing Postgres grant or an undeployed
function. Those need their own verification queries.

## The change loop

For any upgrade, improvement or fix, in this order:

1. **Verify what you are about to rely on.** Not from memory, not from this
   file.
2. **Make the change.** Follow the per-page checklist in
   `docs/seo-workflow.md` if it adds or edits a page — every item there is a
   trap already paid for once.
3. **`tools/check.sh` exits 0** and **`node tools/verify.mjs` passes**. Both,
   every time. `verify.mjs` needs `npm install --no-save playwright-core
   pngjs` — in one command, because with no `package.json` a second
   `--no-save` install removes the first.
4. **Close the gap that let it drift**, if the change revealed one.
5. **Deploy, then fetch the live URL and look at it.** A screen that says
   "success" is not evidence; the page is.
6. **Update `CLAUDE.md`** with anything found to be wrong, in the same commit.

## A trap this doc walked into while being written — and the wrong diagnosis

A documentation-only commit failed `check.sh` with `sitemap.xml לא מעודכן`, and
the first version of this section explained why: that `gen-sitemap.py` derives
`lastmod` from each file's mtime, and mtime drifts across git operations.

**That was wrong, and it was written into the document about not writing things
you have not verified.** The generator uses `git log -1 --format=%cs -- <path>`
— the committer date of the last commit that touched the file. mtime is only a
fallback for when git is unavailable. Checked against all three indexable
pages: every `lastmod` matches its `git log` date exactly.

The real mechanic is a sequencing one, and it is the generator behaving
correctly. `lastmod` reflects **committed** history, so committing a change to
an HTML file moves that file's date — which means a sitemap generated *before*
the commit is stale the moment the commit lands. Regenerate afterwards and
amend, or the next `check.sh` catches it.

Three consequences worth keeping:

- **Run `check.sh` before every commit, including ones that touch no site
  file.** The failure looks unrelated to what you changed.
- **Never chain it as `check.sh; git commit`.** The semicolon runs the commit
  regardless of the exit code, which is how a failing check has already been
  reported as passing twice in this project. Use `&&`, or run them as separate
  steps and read the output.
- **`lastmod` is a real SEO signal and it is currently honest.** Google ignores
  the field on sites where it finds it inaccurate. Do not "fix" the generator
  to stamp today's date, and do not hand-edit the file.

## The backlog, honestly split

**Mine, one command each:**

- Delete the three test leads from `public.leads`. They are the only rows in
  the table and they are not real enquiries.

**The owner's, and nothing in this repo substitutes for them:**

- **A Google Business Profile.** The largest single lever available, and the
  reason `docs/gbp-workflow.md` exists. The local pack renders above the
  organic results and no code produces it.
- **A business email on the site.** There is no `mailto:` anywhere in eight
  HTML files, and `privacy.html` and `accessibility.html` both carry
  `[להשלים]` where a contact route belongs. Those two are legal statements
  that must name one.
- **Legal review of the three drafts.** Nine `[להשלים]` markers and a visible
  banner on each.
- **A logo master of 512px or more.** `assets/img/logo.jpg` is 150×150. This
  used to be cosmetic; it now blocks two visible things — the Business
  Profile image, and installability, since `site.webmanifest` ships without a
  512 icon because one would be upscaled garbage.
- **Venue names, dated real weddings, and written permission to attribute the
  three testimonials.** This is what unblocks case-study pages, and nothing
  else does.

Four of those five are the same shape: the site is finished around a hole only
the owner can fill. Do not paper over one by inventing content.

## Do not

- **Start a performance project.** Measured, not assumed: LCP 148ms mobile
  with the `<h1>` as the LCP element, CLS 0.001, 570 DOM nodes. There is
  nothing to win.
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

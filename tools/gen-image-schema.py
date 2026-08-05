#!/usr/bin/env python3
# Regenerate the ImageGallery JSON-LD on the homepage from the gallery markup.
#
#   tools/gen-image-schema.py            # rewrite the block in place
#   tools/gen-image-schema.py --check    # exit 1 if the block is stale
#
# Why a generator: eighteen hand-written ImageObject nodes drift from the
# gallery the first time a photograph is swapped, and a caption that no longer
# matches the image it names is worse than no markup at all. Everything below is
# read out of index.html itself — the file is the source, the block is derived.
#
# What each property is, and why it is honest:
#
#   contentUrl        the largest derivative that actually exists on disk,
#                     checked before it is written.
#   caption           the photograph's own alt text, verbatim. Those alts are
#                     grounded in each tile's data-cat, so a photo filed under
#                     `events` is never captioned as a wedding.
#   creator           the studio Organization node, by @id. Not a person: the
#                     site does not publish the photographers' names, and
#                     inventing one to fill a schema field is exactly the kind
#                     of thing that gets caught later.
#   copyrightNotice   terms.html asserts copyright in these words.
#   license           terms.html, which is where the terms actually are.
#   creditText        how the photograph should be credited when it is shown.
#                     "Amora Studio" is simply true, and it is the same name
#                     already in copyrightNotice and on the Organization node.
#
# Deliberately NOT emitted: acquireLicensePage. Together with `license` it is
# what earns Google's "Licensable" badge, and that badge tells a searcher the
# image can be licensed. These are photographs of other people's weddings and
# the studio does not sell them. The badge would be a lie told in markup.
#
# SEARCH CONSOLE WILL ASK FOR IT ANYWAY. On 2026-08-05 it emailed
# "2 Image metadata structured data issues": missing acquireLicensePage and
# missing creditText. Both are flagged non-critical -- Google's own words are
# that they "don't prevent the page or feature from appearing".
#
# creditText was added, because it is true. acquireLicensePage was refused,
# because it is not: there is no page where a visitor can license these
# photographs, and pointing the field at terms.html to silence a warning would
# assert a service the studio does not offer. A structured-data warning is a
# suggestion from a crawler, not a defect report, and it does not outrank a
# decision about what the business actually sells. If this mail arrives again,
# the answer is still no -- and the remaining warning is the expected state,
# not an outstanding task.

import io, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAGE = os.path.join(ROOT, 'index.html')

BEGIN = '<!-- BEGIN generated image schema — tools/gen-image-schema.py -->'
END = '<!-- END generated image schema -->'

src = io.open(PAGE, encoding='utf-8').read()

canon = re.search(r'<link rel="canonical" href="([^"]+)"', src)
if not canon or 'SITE_URL' in canon.group(1):
    print('canonical is missing or still a placeholder'); sys.exit(1)
ORIGIN = canon.group(1).rstrip('/')

# One record per gallery tile: the slot id and the alt, in document order.
tiles = re.findall(
    r'<button class="masonry__btn"[^>]*?data-img="([^"]+)"[^>]*?>.*?'
    r'<img class="masonry__photo"[^>]*?alt="([^"]*)"',
    src, re.S)
if not tiles:
    print('no gallery tiles found — has the markup changed?'); sys.exit(1)

# Widths are per-slot, not global: the wide tiles were cut at 1100 and 1300 and
# g17 exists only at 600. Assuming a fixed width silently produced a contentUrl
# pointing at a file that is not there, so read the widest that actually exists.
items = []
for slot, alt in tiles:
    widths = []
    for name in os.listdir(os.path.join(ROOT, 'assets/img')):
        m = re.fullmatch(re.escape(slot) + r'-(\d+)\.jpg', name)
        if m:
            widths.append(int(m.group(1)))
    if not widths:
        print(f'no JPEG derivative on disk for slot {slot}'); sys.exit(1)
    rel = f'assets/img/{slot}-{max(widths)}.jpg'
    items.append((slot, alt, f'{ORIGIN}/{rel}'))


def esc(s):
    return s.replace('\\', '\\\\').replace('"', '\\"')


lines = [
    BEGIN,
    '<script type="application/ld+json">',
    '{',
    ' "@context": "https://schema.org",',
    ' "@type": "ImageGallery",',
    f' "@id": "{ORIGIN}/#gallery-schema",',
    ' "name": "רגעים מהעבודות שלנו",',
    ' "inLanguage": "he",',
    f' "isPartOf": {{ "@id": "{ORIGIN}/#website" }},',
    f' "about": {{ "@id": "{ORIGIN}/#business" }},',
    f' "numberOfItems": {len(items)},',
    ' "associatedMedia": [',
]
for i, (slot, alt, url) in enumerate(items):
    tail = '' if i == len(items) - 1 else ','
    lines += [
        '  {',
        '   "@type": "ImageObject",',
        f'   "@id": "{ORIGIN}/#img-{slot}",',
        f'   "contentUrl": "{url}",',
        f'   "caption": "{esc(alt)}",',
        f'   "name": "{esc(alt)}",',
        f'   "creator": {{ "@id": "{ORIGIN}/#business" }},',
        '   "copyrightNotice": "© Amora Studio",',
        '   "creditText": "Amora Studio",',
        f'   "license": "{ORIGIN}/terms.html"',
        '  }' + tail,
    ]
lines += [' ]', '}', '</script>', END]
block = '\n'.join(lines)

if BEGIN in src:
    start = src.index(BEGIN)
    stop = src.index(END) + len(END)
    out = src[:start] + block + src[stop:]
else:
    # First run: park it immediately before </head>, beside the other blocks.
    out = src.replace('</head>', block + '\n</head>', 1)

if '--check' in sys.argv:
    if out != src:
        print('image schema is stale - run tools/gen-image-schema.py')
        sys.exit(1)
    print('image schema is current')
    sys.exit(0)

io.open(PAGE, 'w', encoding='utf-8').write(out)
print(f'image schema: {len(items)} ImageObject nodes')

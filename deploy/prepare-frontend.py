#!/usr/bin/env python3
"""Build an immutable, self-contained frontend snapshot from public/."""
import pathlib
import shutil
import sys

source, target, revision = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2]), sys.argv[3]
if not (len(revision) == 40 and all(c in '0123456789abcdef' for c in revision)):
    raise SystemExit('invalid revision')
if target.exists():
    raise SystemExit('target already exists')
shutil.copytree(source, target)
prefix = '/assets/' + revision + '/'
index = target / 'index.html'
html = index.read_text(encoding='utf-8')
for name in ('styles.css', 'selection.css', 'scrollbars.js', 'app.js'):
    needle = '"/' + name + '"'
    if needle not in html:
        raise SystemExit('missing index reference: ' + name)
    html = html.replace(needle, '"' + prefix + name + '"')
index.write_text(html, encoding='utf-8')
for path in target.rglob('*.js'):
    content = path.read_text(encoding='utf-8')
    for name in ('icons.svg', 'github-mark.svg'):
        content = content.replace('/' + name, prefix + name)
    path.write_text(content, encoding='utf-8')
(target / '.deployed-revision').write_text(revision + '\n', encoding='ascii')

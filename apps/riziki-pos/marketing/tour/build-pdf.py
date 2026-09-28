"""Turn the walkthrough page into something a printer can set on A4.

Fetch the webfonts once and embed them, so the PDF carries its own type:

    UA="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36"
    curl -A "$UA" -o gf.css \
      "https://fonts.googleapis.com/css2?family=Archivo:wght@600;700\
&family=IBM+Plex+Mono:wght@400;600&family=IBM+Plex+Sans:wght@400;500;600&display=swap"
    # keep the latin faces, replace each gstatic url() with a base64 data: URI,
    # and save the result as fonts.css beside this script

Then:

    python3 build-pdf.py          # writes print.html
    node render-pdf.mjs           # writes riziki-pos-end-to-end.pdf
"""
import re, pathlib

page = pathlib.Path("index.html").read_text()
fonts = pathlib.Path("fonts.css").read_text()

page = re.sub(r'<link rel="preconnect".*?display=swap">\s*', "", page, flags=re.S)
page = re.sub(r"<script>.*?</script>\s*$", "", page, flags=re.S)
page = re.sub(r'<div class="bar">.*?</div>\s*</div>\s*', "", page, flags=re.S, count=1)
page = re.sub(r'<div class="switch".*?</div>\s*', "", page, flags=re.S, count=1)
page = page.replace('<div id="pane-advance">',
                    '<div id="pane-advance"><h3 class="route">Route one — mixed in advance</h3>')
page = page.replace('<div id="pane-order" hidden>',
                    '<div id="pane-order"><h3 class="route">Route two — mixed to order</h3>')

# The diagrams are scaled down to the page width, so their labels need it back.
BUMP = {"11": "12.5", "11.5": "13", "13": "14", "14": "15", "16": "17"}
page = re.sub(r'font-size="(\d+(?:\.\d+)?)"',
              lambda m: 'font-size="%s"' % BUMP.get(m.group(1), m.group(1)), page)

out = ('<!doctype html><html lang="en" data-theme="light"><head><meta charset="utf-8">\n'
  '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
  "<style>\n" + fonts + "\n</style>\n"
  "<style>:root{color-scheme:light}body{margin:0;font:14px system-ui,sans-serif;background:#fff}"
  "img{max-width:100%}[hidden]{display:none!important}</style>\n"
  "</head><body>\n" + page + pathlib.Path("print.css").read_text() + "\n</body></html>")
pathlib.Path("print.html").write_text(out)
print("print.html rebuilt,", len(out) // 1024, "KB")

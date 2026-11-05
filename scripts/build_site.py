"""Build the live site in docs/ from the landing mockup.

plans/landing-mockups/ideal.html is the page as designed, with a switch between first screens and a
few mockup-only blocks. This takes the chosen first screen (the fan), drops the rest, splits the inline
styles and script into docs/styles.css and docs/site.js, and rewrites asset paths for docs/.

    python scripts/build_site.py
"""
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[1]
MOCK = ROOT / "plans" / "landing-mockups"
DOCS = ROOT / "docs"
RELEASES = "https://github.com/pr4nav3/stealth-startup/releases"


def between(text: str, start: str, end: str, keep_end: bool = True) -> str:
    i = text.index(start)
    j = text.index(end, i)
    return text[:i] + (text[j:] if keep_end else text[j + len(end):])


def main() -> None:
    page = (MOCK / "ideal.html").read_text(encoding="utf-8")
    base = (MOCK / "base.css").read_text(encoding="utf-8")

    css = page[page.index("<style>") + len("<style>"):page.index("</style>")]
    body = page[page.index("<body>") + len("<body>"):page.rindex("<script>")]
    js = page[page.rindex("<script>") + len("<script>"):page.rindex("</script>")]

    # ---- styles: the mockup-only first screens and the switch go; base.css comes first
    css = between(css, "  /* ---- first-screen variants", "  /* the fan: the four personalities")
    css = css.replace('  body:not([data-hero="fan"]) .fan { display: none; }\n', "")
    css = between(css, "  .hero-switch {", "  /* ---- 2 · the demo ---- */")
    css = "\n".join(
        line for line in css.split("\n")
        if not re.match(r"\s*(\.speaker|body\[data-hero|\.flip|\.fclock|\.digit|\.colon|\.shuffle|\.slab)\b", line)
    )
    assert "hero-switch" not in css and "data-hero" not in css
    base = base.replace('url("../../docs/assets/', 'url("assets/')
    styles = "/* Built from plans/landing-mockups by scripts/build_site.py. Edit the mockup, then rebuild. */\n\n" + base.rstrip() + "\n\n/* ---- the page ---- */\n" + css.strip() + "\n"

    # ---- markup: only the fan on the first screen, no switch
    body = between(body, '    <div class="flip pop"', "  </section>\n</div>\n")
    body = between(body, '<div class="hero-switch"', "</div>\n", keep_end=False)
    assert "speaker" not in body and "hero-switch" not in body
    body = body.replace("../../docs/", "")
    body = body.replace('<a class="btn lg primary" href="#">Download for Windows</a>', '<a class="btn lg primary" href="%s">Download for Windows</a>' % RELEASES)
    body = body.replace('<script>', "")

    # ---- script: no speaker, flip, shuffle or switch; the theme is remembered
    js = between(js, "  /* ---- 1b · the speaker", "  /* the eye on the promise card")
    js = between(js, "  /* ---- the flip clock: one flip", "  /* ---- 2 · the demo ---- */")
    assert "setHero" not in js and "SHUFFLE" not in js and "digits" not in js
    js = js.replace("../../docs/", "")
    js = js.replace(
        '''  $("theme").addEventListener("click", function () {
    var dark = root.getAttribute("data-theme") === "dark";
    if (dark) root.removeAttribute("data-theme"); else root.setAttribute("data-theme", "dark");
    $("theme").textContent = dark ? "Dark" : "Light";
  });''',
        '''  /* the theme: the button says what it switches to, and the choice is remembered */
  function isDark() { return root.getAttribute("data-theme") === "dark"; }
  function labelTheme() { $("theme").textContent = isDark() ? "Light" : "Dark"; }
  labelTheme();
  $("theme").addEventListener("click", function () {
    if (isDark()) root.removeAttribute("data-theme"); else root.setAttribute("data-theme", "dark");
    labelTheme();
    try { localStorage.setItem("supervisor-theme", isDark() ? "dark" : "light"); } catch (e) {}
  });''')
    assert "labelTheme" in js
    script = "/* Built from plans/landing-mockups by scripts/build_site.py. Edit the mockup, then rebuild. */\n" + js.strip() + "\n"

    head = '''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Supervisor — the focus app that talks back</title>
<meta name="description" content="Start a session. Open a distraction and a voice you chose tells you to get back to work. Free, for macOS and Windows, and everything stays on your computer." />
<meta name="color-scheme" content="light dark" />
<link rel="icon" href="assets/eye.svg" type="image/svg+xml" />
<link rel="preload" href="assets/fonts/inter-variable.woff2" as="font" type="font/woff2" crossorigin />
<link rel="stylesheet" href="styles.css" />
<script>
  /* the remembered theme, before first paint */
  (function () {
    try {
      var saved = localStorage.getItem("supervisor-theme");
      if (saved === "dark" || (!saved && matchMedia("(prefers-color-scheme: dark)").matches)) document.documentElement.setAttribute("data-theme", "dark");
    } catch (e) {}
  })();
</script>
</head>
<body>
'''
    html = head + body.strip("\n") + '\n<script src="site.js"></script>\n</body>\n</html>\n'
    (DOCS / "index.html").write_text(html, encoding="utf-8", newline="\n")
    (DOCS / "styles.css").write_text(styles, encoding="utf-8", newline="\n")
    (DOCS / "site.js").write_text(script, encoding="utf-8", newline="\n")
    print("built docs/index.html, docs/styles.css, docs/site.js")


if __name__ == "__main__":
    main()

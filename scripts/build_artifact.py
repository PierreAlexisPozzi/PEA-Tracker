#!/usr/bin/env python3
"""Assemble index.html + scripts locaux en une seule page autonome.

La page produite (dist/pea-tracker.html) est un fragment HTML : <title>, <style>,
balisage et scripts en ligne, sans <!doctype>/<html>/<head>/<body>. C'est le
format attendu pour la publier comme artifact claude.ai, qui ajoute lui-même
le squelette du document.

Usage : python3 scripts/build_artifact.py [--out dist/pea-tracker.html]
"""
import argparse
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent
LOCAL_SCRIPTS = ("data/research.js", "assets/app.js")


def build() -> str:
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    head = html.split("<!-- page:start -->", 1)[1].split("<!-- page:head-end -->", 1)[0]
    body = html.split("<body>", 1)[1].split("<!-- page:end -->", 1)[0]
    for src in LOCAL_SCRIPTS:
        code = (ROOT / src).read_text(encoding="utf-8")
        if "</script" in code.lower():
            raise SystemExit(f"{src} contient '</script' : impossible de l'insérer en ligne.")
        tag = f'<script src="{src}"></script>'
        if tag not in body:
            raise SystemExit(f"Balise introuvable dans index.html : {tag}")
        body = body.replace(tag, f"<script>\n{code}\n</script>")
    return head.strip() + "\n" + re.sub(r"\n{3,}", "\n\n", body.strip()) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--out", default=str(ROOT / "dist" / "pea-tracker.html"))
    args = parser.parse_args()
    out = pathlib.Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(build(), encoding="utf-8")
    print(f"{out} ({out.stat().st_size // 1024} Ko)")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Récapitulatif du matin du PEA : positions, actions à faire, points à surveiller.

Lit l'export de la base de l'artifact (`--db-dir`, dossier produit par ArtifactData
`out_dir` : snapshots/, quotes/, alerts/, research/, settings/) et la base de recherche,
puis compose un message court au format HTML de Telegram (texte brut pour --out).

Envoi Telegram (`--send`) par un bot si les variables d'environnement
TELEGRAM_BOT_TOKEN (jeton donné par @BotFather) et TELEGRAM_CHAT_ID (identifiant de la
conversation avec le bot) sont définies dans l'environnement. Sinon le message est
seulement affiché ; la notification Claude de la routine prend le relais.

Usage :
    python3 scripts/morning_brief.py --db-dir <dossier> [--news "ligne" ...] [--send] [--out msg.txt]
"""
import argparse
import datetime as dt
import html
import json
import os
import pathlib
import re
import sys
import urllib.error
import urllib.request
import zoneinfo

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import daily_update as du  # noqa: E402  (même dossier)

PARIS = zoneinfo.ZoneInfo("Europe/Paris")
ARTIFACT_URL = "https://claude.ai/artifact/S5JWYoC7fjJWVPFwLKjNjm"
DEFAULTS = {"lineWarn": 15, "lineAlert": 25, "sectorWarn": 20, "sectorAlert": 25, "lossAlert": -30,
            "coreTarget": 40, "staleDays": 35}
JOURS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"]
MAX_LEN = 4000  # limite Telegram : 4 096 caractères ; au-delà, plusieurs envois


def fr(x, d=0):
    return du.fr(x, d)


def sfr(x, d=1, unit=" %"):
    return du.sfr(x, d, unit)


def thr(x, metric):
    """Seuil d'alerte sans décimale inutile : −30 %, 25 %, 12,50 €."""
    if metric in ("price", "total"):
        return f"{fr(x, 2)} €"
    d = 0 if float(x).is_integer() else 1
    return sfr(x, d) if metric in ("pnlPct", "dayVar", "upside") else f"{fr(x, d)} %"


def e(text) -> str:
    return html.escape(str(text), quote=False)


def dfr(iso):
    return dt.date.fromisoformat(iso[:10]).strftime("%d/%m")


def var(x):
    """Variation de séance : « 0,0 % » sans signe quand elle s'arrondit à zéro."""
    return "0,0 %" if x is not None and abs(x) < 0.05 else sfr(x)


def dot(var):
    return "⚪" if var is None or abs(var) < 0.05 else "🟢" if var > 0 else "🔴"


def pick_prices(snap, quotes):
    """Cours retenus : derniers cours de la routine s'ils sont plus récents que le relevé."""
    latest = max(quotes.values(), key=lambda q: (q["date"], q.get("at", ""))) if quotes else None
    newer = latest and (latest["date"] > snap["date"] or
                        (latest["date"] == snap["date"] and latest.get("at", "") > snap.get("importedAt", "")))
    if newer:
        return latest, f"Clôture du {dfr(latest['date'])} · quantités du relevé du {dfr(snap['date'])}"
    prices = {p["isin"]: {"last": p.get("last"), "dayVar": p.get("dayVar")} for p in snap["positions"]}
    return {"date": snap["date"], "prices": prices, "missing": []}, f"Cours et quantités du relevé du {dfr(snap['date'])}"


METRIC_FR = {"price": "cours", "pnlPct": "+/- latente", "weight": "poids", "dayVar": "séance",
             "upside": "potentiel", "sectorWeight": "poids", "total": "valeur"}


def alert_text(alert, v):
    """« Hexaom −31,4 % (+/- latente, seuil −30 %) », ou None si l'alerte ne se déclenche pas."""
    ok, current, matches = du.eval_alert(alert, v)
    if not ok:
        return None
    metric = alert.get("metric")
    who = ", ".join(matches) if alert.get("scope") == "any" else f"{matches[0]} {du.fmt_metric(current, metric)}"
    return f"🔔 {e(who)} ({METRIC_FR.get(metric, metric)}, seuil {thr(alert.get('value'), metric)})."


def build(db_dir: pathlib.Path, news: list[str], news_checked: bool = False) -> tuple[str, str]:
    """Message au format HTML de Telegram, et résumé d'une ligne pour la notification."""
    research = du.load_research(db_dir)
    inst = research["instruments"]
    snaps = du.load_json_dir(db_dir / "snapshots")
    if not snaps:
        msg = "PEA : aucun relevé enregistré dans PEA Tracker."
        return msg, msg
    snap = max(snaps.values(), key=lambda s: (s["date"], s.get("importedAt", "")))
    quotes, source = pick_prices(snap, du.load_json_dir(db_dir / "quotes"))
    st = {**DEFAULTS, **(du.load_json_dir(db_dir / "settings").get("main") or {})}
    v = du.valuation(snap, quotes, research)
    lines = sorted(v["lines"], key=lambda l: -l["value"])
    live = [l for l in lines if not l["nonTradable"]]
    dead = [l for l in lines if l["nonTradable"]]
    cost_live = sum(l["cost"] for l in live)
    pnl_live = sum(l["pnl"] for l in live)
    today = dt.datetime.now(PARIS).date()

    # ------------------------------------------------------------- en-tête
    day_pct = v["day"] / (v["total"] - v["day"]) * 100 if v["total"] - v["day"] else 0
    out = [f"☀️ <b>PEA · {JOURS[today.weekday()]} {today:%d/%m}</b>", f"<i>{source}</i>", "",
           f"💼 <b>{fr(v['total'])} €</b> · séance {sfr(v['day'], 0, ' €')} ({sfr(day_pct)})",
           f"{'📈' if v['pnl'] >= 0 else '📉'} +/- value latente : {sfr(v['pnl'], 0, ' €')} ({sfr(v['pnlPct'])})"]
    if dead:
        names = ", ".join(e(l["label"]) for l in dead)
        out.append(f"↳ hors {names} (radié{'s' if len(dead) > 1 else ''}) : {sfr(pnl_live, 0, ' €')} "
                   f"({sfr(pnl_live / cost_live * 100 if cost_live else 0)})")
    if v["cash"]:
        out.append(f"💶 Liquidités : {fr(v['cash'], 2)} €")
    movers = sorted((l for l in live if l["dayVar"] is not None), key=lambda l: l["dayVar"])
    if len(movers) > 1:
        out.append(f"🏁 Meilleure séance : {e(movers[-1]['label'])} ({var(movers[-1]['dayVar'])}) · "
                   f"pire : {e(movers[0]['label'])} ({var(movers[0]['dayVar'])})")

    # ------------------------------------------------------------- à faire / à surveiller
    todo, watch = [], []
    for l in dead:
        todo.append(f"Demander à BoursoBank le retrait de {e(l['label'])} du PEA (titre radié).")
    core = sum(l["weight"] for l in lines if inst.get(l["isin"], {}).get("sector") == "Monde diversifié")
    if core < st["coreTarget"]:
        gap = max(0.0, (st["coreTarget"] / 100 * v["total"] - core / 100 * v["total"]) / (1 - st["coreTarget"] / 100))
        todo.append(f"Orienter les prochains versements vers l'ETF Monde : {fr(core, 1)} % du PEA, "
                    f"cible {st['coreTarget']} % (≈ {fr(gap)} €).")
    sectors = {k: w for k, w in v["sectors"].items() if "diversifié" not in k.lower()}
    for name, w in sorted(sectors.items(), key=lambda kv: -kv[1])[:1]:
        if w >= st["sectorAlert"]:
            todo.append(f"Ne plus renforcer le secteur {e(name)} ({fr(w, 1)} % du PEA).")
        elif w >= st["sectorWarn"]:
            watch.append(f"⚖️ Secteur {e(name)} : {fr(w, 1)} % du PEA (alerte à {st['sectorAlert']} %).")
    for l in live:
        if not inst.get(l["isin"], {}).get("diversified") and l["weight"] >= st["lineAlert"]:
            todo.append(f"Ne plus renforcer {e(l['label'])} ({fr(l['weight'], 1)} % du PEA).")
        if l["upside"] is not None and l["upside"] <= 0:
            todo.append(f"{e(l['label'])} a atteint l'objectif des analystes ({fr(l['target'], 2)} €) : envisager d'alléger.")
        elif l["upside"] is not None and l["upside"] < 5:
            watch.append(f"🎯 {e(l['label'])} à {fr(l['upside'], 1)} % de l'objectif des analystes ({fr(l['target'], 2)} €).")
        if l["dayVar"] is not None and abs(l["dayVar"]) >= 4:
            watch.append(f"⚡ {e(l['label'])} : {sfr(l['dayVar'])} sur la séance.")

    for alert in du.load_json_dir(db_dir / "alerts").values():
        if alert.get("active") is not False and (text := alert_text(alert, v)):
            watch.append(text)

    for l in live:  # publications : de la veille à J+7
        for ev in inst.get(l["isin"], {}).get("events") or []:
            delta = (dt.date.fromisoformat(ev["date"]) - today).days
            if -1 <= delta <= 7:
                when = {-1: "publié hier", 0: "aujourd'hui", 1: "demain"}.get(delta, f"le {dfr(ev['date'])}")
                watch.append(f"📅 {e(l['label'])} : {e(ev['label'])}, {when}.")

    stale = (today - dt.date.fromisoformat(snap["date"])).days
    if stale > st["staleDays"]:
        todo.append(f"Importer un relevé à jour (le dernier date de {stale} jours).")
    asof = research.get("asOf")
    if asof and (today - dt.date.fromisoformat(asof)).days > 10:
        watch.append(f"🔎 Consensus des analystes à rafraîchir (vérifiés le {dfr(asof)}).")

    out += ["", "✅ <b>À faire</b>"] + ([f"{i}. {t}" for i, t in enumerate(todo, 1)] or ["Rien d'urgent."])
    out += ["", "👀 <b>À surveiller</b>"] + ([f"• {w}" for w in watch] or ["Rien de particulier."])
    if news or news_checked:
        out += ["", "📰 <b>Actualités de la nuit</b>"] + ([f"• {e(n)}" for n in news] or ["Rien de notable sur les actions détenues."])

    # ------------------------------------------------------------- positions (repliées)
    rows = [f"{dot(l['dayVar'])} <b>{e(l['label'])}</b> {fr(l['weight'], 1)} % · séance {var(l['dayVar'])} · "
            f"latente {sfr(l['pnlPct'], 0)}" for l in live]
    out += ["", f"📊 <b>Positions</b> ({len(live)}, touchez pour déplier)", "<blockquote expandable>" + "\n".join(rows) + "</blockquote>"]
    out += ["", f'🔗 <a href="{ARTIFACT_URL}">Ouvrir PEA Tracker</a>', "<i>Aide à la décision, pas un conseil personnalisé.</i>"]

    summary = (f"{fr(v['total'])} € (séance {sfr(v['day'], 0, ' €')}) · {len(todo)} action{'s' if len(todo) > 1 else ''} à faire · "
               f"{len(watch)} point{'s' if len(watch) > 1 else ''} à surveiller")
    return "\n".join(out), summary


def to_plain(text: str) -> str:
    """Version texte (notification, fichier) : balises retirées."""
    text = text.replace(", touchez pour déplier", "").replace("<blockquote expandable>", "").replace("</blockquote>", "")
    text = re.sub(r'<a href="([^"]+)">([^<]+)</a>', r"\2 : \1", text)
    return html.unescape(re.sub(r"</?[biu]>", "", text))


def split(text: str, limit: int = MAX_LEN) -> list[str]:
    """Découpe aux lignes vides pour rester sous la longueur maximale d'un message."""
    parts, cur = [], ""
    for block in text.split("\n\n"):
        cand = (cur + "\n\n" + block) if cur else block
        if len(cand) <= limit:
            cur = cand
        else:
            if cur:
                parts.append(cur)
            cur = block[:limit]
    if cur:
        parts.append(cur)
    return parts


def post(url: str, payload: dict) -> dict:
    req = urllib.request.Request(url, data=json.dumps(payload).encode(), headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read()
    except urllib.error.HTTPError as exc:  # Telegram détaille l'erreur en JSON
        raw = exc.read()
    except Exception as exc:  # noqa: BLE001
        raw = json.dumps({"description": str(exc)}).encode()
    try:
        return json.loads(raw)
    except ValueError:
        return {"description": raw[:160].decode("utf-8", "replace")}


def send_telegram(text: str):
    """Envoie le message HTML. True : envoyé ; False : échec d'envoi ; None : Telegram non configuré."""
    token, chat = os.environ.get("TELEGRAM_BOT_TOKEN"), os.environ.get("TELEGRAM_CHAT_ID")
    if not token or not chat:
        print("Telegram non configuré (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID absents) : message non envoyé.", file=sys.stderr)
        return None
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    ok_all = True
    for i, part in enumerate(split(text), 1):
        body = post(url, {"chat_id": chat, "text": part, "parse_mode": "HTML",
                          "link_preview_options": {"is_disabled": True}})
        plain = not body.get("ok") and "parse" in str(body.get("description", "")).lower()
        if plain:
            body = post(url, {"chat_id": chat, "text": to_plain(part), "link_preview_options": {"is_disabled": True}})
        ok = body.get("ok") is True
        detail = "" if ok else f" ({str(body.get('description', '')).replace(token, '***')[:160]})"
        print(f"Telegram partie {i} : {'envoyée' if ok else 'échec'}{' en texte simple' if plain else ''}{detail}", file=sys.stderr)
        ok_all = ok_all and ok
    return ok_all


def main() -> None:
    parser = argparse.ArgumentParser(description="Récapitulatif du matin du PEA")
    parser.add_argument("--db-dir", type=pathlib.Path, required=True)
    parser.add_argument("--news", action="append", default=[], help="ligne d'actualité à ajouter (répétable)")
    parser.add_argument("--news-checked", action="store_true", help="actualités relues : l'écrire même sans ligne")
    parser.add_argument("--send", action="store_true", help="envoyer par Telegram si configuré")
    parser.add_argument("--out", type=pathlib.Path, help="écrire le message (texte brut) dans ce fichier")
    args = parser.parse_args()
    text, summary = build(args.db_dir, args.news, args.news_checked)
    plain = to_plain(text)
    if args.out:
        args.out.write_text(plain, encoding="utf-8")
    print(plain)
    print(f"Résumé : {summary}", file=sys.stderr)
    if args.send and send_telegram(text) is False:
        sys.exit(2)  # configuré mais en échec ; non configuré = sortie normale


if __name__ == "__main__":
    main()

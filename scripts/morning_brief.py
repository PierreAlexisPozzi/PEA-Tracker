#!/usr/bin/env python3
"""Récapitulatif du matin du PEA : positions, actions à faire, points à surveiller.

Lit l'export de la base de l'artifact (`--db-dir`, dossier produit par ArtifactData
`out_dir` : snapshots/, quotes/, alerts/, research/, settings/) et la base de recherche,
puis compose un message court (*gras*).

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


def dfr(iso):
    return dt.date.fromisoformat(iso[:10]).strftime("%d/%m")


def pick_prices(snap, quotes):
    """Cours retenus : derniers cours de la routine s'ils sont plus récents que le relevé."""
    latest = max(quotes.values(), key=lambda q: (q["date"], q.get("at", ""))) if quotes else None
    newer = latest and (latest["date"] > snap["date"] or
                        (latest["date"] == snap["date"] and latest.get("at", "") > snap.get("importedAt", "")))
    if newer:
        return latest, f"clôture du {dfr(latest['date'])}"
    prices = {p["isin"]: {"last": p.get("last"), "dayVar": p.get("dayVar")} for p in snap["positions"]}
    return {"date": snap["date"], "prices": prices, "missing": []}, f"cours du relevé du {dfr(snap['date'])}"


def build(db_dir: pathlib.Path, news: list[str]) -> str:
    research = du.load_research(db_dir)
    inst = research["instruments"]
    snaps = du.load_json_dir(db_dir / "snapshots")
    if not snaps:
        return "PEA : aucun relevé enregistré dans PEA Tracker."
    snap = max(snaps.values(), key=lambda s: (s["date"], s.get("importedAt", "")))
    quotes, price_label = pick_prices(snap, du.load_json_dir(db_dir / "quotes"))
    st = {**DEFAULTS, **(du.load_json_dir(db_dir / "settings").get("main") or {})}
    v = du.valuation(snap, quotes, research)
    lines = sorted(v["lines"], key=lambda l: -l["value"])
    live = [l for l in lines if not l["nonTradable"]]
    dead = [l for l in lines if l["nonTradable"]]
    cost_live = sum(l["cost"] for l in live)
    pnl_live = sum(l["pnl"] for l in live)

    today = dt.datetime.now(PARIS).date()
    source = ("Cours et quantités du relevé du " + dfr(snap["date"]) if price_label.startswith("cours du relevé")
              else f"{price_label[0].upper() + price_label[1:]} · quantités du relevé du {dfr(snap['date'])}")
    out = [f"*PEA – récap du {JOURS[today.weekday()]} {today:%d/%m}*", source, "",
           f"*Valeur : {fr(v['total'])} €* (séance : {sfr(v['day'], 0, ' €')})",
           f"+/- latente : {sfr(v['pnl'], 0, ' €')} ({sfr(v['pnlPct'])})" +
           (f" · hors titres radiés : {sfr(pnl_live, 0, ' €')} ({sfr(pnl_live / cost_live * 100 if cost_live else 0)})" if dead else "")]
    if v["cash"]:
        out.append(f"Liquidités : {fr(v['cash'], 2)} €")

    out += ["", "*Positions* (poids · séance · +/- latente)"]
    for l in live:
        out.append(f"• {l['label']} : {fr(l['weight'], 1)} % · {sfr(l['dayVar'])} · {sfr(l['pnlPct'], 0)}")

    # ------------------------------------------------------------- à faire
    todo, watch = [], []
    for l in dead:
        todo.append(f"Demander à BoursoBank le retrait de {l['label']} du PEA (titre radié).")
    core = sum(l["weight"] for l in lines if inst.get(l["isin"], {}).get("sector") == "Monde diversifié")
    if core < st["coreTarget"]:
        gap = max(0.0, (st["coreTarget"] / 100 * v["total"] - core / 100 * v["total"]) / (1 - st["coreTarget"] / 100))
        todo.append(f"Prochains versements vers l'ETF Monde : {fr(core, 1)} % du PEA pour une cible de {st['coreTarget']} % (≈ {fr(gap)} €).")
    sectors = {k: w for k, w in v["sectors"].items() if "diversifié" not in k.lower()}
    for name, w in sorted(sectors.items(), key=lambda kv: -kv[1])[:1]:
        if w >= st["sectorAlert"]:
            todo.append(f"Ne plus renforcer le secteur {name} ({fr(w, 1)} % du PEA).")
        elif w >= st["sectorWarn"]:
            watch.append(f"Secteur {name} à {fr(w, 1)} % du PEA (seuil d'alerte {st['sectorAlert']} %).")
    for l in live:
        diversified = inst.get(l["isin"], {}).get("diversified")
        if not diversified and l["weight"] >= st["lineAlert"]:
            todo.append(f"Ne plus renforcer {l['label']} ({fr(l['weight'], 1)} % du PEA).")
        if l["upside"] is not None and l["upside"] <= 0:
            todo.append(f"{l['label']} a atteint l'objectif des analystes ({fr(l['target'], 2)} €) : envisager d'alléger.")
        elif l["upside"] is not None and l["upside"] < 5:
            watch.append(f"{l['label']} à {fr(l['upside'], 1)} % de l'objectif des analystes ({fr(l['target'], 2)} €).")
        if l["dayVar"] is not None and abs(l["dayVar"]) >= 4:
            watch.append(f"{l['label']} : {sfr(l['dayVar'])} sur la séance.")
    held = {l["isin"]: l for l in live}

    # Alertes de la page
    for alert in du.load_json_dir(db_dir / "alerts").values():
        if alert.get("active") is False:
            continue
        ok, current, matches = du.eval_alert(alert, v)
        if ok:
            watch.append(f"Alerte : {du.alert_title(alert, research)}" + (f" ({', '.join(matches)})" if matches else ""))

    # Publications : de la veille à J+7
    for isin, l in held.items():
        for ev in inst.get(isin, {}).get("events") or []:
            d = dt.date.fromisoformat(ev["date"])
            delta = (d - today).days
            if -1 <= delta <= 7:
                when = "aujourd'hui" if delta == 0 else "hier" if delta == -1 else f"le {d:%d/%m}"
                watch.append(f"{l['label']} : {ev['label']} {when}.")

    stale = (today - dt.date.fromisoformat(snap["date"])).days
    if stale > st["staleDays"]:
        todo.append(f"Importer un relevé à jour (le dernier date de {stale} jours).")
    asof = research.get("asOf")
    if asof and (today - dt.date.fromisoformat(asof)).days > 10:
        watch.append(f"Consensus à rafraîchir (dernière vérification le {dfr(asof)}).")

    out += ["", "*À faire*"] + ([f"{i}. {t}" for i, t in enumerate(todo, 1)] or ["Rien d'urgent."])
    out += ["", "*À surveiller*"] + ([f"• {w}" for w in watch] or ["• Rien de particulier."])
    if news:
        out += ["", "*Actualités*"] + [f"• {n}" for n in news]
    out += ["", f"Détail : {ARTIFACT_URL}", "Aide à la décision, pas un conseil personnalisé."]
    return "\n".join(out)


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


def to_html(text: str) -> str:
    """*gras* → <b>gras</b>, le reste échappé pour le mode HTML de Telegram."""
    return re.sub(r"\*([^*\n]+)\*", r"<b>\1</b>", html.escape(text, quote=False))


def send_telegram(text: str):
    """True : envoyé ; False : échec d'envoi ; None : Telegram non configuré."""
    token, chat = os.environ.get("TELEGRAM_BOT_TOKEN"), os.environ.get("TELEGRAM_CHAT_ID")
    if not token or not chat:
        print("Telegram non configuré (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID absents) : message non envoyé.", file=sys.stderr)
        return None
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    ok_all = True
    for i, part in enumerate(split(text), 1):
        payload = json.dumps({"chat_id": chat, "text": to_html(part), "parse_mode": "HTML",
                              "link_preview_options": {"is_disabled": True}}).encode()
        req = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                raw = resp.read()
        except urllib.error.HTTPError as exc:  # Telegram détaille l'erreur en JSON
            raw = exc.read()
        except Exception as exc:  # noqa: BLE001
            raw = json.dumps({"description": str(exc)}).encode()
        try:
            body = json.loads(raw)
        except ValueError:
            body = {"description": raw[:160].decode("utf-8", "replace")}
        ok = body.get("ok") is True
        detail = "" if ok else f" ({str(body.get('description', '')).replace(token, '***')[:160]})"
        print(f"Telegram partie {i} : {'envoyée' if ok else 'échec'}{detail}", file=sys.stderr)
        ok_all = ok_all and ok
    return ok_all


def main() -> None:
    parser = argparse.ArgumentParser(description="Récapitulatif du matin du PEA")
    parser.add_argument("--db-dir", type=pathlib.Path, required=True)
    parser.add_argument("--news", action="append", default=[], help="ligne d'actualité à ajouter (répétable)")
    parser.add_argument("--send", action="store_true", help="envoyer par Telegram si configuré")
    parser.add_argument("--out", type=pathlib.Path, help="écrire le message dans ce fichier")
    args = parser.parse_args()
    text = build(args.db_dir, args.news)
    if args.out:
        args.out.write_text(text, encoding="utf-8")
    print(text)
    if args.send and send_telegram(text) is False:
        sys.exit(2)  # configuré mais en échec ; non configuré = sortie normale


if __name__ == "__main__":
    main()

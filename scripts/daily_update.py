#!/usr/bin/env python3
"""Mise à jour quotidienne du PEA : cours du jour, valorisation, alertes.

1. Lit la base de recherche (data/research.js, via node) et, si fourni, l'export de la
   base de l'artifact (`--db-dir`, dossier produit par ArtifactData `out_dir`, avec les
   sous-dossiers snapshots/, alerts/, research/, settings/).
2. Récupère le dernier cours de chaque instrument ayant un symbole `yahoo`
   (API de graphique publique de Yahoo Finance, sans clé).
3. Écrit le document `quotes/<date>` à enregistrer dans la base de l'artifact.
4. Si un relevé est disponible : valorise les positions au cours du jour, évalue les
   alertes et produit un rapport Markdown (et un JSON des alertes déclenchées).

Usage :
    python3 scripts/daily_update.py --db-dir <dossier> --out-quotes quotes.json \
        --report rapport.md --out-hits alertes.json

Aucune donnée n'est écrite dans le dépôt : les sorties vont où on les demande.
"""
import argparse
import datetime as dt
import json
import pathlib
import subprocess
import sys
import urllib.parse
import urllib.request
import zoneinfo

ROOT = pathlib.Path(__file__).resolve().parent.parent
PARIS = zoneinfo.ZoneInfo("Europe/Paris")


# --------------------------------------------------------------------- données

def load_json_dir(path: pathlib.Path) -> dict:
    if not path.is_dir():
        return {}
    return {f.stem: json.loads(f.read_text(encoding="utf-8")) for f in sorted(path.glob("*.json"))}


def load_research(db_dir: pathlib.Path | None) -> dict:
    """Base publique + surcharges écrites dans la base de l'artifact (collection research)."""
    script = "global.window={};require(process.argv[1]);process.stdout.write(JSON.stringify(window.PEA_RESEARCH))"
    out = subprocess.run(["node", "-e", script, str(ROOT / "data" / "research.js")],
                         capture_output=True, text=True, check=True)
    research = json.loads(out.stdout)
    overrides = load_json_dir(db_dir / "research") if db_dir else {}
    for key, ov in overrides.items():
        if key == "_meta":
            research["asOf"] = ov.get("asOf", research.get("asOf"))
            continue
        base = research["instruments"].get(key, {})
        merged = {**base, **ov}
        if "consensus" in base or "consensus" in ov:
            merged["consensus"] = {**base.get("consensus", {}), **ov.get("consensus", {})}
        research["instruments"][key] = merged
    return research


# ---------------------------------------------------------------------- cours

def fetch_quote(symbol: str) -> dict:
    url = ("https://query1.finance.yahoo.com/v8/finance/chart/"
           f"{urllib.parse.quote(symbol)}?range=5d&interval=1d")
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=20) as resp:
        data = json.load(resp)
    result = data["chart"]["result"][0]
    meta = result["meta"]
    price = meta.get("regularMarketPrice")
    stamp = meta.get("regularMarketTime")
    if price is None or stamp is None:
        raise ValueError("cours absent")
    day = dt.datetime.fromtimestamp(stamp, PARIS).date()
    closes = (result.get("indicators", {}).get("quote") or [{}])[0].get("close") or []
    prev = None
    for ts, close in zip(result.get("timestamp") or [], closes):
        if close is not None and dt.datetime.fromtimestamp(ts, PARIS).date() < day:
            prev = close
    return {
        "symbol": symbol,
        "last": round(float(price), 4),
        "prevClose": round(float(prev), 4) if prev else None,
        "dayVar": round((price / prev - 1) * 100, 2) if prev else None,
        "time": dt.datetime.fromtimestamp(stamp, dt.timezone.utc).isoformat(timespec="seconds"),
        "marketDate": day.isoformat(),
        "currency": meta.get("currency"),
        "name": meta.get("longName") or meta.get("shortName"),
    }


def fetch_all(research: dict) -> dict:
    prices, missing = {}, []
    for isin, inst in research["instruments"].items():
        symbol = inst.get("yahoo")
        if not symbol:
            continue
        try:
            q = fetch_quote(symbol)
            if q["currency"] != "EUR":
                raise ValueError(f"devise {q['currency']}")
            prices[isin] = q
        except Exception as exc:  # noqa: BLE001 - une ligne en échec ne bloque pas les autres
            missing.append({"isin": isin, "symbol": symbol, "error": str(exc)[:120]})
    dates = [q["marketDate"] for q in prices.values()]
    return {
        "date": max(dates) if dates else dt.datetime.now(PARIS).date().isoformat(),
        "at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "source": "Yahoo Finance (dernier cours, Euronext Paris)",
        "prices": prices,
        "missing": missing,
    }


# ---------------------------------------------------------------- valorisation

def valuation(snap: dict, quotes: dict, research: dict) -> dict:
    lines = []
    for p in snap["positions"]:
        inst = research["instruments"].get(p["isin"], {})
        q = quotes["prices"].get(p["isin"])
        last = q["last"] if q else p.get("last") or 0
        qty, pru = p.get("qty") or 0, p.get("pru") or 0
        value, cost = qty * last, qty * pru
        cons = inst.get("consensus") or {}
        non_tradable = bool(inst.get("nonTradable"))
        lines.append({
            "isin": p["isin"], "label": inst.get("short") or inst.get("name") or p["name"],
            "sector": inst.get("sector", "Non classé"), "nonTradable": non_tradable,
            "qty": qty, "pru": pru, "lastSnapshot": p.get("last"), "last": last,
            "dayVar": q["dayVar"] if q else None, "stale": q is None,
            "value": value, "cost": cost, "pnl": value - cost,
            "pnlPct": (value - cost) / cost * 100 if cost else 0.0,
            "sinceSnapshot": (last / p["last"] - 1) * 100 if p.get("last") else None,
            "upside": (cons["target"] / last - 1) * 100 if cons.get("target") and last and not non_tradable else None,
            "target": cons.get("target"),
        })
    cash = snap.get("cash") or 0
    total = sum(l["value"] for l in lines) + cash
    for l in lines:
        l["weight"] = l["value"] / total * 100 if total else 0.0
    sectors = {}
    for l in lines:
        sectors[l["sector"]] = sectors.get(l["sector"], 0) + l["weight"]
    cost = sum(l["cost"] for l in lines)
    day = sum(l["value"] - l["value"] / (1 + l["dayVar"] / 100) for l in lines if l["dayVar"] is not None)
    value_snapshot = sum(l["qty"] * (l["lastSnapshot"] or 0) for l in lines) + cash
    return {
        "lines": lines, "cash": cash, "total": total, "cost": cost, "pnl": total - cash - cost,
        "pnlPct": (total - cash - cost) / cost * 100 if cost else 0.0, "day": day,
        "valueSnapshot": value_snapshot, "sectors": sectors,
    }


def eval_alert(alert: dict, v: dict):
    """Même règle que evalAlert() dans assets/app.js."""
    thr, op, metric, scope = alert.get("value"), alert.get("op"), alert.get("metric"), alert.get("scope")

    def hit(x):
        return x is not None and thr is not None and (x >= thr if op == ">=" else x <= thr)

    def metric_of(l):
        return {"price": l["last"], "pnlPct": l["pnlPct"], "weight": l["weight"],
                "dayVar": l["dayVar"], "upside": l["upside"]}.get(metric)

    if scope == "portfolio":
        x = v["total"] if metric == "total" else v["pnlPct"]
        return hit(x), x, ["Portefeuille"] if hit(x) else []
    if scope == "sector":
        x = v["sectors"].get(alert.get("target"), 0.0)
        return hit(x), x, [alert.get("target")] if hit(x) else []
    if scope == "line":
        line = next((l for l in v["lines"] if l["isin"] == alert.get("target")), None)
        x = metric_of(line) if line else None
        return hit(x), x, [line["label"]] if line and hit(x) else []
    hits = [l for l in v["lines"] if not l["nonTradable"] and hit(metric_of(l))]
    return bool(hits), (metric_of(hits[0]) if hits else None), [f"{l['label']} {metric_of(l):+.2f}" for l in hits]


# ---------------------------------------------------------------------- rapport

def fr(x, d=2):
    return "—" if x is None else f"{x:,.{d}f}".replace(",", " ").replace(".", ",")


def sfr(x, d=1, unit=" %"):
    return "—" if x is None else ("+" if x > 0 else "−" if x < 0 else "") + fr(abs(x), d) + unit


def report(snap, quotes, v, hits, research) -> str:
    at = dt.datetime.fromisoformat(quotes["at"]).astimezone(PARIS)
    out = [f"# Mise à jour du {quotes['date']} (cours relevés à {at:%H:%M}, heure de Paris)", "",
           f"Relevé de référence (quantités) : {snap['date']}. Consensus au {research.get('asOf')}.", "",
           f"- Valeur au cours du jour : **{fr(v['total'], 0)} €** "
           f"(au relevé : {fr(v['valueSnapshot'], 0)} € ; effet des cours {sfr(v['total'] - v['valueSnapshot'], 0, ' €')})",
           f"- Variation du jour estimée : {sfr(v['day'], 2, ' €')}",
           f"- +/- value latente : {sfr(v['pnl'], 0, ' €')} ({sfr(v['pnlPct'])})", "",
           "| Ligne | Cours | Jour | Depuis le relevé | Poids | +/- % | Potentiel |", "|---|---|---|---|---|---|---|"]
    for l in sorted(v["lines"], key=lambda l: -l["value"]):
        out.append(f"| {l['label']}{' (cours non mis à jour)' if l['stale'] else ''} | {fr(l['last'])} € | {sfr(l['dayVar'], 2)} | "
                   f"{sfr(l['sinceSnapshot'])} | {fr(l['weight'], 1)} % | {sfr(l['pnlPct'])} | {sfr(l['upside'])} |")
    out += ["", "## Alertes déclenchées"]
    out += [f"- {h['title']} : {', '.join(h['matches']) or fr(h['current'])}" for h in hits] or ["- aucune"]
    movers = sorted((l for l in v["lines"] if l["dayVar"] is not None), key=lambda l: l["dayVar"])
    if movers:
        out += ["", "## Plus fortes variations du jour",
                f"- Baisse : {movers[0]['label']} {sfr(movers[0]['dayVar'], 2)}",
                f"- Hausse : {movers[-1]['label']} {sfr(movers[-1]['dayVar'], 2)}"]
    big = [l["label"] for l in v["lines"] if l["dayVar"] is not None and abs(l["dayVar"]) >= 4]
    if big:
        out += ["", "## À expliquer (variation du jour ≥ 4 %)", *[f"- {b}" for b in big]]
    if quotes["missing"]:
        out += ["", "## Cours non récupérés", *[f"- {m['isin']} ({m['symbol']}) : {m['error']}" for m in quotes["missing"]]]
    return "\n".join(out) + "\n"


def alert_title(a, research):
    labels = {"price": "Cours", "pnlPct": "+/- value", "weight": "Poids", "dayVar": "Variation du jour",
              "upside": "Potentiel", "sectorWeight": "Poids du secteur", "total": "Valeur totale"}
    who = {"any": "Toute ligne", "portfolio": "Portefeuille", "sector": f"Secteur {a.get('target')}"}.get(a.get("scope"))
    if a.get("scope") == "line":
        inst = research["instruments"].get(a.get("target"), {})
        who = inst.get("short") or inst.get("name") or a.get("target")
    return f"{who} · {labels.get(a.get('metric'), a.get('metric'))} {'≥' if a.get('op') == '>=' else '≤'} {a.get('value')}"


def main() -> None:
    parser = argparse.ArgumentParser(description="Cours du jour, valorisation et alertes du PEA")
    parser.add_argument("--db-dir", type=pathlib.Path, help="export ArtifactData (out_dir) de la base de l'artifact")
    parser.add_argument("--out-quotes", type=pathlib.Path, required=True, help="document quotes/<date> à écrire")
    parser.add_argument("--report", type=pathlib.Path, help="rapport Markdown (sinon sortie standard)")
    parser.add_argument("--out-hits", type=pathlib.Path, help="JSON des alertes déclenchées")
    args = parser.parse_args()

    research = load_research(args.db_dir)
    quotes = fetch_all(research)
    args.out_quotes.write_text(json.dumps(quotes, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{len(quotes['prices'])} cours au {quotes['date']}, {len(quotes['missing'])} manquant(s) -> {args.out_quotes}",
          file=sys.stderr)

    snaps = load_json_dir(args.db_dir / "snapshots") if args.db_dir else {}
    if not snaps:
        print("Aucun relevé fourni : seuls les cours ont été récupérés.", file=sys.stderr)
        return
    snap = max(snaps.values(), key=lambda s: s["date"])
    v = valuation(snap, quotes, research)
    hits = []
    for alert_id, alert in load_json_dir(args.db_dir / "alerts").items():
        if alert.get("active") is False:
            continue
        ok, current, matches = eval_alert(alert, v)
        if ok:
            hits.append({"id": alert_id, "title": alert_title(alert, research), "current": current,
                         "matches": matches, "note": alert.get("note", "")})
    text = report(snap, quotes, v, hits, research)
    if args.report:
        args.report.write_text(text, encoding="utf-8")
    else:
        sys.stdout.write(text)
    if args.out_hits:
        args.out_hits.write_text(json.dumps({"date": quotes["date"], "hits": hits}, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"Valeur au cours du jour : {v['total']:.2f} € · {len(hits)} alerte(s) déclenchée(s)", file=sys.stderr)


if __name__ == "__main__":
    main()

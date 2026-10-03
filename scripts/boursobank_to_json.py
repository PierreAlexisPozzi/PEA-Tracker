#!/usr/bin/env python3
"""Convertit un export de positions BoursoBank (.xlsx) en relevé JSON.

Le JSON produit a exactement la forme d'un document `snapshots/<date>` de
l'application : il peut être importé tel quel dans la base de l'artifact
(ou servir à vérifier un export avant import).

Usage :
    python3 scripts/boursobank_to_json.py export.xlsx --date 2026-10-03 [--cash 85.40]

Dépendance : openpyxl (pip install openpyxl).
"""
import argparse
import datetime as dt
import json
import sys
import unicodedata

try:
    import openpyxl
except ImportError:  # pragma: no cover - message d'aide uniquement
    sys.exit("openpyxl est requis : pip install openpyxl")

# Mêmes synonymes de colonnes que assets/app.js (clés normalisées).
COLS = {
    "name": ["name", "libelle", "nom", "valeur", "instrument", "titre", "designation"],
    "isin": ["isin", "codeisin"],
    "quantity": ["quantity", "quantite", "qte", "qty", "nombre", "nbtitres"],
    "buyingPrice": ["buyingprice", "pru", "prixderevient", "prixderevientunitaire", "coursderevient", "prixmoyen"],
    "lastPrice": ["lastprice", "cours", "derniercours", "coursactuel", "dernier"],
    "intradayVariation": ["intradayvariation", "varjour", "variationjour", "varjour%", "variationdujour"],
    "amount": ["amount", "montant", "valorisation", "montantestime", "valeurestimee"],
    "amountVariation": ["amountvariation", "+/-value", "+/-values", "plusmoinsvalue", "pvlatente", "+/-valuelatente"],
    "variation": ["variation", "+/-%", "perf", "performance", "var%"],
}
REQUIRED = ["name", "isin", "quantity", "buyingPrice", "lastPrice"]


def norm_key(key) -> str:
    text = unicodedata.normalize("NFD", str(key).lower())
    text = "".join(c for c in text if unicodedata.category(c) != "Mn")
    return "".join(c for c in text if c.isalnum() or c in "+/%-")


def to_num(value):
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)):
        return float(value)
    text = "".join(c for c in str(value) if c.isdigit() or c in ",.-+eE")
    if "," in text and "." in text:
        text = text.replace(".", "").replace(",", ".") if text.rfind(",") > text.rfind(".") else text.replace(",", "")
    else:
        text = text.replace(",", ".")
    try:
        return float(text)
    except ValueError:
        return None


def isin_valid(isin: str) -> bool:
    if len(isin) != 12 or not isin[:2].isalpha() or not isin[-1].isdigit():
        return False
    digits = "".join(c if c.isdigit() else str(ord(c) - 55) for c in isin)
    total = 0
    for i, ch in enumerate(reversed(digits)):
        d = int(ch)
        if i % 2:
            d *= 2
            d = d - 9 if d > 9 else d
        total += d
    return total % 10 == 0


def read_positions(path: str):
    ws = openpyxl.load_workbook(path, data_only=True).worksheets[0]
    rows = list(ws.iter_rows(values_only=True))
    headers = list(rows[0])
    index = {}
    for field, synonyms in COLS.items():
        for i, h in enumerate(headers):
            if h is not None and norm_key(h) in synonyms:
                index[field] = i
                break
    missing = [f for f in REQUIRED if f not in index]
    if missing:
        sys.exit(f"Colonnes obligatoires absentes : {', '.join(missing)}")
    get = lambda row, f: row[index[f]] if f in index else None  # noqa: E731
    positions = []
    for row in rows[1:]:
        isin = str(get(row, "isin") or "").strip().upper()
        name = str(get(row, "name") or "").strip()
        if not isin and not name:
            continue
        positions.append({
            "name": name, "isin": isin,
            "qty": to_num(get(row, "quantity")), "pru": to_num(get(row, "buyingPrice")),
            "last": to_num(get(row, "lastPrice")), "dayVar": to_num(get(row, "intradayVariation")),
            "amount": to_num(get(row, "amount")), "pnlReported": to_num(get(row, "amountVariation")),
            "varReported": to_num(get(row, "variation")),
        })
    return positions


def main() -> None:
    parser = argparse.ArgumentParser(description="Export BoursoBank (.xlsx) -> relevé JSON")
    parser.add_argument("xlsx")
    parser.add_argument("--date", default=dt.date.today().isoformat(), help="date du relevé (AAAA-MM-JJ)")
    parser.add_argument("--cash", type=float, default=None, help="liquidités du PEA en euros")
    args = parser.parse_args()

    positions = read_positions(args.xlsx)
    bad = [p["isin"] for p in positions if not isin_valid(p["isin"])]
    if bad:
        print(f"Attention, ISIN invalides : {', '.join(bad)}", file=sys.stderr)
    snapshot = {
        "date": args.date, "source": "Export BoursoBank", "fileName": args.xlsx.split("/")[-1],
        "cash": args.cash, "importedAt": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "positions": positions,
    }
    total = sum((p["amount"] if p["amount"] is not None else (p["qty"] or 0) * (p["last"] or 0)) for p in positions)
    cost = sum((p["qty"] or 0) * (p["pru"] or 0) for p in positions)
    print(f"{len(positions)} lignes · valeur {total:,.2f} € · investi {cost:,.2f} € · +/- {total - cost:,.2f} €", file=sys.stderr)
    json.dump(snapshot, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()

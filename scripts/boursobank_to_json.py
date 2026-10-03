#!/usr/bin/env python3
"""Convertit un export de positions BoursoBank (.csv ou .xlsx) en relevé JSON.

Le JSON produit a exactement la forme d'un document `snapshots/<date>` de
l'application : il peut être importé tel quel dans la base de l'artifact
(ou servir à vérifier un export avant import).

Usage :
    python3 scripts/boursobank_to_json.py export.csv --date 2026-10-03 [--cash 85.40]

Dépendance pour les fichiers .xlsx uniquement : openpyxl (pip install openpyxl).
"""
import argparse
import csv
import datetime as dt
import io
import json
import re
import sys
import unicodedata

# Mêmes synonymes de colonnes que assets/app.js (clés normalisées).
COLS = {
    "name": ["name", "libelle", "nom", "valeur", "instrument", "titre", "designation"],
    "isin": ["isin", "codeisin"],
    "quantity": ["quantity", "quantite", "qte", "qty", "nombre", "nbtitres"],
    "buyingPrice": ["buyingprice", "pru", "prixderevient", "prixderevientunitaire", "coursderevient", "prixmoyen"],
    "lastPrice": ["lastprice", "cours", "derniercours", "coursactuel", "dernier"],
    "intradayVariation": ["intradayvariation", "varjour", "variationjour", "varjour%", "variationdujour"],
    "amount": ["amount", "montant", "valorisation", "montantestime", "valeurestimee"],
    "amountVariation": ["amountvariation", "+/-value", "+/-values", "plusmoinsvalue", "pvlatente", "+/-valuelatente",
                        "+/-valueslatentes", "plusoumoinsvalue", "pmvlatente"],
    "variation": ["variation", "+/-%", "perf", "performance", "var%", "var", "+/-value%", "+/-latente%"],
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
    text = re.sub(r"[\s\u00a0\u202f€%]", "", str(value))
    text = "".join(c for c in text if c.isdigit() or c in ",.-+eE")
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


def read_matrix(path: str):
    """Lignes brutes du fichier : CSV (séparateur détecté) ou première feuille Excel."""
    if path.lower().endswith((".csv", ".txt")):
        raw = open(path, "rb").read()
        try:
            text = raw.decode("utf-8-sig")
        except UnicodeDecodeError:
            text = raw.decode("cp1252")
        sample = [line for line in text.splitlines() if line.strip()][:10]

        def count_outside_quotes(line, ch):
            n, quoted = 0, False
            for c in line:
                if c == '"':
                    quoted = not quoted
                elif c == ch and not quoted:
                    n += 1
            return n

        sep = max([";", "\t", ","], key=lambda ch: max([count_outside_quotes(line, ch) for line in sample] or [0]))
        rows = csv.reader(io.StringIO(text), delimiter=sep)
        return [[c.strip() for c in r] for r in rows if any(c.strip() for c in r)]
    try:
        import openpyxl
    except ImportError:
        sys.exit("openpyxl est requis pour les fichiers .xlsx : pip install openpyxl")
    ws = openpyxl.load_workbook(path, data_only=True).worksheets[0]
    return [list(r) for r in ws.iter_rows(values_only=True) if any(c not in (None, "") for c in r)]


def read_positions(path: str):
    rows = read_matrix(path)
    synonyms = {s for values in COLS.values() for s in values}
    # La ligne d'en-tête est celle qui contient le plus de colonnes reconnues.
    head = max(range(min(15, len(rows))), key=lambda i: sum(1 for c in rows[i] if c is not None and norm_key(c) in synonyms))
    headers = list(rows[head])
    rows = rows[head:]
    index = {}
    for field, synonyms in COLS.items():
        for i, h in enumerate(headers):
            if h is not None and norm_key(h) in synonyms:
                index[field] = i
                break
    missing = [f for f in REQUIRED if f not in index]
    if missing:
        sys.exit(f"Colonnes obligatoires absentes : {', '.join(missing)}")
    get = lambda row, f: row[index[f]] if f in index and index[f] < len(row) else None  # noqa: E731
    positions, cash = [], None
    for row in rows[1:]:
        isin = re.sub(r"\s", "", str(get(row, "isin") or "")).upper()
        name = str(get(row, "name") or "").strip()
        if not isin and not name:
            continue
        if len(isin) != 12:  # total, solde espèces, sous-titre
            if re.search(r"esp[eè]ces|liquidit|solde", name, re.I) and to_num(get(row, "amount")) is not None:
                cash = to_num(get(row, "amount"))
            print(f"Ligne ignorée : {name or isin}", file=sys.stderr)
            continue
        positions.append({
            "name": name, "isin": isin,
            "qty": to_num(get(row, "quantity")), "pru": to_num(get(row, "buyingPrice")),
            "last": to_num(get(row, "lastPrice")), "dayVar": to_num(get(row, "intradayVariation")),
            "amount": to_num(get(row, "amount")), "pnlReported": to_num(get(row, "amountVariation")),
            "varReported": to_num(get(row, "variation")),
        })
    return positions, cash


def main() -> None:
    parser = argparse.ArgumentParser(description="Export BoursoBank (.csv/.xlsx) -> relevé JSON")
    parser.add_argument("export", help="fichier .csv ou .xlsx exporté de BoursoBank")
    parser.add_argument("--date", default=dt.date.today().isoformat(), help="date du relevé (AAAA-MM-JJ)")
    parser.add_argument("--cash", type=float, default=None, help="liquidités du PEA en euros")
    args = parser.parse_args()

    positions, cash_row = read_positions(args.export)
    bad = [p["isin"] for p in positions if not isin_valid(p["isin"])]
    if bad:
        print(f"Attention, ISIN invalides : {', '.join(bad)}", file=sys.stderr)
    snapshot = {
        "date": args.date, "source": "Export BoursoBank", "fileName": args.export.split("/")[-1],
        "cash": args.cash if args.cash is not None else cash_row, "importedAt": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "positions": positions,
    }
    total = sum((p["amount"] if p["amount"] is not None else (p["qty"] or 0) * (p["last"] or 0)) for p in positions)
    cost = sum((p["qty"] or 0) * (p["pru"] or 0) for p in positions)
    print(f"{len(positions)} lignes · valeur {total:,.2f} € · investi {cost:,.2f} € · +/- {total - cost:,.2f} €", file=sys.stderr)
    json.dump(snapshot, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()

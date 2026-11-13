#!/usr/bin/env python3
"""Envoie un message HTML Telegram (fichier) au bot du PEA Tracker.

Même envoi que le récapitulatif du matin : TELEGRAM_BOT_TOKEN et TELEGRAM_CHAT_ID lus dans
l'environnement, repli en texte simple si Telegram refuse la mise en forme, jeton jamais affiché.
Code de sortie : 0 envoyé ou Telegram non configuré, 2 échec d'envoi.

Usage :
    python3 scripts/send_telegram.py message.html
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from morning_brief import send_telegram  # noqa: E402  (même dossier)

if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    if send_telegram(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8").strip()) is False:
        sys.exit(2)

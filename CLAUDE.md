# PEA Tracker : notes pour Claude

Tableau de bord d'un PEA BoursoBank, publié comme artifact claude.ai privé :
<https://claude.ai/artifact/S5JWYoC7fjJWVPFwLKjNjm>.

## Règles

- **Dépôt public** : ne jamais versionner de positions, quantités, montants ou exports
  (`*.csv`, `*.xlsx` sont ignorés). Les relevés vivent dans la base de l'artifact.
- Demande d'analyse, de point ou de mise à jour du portefeuille : suivre le skill
  `.claude/skills/analyse-pea/SKILL.md`.
- Textes de l'interface en français, ton direct.

## Structure

- `index.html` : page, styles et balisage. `assets/app.js` : logique (import CSV/Excel,
  contrôles, alertes, flux, analyses, stockage `db` ou localStorage).
- `data/research.js` : base publique (consensus, fiches, idées), datée par `asOf`.
- `scripts/build_artifact.py` : assemble la page en un fichier à publier.
- `scripts/boursobank_to_json.py` : export BoursoBank vers document `snapshots/<date>`.

## Vérifier un changement

- Syntaxe : `node -e "new Function(require('fs').readFileSync('assets/app.js','utf8'))"`.
- Navigateur : servir le dossier (`python3 -m http.server`) et piloter Chromium avec
  Playwright. Le proxy de l'environnement ne laisse pas Chromium joindre cdnjs ni Google
  Fonts : télécharger ces fichiers avec curl et les servir via `context.route`.
- Publier : `python3 scripts/build_artifact.py --out <scratchpad>/pea-tracker.html`, puis
  outil `Artifact` avec `url` (lire l'artifact d'abord dans une nouvelle conversation).

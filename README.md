# PEA Tracker

Tableau de bord de suivi d'un PEA BoursoBank : import de l'export des positions,
contrôles visuels, alertes, journal des mouvements, avis des analystes sur chaque
ligne et idées de mid caps éligibles PEA.

Page statique, sans serveur ni build : HTML, CSS et JavaScript. Les fichiers CSV sont
lus par l'application elle-même ; [SheetJS](https://sheetjs.com), chargé depuis cdnjs,
sert uniquement aux fichiers Excel.

## Utilisation

1. Dans l'espace BoursoBank, exporter les positions du PEA en CSV (ou Excel `.xlsx`).
2. Ouvrir `index.html` (double-clic, ou via GitHub Pages). En haut de la Synthèse, la zone
   **Mettre à jour mon relevé** accepte le fichier de trois façons : glisser-déposer
   (n'importe où sur la page), **Choisir le fichier CSV**, ou **Coller le contenu** du CSV.
3. Vérifier les contrôles qualité affichés et la date du relevé (reprise du nom du fichier
   quand il en contient une), puis enregistrer.

Lecture du CSV : séparateur `;`, `,` ou tabulation détecté automatiquement, décimales à
virgule ou à point, encodage UTF-8 ou Windows-1252, en-têtes anglais (`name;isin;quantity;…`)
ou français (`Libellé;Code ISIN;Quantité;PRU;Cours;…`). Les lignes de titre, de total et
de solde espèces sont ignorées ; le solde espèces pré-remplit les liquidités.

À chaque nouvel import, l'application compare le relevé au précédent et en déduit
les mouvements (achat, renforcement, allègement, vente), réévalue les contrôles et
les alertes.

## Ce que fait chaque onglet

| Onglet | Contenu |
|---|---|
| Synthèse | Zone « Mettre à jour mon relevé », dernière analyse, valeur, +/- value (avec et sans titres radiés), indice de santé, actions prioritaires, répartition, performance par ligne, avis des analystes |
| Analyse | Rapport créé à chaque import ou à la demande : ce qui a changé, plan d'action, prochain versement, commentaire ligne par ligne, commentaire rédigé par Claude ; historique des analyses |
| Positions | Tableau triable, poids par ligne, consensus, potentiel vs objectif, fiche détaillée par ligne |
| Contrôles | 22 contrôles en vert / orange / rouge : qualité du relevé, concentration, pertes, titres radiés, socle diversifié, doublons titres/ETF, analystes, cadre PEA |
| Alertes | Seuils sur le cours, la +/- value, le poids, la variation du jour, le potentiel, un secteur ou le portefeuille ; alertes recommandées en un clic |
| Flux | Chaîne de traitement d'un relevé, évolution de la valeur, plafond des versements (150 000 €), journal des mouvements, relevés enregistrés |
| Idées mid caps | Valeurs moyennes non détenues avec consensus à l'achat, classées par un score sur 100 |

### Analyses

Une nouvelle analyse est faite à chaque fois :

- **à chaque import** : la page crée automatiquement l'analyse chiffrée du relevé (comparée au
  relevé précédent) puis, dans l'artifact claude.ai, demande à Claude d'en rédiger un
  commentaire (capacité `sample`, sur le compte Claude de l'utilisateur ; option dans Réglages) ;
- **à la demande dans la page** : bouton « Nouvelle analyse » de l'onglet Analyse ;
- **à la demande dans une conversation avec Claude** : le skill
  `.claude/skills/analyse-pea` relit les relevés de l'artifact, rafraîchit les consensus sur le
  web, met à jour `data/research.js`, republie la page et y enregistre l'analyse rédigée.

Le commentaire rédigé dans la page n'a pas accès à internet : il s'appuie sur les données du
relevé et sur la base de recherche datée. Seule l'analyse demandée en conversation rafraîchit
les consensus.

### Lecture du consensus

Échelle FactSet affichée par Boursorama : 1 = Acheter, 2 = Renforcer, 3 = Conserver,
4 = Alléger, 5 = Vendre. Pour un détenteur, une note médiane ≤ 2,5 se lit
**Renforcer**, ≤ 3,5 **Conserver**, ≤ 4,5 **Alléger**, au-delà **Vendre**.

### Score des idées

`0,4 × potentiel (plafonné à 60 %) + 0,3 × force du consensus + 0,2 × valorisation (PER 2026e) + 0,1 × nombre d'analystes`.
C'est un indicateur de tri, pas une recommandation.

## Données et confidentialité

Ce dépôt est **public** : il ne contient aucune donnée personnelle.

- `data/research.js` : uniquement des données de marché publiques (consensus, objectifs,
  métadonnées des instruments, idées). Date de mise à jour dans `asOf`.
- Les relevés, alertes, mouvements et réglages restent dans le navigateur
  (`localStorage`). Une sauvegarde JSON est disponible dans **Réglages**.
- Publiée comme artifact claude.ai, la page enregistre ces données dans la base privée
  de l'artifact : elles sont accessibles sur tous les appareils, et Claude peut les relire
  pour mettre à jour l'analyse.
- `.gitignore` exclut les exports `.xlsx` / `.csv` et le dossier `dist/`.

## Mettre à jour la recherche

Modifier `data/research.js` (bloc `consensus` d'une valeur, `asOf`), ou demander à
Claude de le faire à partir des consensus du moment. Le contrôle P13 passe en
vigilance quand les consensus ont plus de 60 jours.

## Scripts

```bash
# Vérifier / convertir un export BoursoBank (.csv ou .xlsx) en relevé JSON (document snapshots/<date>)
python3 scripts/boursobank_to_json.py export.csv --date 2026-10-03 --cash 85.40 > releve.json

# Assembler la page en un seul fichier autonome (scripts en ligne) pour la publier
python3 scripts/build_artifact.py --out dist/pea-tracker.html
```

## Structure

```
index.html              page, styles et balisage
assets/app.js           import, contrôles, alertes, flux, graphiques, stockage
data/research.js        base de recherche publique (consensus, idées)
scripts/                conversion de l'export, assemblage de la page autonome
```

## Avertissement

Outil d'aide à la décision, pas un conseil en investissement personnalisé. Les
consensus d'analystes sont datés et souvent révisés ; les vérifier avant toute opération.

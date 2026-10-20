/*
 * PEA Tracker — base de recherche (données de marché publiques uniquement).
 *
 * Ce fichier ne contient AUCUNE position personnelle : seulement l'univers
 * d'instruments suivis (métadonnées, consensus des analystes, avis, idées).
 * Les positions sont importées dans le navigateur depuis l'export BoursoBank.
 *
 * Échelle de consensus (FactSet / Boursorama) :
 *   1 = Acheter · 2 = Renforcer · 3 = Conserver · 4 = Alléger · 5 = Vendre
 *
 * Mise à jour : modifier `asOf`, puis les blocs `consensus` concernés.
 * `yahoo` : symbole utilisé par scripts/daily_update.py pour le cours du jour.
 * `events` : publications à venir ({ date, label }), reprises par le récapitulatif du matin.
 * Les mises à jour quotidiennes de la routine sont écrites dans la base de
 * l'artifact (collection `research`) et priment sur ce fichier.
 */
window.PEA_RESEARCH = {
  version: 1,
  asOf: '2026-10-18',
  source: 'Consensus FactSet affiché par Boursorama (consulté le 18/10/2026, cours du 16/10), Zonebourse, communiqués des sociétés.',

  instruments: {
    /* ------------------------------------------------------------ ETF */
    'FR001400U5Q4': {
      yahoo: 'DCAM.PA', name: 'Amundi PEA Monde (MSCI World)', short: 'ETF Monde (MSCI World)', ticker: 'DCAM',
      kind: 'etf', sector: 'Monde diversifié', diversified: true, ter: 0.20,
      zones: { 'Amérique du Nord': 0.75, 'Europe': 0.16, 'Asie-Pacifique': 0.09 },
      view: { label: 'Renforcer', why: "Socle diversifié idéal d'un PEA : ~1 300 sociétés de 23 pays développés, frais de 0,20 %/an, capitalisant. C'est le support à privilégier pour les versements réguliers." },
      facts: ['Lancé le 04/03/2025, réplication synthétique (éligible PEA), indice MSCI World EUR dividendes nets réinvestis.'],
      risks: ['Concentration sur les États-Unis (~70 %) et sur les grandes valeurs technologiques.'],
      sources: [{ label: 'Fiche Amundi ETF', url: 'https://www.amundietf.fr' }]
    },
    'LU1834988278': {
      yahoo: 'ENRG.PA', name: 'Amundi STOXX Europe 600 Energy Screened', short: 'ETF Énergie Europe', ticker: 'ENRG',
      kind: 'etf', sector: 'Énergie', zones: { 'Europe': 1 }, contains: ['FR0000120271'],
      view: { label: 'Conserver', why: "Très belle performance, mais l'énergie est un secteur cyclique lié au prix du pétrole. Ne plus renforcer ; alléger si la poche énergie dépasse le seuil de concentration." },
      facts: ['Expose aux majors pétrolières et gazières européennes (Shell, TotalEnergies, BP, Eni…).'],
      risks: ['Forte sensibilité au prix du baril et aux décisions de l’OPEP+.'],
      sources: []
    },
    'LU1834988518': {
      yahoo: 'TNO.PA', name: 'Amundi STOXX Europe 600 Technology', short: 'ETF Technologie Europe', ticker: 'TNO',
      kind: 'etf', sector: 'Technologie', zones: { 'Europe': 1 },
      view: { label: 'Conserver', why: 'Complément de croissance européen (semi-conducteurs, logiciels). Poids à surveiller car très concentré sur quelques valeurs (ASML, SAP).' },
      facts: ['Principales lignes : ASML, SAP, et les équipementiers de semi-conducteurs européens.'],
      risks: ['Concentration sur 2 ou 3 valeurs ; volatilité supérieure au marché.'],
      sources: []
    },
    'LU1834987890': {
      yahoo: 'IND.PA', name: 'Amundi STOXX Europe 600 Industrials', short: 'ETF Industrie Europe', ticker: 'IND',
      kind: 'etf', sector: 'Industrie', zones: { 'Europe': 1 },
      view: { label: 'Conserver', why: 'Exposition cohérente au cycle industriel et à la défense européenne. Pas de raison de vendre.' },
      facts: [], risks: ['Cyclique : sensible au ralentissement économique.'], sources: []
    },
    'LU1681041460': {
      yahoo: 'MCEU.PA', name: 'Amundi MSCI Europe Momentum Factor', short: 'ETF Europe Momentum', ticker: 'MCEU',
      kind: 'etf', sector: 'Europe diversifié', diversified: true, zones: { 'Europe': 1 },
      view: { label: 'Conserver', why: 'Stratégie factorielle (valeurs en tendance haussière) bien diversifiée en Europe. Fait doublon partiel avec les ETF sectoriels.' },
      facts: [], risks: ['Le facteur momentum peut sous-performer brutalement lors des retournements de marché.'], sources: []
    },

    /* --------------------------------------------------- Actions suivies */
    'FR0000120271': {
      yahoo: 'TTE.PA', name: 'TotalEnergies', ticker: 'TTE', kind: 'action', sector: 'Énergie', cap: 'Large cap',
      market: 'Euronext Paris', zones: { 'Europe': 1 },
      consensus: { buy: 13, outperform: 1, hold: 8, underperform: 2, sell: 0, median: 1.96, target: 89.19, price: 80.71, priceDate: '2026-10-16' },
      view: { label: 'Conserver', why: "Consensus positif (14 avis positifs sur 24) et objectif médian relevé à 89,19 €, soit ~10 % de potentiel. Le cours a déjà pris ~8 % depuis le relevé et la valeur fait doublon avec l'ETF Énergie : ne pas renforcer." },
      facts: ['Objectif médian relevé de 82,60 € à 89,19 € (24 analystes : 13 Acheter, 1 Renforcer, 8 Conserver, 2 Alléger).', 'UBS relève son objectif à 88 € (Achat, 21/09/2026) ; Oddo BHF vise aussi 88 €.', 'PER 2026e ~8, dividende 2026e ~3,60 €/action.'],
      risks: ['Prix du pétrole et du gaz ; fiscalité exceptionnelle sur les énergéticiens.'],
      sources: [{ label: 'Consensus Boursorama', url: 'https://www.boursorama.com/cours/consensus/1rPTTE/' }]
    },
    'FR0000066672': {
      yahoo: 'GLO.PA', name: 'GL Events', ticker: 'GLO', kind: 'action', sector: 'Événementiel', cap: 'Small cap',
      market: 'Euronext Paris', zones: { 'Europe': 1 },
      consensus: { buy: 6, outperform: 0, hold: 0, underperform: 0, sell: 0, median: 1, target: 38.77, price: 31.40, priceDate: '2026-10-16' },
      view: { label: 'Conserver', why: "La thèse se confirme : chiffre d'affaires du 3e trimestre +44 % et objectifs 2026 relevés. Le titre a pris ~30 % depuis le relevé ; il reste ~23 % de potentiel vs l'objectif de 38,77 €. Conserver, sans renforcer après une telle hausse (ligne déjà à ~8,6 %)." },
      facts: ['T3 2026 : CA 415,9 M€ (+44,3 %) ; croissance 2026 attendue désormais > 10 % à changes et périmètre constants (contre +8 %).', '15/10/2026 : +23 à +28 % en séance, meilleure séance en 25 ans. TP ICAP Midcap relève son objectif à 38 € (Achat), Portzamparc maintient 38 € (Achat).', 'Une société liée au président Olivier Ginon achète des titres (dont 12 000 le 15/10).', '02/10/2026 : concession du Lima Convention Center (Pérou).'],
      risks: ['Après +30 % en quelques séances, le titre peut consolider.', 'Activité dépendante des grands événements ; endettement lié aux sites (Venues).'],
      sources: [{ label: 'Consensus Boursorama', url: 'https://www.boursorama.com/cours/consensus/1rPGLO/' }, { label: 'Convictions Portzamparc S2 2026', url: 'https://www.boursorama.com/bourse/actualites/valeurs-moyennes-les-8-convictions-de-portzamparc-pour-le-second-semestre-92b55c32855021abd2eebb70a1ca0b5f' }]
    },
    'FR0004159473': {
      yahoo: 'ALHEX.PA', name: 'Hexaom', ticker: 'ALHEX', kind: 'action', sector: 'Construction résidentielle', cap: 'Small cap',
      market: 'Euronext Growth', zones: { 'Europe': 1 },
      consensus: { buy: 2, outperform: 0, hold: 0, underperform: 0, sell: 0, median: 1, target: 51.00, price: 22.30, priceDate: '2026-10-16' },
      view: { label: 'Conserver', why: "Remonte à 22,30 € (+10 % depuis le relevé). Les 2 analystes qui la suivent restent à l'achat (objectif 51 €), mais ce potentiel repose sur une couverture très étroite. Conserver sans moyenner à la baisse." },
      facts: ['S1 2026 : CA 343,9 M€ (+12,3 %), ROC 19,5 M€ (+59,8 %), RN part du groupe 12,6 M€ (+125 %).', 'Objectif 2026 : CA ~+20 % et marge opérationnelle > 5 %.', 'Consensus à 38,75 € en février 2026, relevé depuis.'],
      risks: ['Repli des ventes de maisons à l’été 2026 ; marché immobilier sensible aux taux.', 'Petite capitalisation peu liquide (Euronext Growth).'],
      sources: [{ label: 'Consensus Boursorama', url: 'https://www.boursorama.com/cours/consensus/1rPALHEX/' }]
    },
    'FR0000075442': {
      yahoo: 'ALLDL.PA', name: 'Groupe LDLC', ticker: 'ALLDL', kind: 'action', sector: 'Distribution informatique', cap: 'Small cap',
      market: 'Euronext Growth', zones: { 'Europe': 1 },
      consensus: { buy: 1, outperform: 0, hold: 0, underperform: 0, sell: 0, median: 1, target: 16.20, price: 8.90, priceDate: '2026-10-16' },
      view: { label: 'Conserver', why: "Sous surveillance : −25 % depuis le relevé sans communiqué de la société, et l'unique objectif d'analyste (16,20 €, juin 2026) est sans doute dépassé. Ne pas renforcer avant le chiffre d'affaires du 29/10 ; la ligne ne pèse que ~3,6 %." },
      facts: ['Octobre 2026 : de 11,82 € (02/10) à 8,30 € (15/10) puis 8,90 € (16/10), sans communiqué ; le dividende de 0,73 € détaché le 05/10 n’en explique qu’une partie. Environ −50 % depuis le 1er janvier.', 'Prochain chiffre d’affaires (T2 2026/27) annoncé pour le 29/10/2026.', 'Exercice 2025/26 : CA 554,1 M€ (+3,7 %), RN 10,2 M€ ; T1 2026/27 : CA −14,3 %.'],
      risks: ['Un seul analyste, dont l’objectif date de juin 2026, avant la baisse.', 'Cycle du matériel informatique grand public.'],
      events: [{ date: '2026-10-29', label: 'chiffre d’affaires du 2e trimestre 2026/27' }],
      sources: [{ label: 'Consensus Zonebourse', url: 'https://www.zonebourse.com/cours/action/GROUPE-LDLC-5107/consensus/' }]
    },
    'FR0000054231': {
      yahoo: 'HCO.PA', name: 'HighCo', ticker: 'HCO', kind: 'action', sector: 'Marketing & médias', cap: 'Micro cap',
      market: 'Euronext Paris', zones: { 'Europe': 1 },
      consensus: { buy: 3, outperform: 0, hold: 0, underperform: 0, sell: 0, median: 1, target: 4.70, price: 3.575, priceDate: '2026-10-16' },
      view: { label: 'Conserver', why: "3 analystes à l'achat, objectif médian relevé à 4,70 € (~31 % de potentiel), rendement estimé ~7 %. La ligne ne pèse que ~1,5 % : la porter à ~5 % ou la céder." },
      facts: ['Consensus : 3 analystes à l’achat, objectif médian relevé de 4,50 € à 4,70 €.', 'Chiffre d’affaires du 3e trimestre attendu le 20/10/2026.', 'S1 2026 : marge brute 39,2 M€ (+26,7 %) avec Sogec et BudgetBox ; marge opérationnelle ajustée visée ~13 %.'],
      risks: ['Retard du Retail Media ; objectif de marge brute 2026 légèrement abaissé.'],
      events: [{ date: '2026-10-20', label: 'chiffre d’affaires du 3e trimestre' }],
      sources: [{ label: 'Consensus Boursorama', url: 'https://www.boursorama.com/cours/consensus/1rPHCO/' }]
    },
    'FR0013018041': {
      name: 'Navya', ticker: 'NAVYA', kind: 'action', sector: 'Mobilité autonome', cap: 'Micro cap',
      market: 'Radiée', zones: { 'Europe': 1 }, nonTradable: true,
      view: { label: 'Sortir', why: "Société en liquidation judiciaire depuis avril 2023, cotation suspendue puis radiation : les titres n'ont plus de valeur. Demander leur retrait du PEA à la banque (possible sans clôturer le plan)." },
      facts: ['Le cours de 0,03 € affiché n’est pas négociable.', 'En PEA, la perte n’est pas imputable fiscalement.'],
      risks: [],
      sources: [{ label: 'AMF : titres de société en liquidation dans un PEA', url: 'https://www.amf-france.org/fr/le-mediateur/journal-de-bord-du-mediateur/dossiers-du-mois/pea-les-titres-non-cotes-dune-societe-en-liquidation-judiciaire-peuvent-etre-retires-du-plan-sans-en' }]
    },

    /* ------------------------------------------------- Idées mid caps */
    'FR0005691656': {
      yahoo: 'TRI.PA', name: 'Trigano', ticker: 'TRI', kind: 'action', sector: 'Loisirs (camping-cars)', cap: 'Mid cap',
      market: 'Euronext Paris', zones: { 'Europe': 1 }, idea: true,
      consensus: { buy: 7, outperform: 1, hold: 0, underperform: 0, sell: 0, median: 1.13, target: 177.75, price: 128.90, priceDate: '2026-10-16' },
      view: { label: 'Conserver', why: "Détenue depuis le 20/10 (1 titre). 8 analystes, quasi tous à l'achat, objectif médian 177,75 € (~40 % de potentiel) et PER ~9. Conserver ; un seul titre pèse déjà ~7 % du PEA." },
      per: [8.9, null], yield: 3.1,
      thesis: 'Leader européen des véhicules de loisirs, valorisation modeste (PER ~9) et consensus quasi unanime à l’achat (8 analystes). Objectif médian abaissé de 188,71 € à 177,75 €.',
      risks: ['Demande cyclique (pouvoir d’achat, taux) ; niveau des stocks chez les distributeurs.'],
      sources: [{ label: 'Consensus Boursorama', url: 'https://www.boursorama.com/cours/consensus/1rPTRI/' }]
    },
    'FR0010929125': {
      yahoo: 'IDL.PA', name: 'ID Logistics', ticker: 'IDL', kind: 'action', sector: 'Logistique', cap: 'Mid cap',
      market: 'Euronext Paris', zones: { 'Europe': 1 }, idea: true,
      consensus: { buy: 6, outperform: 1, hold: 0, underperform: 0, sell: 0, median: 1.14, target: 506, price: 335.00, priceDate: '2026-10-16' },
      per: [28.0, null], yield: 0,
      thesis: 'Logistique contractuelle (e-commerce, distribution) en croissance régulière, expansion aux États-Unis. 7 analystes positifs.',
      risks: ['Valorisation exigeante (PER ~30) ; marges structurellement fines.'],
      sources: [{ label: 'Consensus Boursorama', url: 'https://www.boursorama.com/cours/consensus/1rPIDL/' }]
    },
    'FR0000121709': {
      yahoo: 'SK.PA', name: 'SEB', ticker: 'SK', kind: 'action', sector: 'Petit électroménager', cap: 'Mid cap',
      market: 'Euronext Paris', zones: { 'Europe': 1 }, idea: true,
      consensus: { buy: 7, outperform: 1, hold: 3, underperform: 0, sell: 0, median: 1.64, target: 73.95, price: 57.80, priceDate: '2026-10-16' },
      view: { label: 'Conserver', why: "Détenue depuis le 20/10 (3 titres). 8 avis positifs sur 11, objectif médian 73,95 € (~30 % de potentiel), PER ~10 et rendement ~5 %. Conserver." },
      per: [10.2, null], yield: 4.9,
      thesis: 'Leader mondial du petit équipement domestique, rendement ~5 % et PER ~10. Conviction Portzamparc S2 2026 (objectif 99 €).',
      risks: ['Consommation des ménages, droits de douane américains, concurrence chinoise.'],
      sources: [{ label: 'Consensus Boursorama', url: 'https://www.boursorama.com/cours/consensus/1rPSK/' }]
    },
    'FR0000063737': {
      yahoo: 'AUB.PA', name: 'Aubay', ticker: 'AUB', kind: 'action', sector: 'Services informatiques', cap: 'Small cap',
      market: 'Euronext Paris', zones: { 'Europe': 1 }, idea: true,
      consensus: { buy: 3, outperform: 1, hold: 0, underperform: 0, sell: 0, median: 1.25, target: 68.38, price: 49.45, priceDate: '2026-10-16' },
      per: [13.2, null], yield: 3.0,
      thesis: 'ESN rentable au bilan sain, bien positionnée sur la banque-assurance en Europe. 4 analystes positifs.',
      risks: ['Ralentissement des budgets IT ; pression de l’IA générative sur la régie.'],
      sources: [{ label: 'Consensus Boursorama', url: 'https://www.boursorama.com/cours/consensus/1rPAUB/' }]
    },
    'FR0000031577': {
      yahoo: 'VIRP.PA', name: 'Virbac', ticker: 'VIRP', kind: 'action', sector: 'Santé animale', cap: 'Mid cap',
      market: 'Euronext Paris', zones: { 'Europe': 1 }, idea: true,
      consensus: { buy: 5, outperform: 1, hold: 1, underperform: 0, sell: 0, median: 1.43, target: 412.43, price: 337.00, priceDate: '2026-10-16' },
      per: [16.3, null], yield: 0.5,
      thesis: 'Santé animale : croissance régulière et profil défensif, peu corrélé au reste du portefeuille.',
      risks: ['Effets de change (pays émergents) ; intégration des acquisitions.'],
      sources: [{ label: 'Consensus Boursorama', url: 'https://www.boursorama.com/cours/consensus/1rPVIRP/' }]
    },
    'FR0000038242': {
      yahoo: 'LBIRD.PA', name: 'Lumibird', ticker: 'LBIRD', kind: 'action', sector: 'Lasers & photonique', cap: 'Small cap',
      market: 'Euronext Paris', zones: { 'Europe': 1 }, idea: true,
      consensus: { buy: 3, outperform: 0, hold: 0, underperform: 0, sell: 0, median: 1, target: 31.83, price: 22.60, priceDate: '2026-10-16' },
      view: { label: 'Conserver', why: "Détenue depuis le 20/10 (4 titres). 3 analystes à l'achat, objectif médian 31,83 € (~40 % de potentiel), mais PER 2026e ~24 : valeur plus volatile. Conserver sans renforcer." },
      per: [23.8, null], yield: 0,
      thesis: 'Lasers pour la défense, le médical et le lidar ; redressement opérationnel. Conviction Portzamparc S2 2026 (objectif 33,10 €).',
      risks: ['Valorisation 2026 élevée (PER ~29) ; exécution du redressement.'],
      sources: [{ label: 'Consensus Boursorama', url: 'https://www.boursorama.com/cours/consensus/1rPLBIRD/' }]
    },
    'FR001400Q9V2': {
      yahoo: 'EXENS.PA', name: 'Exosens', ticker: 'EXENS', kind: 'action', sector: 'Défense (optronique)', cap: 'Mid cap',
      market: 'Euronext Paris', zones: { 'Europe': 1 }, idea: true,
      consensus: { buy: 8, outperform: 1, hold: 3, underperform: 0, sell: 0, median: 1.58, target: 69.42, price: 59.45, priceDate: '2026-10-16' },
      per: [29.4, null], yield: 0.7,
      thesis: 'Vision nocturne et détection, portée par la hausse des budgets de défense européens. Une grande partie du potentiel est déjà dans le cours.',
      risks: ['Valorisation exigeante (PER ~35) ; dépendance aux commandes militaires.'],
      sources: [{ label: 'Consensus Boursorama', url: 'https://www.boursorama.com/cours/consensus/1rPEXENS/' }]
    },
    'FR0000065484': {
      yahoo: 'LSS.PA', name: 'Lectra', ticker: 'LSS', kind: 'action', sector: 'Logiciels industriels', cap: 'Small cap',
      market: 'Euronext Paris', zones: { 'Europe': 1 }, idea: true,
      consensus: { buy: 3, outperform: 1, hold: 1, underperform: 0, sell: 0, median: 1.6, target: 24.20, price: 20.85, priceDate: '2026-10-16' },
      per: [27.5, null], yield: 1.9,
      thesis: 'Logiciels et équipements de découpe pour la mode, l’automobile et l’ameublement ; modèle de plus en plus récurrent (SaaS).',
      risks: ['Potentiel limité (~18 %) ; secteurs clients cycliques.'],
      sources: [{ label: 'Consensus Boursorama', url: 'https://www.boursorama.com/cours/consensus/1rPLSS/' }]
    },

    /* ------------------------------------------------- Idées ETF (PEA) */
    'FR0013412020': {
      yahoo: 'PAEEM.PA', name: 'Amundi PEA Émergent ESG Transition', short: 'ETF Pays émergents', ticker: 'PAEEM',
      kind: 'etf', etfIdea: true, sector: 'Émergents diversifié', zones: { 'Pays émergents': 1 },
      ter: 0.30, aum: 950, aumDate: '2026-10-16', replication: 'Synthétique', index: 'MSCI EM ESG Broad Transition (filtre ESG)',
      price: 34.815, priceDate: '2026-10-20', perf1y: 23.0,
      role: 'Ajoute les pays émergents (Chine, Inde, Taïwan, Corée…), absents de ton PEA.',
      risks: ['Volatilité plus forte et risque politique ; indice filtré ESG, un peu différent du MSCI Emerging Markets classique.'],
      sources: [{ label: 'Comparatif ETF PEA (16/10/2026)', url: 'https://www.epargnant30.fr/etf-pea/' }]
    },
    'FR0013411980': {
      yahoo: 'PTPXE.PA', name: 'Amundi PEA Japon (TOPIX)', short: 'ETF Japon', ticker: 'PTPXE',
      kind: 'etf', etfIdea: true, sector: 'Japon diversifié', zones: { 'Asie-Pacifique': 1 },
      ter: 0.20, aum: 210, aumDate: '2026-10-16', replication: 'Synthétique', index: 'TOPIX (≈ 1 700 sociétés japonaises)',
      price: 39.625, priceDate: '2026-10-20', perf1y: 23.7,
      role: 'Diversifie hors Europe et hors États-Unis, avec des frais bas.',
      risks: ['Exposition au yen (non couverte) ; le Japon ne pèse qu’environ 5 % dans ton ETF Monde.'],
      sources: [{ label: 'Comparatif ETF PEA (16/10/2026)', url: 'https://www.epargnant30.fr/etf-pea/' }]
    },
    'FR0011871128': {
      yahoo: 'PSP5.PA', name: 'Amundi PEA S&P 500', short: 'ETF S&P 500', ticker: 'PSP5',
      kind: 'etf', etfIdea: true, sector: 'États-Unis diversifié', zones: { 'Amérique du Nord': 1 }, overlapCore: 70,
      ter: 0.12, aum: 1540, aumDate: '2026-10-16', replication: 'Synthétique', index: 'S&P 500 (500 grandes sociétés américaines)',
      price: 60.29, priceDate: '2026-10-20', perf1y: 17.1,
      role: 'Exposition aux États-Unis parmi les moins chères du PEA.',
      risks: ['Recoupe largement ton ETF Monde (≈ 70 % américain) ; dollar non couvert.'],
      sources: [{ label: 'Liste ETF PEA (09/10/2026)', url: 'https://pea.fr/guides/etf-pea-eligibles-guide-complet-frais-encours/' }]
    },
    'LU1834986900': {
      yahoo: 'HLT.PA', name: 'Amundi STOXX Europe 600 Healthcare', short: 'ETF Santé Europe', ticker: 'HLT',
      kind: 'etf', etfIdea: true, sector: 'Santé', zones: { 'Europe': 1 }, defensive: true,
      ter: 0.30, aum: 895, aumDate: '2025-12-31', replication: 'Synthétique', index: 'STOXX Europe 600 Health Care',
      price: 155.34, priceDate: '2026-10-20', perf1y: 3.9,
      role: 'Secteur défensif (Novo Nordisk, AstraZeneca, Roche…) qui équilibre l’énergie, l’industrie et la tech.',
      risks: ['Concentré sur quelques géants pharmaceutiques ; une part coûte ~155 €.'],
      sources: [{ label: 'Fiche ETF (francetransactions)', url: 'https://www.francetransactions.com/bourse/etf/amundi-stoxx-europe-600-hlthcare-etf-acc-lu1834986900.html' }]
    },
    'LU1598689153': {
      yahoo: 'MMS.PA', name: 'Amundi MSCI EMU Small Cap ESG Broad Transition', short: 'ETF Small caps zone euro', ticker: 'MMS',
      kind: 'etf', etfIdea: true, sector: 'Small caps zone euro', zones: { 'Europe': 1 }, smallcaps: true,
      ter: 0.40, aum: 570, aumDate: '2026-10-16', replication: 'Physique (distribuant)', index: 'MSCI EMU Small Cap ESG Broad Transition',
      price: 422.45, priceDate: '2026-10-20', perf1y: 6.0,
      role: 'Petites et moyennes valeurs de la zone euro en une seule ligne, sans choisir de titres.',
      risks: ['Part chère (~420 €) ; frais les plus élevés de la sélection ; performance indiquée hors dividendes (part distribuante).'],
      sources: [{ label: 'Comparatif ETF PEA (16/10/2026)', url: 'https://www.epargnant30.fr/etf-pea/' }]
    },
    'FR0011871110': {
      yahoo: 'PUST.PA', name: 'Amundi PEA Nasdaq-100', short: 'ETF Nasdaq-100', ticker: 'PUST',
      kind: 'etf', etfIdea: true, sector: 'Technologie', zones: { 'Amérique du Nord': 1 }, overlapCore: 45, overlapSector: 'Technologie',
      ter: 0.30, aum: 1340, aumDate: '2026-10-16', replication: 'Synthétique', index: 'Nasdaq-100',
      price: 105.38, priceDate: '2026-10-20', perf1y: 20.2,
      role: 'Croissance technologique américaine (Apple, Microsoft, Nvidia…).',
      risks: ['Très concentré sur une dizaine de géants de la tech, déjà présents dans ton ETF Monde ; volatil.'],
      sources: [{ label: 'Liste ETF PEA (09/10/2026)', url: 'https://pea.fr/guides/etf-pea-eligibles-guide-complet-frais-encours/' }]
    }
  },

  /* ETF examinés mais écartés. */
  excludedEtfs: [
    { name: 'Amundi PEA Global (MSCI ACWI, GPEA)', reason: 'Lancé en juillet 2026, ~80 M€ d’encours : trop jeune. Ton ETF Monde couvre déjà les pays développés.' },
    { name: 'Amundi MSCI World (CW8)', reason: 'Mêmes sociétés que ton ETF Monde, mais 0,38 % de frais contre 0,20 %.' },
    { name: 'BNP Paribas Easy MSCI Europe Small Caps (LU1291101555)', reason: 'Non éligible au PEA selon plusieurs sources.' },
    { name: 'Amundi Russell 2000 (RS2K)', reason: 'Petites valeurs américaines, part à ~370 € et frais de 0,35 % : pas prioritaire pour ce portefeuille.' }
  ],

  /* Valeurs examinées mais écartées de la sélection, avec la raison. */
  excluded: [
    { name: 'Wavestone', reason: 'Révisions à la baisse : objectif médian ramené de ~65 € à 47,92 €, 3 analystes sur 5 passés à Conserver.' },
    { name: 'Exail Technologies', reason: 'Consensus Conserver (6 avis sur 8) et PER 2026e ~87 après un fort parcours boursier.' },
    { name: 'Linedata', reason: 'Pas de consensus publié par FactSet sur Boursorama ; difficile à suivre.' }
  ]
};

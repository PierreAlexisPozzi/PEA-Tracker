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
 * Les mises à jour quotidiennes de la routine sont écrites dans la base de
 * l'artifact (collection `research`) et priment sur ce fichier.
 */
window.PEA_RESEARCH = {
  version: 1,
  asOf: '2026-10-03',
  source: 'Consensus FactSet affiché par Boursorama (consulté le 03/10/2026), Zonebourse, communiqués des sociétés.',

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
      consensus: { buy: 13, outperform: 1, hold: 7, underperform: 2, sell: 0, median: 1.91, target: 82.60, price: 74.46, priceDate: '2026-10-03' },
      view: { label: 'Conserver', why: "Consensus positif (14 avis positifs sur 23) et rendement estimé ~4,8 %. Mais l'objectif moyen ne laisse que ~11 % de potentiel et la valeur fait doublon avec l'ETF Énergie." },
      facts: ['Objectif médian 82,60 € (23 analystes : 13 Acheter, 1 Renforcer, 7 Conserver, 2 Alléger).', 'PER 2026e ~8, dividende 2026e ~3,60 €/action.'],
      risks: ['Prix du pétrole et du gaz ; fiscalité exceptionnelle sur les énergéticiens.'],
      sources: [{ label: 'Consensus Boursorama', url: 'https://www.boursorama.com/cours/consensus/1rPTTE/' }]
    },
    'FR0000066672': {
      yahoo: 'GLO.PA', name: 'GL Events', ticker: 'GLO', kind: 'action', sector: 'Événementiel', cap: 'Small cap',
      market: 'Euronext Paris', zones: { 'Europe': 1 },
      consensus: { buy: 6, outperform: 0, hold: 0, underperform: 0, sell: 0, median: 1, target: 38.77, price: 24.20, priceDate: '2026-10-03' },
      view: { label: 'Conserver', why: "6 analystes sur 6 à l'achat et ~60 % de potentiel. Les résultats du 1er semestre sont solides, malgré la baisse du titre. Renforcement possible, en limitant la ligne à ~8 % du portefeuille." },
      facts: ['S1 2026 : CA 966 M€ (+9 %), RN part du groupe 55 M€ (+6 %), objectifs annuels confirmés.', 'Fait partie des 8 convictions de Portzamparc pour le S2 2026 (objectif 38 €).', '02/10/2026 : obtention de la concession du Lima Convention Center (Pérou).'],
      risks: ['Activité dépendante des grands événements ; endettement lié aux sites (Venues).', 'Titre en baisse d’environ 17 % sur un an malgré la croissance.'],
      sources: [{ label: 'Consensus Boursorama', url: 'https://www.boursorama.com/cours/consensus/1rPGLO/' }, { label: 'Convictions Portzamparc S2 2026', url: 'https://www.boursorama.com/bourse/actualites/valeurs-moyennes-les-8-convictions-de-portzamparc-pour-le-second-semestre-92b55c32855021abd2eebb70a1ca0b5f' }]
    },
    'FR0004159473': {
      yahoo: 'ALHEX.PA', name: 'Hexaom', ticker: 'ALHEX', kind: 'action', sector: 'Construction résidentielle', cap: 'Small cap',
      market: 'Euronext Growth', zones: { 'Europe': 1 },
      consensus: { buy: 2, outperform: 0, hold: 0, underperform: 0, sell: 0, median: 1, target: 51.00, price: 20.20, priceDate: '2026-10-03' },
      view: { label: 'Conserver', why: "Les 2 analystes qui suivent la valeur sont à l'achat. Le potentiel affiché (+150 %) repose sur une couverture très étroite : à prendre avec prudence. Ne pas moyenner à la baisse au-delà de ~7 % du portefeuille." },
      facts: ['S1 2026 : CA 343,9 M€ (+12,3 %), ROC 19,5 M€ (+59,8 %), RN part du groupe 12,6 M€ (+125 %).', 'Objectif 2026 : CA ~+20 % et marge opérationnelle > 5 %.', 'Consensus à 38,75 € en février 2026, relevé depuis.'],
      risks: ['Repli des ventes de maisons à l’été 2026 ; marché immobilier sensible aux taux.', 'Petite capitalisation peu liquide (Euronext Growth).'],
      sources: [{ label: 'Consensus Boursorama', url: 'https://www.boursorama.com/cours/consensus/1rPALHEX/' }]
    },
    'FR0000075442': {
      yahoo: 'ALLDL.PA', name: 'Groupe LDLC', ticker: 'ALLDL', kind: 'action', sector: 'Distribution informatique', cap: 'Small cap',
      market: 'Euronext Growth', zones: { 'Europe': 1 },
      consensus: { buy: 1, outperform: 0, hold: 0, underperform: 0, sell: 0, median: 1, target: 16.20, price: 11.82, priceDate: '2026-10-02' },
      view: { label: 'Conserver', why: 'Un seul analyste (TP ICAP Midcap, Achat, objectif 16,20 €). Rentabilité record sur 2025/26 et dividende de 0,73 € (~6 %), mais le 1er trimestre 2026/27 recule.' },
      facts: ['Exercice 2025/26 : CA 554,1 M€ (+3,7 %), RN 10,2 M€ (record hors Covid).', 'T1 2026/27 : CA 109 M€ (-14,3 %), demande grand public prudente.', 'Dividende 0,73 € approuvé le 25/09/2026.'],
      risks: ['Consensus fondé sur un seul analyste.', 'Cycle du matériel informatique grand public.'],
      sources: [{ label: 'Consensus Zonebourse', url: 'https://www.zonebourse.com/cours/action/GROUPE-LDLC-5107/consensus/' }]
    },
    'FR0000054231': {
      yahoo: 'HCO.PA', name: 'HighCo', ticker: 'HCO', kind: 'action', sector: 'Marketing & médias', cap: 'Micro cap',
      market: 'Euronext Paris', zones: { 'Europe': 1 },
      consensus: { buy: 2, outperform: 0, hold: 0, underperform: 0, sell: 0, median: 1, target: 4.50, price: 3.46, priceDate: '2026-10-03' },
      view: { label: 'Conserver', why: "2 analystes à l'achat (objectif médian 4,50 €, ~30 % de potentiel) et rendement estimé ~7 %." },
      facts: ['S1 2026 : marge brute 39,2 M€ (+26,7 %) avec l’intégration de Sogec et BudgetBox.', 'Objectif de marge opérationnelle ajustée 2026 relevé à ~13 %.', '11/09/2026 : Invest Securities relève son objectif à 4,60 € ; Oddo BHF à 5 €.'],
      risks: ['Retard du Retail Media ; objectif de marge brute 2026 légèrement abaissé.'],
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
      consensus: { buy: 6, outperform: 1, hold: 0, underperform: 0, sell: 0, median: 1.14, target: 188.71, price: 125.20, priceDate: '2026-10-03' },
      per: [10.9, 10.1], yield: 2.3,
      thesis: 'Leader européen des véhicules de loisirs, valorisation modeste (PER ~11) et consensus quasi unanime à l’achat.',
      risks: ['Demande cyclique (pouvoir d’achat, taux) ; niveau des stocks chez les distributeurs.'],
      sources: [{ label: 'Consensus Boursorama', url: 'https://www.boursorama.com/cours/consensus/1rPTRI/' }]
    },
    'FR0010929125': {
      yahoo: 'IDL.PA', name: 'ID Logistics', ticker: 'IDL', kind: 'action', sector: 'Logistique', cap: 'Mid cap',
      market: 'Euronext Paris', zones: { 'Europe': 1 }, idea: true,
      consensus: { buy: 6, outperform: 1, hold: 0, underperform: 0, sell: 0, median: 1.14, target: 502, price: 313.50, priceDate: '2026-10-02' },
      per: [29.6, 25.2], yield: 0,
      thesis: 'Logistique contractuelle (e-commerce, distribution) en croissance régulière, expansion aux États-Unis. 7 analystes positifs.',
      risks: ['Valorisation exigeante (PER ~30) ; marges structurellement fines.'],
      sources: [{ label: 'Consensus Boursorama', url: 'https://www.boursorama.com/cours/consensus/1rPIDL/' }]
    },
    'FR0000121709': {
      yahoo: 'SK.PA', name: 'SEB', ticker: 'SK', kind: 'action', sector: 'Petit électroménager', cap: 'Mid cap',
      market: 'Euronext Paris', zones: { 'Europe': 1 }, idea: true,
      consensus: { buy: 7, outperform: 1, hold: 3, underperform: 0, sell: 0, median: 1.64, target: 74.41, price: 53.50, priceDate: '2026-10-03' },
      per: [10.0, 7.4], yield: 4.9,
      thesis: 'Leader mondial du petit équipement domestique, titre déprimé et rendement ~5 %. Conviction Portzamparc S2 2026 (objectif 99 €).',
      risks: ['Consommation des ménages, droits de douane américains, concurrence chinoise.'],
      sources: [{ label: 'Consensus Boursorama', url: 'https://www.boursorama.com/cours/consensus/1rPSK/' }]
    },
    'FR0000063737': {
      yahoo: 'AUB.PA', name: 'Aubay', ticker: 'AUB', kind: 'action', sector: 'Services informatiques', cap: 'Small cap',
      market: 'Euronext Paris', zones: { 'Europe': 1 }, idea: true,
      consensus: { buy: 3, outperform: 1, hold: 0, underperform: 0, sell: 0, median: 1.25, target: 68.08, price: 50.00, priceDate: '2026-10-02' },
      per: [15.1, 14.1], yield: 2.6,
      thesis: 'ESN rentable au bilan sain, bien positionnée sur la banque-assurance en Europe. 4 analystes positifs.',
      risks: ['Ralentissement des budgets IT ; pression de l’IA générative sur la régie.'],
      sources: [{ label: 'Consensus Boursorama', url: 'https://www.boursorama.com/cours/consensus/1rPAUB/' }]
    },
    'FR0000031577': {
      yahoo: 'VIRP.PA', name: 'Virbac', ticker: 'VIRP', kind: 'action', sector: 'Santé animale', cap: 'Mid cap',
      market: 'Euronext Paris', zones: { 'Europe': 1 }, idea: true,
      consensus: { buy: 6, outperform: 0, hold: 2, underperform: 0, sell: 0, median: 1.5, target: 411.88, price: 308.00, priceDate: '2026-10-02' },
      per: [16.0, 14.5], yield: 0.5,
      thesis: 'Santé animale : croissance régulière et profil défensif, peu corrélé au reste du portefeuille.',
      risks: ['Effets de change (pays émergents) ; intégration des acquisitions.'],
      sources: [{ label: 'Consensus Boursorama', url: 'https://www.boursorama.com/cours/consensus/1rPVIRP/' }]
    },
    'FR0000038242': {
      yahoo: 'LBIRD.PA', name: 'Lumibird', ticker: 'LBIRD', kind: 'action', sector: 'Lasers & photonique', cap: 'Small cap',
      market: 'Euronext Paris', zones: { 'Europe': 1 }, idea: true,
      consensus: { buy: 3, outperform: 0, hold: 0, underperform: 0, sell: 0, median: 1, target: 32.17, price: 23.80, priceDate: '2026-10-03' },
      per: [28.9, 21.8], yield: 0,
      thesis: 'Lasers pour la défense, le médical et le lidar ; redressement opérationnel. Conviction Portzamparc S2 2026 (objectif 33,10 €).',
      risks: ['Valorisation 2026 élevée (PER ~29) ; exécution du redressement.'],
      sources: [{ label: 'Consensus Boursorama', url: 'https://www.boursorama.com/cours/consensus/1rPLBIRD/' }]
    },
    'FR001400Q9V2': {
      yahoo: 'EXENS.PA', name: 'Exosens', ticker: 'EXENS', kind: 'action', sector: 'Défense (optronique)', cap: 'Mid cap',
      market: 'Euronext Paris', zones: { 'Europe': 1 }, idea: true,
      consensus: { buy: 7, outperform: 1, hold: 2, underperform: 0, sell: 0, median: 1.5, target: 67.60, price: 59.20, priceDate: '2026-10-02' },
      per: [35.4, 28.7], yield: 0.5,
      thesis: 'Vision nocturne et détection, portée par la hausse des budgets de défense européens. Une grande partie du potentiel est déjà dans le cours.',
      risks: ['Valorisation exigeante (PER ~35) ; dépendance aux commandes militaires.'],
      sources: [{ label: 'Consensus Boursorama', url: 'https://www.boursorama.com/cours/consensus/1rPEXENS/' }]
    },
    'FR0000065484': {
      yahoo: 'LSS.PA', name: 'Lectra', ticker: 'LSS', kind: 'action', sector: 'Logiciels industriels', cap: 'Small cap',
      market: 'Euronext Paris', zones: { 'Europe': 1 }, idea: true,
      consensus: { buy: 3, outperform: 1, hold: 1, underperform: 0, sell: 0, median: 1.6, target: 23.90, price: 20.30, priceDate: '2026-10-03' },
      per: [31.5, 25.0], yield: 1.5,
      thesis: 'Logiciels et équipements de découpe pour la mode, l’automobile et l’ameublement ; modèle de plus en plus récurrent (SaaS).',
      risks: ['Potentiel limité (~18 %) ; secteurs clients cycliques.'],
      sources: [{ label: 'Consensus Boursorama', url: 'https://www.boursorama.com/cours/consensus/1rPLSS/' }]
    }
  },

  /* Valeurs examinées mais écartées de la sélection, avec la raison. */
  excluded: [
    { name: 'Wavestone', reason: 'Révisions à la baisse : objectif médian ramené de ~65 € à 47,92 €, 3 analystes sur 5 passés à Conserver.' },
    { name: 'Exail Technologies', reason: 'Consensus Conserver (6 avis sur 8) et PER 2026e ~87 après un fort parcours boursier.' },
    { name: 'Linedata', reason: 'Pas de consensus publié par FactSet sur Boursorama ; difficile à suivre.' }
  ]
};

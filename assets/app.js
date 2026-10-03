/*
 * PEA Tracker — logique de l'application (JavaScript sans dépendance de build).
 *
 * Chaîne de traitement d'un relevé :
 *   export BoursoBank (.xlsx) → lecture & contrôles qualité → relevé historisé
 *   → détection des mouvements → contrôles du portefeuille → alertes → décision.
 *
 * Stockage : base `db` de l'artifact claude.ai quand elle est disponible
 * (privée, relue par Claude lors des mises à jour), sinon localStorage.
 */
(function () {
  'use strict';

  /* ================================================================ Constantes */

  const R = window.PEA_RESEARCH || { instruments: {}, excluded: [], asOf: null, source: '' };
  const PEA_CEILING = 150000;
  const LS_KEY = 'pea-tracker-v1';
  const TABS = ['synthese', 'positions', 'controles', 'alertes', 'flux', 'idees'];
  const DEFAULT_SETTINGS = {
    lineWarn: 15, lineAlert: 25,
    sectorWarn: 20, sectorAlert: 25,
    lossWarn: -20, lossAlert: -30,
    coreTarget: 40, coreMin: 20,
    outsideEuropeMin: 20,
    dustMax: 2,
    staleDays: 35,
    researchStaleDays: 60,
    deposits: null,
    openDate: ''
  };
  const COLS = {
    name: ['name', 'libelle', 'nom', 'valeur', 'instrument', 'titre', 'designation'],
    isin: ['isin', 'codeisin'],
    quantity: ['quantity', 'quantite', 'qte', 'qty', 'nombre', 'nbtitres'],
    buyingPrice: ['buyingprice', 'pru', 'prixderevient', 'prixderevientunitaire', 'coursderevient', 'prixmoyen'],
    lastPrice: ['lastprice', 'cours', 'derniercours', 'coursactuel', 'dernier'],
    intradayVariation: ['intradayvariation', 'varjour', 'variationjour', 'varjour%', 'variationdujour'],
    amount: ['amount', 'montant', 'valorisation', 'montantestime', 'valeurestimee'],
    amountVariation: ['amountvariation', '+/-value', '+/-values', 'plusmoinsvalue', 'pvlatente', '+/-valuelatente'],
    variation: ['variation', '+/-%', 'perf', 'performance', 'var%']
  };
  const METRICS = {
    price: { label: 'Cours', unit: '€', scopes: ['line'] },
    pnlPct: { label: '+/- value latente', unit: '%', scopes: ['line', 'any', 'portfolio'] },
    weight: { label: 'Poids dans le PEA', unit: '%', scopes: ['line', 'any'] },
    dayVar: { label: 'Variation du jour', unit: '%', scopes: ['line', 'any'] },
    upside: { label: 'Potentiel vs objectif des analystes', unit: '%', scopes: ['line', 'any'] },
    sectorWeight: { label: 'Poids du secteur', unit: '%', scopes: ['sector'] },
    total: { label: 'Valeur totale du PEA', unit: '€', scopes: ['portfolio'] }
  };
  const SCOPE_LABEL = { line: 'Une ligne', any: "N'importe quelle ligne", sector: 'Un secteur', portfolio: 'Le portefeuille' };
  const FLOW_TYPES = {
    versement: 'Versement', retrait: 'Retrait', dividende: 'Dividende', frais: 'Frais',
    achat: 'Achat', renfort: 'Renforcement', allegement: 'Allègement', vente: 'Vente', pru: 'Ajustement du PRU'
  };

  /* ================================================================ État */

  const S = {
    mode: 'pending',
    store: null,
    loaded: false,
    snapshots: [], alerts: [], flows: [], research: {},
    settings: Object.assign({}, DEFAULT_SETTINGS),
    current: null,
    demo: null,
    tab: 'synthese',
    posSort: { key: 'value', dir: -1 },
    ctrlFilter: 'all',
    ideaSort: 'score',
    readOnly: false,
    awaitId: null,
    pending: null,
    alertDraft: null
  };

  /* ================================================================ Utilitaires */

  const $ = (sel, root) => (root || document).querySelector(sel);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const FMT = {};
  const fmt = (d) => FMT[d] || (FMT[d] = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d }));
  const ok = (v) => v != null && isFinite(v);
  const nb = (v, d = 2) => ok(v) ? fmt(d).format(v) : '—';
  const eur = (v, d = 2) => ok(v) ? fmt(d).format(v) + ' €' : '—';
  const sign = (v) => v > 0 ? '+' : v < 0 ? '−' : '';
  const sEur = (v, d = 2) => ok(v) ? sign(v) + fmt(d).format(Math.abs(v)) + ' €' : '—';
  const sPct = (v, d = 1) => ok(v) ? sign(v) + fmt(d).format(Math.abs(v)) + ' %' : '—';
  const pct = (v, d = 1) => ok(v) ? fmt(d).format(v) + ' %' : '—';
  const tone = (v) => v > 0 ? 'up' : v < 0 ? 'down' : '';
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const sum = (arr, f) => arr.reduce((s, x) => s + (f ? f(x) : x), 0);
  const pad = (n) => String(n).padStart(2, '0');
  const todayISO = () => { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
  const dateFR = (iso) => iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '—';
  const daysSince = (iso) => iso ? Math.floor((new Date(todayISO()) - new Date(String(iso).slice(0, 10))) / 86400000) : null;
  const uid = () => 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const normKey = (k) => String(k).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9+/%-]/g, '');
  const clone = (o) => JSON.parse(JSON.stringify(o));

  function num(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    let s = String(v).replace(/[\s  €%]/g, '').replace(/[^0-9,.\-+eE]/g, '');
    if (s.includes(',') && s.includes('.')) {
      s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
    } else {
      s = s.replace(',', '.');
    }
    const n = parseFloat(s);
    return isFinite(n) ? n : null;
  }

  /** Clé de contrôle ISIN (algorithme de Luhn sur les chiffres convertis). */
  function isinValid(s) {
    if (!/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(s || '')) return false;
    const digits = s.split('').map((c) => /[0-9]/.test(c) ? c : String(c.charCodeAt(0) - 55)).join('');
    let total = 0;
    let dbl = false;
    for (let i = digits.length - 1; i >= 0; i--) {
      let d = +digits[i];
      if (dbl) { d *= 2; if (d > 9) d -= 9; }
      total += d;
      dbl = !dbl;
    }
    return total % 10 === 0;
  }

  function titleCase(s) {
    return String(s || '').toLowerCase().replace(/(^|[\s\-'(])([a-zà-ÿ])/g, (m, p, c) => p + c.toUpperCase());
  }

  let toastTimer = null;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 3800);
  }

  /* ================================================================ Stockage */

  function lsRead() { try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch (e) { return {}; } }
  function lsWrite(o) { try { localStorage.setItem(LS_KEY, JSON.stringify(o)); return true; } catch (e) { return false; } }

  const LocalStore = {
    kind: 'local',
    data: null,
    onChange: null,
    init(cb) {
      this.onChange = cb;
      this.data = lsRead();
      ['snapshots', 'alerts', 'flows', 'research'].forEach((k) => { this.data[k] = this.data[k] || {}; });
      this.data.settings = this.data.settings || {};
      this.emit();
    },
    emit() {
      const d = this.data;
      const list = (k) => Object.keys(d[k]).map((id) => Object.assign({ id }, d[k][id]));
      this.onChange({ snapshots: list('snapshots'), alerts: list('alerts'), flows: list('flows'), research: d.research, settings: d.settings });
    },
    async set(coll, id, doc) {
      if (coll === 'settings') this.data.settings = clone(doc); else this.data[coll][id] = clone(doc);
      if (!lsWrite(this.data)) toast('Ce navigateur bloque le stockage local : les données ne seront pas conservées.');
      this.emit();
    },
    async del(coll, id) {
      delete this.data[coll][id];
      lsWrite(this.data);
      this.emit();
    },
    exportAll() { return clone(this.data); },
    importAll(obj) {
      ['snapshots', 'alerts', 'flows', 'research'].forEach((k) => { this.data[k] = obj[k] || {}; });
      this.data.settings = obj.settings || {};
      lsWrite(this.data);
      this.emit();
    }
  };

  function DbStore(db) {
    const cache = { snapshots: {}, alerts: {}, flows: {}, research: {}, settings: null };
    const seen = new Set();
    let onChange = null;
    const emit = () => {
      if (seen.size < 5) return;
      onChange({
        snapshots: Object.values(cache.snapshots), alerts: Object.values(cache.alerts),
        flows: Object.values(cache.flows), research: cache.research, settings: cache.settings || {}
      });
    };
    const onErr = () => { seen.add('err'); toast('Connexion aux données interrompue. Rechargez la page.'); };
    const withRetry = async (fn) => {
      try { return await fn(); } catch (e) {
        if (e && e.code === 'unavailable') { await new Promise((r) => setTimeout(r, 400 + Math.random() * 600)); return fn(); }
        throw e;
      }
    };
    return {
      kind: 'db',
      init(cb) {
        onChange = cb;
        ['snapshots', 'alerts', 'flows', 'research'].forEach((coll) => {
          db.collection(coll).onSnapshot((snap) => {
            const m = {};
            snap.docs.forEach((d) => { if (d.exists) m[d.id] = Object.assign({ id: d.id }, d.data()); });
            cache[coll] = m;
            seen.add(coll);
            emit();
          }, onErr);
        });
        db.doc('settings/main').onSnapshot((s) => {
          cache.settings = s.exists ? Object.assign({}, s.data()) : null;
          seen.add('settings');
          emit();
        }, onErr);
      },
      set(coll, id, doc) {
        const path = coll === 'settings' ? 'settings/main' : coll + '/' + id;
        const body = clone(doc);
        delete body.id;
        return withRetry(() => db.doc(path).set(body));
      },
      del(coll, id) { return withRetry(() => db.doc(coll + '/' + id).delete()); }
    };
  }

  async function save(coll, id, doc) {
    if (S.readOnly) { toast('Lecture seule : ces données ne peuvent pas être modifiées depuis cette vue.'); throw new Error('read-only'); }
    try { await S.store.set(coll, id, doc); } catch (e) { writeError(e); throw e; }
  }
  async function remove(coll, id) {
    if (S.readOnly) { toast('Lecture seule.'); return; }
    try { await S.store.del(coll, id); } catch (e) { writeError(e); }
  }
  function writeError(e) {
    const code = e && e.code;
    if (code === 'invalid_argument' || code === 'not_granted') { S.readOnly = true; toast('Enregistrement refusé : cette vue est en lecture seule.'); }
    else if (code === 'quota_exceeded') toast('Stockage plein : supprimez d’anciens relevés dans l’onglet Flux.');
    else if (code === 'resource_exhausted') toast('Trop d’enregistrements d’un coup, patientez quelques secondes.');
    else toast('Enregistrement impossible pour le moment.');
  }

  function applyData(d) {
    S.snapshots = (d.snapshots || []).filter((s) => s && s.date && Array.isArray(s.positions)).sort((a, b) => a.date < b.date ? -1 : 1);
    S.alerts = (d.alerts || []).sort((a, b) => String(a.createdAt) < String(b.createdAt) ? -1 : 1);
    S.flows = (d.flows || []).sort((a, b) => a.date < b.date ? 1 : a.date > b.date ? -1 : 0);
    S.research = d.research || {};
    S.settings = Object.assign({}, DEFAULT_SETTINGS, d.settings || {});
    if (S.awaitId && S.snapshots.some((s) => s.id === S.awaitId)) { S.current = S.awaitId; S.awaitId = null; }
    if (!S.current || !S.snapshots.some((s) => s.id === S.current)) {
      S.current = S.snapshots.length ? S.snapshots[S.snapshots.length - 1].id : null;
    }
    if (S.snapshots.length) S.demo = null;
    S.loaded = true;
    renderAll();
  }

  /* ================================================================ Recherche */

  function researchAsOf() { return (S.research._meta && S.research._meta.asOf) || R.asOf; }
  function inst(isin) {
    const base = R.instruments[isin];
    const ov = S.research[isin];
    if (!base && !ov) return null;
    if (!ov) return base;
    const out = Object.assign({}, base || {}, ov);
    if ((base && base.consensus) || ov.consensus) out.consensus = Object.assign({}, base && base.consensus, ov.consensus);
    return out;
  }
  function allIsins() {
    const set = new Set(Object.keys(R.instruments));
    Object.keys(S.research).forEach((k) => { if (k !== '_meta') set.add(k); });
    return Array.from(set);
  }
  function metaFor(isin, name) {
    const m = inst(isin);
    if (m) return m;
    const etf = /\b(ETF|UCITS|TRACKER|AMUNDI|ISHARES|LYXOR|XTRACKERS|EASY|SPDR|VANECK)\b/i.test(name || '');
    return { name: titleCase(name), kind: etf ? 'etf' : 'action', sector: 'Non classé', zones: { Europe: 1 }, unknown: true };
  }
  function consensusCount(c) { return c ? (c.buy || 0) + (c.outperform || 0) + (c.hold || 0) + (c.underperform || 0) + (c.sell || 0) : 0; }

  /** Traduit le consensus (échelle 1-5) en avis pour un détenteur. */
  function analystCall(c) {
    if (!c || !ok(c.median)) return null;
    const n = consensusCount(c);
    const med = c.median;
    let label, cls;
    if (med <= 2.5) { label = 'Renforcer'; cls = 'buy'; }
    else if (med <= 3.5) { label = 'Conserver'; cls = 'hold'; }
    else if (med <= 4.5) { label = 'Alléger'; cls = 'reduce'; }
    else { label = 'Vendre'; cls = 'sell'; }
    const strength = med <= 1.5 ? 'consensus fort' : med <= 2.5 ? 'consensus modéré' : med <= 3.5 ? 'consensus neutre' : 'consensus négatif';
    return { label, cls, n, med, strength, thin: n <= 2 };
  }
  function viewCls(label) {
    return { Renforcer: 'buy', Acheter: 'buy', Conserver: 'hold', Alléger: 'reduce', Vendre: 'sell', Sortir: 'sell' }[label] || 'none';
  }
  function recoPill(label, cls) { return '<span class="reco r-' + (cls || viewCls(label)) + '">' + esc(label) + '</span>'; }

  function abar(c) {
    if (!c) return '<span class="muted small">—</span>';
    const n = consensusCount(c) || 1;
    const parts = [['buy', 'Acheter', '--a1'], ['outperform', 'Renforcer', '--a2'], ['hold', 'Conserver', '--a3'], ['underperform', 'Alléger', '--a4'], ['sell', 'Vendre', '--a5']];
    const tip = parts.map((p) => (c[p[0]] || 0) + ' ' + p[1]).join(' · ');
    return '<span class="abar" tabindex="0" data-tip="' + esc('<b>' + consensusCount(c) + ' analystes</b><br>' + tip) + '">' +
      parts.filter((p) => c[p[0]]).map((p) => '<i style="width:' + (c[p[0]] / n * 100) + '%;background:var(' + p[2] + ')"></i>').join('') + '</span>';
  }
  const ABAR_LEGEND = '<div class="alegend"><span><i style="background:var(--a1)"></i>Acheter</span><span><i style="background:var(--a2)"></i>Renforcer</span><span><i style="background:var(--a3)"></i>Conserver</span><span><i style="background:var(--a4)"></i>Alléger</span><span><i style="background:var(--a5)"></i>Vendre</span></div>';

  /* ================================================================ Import */

  function readWorkbook(buf) {
    if (!window.XLSX) throw new Error("La bibliothèque de lecture Excel n'a pas pu être chargée (connexion requise).");
    const wb = window.XLSX.read(buf, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    return window.XLSX.utils.sheet_to_json(ws, { defval: null, raw: true });
  }

  function normalizeRows(rows) {
    const headers = rows.length ? Object.keys(rows[0]) : [];
    const map = {};
    Object.keys(COLS).forEach((field) => {
      const h = headers.find((x) => COLS[field].includes(normKey(x)));
      if (h) map[field] = h;
    });
    const required = ['name', 'isin', 'quantity', 'buyingPrice', 'lastPrice'];
    const missing = required.filter((f) => !map[f]);
    const positions = [];
    if (!missing.length) {
      rows.forEach((r) => {
        const isin = String(r[map.isin] || '').trim().toUpperCase();
        const name = String(r[map.name] || '').trim();
        if (!isin && !name) return;
        positions.push({
          name, isin,
          qty: num(r[map.quantity]), pru: num(r[map.buyingPrice]), last: num(r[map.lastPrice]),
          dayVar: map.intradayVariation ? num(r[map.intradayVariation]) : null,
          amount: map.amount ? num(r[map.amount]) : null,
          pnlReported: map.amountVariation ? num(r[map.amountVariation]) : null,
          varReported: map.variation ? num(r[map.variation]) : null
        });
      });
    }
    return { headers, map, missing, positions };
  }

  /** Contrôles qualité d'un relevé (colonnes, ISIN, doublons, cohérence des montants). */
  function qualityChecks(positions, parsed) {
    const out = [];
    if (parsed) {
      const found = Object.keys(parsed.map).length;
      out.push(parsed.missing.length
        ? { id: 'Q1', title: 'Colonnes reconnues', status: 'alert', detail: 'Colonnes obligatoires absentes : ' + parsed.missing.join(', ') + '. Vérifiez qu’il s’agit bien de l’export des positions.' }
        : { id: 'Q1', title: 'Colonnes reconnues', status: 'ok', detail: found + ' colonnes reconnues sur ' + parsed.headers.length + '.' });
    }
    out.push(positions.length
      ? { id: 'Q2', title: 'Lignes lues', status: 'ok', detail: positions.length + ' lignes de position.' }
      : { id: 'Q2', title: 'Lignes lues', status: 'alert', detail: 'Aucune ligne exploitable dans le fichier.' });
    const badIsin = positions.filter((p) => !isinValid(p.isin));
    out.push({ id: 'Q3', title: 'Codes ISIN valides', status: badIsin.length ? 'alert' : 'ok', detail: badIsin.length ? 'Clé de contrôle invalide : ' + badIsin.map((p) => p.name + ' (' + p.isin + ')').join(', ') : 'Clé de contrôle vérifiée pour chaque ISIN.' });
    const seen = {};
    const dup = [];
    positions.forEach((p) => { if (seen[p.isin]) dup.push(p.name); seen[p.isin] = 1; });
    out.push({ id: 'Q4', title: 'Absence de doublons', status: dup.length ? 'warn' : 'ok', detail: dup.length ? 'ISIN en double : ' + dup.join(', ') : 'Chaque ISIN apparaît une seule fois.' });
    const badNum = positions.filter((p) => !(p.qty > 0) || !(p.pru >= 0) || !(p.last >= 0));
    out.push({ id: 'Q5', title: 'Quantités et cours renseignés', status: badNum.length ? 'alert' : 'ok', detail: badNum.length ? 'Valeurs manquantes ou nulles : ' + badNum.map((p) => p.name).join(', ') : 'Quantité, PRU et cours présents sur chaque ligne.' });
    const amt = positions.filter((p) => ok(p.amount) && ok(p.qty) && ok(p.last) && Math.abs(p.qty * p.last - p.amount) > Math.max(0.05, Math.abs(p.amount) * 0.005));
    out.push({ id: 'Q6', title: 'Montant = quantité × cours', status: amt.length ? 'warn' : 'ok', detail: amt.length ? 'Écart détecté : ' + amt.map((p) => p.name + ' (' + eur(p.qty * p.last) + ' calculé vs ' + eur(p.amount) + ')').join(', ') : 'Valorisation cohérente sur chaque ligne.' });
    const pv = positions.filter((p) => ok(p.pnlReported) && ok(p.qty) && ok(p.last) && ok(p.pru) && Math.abs((p.last - p.pru) * p.qty - p.pnlReported) > Math.max(1.5, Math.abs(p.qty * p.pru) * 0.02));
    out.push({ id: 'Q7', title: '+/- value = (cours − PRU) × quantité', status: pv.length ? 'warn' : 'ok', detail: pv.length ? 'Écart supérieur à l’arrondi du PRU : ' + pv.map((p) => p.name).join(', ') : 'Plus et moins-values cohérentes (tolérance d’arrondi du PRU).' });
    return out;
  }

  /** Mouvements déduits de la comparaison de deux relevés. */
  function diffSnapshots(prev, next) {
    if (!prev) return [];
    const out = [];
    const P = new Map(prev.positions.map((p) => [p.isin, p]));
    const N = new Map(next.positions.map((p) => [p.isin, p]));
    N.forEach((n, isin) => {
      const p = P.get(isin);
      if (!p) {
        out.push({ type: 'achat', isin, name: n.name, qty: n.qty, price: n.pru, amount: n.qty * n.pru, note: 'Nouvelle ligne (prix estimé = PRU)' });
      } else if (n.qty > p.qty + 1e-9) {
        const dq = n.qty - p.qty;
        const price = (n.qty * n.pru - p.qty * p.pru) / dq;
        out.push({ type: 'renfort', isin, name: n.name, qty: dq, price, amount: dq * price, note: 'Prix estimé à partir de l’évolution du PRU' });
      } else if (n.qty < p.qty - 1e-9) {
        const dq = p.qty - n.qty;
        out.push({ type: 'allegement', isin, name: n.name, qty: dq, price: n.last, amount: dq * n.last, note: 'Prix estimé au dernier cours' });
      } else if (ok(n.pru) && ok(p.pru) && Math.abs(n.pru - p.pru) > Math.max(0.01, p.pru * 0.005)) {
        out.push({ type: 'pru', isin, name: n.name, qty: 0, price: n.pru, amount: 0, note: 'PRU ' + eur(p.pru) + ' → ' + eur(n.pru) + ' sans changement de quantité' });
      }
    });
    P.forEach((p, isin) => {
      if (!N.has(isin)) out.push({ type: 'vente', isin, name: p.name, qty: p.qty, price: p.last, amount: p.qty * p.last, note: 'Ligne soldée (prix estimé au dernier cours connu)' });
    });
    return out.map((f) => Object.assign(f, { id: next.date + '_' + f.isin + '_' + f.type, date: next.date, from: prev.date, source: 'auto', estimated: true }));
  }

  /* ================================================================ Analyse */

  function currentSnapshot() {
    if (S.demo) return S.demo;
    return S.snapshots.find((s) => s.id === S.current) || null;
  }
  function previousSnapshot(snap) {
    if (!snap || S.demo) return null;
    const i = S.snapshots.findIndex((s) => s.id === snap.id);
    return i > 0 ? S.snapshots[i - 1] : null;
  }

  function analyze(snap) {
    if (!snap) return null;
    const lines = snap.positions.map((p) => {
      const m = metaFor(p.isin, p.name);
      const value = ok(p.amount) ? p.amount : (p.qty || 0) * (p.last || 0);
      const cost = (p.qty || 0) * (p.pru || 0);
      const pnl = value - cost;
      const c = m.consensus;
      const upside = c && ok(c.target) && p.last > 0 && !m.nonTradable ? (c.target / p.last - 1) * 100 : null;
      const dayEur = ok(p.dayVar) && p.dayVar > -100 ? value - value / (1 + p.dayVar / 100) : 0;
      return Object.assign({}, p, { m, label: m.short || m.name || p.name, value, cost, pnl, pnlPct: cost ? pnl / cost * 100 : 0, upside, dayEur, call: analystCall(c) });
    });
    const invested = sum(lines, (l) => l.value);
    const cash = ok(snap.cash) ? snap.cash : 0;
    const total = invested + cash;
    lines.forEach((l) => { l.weight = total ? l.value / total * 100 : 0; });
    const group = (keyFn) => {
      const acc = {};
      lines.forEach((l) => { const k = keyFn(l); acc[k] = acc[k] || { name: k, value: 0, lines: [] }; acc[k].value += l.value; acc[k].lines.push(l); });
      return Object.values(acc).map((g) => Object.assign(g, { weight: total ? g.value / total * 100 : 0 })).sort((a, b) => b.value - a.value);
    };
    const sectors = group((l) => l.m.sector || 'Non classé');
    const zoneAcc = {};
    lines.forEach((l) => { const z = l.m.zones || { Europe: 1 }; Object.keys(z).forEach((k) => { zoneAcc[k] = (zoneAcc[k] || 0) + l.value * z[k]; }); });
    const zones = Object.keys(zoneAcc).map((k) => ({ name: k, value: zoneAcc[k], weight: invested ? zoneAcc[k] / invested * 100 : 0 })).sort((a, b) => b.value - a.value);
    const etf = sum(lines.filter((l) => l.m.kind === 'etf'), (l) => l.value);
    const cost = sum(lines, (l) => l.cost);
    const tradable = lines.filter((l) => !l.m.nonTradable);
    const costT = sum(tradable, (l) => l.cost);
    const pnlT = sum(tradable, (l) => l.pnl);
    return {
      snap, lines, invested, cash, total, cost,
      pnl: invested - cost, pnlPct: cost ? (invested - cost) / cost * 100 : 0,
      pnlT, pnlTPct: costT ? pnlT / costT * 100 : 0, hasNonTradable: tradable.length < lines.length,
      day: sum(lines, (l) => l.dayEur),
      sectors, zones,
      types: [{ name: 'ETF', value: etf, color: 'var(--s1)' }, { name: 'Actions', value: invested - etf, color: 'var(--s2)' }, { name: 'Liquidités', value: cash, color: 'var(--s3)' }]
        .filter((t) => t.value > 0).map((t) => Object.assign(t, { weight: total ? t.value / total * 100 : 0 })),
      counts: { etf: lines.filter((l) => l.m.kind === 'etf').length, stocks: lines.filter((l) => l.m.kind !== 'etf').length }
    };
  }

  /** Contrôles du portefeuille. Statuts : ok | warn | alert | info. */
  function runControls(A) {
    const st = S.settings;
    const C = [];
    const add = (o) => C.push(o);
    if (!A) return C;
    const L = A.lines;

    qualityChecks(A.snap.positions).forEach((q) => add(Object.assign({ group: 'Qualité du relevé', action: q.status === 'ok' ? '' : 'Ré-exportez le fichier depuis BoursoBank ou corrigez la ligne concernée.' }, q, { id: 'D' + q.id.slice(1) })));

    // P1 — concentration par ligne (hors ETF diversifiés)
    const lineSet = L.filter((l) => !l.m.diversified && !l.m.nonTradable).sort((a, b) => b.weight - a.weight);
    const top = lineSet[0];
    if (top) {
      const over = lineSet.filter((l) => l.weight >= st.lineWarn);
      const s = top.weight >= st.lineAlert ? 'alert' : top.weight >= st.lineWarn ? 'warn' : 'ok';
      add({ id: 'P1', group: 'Risque du portefeuille', title: 'Concentration par ligne', status: s,
        detail: 'Ligne la plus lourde (hors ETF diversifiés) : ' + top.label + ' à ' + pct(top.weight) + '. Seuils : vigilance ' + st.lineWarn + ' %, alerte ' + st.lineAlert + ' %.',
        action: s === 'ok' ? '' : 'Ne plus renforcer ' + over.map((l) => l.label).join(', ') + ' ; orienter les prochains versements vers le socle diversifié.' });
    }
    // P2 — concentration sectorielle
    const secs = A.sectors.filter((x) => !/diversifié/i.test(x.name));
    if (secs.length) {
      const s0 = secs[0];
      const s = s0.weight >= st.sectorAlert ? 'alert' : s0.weight >= st.sectorWarn ? 'warn' : 'ok';
      add({ id: 'P2', group: 'Risque du portefeuille', title: 'Concentration sectorielle', status: s,
        detail: 'Premier secteur : ' + s0.name + ' à ' + pct(s0.weight) + ' (' + s0.lines.map((l) => l.label).join(' + ') + '). Seuils : ' + st.sectorWarn + ' % / ' + st.sectorAlert + ' %.',
        action: s === 'ok' ? '' : 'Ne plus renforcer le secteur ' + s0.name + '. Au-delà du seuil d’alerte, alléger la ligne la plus performante (cession sans impôt à l’intérieur du PEA).' });
    }
    // P3 — lignes en forte perte
    const losers = L.filter((l) => !l.m.nonTradable && l.pnlPct <= st.lossWarn).sort((a, b) => a.pnlPct - b.pnlPct);
    add({ id: 'P3', group: 'Risque du portefeuille', title: 'Lignes en forte moins-value', status: losers.some((l) => l.pnlPct <= st.lossAlert) ? 'alert' : losers.length ? 'warn' : 'ok',
      detail: losers.length ? losers.map((l) => l.label + ' ' + sPct(l.pnlPct) + (l.call ? ' (analystes : ' + l.call.label.toLowerCase() + ')' : '')).join(' · ') : 'Aucune ligne sous ' + st.lossWarn + ' %.',
      action: losers.length ? 'Relire la thèse de chaque ligne : si le consensus reste positif et les résultats tiennent, conserver ; sinon couper. Éviter de moyenner à la baisse par réflexe.' : '' });
    // P4 — titres non négociables
    const dead = L.filter((l) => l.m.nonTradable);
    add({ id: 'P4', group: 'Risque du portefeuille', title: 'Titres sans valeur ou non négociables', status: dead.length ? 'alert' : 'ok',
      detail: dead.length ? dead.map((l) => l.label + ' : ' + sEur(l.pnl, 0) + ' (' + sPct(l.pnlPct) + ')').join(' · ') + '. Société liquidée, cotation suspendue.' : 'Aucun titre radié ou suspendu.',
      action: dead.length ? 'Demander à BoursoBank, par messagerie sécurisée, le retrait des titres du PEA pour cause de liquidation judiciaire : le plan n’est pas clôturé. La perte n’est pas déductible.' : '' });
    // P5 — socle diversifié
    const core = sum(L.filter((l) => l.m.sector === 'Monde diversifié'), (l) => l.weight);
    add({ id: 'P5', group: 'Risque du portefeuille', title: 'Poids du socle diversifié (ETF Monde)', status: core < st.coreMin ? 'alert' : core < st.coreTarget ? 'warn' : 'ok',
      detail: 'ETF Monde : ' + pct(core) + ' du PEA. Cible : au moins ' + st.coreTarget + ' %.',
      action: core < st.coreTarget ? 'Diriger les prochains versements vers l’ETF Monde jusqu’à la cible (environ ' + eur(Math.max(0, (st.coreTarget / 100 * A.total - core / 100 * A.total) / (1 - st.coreTarget / 100)), 0) + ' à investir).' : '' });
    // P6 — exposition hors Europe
    const eu = (A.zones.find((z) => z.name === 'Europe') || { weight: 0 }).weight;
    const outside = 100 - eu;
    add({ id: 'P6', group: 'Risque du portefeuille', title: 'Diversification géographique', status: outside < st.outsideEuropeMin ? 'warn' : 'ok',
      detail: 'Exposition hors Europe : ' + pct(outside) + ' (estimation par transparence des ETF). Minimum conseillé : ' + st.outsideEuropeMin + ' %.',
      action: outside < st.outsideEuropeMin ? 'Le portefeuille dépend fortement de l’économie européenne et française : l’ETF Monde est le moyen le plus simple de rééquilibrer.' : '' });
    // P7 — lignes négligeables
    const dust = L.filter((l) => !l.m.nonTradable && l.weight < st.dustMax);
    add({ id: 'P7', group: 'Risque du portefeuille', title: 'Lignes de poids négligeable', status: dust.length ? 'warn' : 'ok',
      detail: dust.length ? dust.map((l) => l.label + ' (' + pct(l.weight) + ', ' + eur(l.value, 0) + ')').join(' · ') : 'Aucune ligne sous ' + st.dustMax + ' % du PEA.',
      action: dust.length ? 'Une ligne de moins de ' + st.dustMax + ' % ne change rien à la performance mais demande du suivi : la porter à un poids significatif (~5 %) ou la céder. En PEA, le courtage en ligne est plafonné à 0,5 % de l’ordre.' : '' });
    // P8 — chevauchements
    const held = new Set(L.map((l) => l.isin));
    const overlaps = [];
    L.forEach((l) => (l.m.contains || []).forEach((i) => { if (held.has(i)) overlaps.push(L.find((x) => x.isin === i).label + ' (direct + ' + l.label + ')'); }));
    add({ id: 'P8', group: 'Risque du portefeuille', title: 'Doublons entre titres et ETF', status: overlaps.length ? 'warn' : 'ok',
      detail: overlaps.length ? 'Détenu(s) deux fois : ' + overlaps.join(' · ') : 'Pas de titre détenu à la fois en direct et via un ETF suivi.',
      action: overlaps.length ? 'Le risque réel sur ces titres est plus élevé que leur poids affiché : en tenir compte avant de renforcer.' : '' });
    // P9 — avis analystes
    const neg = L.filter((l) => l.call && (l.call.cls === 'reduce' || l.call.cls === 'sell'));
    add({ id: 'P9', group: 'Suivi des analystes', title: 'Consensus défavorable sur une ligne', status: neg.length ? 'alert' : 'ok',
      detail: neg.length ? neg.map((l) => l.label + ' : ' + l.call.label).join(' · ') : 'Aucune ligne détenue avec un consensus Alléger ou Vendre.',
      action: neg.length ? 'Examiner la cession de ces lignes.' : '' });
    // P10 — objectifs atteints
    const reached = L.filter((l) => ok(l.upside) && l.upside <= 0);
    add({ id: 'P10', group: 'Suivi des analystes', title: 'Objectif de cours atteint', status: reached.length ? 'warn' : 'ok',
      detail: reached.length ? reached.map((l) => l.label + ' (' + sPct(l.upside) + ' vs objectif)').join(' · ') : 'Toutes les lignes suivies restent sous l’objectif moyen des analystes.',
      action: reached.length ? 'Envisager une prise de bénéfices partielle, sauf relèvement récent des objectifs.' : '' });
    // P11 — couverture faible
    const thin = L.filter((l) => l.call && l.call.thin);
    add({ id: 'P11', group: 'Suivi des analystes', title: 'Consensus fondé sur peu d’analystes', status: thin.length ? 'info' : 'ok',
      detail: thin.length ? thin.map((l) => l.label + ' (' + l.call.n + ')').join(' · ') : 'Chaque consensus repose sur au moins 3 analystes.',
      action: thin.length ? 'Un consensus à 1 ou 2 analystes est fragile : un seul changement d’avis le fait basculer.' : '' });
    // P12 — instruments non reconnus
    const unk = L.filter((l) => l.m.unknown);
    add({ id: 'P12', group: 'Suivi des analystes', title: 'Instruments non référencés', status: unk.length ? 'warn' : 'ok',
      detail: unk.length ? unk.map((l) => l.name + ' (' + l.isin + ')').join(' · ') : 'Chaque ligne a sa fiche (secteur, consensus, avis).',
      action: unk.length ? 'Demander à Claude d’ajouter ces valeurs à la base de recherche.' : '' });
    // P13 — fraîcheur des consensus
    const rAge = daysSince(researchAsOf());
    add({ id: 'P13', group: 'Suivi des analystes', title: 'Fraîcheur des consensus', status: rAge != null && rAge > st.researchStaleDays ? 'warn' : 'ok',
      detail: 'Consensus mis à jour le ' + dateFR(researchAsOf()) + (rAge != null ? ' (il y a ' + rAge + ' j)' : '') + '.',
      action: rAge != null && rAge > st.researchStaleDays ? 'Demander à Claude de rafraîchir les consensus et les idées.' : '' });
    // P14 — fraîcheur du relevé
    const sAge = daysSince(A.snap.date);
    add({ id: 'P14', group: 'Cadre du PEA', title: 'Fraîcheur du relevé', status: sAge > st.staleDays ? 'warn' : 'ok',
      detail: 'Relevé du ' + dateFR(A.snap.date) + ' (il y a ' + sAge + ' j).',
      action: sAge > st.staleDays ? 'Importer un nouvel export BoursoBank.' : '' });
    // P15 — plafond des versements
    const dep = depositsTotal();
    add(dep == null
      ? { id: 'P15', group: 'Cadre du PEA', title: 'Plafond des versements (150 000 €)', status: 'info', detail: 'Montant des versements cumulés non renseigné.', action: 'Le renseigner dans Réglages pour suivre le plafond.' }
      : { id: 'P15', group: 'Cadre du PEA', title: 'Plafond des versements (150 000 €)', status: dep >= PEA_CEILING ? 'alert' : dep >= PEA_CEILING * 0.9 ? 'warn' : 'ok', detail: 'Versements cumulés : ' + eur(dep, 0) + ' (' + pct(dep / PEA_CEILING * 100) + ' du plafond). Reste ' + eur(Math.max(0, PEA_CEILING - dep), 0) + '.', action: dep >= PEA_CEILING * 0.9 ? 'Prévoir un compte-titres ou un PEA-PME pour les versements suivants.' : '' });
    // P16 — antériorité
    if (st.openDate) {
      const years = (new Date(todayISO()) - new Date(st.openDate)) / (365.25 * 86400000);
      add({ id: 'P16', group: 'Cadre du PEA', title: 'Antériorité du plan', status: years >= 5 ? 'ok' : 'info',
        detail: 'PEA ouvert le ' + dateFR(st.openDate) + ' (' + nb(years, 1) + ' ans).',
        action: years >= 5 ? 'Plus de 5 ans : retraits possibles sans clôture, gains exonérés d’impôt sur le revenu (prélèvements sociaux dus).' : 'Avant 5 ans, un retrait entraîne en principe la clôture du plan : n’y placer que de l’épargne de long terme.' });
    } else {
      add({ id: 'P16', group: 'Cadre du PEA', title: 'Antériorité du plan', status: 'info', detail: 'Date d’ouverture du PEA non renseignée.', action: 'La renseigner dans Réglages (l’avantage fiscal complet s’acquiert à 5 ans).' });
    }
    return C;
  }

  function healthScore(C) {
    const pen = sum(C, (c) => c.status === 'alert' ? 12 : c.status === 'warn' ? 5 : 0);
    return clamp(100 - pen, 0, 100);
  }

  function depositsTotal() {
    const base = ok(S.settings.deposits) ? +S.settings.deposits : null;
    const manual = S.flows.filter((f) => f.source === 'manuel');
    const plus = sum(manual.filter((f) => f.type === 'versement'), (f) => +f.amount || 0);
    const minus = sum(manual.filter((f) => f.type === 'retrait'), (f) => +f.amount || 0);
    if (base == null && !plus && !minus) return null;
    return (base || 0) + plus - minus;
  }

  /* ================================================================ Alertes */

  function metricOf(l, metric) {
    if (!l) return null;
    return { price: l.last, pnlPct: l.pnlPct, weight: l.weight, dayVar: l.dayVar, upside: l.upside }[metric];
  }
  function fmtMetric(v, metric) {
    const u = METRICS[metric] ? METRICS[metric].unit : '';
    if (!ok(v)) return '—';
    if (u === '€') return eur(v, metric === 'total' ? 0 : 2);
    return (metric === 'pnlPct' || metric === 'dayVar' || metric === 'upside') ? sPct(v) : pct(v);
  }
  function alertTitle(a) {
    const m = METRICS[a.metric] || { label: a.metric };
    let who = '';
    if (a.scope === 'line') { const meta = inst(a.target); who = meta ? (meta.short || meta.name) : a.target; }
    else if (a.scope === 'sector') who = 'Secteur ' + a.target;
    else if (a.scope === 'any') who = 'Toute ligne';
    else who = 'Portefeuille';
    return who + ' · ' + m.label + ' ' + (a.op === '>=' ? '≥' : '≤') + ' ' + fmtMetric(a.value, a.metric).replace(/^\+/, '');
  }
  function evalAlert(a, A) {
    if (!A) return { hit: false, current: null, matches: [] };
    const cmp = (v) => ok(v) && (a.op === '>=' ? v >= a.value : v <= a.value);
    if (a.scope === 'portfolio') {
      const v = a.metric === 'total' ? A.total : A.pnlPct;
      return { hit: cmp(v), current: v, matches: cmp(v) ? ['Portefeuille'] : [] };
    }
    if (a.scope === 'sector') {
      const s = A.sectors.find((x) => x.name === a.target);
      const v = s ? s.weight : 0;
      return { hit: cmp(v), current: v, matches: cmp(v) ? [a.target] : [] };
    }
    if (a.scope === 'line') {
      const l = A.lines.find((x) => x.isin === a.target);
      const v = metricOf(l, a.metric);
      return { hit: cmp(v), current: v, matches: cmp(v) ? [l.label] : [], missing: !l };
    }
    const hits = A.lines.filter((l) => !l.m.nonTradable && cmp(metricOf(l, a.metric)));
    const worst = hits.length ? metricOf(hits.slice().sort((x, y) => a.op === '>=' ? metricOf(y, a.metric) - metricOf(x, a.metric) : metricOf(x, a.metric) - metricOf(y, a.metric))[0], a.metric) : null;
    return { hit: hits.length > 0, current: worst, matches: hits.map((l) => l.label + ' ' + fmtMetric(metricOf(l, a.metric), a.metric)) };
  }
  const alertKey = (a) => [a.scope, a.target || '', a.metric, a.op].join('|');

  /** Alertes proposées à partir du relevé et de la recherche. */
  function suggestedAlerts(A) {
    if (!A) return [];
    const st = S.settings;
    const out = [];
    A.lines.forEach((l) => {
      if (l.m.nonTradable) return;
      const c = l.m.consensus;
      if (c && ok(c.target) && l.last < c.target) out.push({ scope: 'line', target: l.isin, metric: 'price', op: '>=', value: +c.target, note: 'Objectif moyen des analystes atteint : envisager d’alléger.' });
      if (l.m.kind !== 'etf' && l.last > 0) out.push({ scope: 'line', target: l.isin, metric: 'price', op: '<=', value: Math.round(l.last * 0.85 * 100) / 100, note: 'Baisse de 15 % depuis le relevé : vérifier les nouvelles de la société.' });
    });
    out.push({ scope: 'any', target: null, metric: 'weight', op: '>=', value: st.lineAlert, note: 'Une ligne pèse trop lourd : ne plus la renforcer.' });
    out.push({ scope: 'any', target: null, metric: 'pnlPct', op: '<=', value: st.lossAlert, note: 'Moins-value importante : relire la thèse d’investissement.' });
    out.push({ scope: 'any', target: null, metric: 'dayVar', op: '<=', value: -5, note: 'Forte baisse en séance : chercher l’information (résultats, avertissement).' });
    const sec = A.sectors.find((x) => !/diversifié/i.test(x.name));
    if (sec) out.push({ scope: 'sector', target: sec.name, metric: 'sectorWeight', op: '>=', value: st.sectorAlert + 5, note: 'Secteur surpondéré : rééquilibrer.' });
    return out;
  }

  /* ================================================================ Idées */

  function ideaScore(m) {
    const c = m.consensus;
    const up = (c.target / c.price - 1) * 100;
    const sUp = clamp(up / 60, 0, 1) * 100;
    const sCons = clamp((3 - c.median) / 2, 0, 1) * 100;
    const sCov = clamp((consensusCount(c) - 1) / 7, 0, 1) * 100;
    const per = m.per && m.per[0];
    const sVal = ok(per) ? clamp((35 - per) / 25, 0, 1) * 100 : 50;
    return { score: Math.round(0.4 * sUp + 0.3 * sCons + 0.1 * sCov + 0.2 * sVal), up, parts: { sUp, sCons, sCov, sVal } };
  }

  /* ================================================================ Graphiques */

  function hbars(items, fmtV, opts) {
    opts = opts || {};
    const mx = opts.max || Math.max.apply(null, items.map((i) => i.value).concat([1e-9]));
    return '<div class="hb">' + items.map((i) =>
      '<div class="hb-row" tabindex="0" data-tip="' + esc(i.tip || ('<b>' + esc(i.label) + '</b><br>' + fmtV(i.value))) + '">' +
      '<span class="hb-label">' + esc(i.label) + '</span>' +
      '<span class="hb-track"><i style="width:' + clamp(i.value / mx * 100, 0.8, 100) + '%;background:' + (i.color || 'var(--accent)') + '"></i></span>' +
      '<span class="hb-val num">' + esc(fmtV(i.value)) + '</span></div>').join('') + '</div>';
  }

  function dbars(items) {
    const mx = Math.max.apply(null, items.map((i) => Math.abs(i.value)).concat([1]));
    return '<div class="db">' + items.map((i) => {
      const w = clamp(Math.abs(i.value) / mx * 100, 0.8, 100);
      return '<div class="db-row" tabindex="0" data-tip="' + esc(i.tip) + '">' +
        '<span class="hb-label">' + esc(i.label) + '</span>' +
        '<span class="db-neg">' + (i.value < 0 ? '<i style="width:' + w + '%"></i>' : '') + '</span>' +
        '<span class="db-pos">' + (i.value >= 0 ? '<i style="width:' + w + '%"></i>' : '') + '</span>' +
        '<span class="hb-val num ' + tone(i.value) + '">' + esc(sPct(i.value)) + '</span></div>';
    }).join('') + '</div>';
  }

  function ring(score) {
    const r = 38;
    const c = 2 * Math.PI * r;
    const col = score >= 75 ? 'var(--good)' : score >= 50 ? 'var(--warn)' : 'var(--crit)';
    return '<svg class="ring" viewBox="0 0 92 92" role="img" aria-label="Indice de santé ' + score + ' sur 100">' +
      '<circle cx="46" cy="46" r="' + r + '" fill="none" stroke="var(--line)" stroke-width="8"/>' +
      '<circle cx="46" cy="46" r="' + r + '" fill="none" stroke="' + col + '" stroke-width="8" stroke-linecap="round" stroke-dasharray="' + (c * score / 100) + ' ' + c + '" transform="rotate(-90 46 46)"/>' +
      '<text x="46" y="44" text-anchor="middle" style="font:800 22px var(--font-display);fill:var(--ink)">' + score + '</text>' +
      '<text x="46" y="60" text-anchor="middle" style="font:600 10px var(--font-body);fill:var(--muted)">/ 100</text></svg>';
  }

  function niceStep(span) {
    const raw = span / 4 || 1;
    const p = Math.pow(10, Math.floor(Math.log10(raw)));
    const f = raw / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
  }

  /** Historique de valorisation : valeur du PEA et montant investi. */
  function drawHistory() {
    const el = $('#histChart');
    if (!el) return;
    const W = el.clientWidth;
    if (!W) return;
    const pts = S.snapshots.map((s) => { const A = analyze(s); return { date: s.date, value: A.total, cost: A.cost + A.cash }; });
    if (!pts.length) { el.innerHTML = ''; return; }
    const H = 220;
    const P = { l: 64, r: 16, t: 14, b: 30 };
    const vals = pts.flatMap((p) => [p.value, p.cost]);
    let lo = Math.min.apply(null, vals);
    let hi = Math.max.apply(null, vals);
    if (hi - lo < 1) { lo -= 50; hi += 50; }
    const step = niceStep(hi - lo);
    lo = Math.floor(lo / step) * step;
    hi = Math.ceil(hi / step) * step;
    const t0 = new Date(pts[0].date).getTime();
    const t1 = new Date(pts[pts.length - 1].date).getTime();
    const x = (d) => pts.length === 1 ? (P.l + (W - P.r)) / 2 : P.l + (new Date(d).getTime() - t0) / (t1 - t0) * (W - P.l - P.r);
    const y = (v) => P.t + (1 - (v - lo) / (hi - lo)) * (H - P.t - P.b);
    let g = '';
    for (let v = lo; v <= hi + 1e-9; v += step) {
      g += '<line class="grid" x1="' + P.l + '" x2="' + (W - P.r) + '" y1="' + y(v) + '" y2="' + y(v) + '"/>';
      g += '<text x="' + (P.l - 8) + '" y="' + (y(v) + 4) + '" text-anchor="end">' + nb(v, 0) + ' €</text>';
    }
    const line = (k) => pts.map((p, i) => (i ? 'L' : 'M') + x(p.date).toFixed(1) + ' ' + y(p[k]).toFixed(1)).join(' ');
    const ticks = pts.length <= 6 ? pts : [pts[0], pts[Math.floor(pts.length / 2)], pts[pts.length - 1]];
    const last = pts[pts.length - 1];
    el.innerHTML = '<svg class="chart" width="' + W + '" height="' + H + '" role="img" aria-label="Évolution de la valeur du PEA">' + g +
      '<line class="axis" x1="' + P.l + '" x2="' + (W - P.r) + '" y1="' + (H - P.b) + '" y2="' + (H - P.b) + '"/>' +
      ticks.map((p) => '<text x="' + x(p.date) + '" y="' + (H - 10) + '" text-anchor="middle">' + dateFR(p.date).slice(0, 5) + '</text>').join('') +
      '<path d="' + line('cost') + '" fill="none" stroke="var(--s2)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>' +
      '<path d="' + line('value') + '" fill="none" stroke="var(--s1)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>' +
      '<circle cx="' + x(last.date) + '" cy="' + y(last.cost) + '" r="4" fill="var(--s2)" stroke="var(--surface)" stroke-width="2"/>' +
      '<circle cx="' + x(last.date) + '" cy="' + y(last.value) + '" r="4" fill="var(--s1)" stroke="var(--surface)" stroke-width="2"/>' +
      '<line id="xhair" class="axis" y1="' + P.t + '" y2="' + (H - P.b) + '" x1="-10" x2="-10"/>' +
      '<rect class="hit" x="' + P.l + '" y="' + P.t + '" width="' + (W - P.l - P.r) + '" height="' + (H - P.t - P.b) + '"/></svg>';
    const svg = el.querySelector('svg');
    const hit = svg.querySelector('.hit');
    const xh = svg.querySelector('#xhair');
    hit.addEventListener('pointermove', (ev) => {
      const bx = svg.getBoundingClientRect().left;
      const px = ev.clientX - bx;
      let best = pts[0];
      pts.forEach((p) => { if (Math.abs(x(p.date) - px) < Math.abs(x(best.date) - px)) best = p; });
      xh.setAttribute('x1', x(best.date));
      xh.setAttribute('x2', x(best.date));
      showTip('<b>' + dateFR(best.date) + '</b><br>Valeur : ' + eur(best.value, 0) + '<br>Investi : ' + eur(best.cost, 0) + '<br>Écart : ' + sEur(best.value - best.cost, 0), ev.clientX, ev.clientY);
    });
    hit.addEventListener('pointerleave', () => { xh.setAttribute('x1', -10); xh.setAttribute('x2', -10); hideTip(); });
  }

  /* ================================================================ Info-bulle */

  function showTip(html, cx, cy) {
    const t = $('#tip');
    t.innerHTML = html;
    t.hidden = false;
    const r = t.getBoundingClientRect();
    let left = cx + 14;
    let top = cy + 14;
    if (left + r.width > window.innerWidth - 8) left = cx - r.width - 14;
    if (top + r.height > window.innerHeight - 8) top = cy - r.height - 14;
    t.style.left = Math.max(8, left) + 'px';
    t.style.top = Math.max(8, top) + 'px';
  }
  function hideTip() { $('#tip').hidden = true; }

  /* ================================================================ Rendu */

  function renderAll() {
    const snap = currentSnapshot();
    const A = analyze(snap);
    const C = runControls(A);
    const AL = S.alerts.map((a) => Object.assign({ a }, evalAlert(a, A)));
    renderHeader(A);
    renderCounts(C, AL);
    $('#panel-synthese').innerHTML = renderSynthese(A, C);
    $('#panel-positions').innerHTML = renderPositions(A);
    $('#panel-controles').innerHTML = renderControles(A, C);
    $('#panel-alertes').innerHTML = renderAlertes(A, AL);
    $('#panel-flux').innerHTML = renderFlux(A, C, AL);
    $('#panel-idees').innerHTML = renderIdees(A);
    showTab(S.tab, true);
  }

  function renderHeader(A) {
    const meta = $('#meta');
    if (!S.loaded) { meta.innerHTML = '<span>Chargement des données…</span>'; }
    else if (!A) { meta.innerHTML = '<span>Aucun relevé importé</span><span>Consensus au ' + dateFR(researchAsOf()) + '</span>'; }
    else {
      meta.innerHTML = '<span>' + (S.demo ? 'Exemple fictif' : 'Relevé du ' + dateFR(A.snap.date)) + '</span><span>' + A.lines.length + ' lignes</span><span>Consensus au ' + dateFR(researchAsOf()) + '</span>';
    }
    const sel = $('#snapSelect');
    if (S.snapshots.length > 1 && !S.demo) {
      sel.hidden = false;
      sel.innerHTML = S.snapshots.slice().reverse().map((s) => '<option value="' + esc(s.id) + '"' + (s.id === S.current ? ' selected' : '') + '>Relevé du ' + dateFR(s.date) + '</option>').join('');
    } else sel.hidden = true;
    const badge = $('#storeBadge');
    badge.className = 'store-badge' + (S.mode === 'db' ? ' cloud' : '');
    badge.lastElementChild.textContent = S.mode === 'db' ? 'Données privées enregistrées' : S.mode === 'local' ? 'Données dans ce navigateur' : 'Connexion…';
    $('#btnImport').disabled = S.readOnly;
  }

  function renderCounts(C, AL) {
    const a = C.filter((c) => c.status === 'alert').length;
    const w = C.filter((c) => c.status === 'warn').length;
    const cc = $('#countCtrl');
    cc.hidden = !(a || w);
    cc.className = 'count ' + (a ? 'alert' : 'warn');
    cc.textContent = a || w;
    cc.title = a + ' alerte(s), ' + w + ' vigilance(s)';
    const hits = AL.filter((x) => x.a.active !== false && x.hit).length;
    const ca = $('#countAlert');
    ca.hidden = !hits;
    ca.className = 'count alert';
    ca.textContent = hits;
  }

  function chip(status, text) {
    const ico = { ok: '✓', warn: '!', alert: '×', info: 'i' }[status] || 'i';
    const lab = text || { ok: 'Conforme', warn: 'Vigilance', alert: 'Alerte', info: 'Info' }[status];
    return '<span class="chip ' + status + '"><span class="ico" aria-hidden="true">' + ico + '</span>' + esc(lab) + '</span>';
  }

  function emptyState() {
    if (!S.loaded) {
      return '<div class="empty"><h2>Chargement…</h2><p class="muted">Récupération de vos relevés enregistrés.</p></div>';
    }
    return '<div class="empty"><span class="eyebrow">Premier pas</span><h2>Importez votre export BoursoBank</h2>' +
      '<p class="muted">Dans votre espace BoursoBank, exportez les positions de votre PEA au format Excel (.xlsx), puis importez le fichier ici. ' +
      'Les contrôles, alertes, mouvements et avis des analystes se calculent automatiquement.</p>' +
      '<div class="actions"><button class="btn primary" type="button" data-act="import">Importer un relevé</button>' +
      '<button class="btn" type="button" data-act="demo">Voir un exemple fictif</button></div></div>';
  }

  function demoBanner() {
    return S.demo ? '<div class="banner"><span><b>Exemple fictif.</b> Ces positions ne sont pas les vôtres.</span><button class="btn sm" type="button" data-act="exit-demo">Quitter l’exemple</button></div>' : '';
  }

  /* ---------------- Synthèse */

  function renderSynthese(A, C) {
    if (!A) return emptyState() + renderPipeline(null, [], []);
    const score = healthScore(C);
    const nA = C.filter((c) => c.status === 'alert').length;
    const nW = C.filter((c) => c.status === 'warn').length;
    const nO = C.filter((c) => c.status === 'ok').length;
    const todo = C.filter((c) => (c.status === 'alert' || c.status === 'warn') && c.action).sort((a, b) => (a.status === 'alert' ? 0 : 1) - (b.status === 'alert' ? 0 : 1)).slice(0, 5);
    const lines = A.lines.slice().sort((a, b) => b.value - a.value);
    const kpi = '<div class="kpis">' +
      '<div class="kpi"><span class="label">Valeur du PEA</span><span class="value hero num">' + eur(A.total, 0) + '</span><span class="sub">' + (A.cash ? 'dont ' + eur(A.cash, 0) + ' de liquidités' : 'hors liquidités (non incluses dans l’export)') + '</span></div>' +
      '<div class="kpi"><span class="label">+/- value latente</span><span class="value num ' + tone(A.pnl) + '">' + sEur(A.pnl, 0) + '</span><span class="sub num">' + sPct(A.pnlPct) + ' sur ' + eur(A.cost, 0) + ' investis</span></div>' +
      (A.hasNonTradable ? '<div class="kpi"><span class="label">Hors titres radiés</span><span class="value num ' + tone(A.pnlT) + '">' + sEur(A.pnlT, 0) + '</span><span class="sub num">' + sPct(A.pnlTPct) + ' sur les lignes cotées</span></div>' : '') +
      '<div class="kpi"><span class="label">Variation du jour</span><span class="value num ' + tone(A.day) + '">' + sEur(A.day, 2) + '</span><span class="sub">estimée sur le relevé</span></div>' +
      '<div class="kpi"><span class="label">Lignes</span><span class="value num">' + A.lines.length + '</span><span class="sub">' + A.counts.etf + ' ETF · ' + A.counts.stocks + ' actions</span></div></div>';

    const health = '<div class="card section"><div class="section-head"><h2>Santé du portefeuille</h2><button class="btn ghost sm" type="button" data-goto="controles">Voir les ' + C.length + ' contrôles</button></div>' +
      '<div class="health">' + ring(score) + '<div class="section" style="gap:8px"><p class="small muted">Indice calculé sur les contrôles : −12 points par alerte, −5 par point de vigilance.</p>' +
      '<div class="health-legend">' + chip('alert', nA + ' alerte' + (nA > 1 ? 's' : '')) + chip('warn', nW + ' vigilance' + (nW > 1 ? 's' : '')) + chip('ok', nO + ' conforme' + (nO > 1 ? 's' : '')) + '</div></div></div>' +
      '<h3>À faire en priorité</h3>' +
      (todo.length ? '<ol class="plain">' + todo.map((c) => '<li><b>' + esc(c.title) + '</b> : ' + esc(c.action) + '</li>').join('') + '</ol>' : '<p class="muted">Rien d’urgent : le portefeuille respecte vos seuils.</p>') + '</div>';

    const types = '<div class="card section"><div class="section-head"><h2>Répartition</h2><span class="muted small">par type d’actif</span></div>' +
      '<div class="stack" role="img" aria-label="Répartition par type d’actif">' + A.types.map((t) => '<div tabindex="0" style="width:' + t.weight + '%;background:' + t.color + '" data-tip="' + esc('<b>' + t.name + '</b><br>' + eur(t.value, 0) + ' · ' + pct(t.weight)) + '"></div>').join('') + '</div>' +
      '<div class="legend">' + A.types.map((t) => '<span><i style="background:' + t.color + '"></i>' + esc(t.name) + ' <b class="num">' + pct(t.weight) + '</b></span>').join('') + '</div>' +
      '<h3 style="margin-top:8px">Zones géographiques</h3><p class="small muted">Estimation par transparence des ETF (MSCI World ≈ 75 % Amérique du Nord).</p>' +
      hbars(A.zones.map((z) => ({ label: z.name, value: z.weight })), (v) => pct(v), { max: 100 }) + '</div>';

    const sectors = '<div class="card section"><div class="section-head"><h2>Secteurs</h2><span class="muted small">en % du PEA</span></div>' +
      hbars(A.sectors.map((s) => ({ label: s.name, value: s.weight, color: !/diversifié/i.test(s.name) && s.weight >= S.settings.sectorAlert ? 'var(--serious)' : undefined, tip: '<b>' + esc(s.name) + '</b><br>' + pct(s.weight) + ' · ' + eur(s.value, 0) + '<br>' + esc(s.lines.map((l) => l.label).join(', ')) })), (v) => pct(v)) +
      '<p class="small muted">En orange : au-dessus du seuil d’alerte sectoriel (' + S.settings.sectorAlert + ' %).</p></div>';

    const pnl = '<div class="card section"><div class="section-head"><h2>Performance par ligne</h2><div class="legend"><span><i style="background:var(--gain)"></i>Plus-value</span><span><i style="background:var(--loss)"></i>Moins-value</span></div></div>' +
      dbars(A.lines.slice().sort((a, b) => b.pnlPct - a.pnlPct).map((l) => ({ label: l.label, value: l.pnlPct, tip: '<b>' + esc(l.label) + '</b><br>' + sPct(l.pnlPct) + ' · ' + sEur(l.pnl) + '<br>PRU ' + eur(l.pru) + ' → cours ' + eur(l.last) }))) + '</div>';

    const analysts = '<div class="section"><div class="section-head"><h2>Ce que disent les analystes sur vos lignes</h2>' + ABAR_LEGEND + '</div>' +
      '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Ligne</th><th>Avis des analystes</th><th>Répartition</th><th class="r">Objectif</th><th class="r">Potentiel</th><th>Avis de synthèse</th></tr></thead><tbody>' +
      lines.map((l) => '<tr class="clickable" data-detail="' + esc(l.isin) + '"><td><div class="name-cell"><b>' + esc(l.label) + '</b><span>' + esc(l.m.sector || '') + '</span></div></td>' +
        '<td>' + (l.call ? recoPill(l.call.label, l.call.cls) + ' <span class="small muted">' + esc(l.call.strength) + (l.call.thin ? ', ' + l.call.n + ' analyste' + (l.call.n > 1 ? 's' : '') : '') + '</span>' : '<span class="small muted">' + (l.m.kind === 'etf' ? 'ETF : pas de consensus' : l.m.nonTradable ? 'Plus suivie' : 'Non couvert') + '</span>') + '</td>' +
        '<td>' + abar(l.m.consensus) + '</td>' +
        '<td class="r">' + (l.m.consensus && !l.m.nonTradable ? eur(l.m.consensus.target) : '—') + '</td>' +
        '<td class="r ' + tone(l.upside) + '">' + sPct(l.upside) + '</td>' +
        '<td>' + (l.m.view ? recoPill(l.m.view.label) : '<span class="reco r-none">À étudier</span>') + '</td></tr>').join('') +
      '</tbody></table></div><p class="note">« Renforcer » regroupe les avis Acheter et Renforcer (note médiane ≤ 2,5 sur l’échelle FactSet 1-5). L’avis de synthèse tient compte du poids de la ligne et des doublons. Cliquez sur une ligne pour le détail et les sources.</p></div>';

    return demoBanner() + kpi + '<div class="grid-2">' + health + types + '</div>' + analysts + '<div class="grid-2">' + sectors + pnl + '</div>';
  }

  /* ---------------- Positions */

  function renderPositions(A) {
    if (!A) return emptyState();
    const k = S.posSort.key;
    const d = S.posSort.dir;
    const val = (l) => ({ label: l.label, qty: l.qty, pru: l.pru, last: l.last, dayVar: l.dayVar, value: l.value, weight: l.weight, pnl: l.pnl, pnlPct: l.pnlPct, upside: l.upside == null ? -Infinity : l.upside })[k];
    const lines = A.lines.slice().sort((a, b) => { const x = val(a); const y = val(b); return (typeof x === 'string' ? x.localeCompare(y) : x - y) * d; });
    const th = (key, label, r) => '<th class="' + (r ? 'r' : '') + '" aria-sort="' + (k === key ? (d > 0 ? 'ascending' : 'descending') : 'none') + '"><button type="button" data-sort="' + key + '">' + label + (k === key ? (d > 0 ? ' ↑' : ' ↓') : '') + '</button></th>';
    const maxW = Math.max(S.settings.lineAlert, Math.max.apply(null, A.lines.map((l) => l.weight)));
    return demoBanner() + '<div class="section"><div class="section-head"><h2>Positions</h2><span class="muted small">Cliquez sur une ligne pour sa fiche.</span></div>' +
      '<div class="tbl-wrap"><table class="tbl"><thead><tr>' + th('label', 'Ligne') + th('qty', 'Qté', 1) + th('pru', 'PRU', 1) + th('last', 'Cours', 1) + th('dayVar', 'Jour', 1) + th('value', 'Valeur', 1) + th('weight', 'Poids') + th('pnl', '+/- value', 1) + th('pnlPct', '%', 1) + '<th>Analystes</th>' + th('upside', 'Potentiel', 1) + '<th>Avis</th></tr></thead><tbody>' +
      lines.map((l) => '<tr class="clickable" data-detail="' + esc(l.isin) + '">' +
        '<td><div class="name-cell"><b>' + esc(l.label) + '</b><span>' + esc(l.isin) + ' · ' + esc(l.m.kind === 'etf' ? 'ETF' : (l.m.market || 'Action')) + '</span></div></td>' +
        '<td class="r">' + nb(l.qty, l.qty % 1 ? 2 : 0) + '</td><td class="r">' + eur(l.pru) + '</td><td class="r">' + eur(l.last) + '</td>' +
        '<td class="r ' + tone(l.dayVar) + '">' + sPct(l.dayVar, 2) + '</td><td class="r"><b>' + eur(l.value) + '</b></td>' +
        '<td><div class="wbar"><span class="track"><span class="fill' + (!l.m.diversified && l.weight >= S.settings.lineWarn ? ' over' : '') + '" style="display:block;width:' + clamp(l.weight / maxW * 100, 1, 100) + '%"></span></span><span class="num small">' + pct(l.weight) + '</span></div></td>' +
        '<td class="r ' + tone(l.pnl) + '">' + sEur(l.pnl) + '</td><td class="r ' + tone(l.pnlPct) + '">' + sPct(l.pnlPct) + '</td>' +
        '<td>' + (l.call ? recoPill(l.call.label, l.call.cls) : '<span class="small muted">—</span>') + '</td>' +
        '<td class="r ' + tone(l.upside) + '">' + sPct(l.upside) + '</td>' +
        '<td>' + (l.m.view ? recoPill(l.m.view.label) : '<span class="reco r-none">À étudier</span>') + '</td></tr>').join('') +
      '</tbody><tfoot><tr><td>Total' + (A.cash ? ' (dont liquidités ' + eur(A.cash, 0) + ')' : '') + '</td><td></td><td></td><td></td><td class="r ' + tone(A.day) + '">' + sEur(A.day) + '</td><td class="r">' + eur(A.total) + '</td><td>100 %</td><td class="r ' + tone(A.pnl) + '">' + sEur(A.pnl) + '</td><td class="r ' + tone(A.pnlPct) + '">' + sPct(A.pnlPct) + '</td><td></td><td></td><td></td></tr></tfoot></table></div>' +
      '<p class="note">Potentiel = objectif moyen des analystes ÷ cours du relevé − 1. Barre orange : ligne au-dessus du seuil de vigilance (' + S.settings.lineWarn + ' %, ETF diversifiés exclus).</p></div>';
  }

  function detailSheet(isin) {
    const A = analyze(currentSnapshot());
    const l = A && A.lines.find((x) => x.isin === isin);
    const m = l ? l.m : metaFor(isin, isin);
    const c = m.consensus;
    const call = analystCall(c);
    const price = l ? l.last : c && c.price;
    const up = c && ok(c.target) && price && !m.nonTradable ? (c.target / price - 1) * 100 : null;
    const list = (arr) => arr && arr.length ? '<ul class="plain">' + arr.map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul>' : '<p class="muted small">—</p>';
    openSheet('<div class="sheet-head"><div><span class="eyebrow">' + esc(isin) + (m.ticker ? ' · ' + esc(m.ticker) : '') + ' · ' + esc(m.market || (m.kind === 'etf' ? 'ETF' : '')) + '</span><h2 id="sheetTitle">' + esc(m.name || (l && l.name)) + '</h2><p class="muted small">' + esc(m.sector || '') + (m.cap ? ' · ' + esc(m.cap) : '') + (ok(m.ter) ? ' · frais ' + pct(m.ter, 2) + '/an' : '') + '</p></div><button class="btn" type="button" data-act="close">Fermer</button></div>' +
      (l ? '<div class="kpis"><div class="kpi"><span class="label">Valeur</span><span class="value num">' + eur(l.value) + '</span><span class="sub">' + nb(l.qty, 0) + ' × ' + eur(l.last) + '</span></div><div class="kpi"><span class="label">+/- value</span><span class="value num ' + tone(l.pnl) + '">' + sEur(l.pnl) + '</span><span class="sub num">' + sPct(l.pnlPct) + ' · PRU ' + eur(l.pru) + '</span></div><div class="kpi"><span class="label">Poids</span><span class="value num">' + pct(l.weight) + '</span><span class="sub">du PEA</span></div></div>' : '') +
      '<div class="grid-2"><div class="section"><h3>Avis de synthèse</h3>' + (m.view ? '<div>' + recoPill(m.view.label) + '</div><p>' + esc(m.view.why) + '</p>' : '<p class="muted">Pas encore de fiche : demandez à Claude de l’ajouter.</p>') + '</div>' +
      '<div class="section"><h3>Consensus des analystes</h3>' + (call ? '<div>' + recoPill(call.label, call.cls) + ' <span class="small muted">' + esc(call.strength) + ' · note médiane ' + nb(call.med, 2) + '/5</span></div>' + abar(c) + ABAR_LEGEND +
        '<p class="small">' + call.n + ' analyste' + (call.n > 1 ? 's' : '') + ' · objectif moyen <b>' + eur(c.target) + '</b> · potentiel <b class="' + tone(up) + '">' + sPct(up) + '</b></p>' : '<p class="muted small">' + (m.kind === 'etf' ? 'Un ETF réplique un indice : il n’a pas de consensus d’analystes.' : 'Aucun consensus disponible.') + '</p>') + '</div></div>' +
      '<div class="grid-2"><div class="section"><h3>Faits récents</h3>' + list(m.facts) + '</div><div class="section"><h3>Risques</h3>' + list(m.risks) + '</div></div>' +
      (m.sources && m.sources.length ? '<p class="small">Sources : ' + m.sources.map((s) => '<a href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(s.label) + '</a>').join(' · ') + '</p>' : '') +
      '<div class="actions">' + (l && !m.nonTradable ? '<button class="btn primary" type="button" data-act="alert-for" data-isin="' + esc(isin) + '">Créer une alerte sur cette ligne</button>' : '') + '</div>');
  }

  /* ---------------- Contrôles */

  function renderControles(A, C) {
    if (!A) return emptyState();
    const f = S.ctrlFilter;
    const shown = C.filter((c) => f === 'all' || c.status === f);
    const groups = [];
    shown.forEach((c) => { let g = groups.find((x) => x.name === c.group); if (!g) groups.push(g = { name: c.group, items: [] }); g.items.push(c); });
    const n = (s) => C.filter((c) => c.status === s).length;
    const seg = (key, label) => '<button class="seg" type="button" data-cfilter="' + key + '" aria-pressed="' + (f === key) + '">' + label + '</button>';
    return demoBanner() + '<div class="section"><div class="section-head"><h2>Contrôles</h2><div class="ctrl-summary">' + chip('alert', n('alert') + ' alerte(s)') + chip('warn', n('warn') + ' vigilance(s)') + chip('ok', n('ok') + ' conforme(s)') + chip('info', n('info') + ' info') + '</div></div>' +
      '<div class="filter-row">' + seg('all', 'Tous') + seg('alert', 'Alertes') + seg('warn', 'Vigilance') + seg('ok', 'Conformes') + seg('info', 'Infos') + '</div>' +
      (groups.length ? groups.map((g) => '<div class="section"><h3>' + esc(g.name) + '</h3><div class="ctrl-list">' + g.items.map((c) =>
        '<div class="ctrl ' + c.status + '"><span class="stripe"></span><div class="body"><div class="row1"><span class="title"><span class="code">' + esc(c.id) + '</span>' + esc(c.title) + '</span>' + chip(c.status) + '</div>' +
        '<p class="detail">' + esc(c.detail) + '</p>' + (c.action ? '<p class="action"><b>Action :</b> ' + esc(c.action) + '</p>' : '') + '</div></div>').join('') + '</div></div>').join('') : '<p class="muted">Aucun contrôle dans cette catégorie.</p>') +
      '<p class="note">Les seuils se règlent dans Réglages. Les contrôles se recalculent à chaque import et à chaque ouverture.</p></div>';
  }

  /* ---------------- Alertes */

  function renderAlertes(A, AL) {
    const hits = AL.filter((x) => x.a.active !== false && x.hit);
    const d = S.alertDraft || { scope: 'line', target: A && A.lines[0] ? A.lines[0].isin : '', metric: 'price', op: '<=', value: '' , note: '' };
    const metricsFor = Object.keys(METRICS).filter((k) => METRICS[k].scopes.includes(d.scope));
    if (!metricsFor.includes(d.metric)) d.metric = metricsFor[0];
    const targetField = d.scope === 'line'
      ? '<div class="field"><label for="al-target">Ligne</label><select class="input" id="al-target">' + (A ? A.lines : []).filter((l) => !l.m.nonTradable).map((l) => '<option value="' + esc(l.isin) + '"' + (l.isin === d.target ? ' selected' : '') + '>' + esc(l.label) + '</option>').join('') + '</select></div>'
      : d.scope === 'sector'
        ? '<div class="field"><label for="al-target">Secteur</label><select class="input" id="al-target">' + (A ? A.sectors : []).map((s) => '<option' + (s.name === d.target ? ' selected' : '') + '>' + esc(s.name) + '</option>').join('') + '</select></div>'
        : '';
    const curLine = A && d.scope === 'line' ? A.lines.find((l) => l.isin === d.target) : null;
    const hint = curLine ? 'Actuel : ' + fmtMetric(metricOf(curLine, d.metric), d.metric) : '';
    const form = '<div class="card section"><h2>Nouvelle alerte</h2><form id="alertForm" class="form-grid" novalidate>' +
      '<div class="field"><label for="al-scope">Porte sur</label><select class="input" id="al-scope">' + Object.keys(SCOPE_LABEL).map((k) => '<option value="' + k + '"' + (k === d.scope ? ' selected' : '') + '>' + SCOPE_LABEL[k] + '</option>').join('') + '</select></div>' +
      targetField +
      '<div class="field"><label for="al-metric">Indicateur</label><select class="input" id="al-metric">' + metricsFor.map((k) => '<option value="' + k + '"' + (k === d.metric ? ' selected' : '') + '>' + METRICS[k].label + '</option>').join('') + '</select></div>' +
      '<div class="field"><label for="al-op">Condition</label><select class="input" id="al-op"><option value="<="' + (d.op === '<=' ? ' selected' : '') + '>inférieur ou égal à</option><option value=">="' + (d.op === '>=' ? ' selected' : '') + '>supérieur ou égal à</option></select></div>' +
      '<div class="field"><label for="al-value">Seuil (' + esc(METRICS[d.metric].unit) + ')</label><input class="input" id="al-value" inputmode="decimal" value="' + esc(d.value) + '" placeholder="' + esc(hint) + '"></div>' +
      '<div class="field" style="grid-column:1/-1"><label for="al-note">Que faire si elle se déclenche ? (facultatif)</label><input class="input" id="al-note" value="' + esc(d.note || '') + '" placeholder="Ex. : alléger de moitié"></div>' +
      '<div class="actions"><button class="btn primary" type="submit"' + (S.readOnly ? ' disabled' : '') + '>Créer l’alerte</button><span class="small muted">' + esc(hint) + '</span></div></form></div>';
    const sugg = suggestedAlerts(A);
    const have = new Set(S.alerts.map(alertKey));
    const missing = sugg.filter((s) => !have.has(alertKey(s)));
    const suggest = A ? '<div class="card section"><h2>Alertes recommandées</h2><p class="small muted">Objectifs des analystes, baisse de 15 % sur les actions, concentration, moins-value et forte baisse en séance.</p>' +
      (missing.length ? '<ul class="plain">' + missing.slice(0, 6).map((s) => '<li>' + esc(alertTitle(s)) + '</li>').join('') + (missing.length > 6 ? '<li>… et ' + (missing.length - 6) + ' autres</li>' : '') + '</ul><div><button class="btn" type="button" data-act="add-suggested"' + (S.readOnly ? ' disabled' : '') + '>Ajouter les ' + missing.length + ' alertes</button></div>' : '<p class="muted small">Toutes les alertes recommandées sont déjà en place.</p>') + '</div>' : '';
    const row = (x) => {
      const a = x.a;
      const active = a.active !== false;
      const st = !active ? chip('info', 'Désactivée') : x.missing ? chip('info', 'Ligne absente') : x.hit ? chip('alert', 'Déclenchée') : chip('ok', 'En veille');
      return '<tr><td><div class="name-cell"><b>' + esc(alertTitle(a)) + '</b><span>' + esc(a.note || '') + '</span></div></td><td>' + st + '</td>' +
        '<td class="r">' + esc(fmtMetric(x.current, a.metric)) + '</td><td class="small">' + esc(x.matches.join(' · ')) + '</td>' +
        '<td class="small muted">' + (a.lastHitDate ? dateFR(a.lastHitDate) : '—') + '</td>' +
        '<td><div class="actions"><button class="btn sm" type="button" data-alert-toggle="' + esc(a.id) + '">' + (active ? 'Désactiver' : 'Activer') + '</button><button class="btn sm danger" type="button" data-alert-del="' + esc(a.id) + '">Supprimer</button></div></td></tr>';
    };
    const sorted = AL.slice().sort((x, y) => (y.hit && y.a.active !== false ? 1 : 0) - (x.hit && x.a.active !== false ? 1 : 0));
    const table = '<div class="section"><div class="section-head"><h2>Vos alertes</h2><span class="small muted">' + S.alerts.length + ' alerte(s), ' + hits.length + ' déclenchée(s)</span></div>' +
      (S.alerts.length ? '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Alerte</th><th>État</th><th class="r">Valeur actuelle</th><th>Lignes concernées</th><th>Dernier déclenchement</th><th></th></tr></thead><tbody>' + sorted.map(row).join('') + '</tbody></table></div>'
        : '<div class="empty"><p>Aucune alerte pour l’instant. Créez-en une ci-dessus ou ajoutez les alertes recommandées.</p></div>') +
      '<p class="note">Les alertes sont évaluées sur le relevé affiché, à chaque import et à chaque ouverture. Les titres radiés sont exclus des alertes « n’importe quelle ligne ». La page ne surveille pas les cours en continu : pour une alerte en temps réel, recopiez les seuils de cours dans l’application BoursoBank.</p></div>';
    return demoBanner() + (hits.length ? '<div class="banner"><span><b>' + hits.length + ' alerte(s) déclenchée(s)</b> sur le relevé du ' + dateFR(A.snap.date) + '.</span></div>' : '') + table + '<div class="grid-2">' + form + suggest + '</div>';
  }

  /* ---------------- Flux */

  function renderPipeline(A, C, AL) {
    const snap = A && A.snap;
    const q = snap ? qualityChecks(snap.positions) : [];
    const qBad = q.filter((x) => x.status !== 'ok').length;
    const prev = previousSnapshot(snap);
    const mv = snap && prev ? diffSnapshots(prev, snap).length : 0;
    const nA = C.filter((c) => c.status === 'alert').length;
    const nW = C.filter((c) => c.status === 'warn').length;
    const hits = AL.filter((x) => x.a.active !== false && x.hit).length;
    const steps = [
      ['Export BoursoBank', 'Fichier Excel des positions du PEA.', snap ? chip('ok', 'Reçu') : chip('info', 'En attente')],
      ['Lecture et contrôles qualité', 'Colonnes, ISIN, doublons, cohérence des montants.', snap ? chip(qBad ? 'warn' : 'ok', qBad ? qBad + ' anomalie(s)' : q.length + ' contrôles OK') : ''],
      ['Historisation', 'Un relevé daté par import.', snap ? chip('ok', S.demo ? 'Exemple' : S.snapshots.length + ' relevé(s)') : ''],
      ['Mouvements', 'Achats, renforcements, allègements, ventes déduits.', snap ? chip(prev ? 'ok' : 'info', prev ? mv + ' mouvement' + (mv > 1 ? 's' : '') : 'Premier relevé') : ''],
      ['Contrôles du portefeuille', 'Concentration, pertes, analystes, cadre PEA.', snap ? chip(nA ? 'alert' : nW ? 'warn' : 'ok', nA + ' alerte' + (nA > 1 ? 's' : '') + ', ' + nW + ' vigilance' + (nW > 1 ? 's' : '')) : ''],
      ['Alertes', 'Vos seuils évalués sur le relevé.', snap ? chip(hits ? 'alert' : 'ok', hits + ' déclenchée(s)') : ''],
      ['Décision', 'Avis par ligne et idées mid caps.', snap ? chip('info', 'Voir Synthèse') : '']
    ];
    return '<div class="section"><div class="section-head"><h2>Chaîne de traitement d’un relevé</h2></div><ol class="pipeline" style="list-style:none;padding:0;margin:0">' +
      steps.map((s, i) => '<li class="step"><span class="n">Étape ' + (i + 1) + '</span><span class="t">' + esc(s[0]) + '</span><span class="d">' + esc(s[1]) + '</span>' + s[2] + '</li>').join('') + '</ol></div>';
  }

  function renderFlux(A, C, AL) {
    const pipe = renderPipeline(A, C, AL);
    if (!A) return pipe + emptyState();
    const dep = depositsTotal();
    const flows = S.demo ? [] : S.flows;
    const journal = '<div class="section"><div class="section-head"><h2>Journal des mouvements</h2><span class="small muted">Mouvements détectés automatiquement à chaque import, plus vos saisies.</span></div>' +
      (flows.length ? '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Date</th><th>Type</th><th>Ligne</th><th class="r">Qté</th><th class="r">Prix</th><th class="r">Montant</th><th>Origine</th><th></th></tr></thead><tbody>' +
        flows.map((f) => '<tr><td class="num">' + dateFR(f.date) + '</td><td>' + esc(FLOW_TYPES[f.type] || f.type) + '</td><td><div class="name-cell"><b>' + esc(f.name || f.label || '—') + '</b><span>' + esc(f.note || '') + '</span></div></td>' +
          '<td class="r">' + (f.qty ? nb(f.qty, f.qty % 1 ? 2 : 0) : '—') + '</td><td class="r">' + (ok(f.price) && f.price ? eur(f.price) : '—') + '</td>' +
          '<td class="r">' + (ok(f.amount) && f.amount ? eur(f.amount) : '—') + '</td><td class="small">' + (f.source === 'auto' ? 'Détecté' + (f.estimated ? ' (estimé)' : '') : 'Saisi') + '</td>' +
          '<td><button class="btn sm danger" type="button" data-flow-del="' + esc(f.id) + '">Supprimer</button></td></tr>').join('') + '</tbody></table></div>'
        : '<div class="empty"><p>Aucun mouvement pour l’instant. Ils apparaîtront dès le prochain import (comparaison avec le relevé précédent) ou via la saisie ci-dessous.</p></div>') + '</div>';
    const form = '<div class="card section"><h2>Saisir un mouvement</h2><p class="small muted">Versements, dividendes, frais : l’export des positions ne les contient pas.</p><form id="flowForm" class="form-grid" novalidate>' +
      '<div class="field"><label for="fl-date">Date</label><input class="input" type="date" id="fl-date" value="' + todayISO() + '"></div>' +
      '<div class="field"><label for="fl-type">Type</label><select class="input" id="fl-type">' + ['versement', 'dividende', 'retrait', 'frais', 'achat', 'vente'].map((t) => '<option value="' + t + '">' + FLOW_TYPES[t] + '</option>').join('') + '</select></div>' +
      '<div class="field"><label for="fl-line">Ligne (facultatif)</label><select class="input" id="fl-line"><option value="">—</option>' + A.lines.map((l) => '<option value="' + esc(l.isin) + '">' + esc(l.label) + '</option>').join('') + '</select></div>' +
      '<div class="field"><label for="fl-amount">Montant (€)</label><input class="input" id="fl-amount" inputmode="decimal" placeholder="0,00"></div>' +
      '<div class="field" style="grid-column:1/-1"><label for="fl-note">Note</label><input class="input" id="fl-note" placeholder="Ex. : dividende Groupe LDLC"></div>' +
      '<div class="actions"><button class="btn primary" type="submit"' + (S.readOnly || S.demo ? ' disabled' : '') + '>Ajouter au journal</button></div></form></div>';
    const plafond = '<div class="card section"><h2>Plafond des versements</h2>' +
      (dep == null ? '<p class="muted">Renseignez vos versements cumulés dans Réglages pour suivre le plafond légal de 150 000 €.</p><div><button class="btn" type="button" data-act="settings">Ouvrir les réglages</button></div>'
        : '<p class="kpi" style="padding:0"><span class="value num">' + eur(dep, 0) + '</span><span class="sub">versés sur 150 000 € · reste ' + eur(Math.max(0, PEA_CEILING - dep), 0) + '</span></p><div class="meter" role="img" aria-label="' + pct(dep / PEA_CEILING * 100) + ' du plafond"><i style="width:' + clamp(dep / PEA_CEILING * 100, 0.5, 100) + '%"></i></div>') +
      '<p class="small muted">Seuls les versements comptent (pas les plus-values). Les mouvements saisis de type Versement et Retrait ajustent le total.</p></div>';
    const hist = '<div class="card section"><div class="section-head"><h2>Évolution de la valeur</h2><div class="legend"><span><i style="background:var(--s1)"></i>Valeur du PEA</span><span><i style="background:var(--s2)"></i>Montant investi</span></div></div>' +
      (S.demo ? '<p class="muted">Disponible avec vos propres relevés.</p>' : '<div id="histChart"></div>' + (S.snapshots.length < 2 ? '<p class="small muted">Un seul relevé pour l’instant : la courbe se dessinera à partir du prochain import.</p>' : '')) + '</div>';
    const snaps = S.demo ? '' : '<div class="section"><h2>Relevés enregistrés</h2><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Date</th><th class="r">Lignes</th><th class="r">Valeur</th><th class="r">+/- value</th><th>Importé le</th><th></th></tr></thead><tbody>' +
      S.snapshots.slice().reverse().map((s) => { const a = analyze(s); return '<tr><td class="num">' + dateFR(s.date) + '</td><td class="r">' + s.positions.length + '</td><td class="r">' + eur(a.total, 0) + '</td><td class="r ' + tone(a.pnl) + '">' + sEur(a.pnl, 0) + '</td><td class="small muted">' + (s.importedAt ? dateFR(s.importedAt) : '—') + '</td><td><div class="actions"><button class="btn sm" type="button" data-snap-show="' + esc(s.id) + '">Afficher</button><button class="btn sm danger" type="button" data-snap-del="' + esc(s.id) + '">Supprimer</button></div></td></tr>'; }).join('') +
      '</tbody></table></div></div>';
    return demoBanner() + pipe + '<div class="grid-2">' + hist + plafond + '</div>' + journal + form + snaps;
  }

  /* ---------------- Idées */

  function renderIdees(A) {
    const held = new Set(A ? A.lines.map((l) => l.isin) : []);
    let ideas = allIsins().map((i) => Object.assign({ isin: i }, inst(i))).filter((m) => m.idea && m.consensus && !held.has(m.isin))
      .map((m) => Object.assign(m, { sc: ideaScore(m) }));
    const key = S.ideaSort;
    ideas.sort((a, b) => key === 'up' ? b.sc.up - a.sc.up : key === 'per' ? (a.per ? a.per[0] : 99) - (b.per ? b.per[0] : 99) : b.sc.score - a.sc.score);
    const size = A ? A.total * 0.08 : null;
    const seg = (k, label) => '<button class="seg" type="button" data-isort="' + k + '" aria-pressed="' + (S.ideaSort === k) + '">' + label + '</button>';
    const card = (m) => {
      const c = m.consensus;
      const call = analystCall(c);
      const ticket = A && A.total ? c.price / A.total * 100 : null;
      return '<article class="card idea"><div class="idea-head"><div><span class="eyebrow">' + esc(m.ticker) + ' · ' + esc(m.cap || '') + '</span><h3>' + esc(m.name) + '</h3><p class="small muted">' + esc(m.sector) + '</p></div>' +
        '<div class="score" data-tip="' + esc('<b>Score ' + m.sc.score + '/100</b><br>Potentiel ' + Math.round(m.sc.parts.sUp) + ' · Consensus ' + Math.round(m.sc.parts.sCons) + '<br>Couverture ' + Math.round(m.sc.parts.sCov) + ' · Valorisation ' + Math.round(m.sc.parts.sVal)) + '" tabindex="0"><b>' + m.sc.score + '</b><span class="small muted">score</span></div></div>' +
        '<div class="meter" aria-hidden="true"><i style="width:' + m.sc.score + '%"></i></div>' +
        '<div>' + recoPill(call.label, call.cls) + ' <span class="small muted">' + call.n + ' analystes · ' + esc(call.strength) + '</span></div>' + abar(c) +
        '<div class="facts"><div><span>Cours</span><b>' + eur(c.price) + '</b></div><div><span>Objectif</span><b>' + eur(c.target) + '</b></div><div><span>Potentiel</span><b class="' + tone(m.sc.up) + '">' + sPct(m.sc.up, 0) + '</b></div>' +
        '<div><span>PER 2026e</span><b>' + (m.per ? nb(m.per[0], 1) : '—') + '</b></div><div><span>PER 2027e</span><b>' + (m.per ? nb(m.per[1], 1) : '—') + '</b></div><div><span>Rendement</span><b>' + (ok(m.yield) ? pct(m.yield) : '—') + '</b></div></div>' +
        (ok(ticket) ? '<p class="small"><b>Ticket minimum :</b> 1 titre = ' + pct(ticket) + ' du PEA' + (ticket > 12 ? ' (trop lourd pour une seule ligne aujourd’hui)' : '') + '.</p>' : '') +
        '<p class="small">' + esc(m.thesis) + '</p>' + (m.risks && m.risks.length ? '<p class="small muted"><b>Risque :</b> ' + esc(m.risks.join(' ')) + '</p>' : '') +
        '<p class="small">' + (m.sources || []).map((s) => '<a href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(s.label) + '</a>').join(' · ') + ' <span class="muted">· cours du ' + dateFR(c.priceDate) + '</span></p></article>';
    };
    return '<div class="section"><div class="section-head"><h2>Idées mid caps éligibles PEA</h2><div class="filter-row">' + seg('score', 'Score') + seg('up', 'Potentiel') + seg('per', 'PER le plus bas') + '</div></div>' +
      '<p class="small muted" style="max-width:80ch">Valeurs moyennes françaises non détenues, avec un consensus à l’achat. Score sur 100 = potentiel vs objectif (40 %), force du consensus (30 %), valorisation PER 2026e (20 %), nombre d’analystes (10 %). Consensus au ' + dateFR(researchAsOf()) + '.</p>' +
      (size ? '<div class="banner"><span>Taille conseillée pour une nouvelle ligne : <b>~8 % du PEA, soit environ ' + eur(size, 0) + '</b>. Avec un portefeuille de cette taille, une ou deux nouvelles lignes suffisent ; le reste des versements va au socle ETF Monde.</span></div>' : '') +
      '<div class="grid-3">' + ideas.map(card).join('') + '</div>' +
      '<div class="grid-2"><div class="card section"><h3>Écartées après analyse</h3><ul class="plain">' + (R.excluded || []).map((e) => '<li><b>' + esc(e.name) + '</b> : ' + esc(e.reason) + '</li>').join('') + '</ul></div>' +
      '<div class="card section"><h3>Alternative sans choix de titres</h3><p class="small">Un ETF petites et moyennes capitalisations européennes éligible PEA donne la même exposition en une seule ligne, sans risque spécifique. L’offre est réduite et le plus souvent à réplication synthétique : vérifiez l’ISIN, les frais et le DIC sur BoursoBank avant d’acheter.</p></div></div>' +
      '<p class="note">Ces idées ne constituent pas un conseil personnalisé. Un objectif d’analyste est une estimation à 12 mois, souvent révisée : le potentiel affiché n’est pas une promesse de rendement.</p></div>';
  }

  /* ================================================================ Feuilles */

  let lastFocus = null;
  function openSheet(html) {
    lastFocus = document.activeElement;
    $('#sheetCard').innerHTML = html;
    $('#sheet').hidden = false;
    const f = $('#sheetCard').querySelector('button, input, select');
    if (f) f.focus();
  }
  function closeSheet() {
    $('#sheet').hidden = true;
    $('#sheetCard').innerHTML = '';
    S.pending = null;
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  function importSheet() {
    if (S.readOnly) { toast('Lecture seule : import impossible depuis cette vue.'); return; }
    const p = S.pending;
    let body = '<div class="sheet-head"><div><span class="eyebrow">Étapes 1 à 6</span><h2 id="sheetTitle">Importer un relevé</h2></div><button class="btn" type="button" data-act="close">Fermer</button></div>';
    if (!p) {
      body += '<div class="drop" id="drop"><b>Déposez ici votre export BoursoBank</b><span class="small muted">Fichier .xlsx des positions du PEA (ou .csv)</span><button class="btn primary" type="button" data-act="pick">Choisir le fichier</button></div>' +
        '<p class="small muted">Le fichier est lu dans votre navigateur. Seules les positions sont enregistrées.</p>';
    } else if (p.error) {
      body += '<div class="ctrl alert"><span class="stripe"></span><div class="body"><span class="title">Lecture impossible</span><p class="detail">' + esc(p.error) + '</p></div></div><div class="actions"><button class="btn" type="button" data-act="pick">Choisir un autre fichier</button></div>';
    } else {
      const blocking = p.checks.some((c) => c.status === 'alert' && (c.id === 'Q1' || c.id === 'Q2'));
      const A = blocking ? null : analyze(p.snap);
      const exists = S.snapshots.some((s) => s.id === p.snap.id);
      body += '<p class="small"><b>' + esc(p.fileName) + '</b></p><div class="checklist">' + p.checks.map((c) => '<div class="item">' + chip(c.status) + '<div><b>' + esc(c.title) + '</b><p class="d">' + esc(c.detail) + '</p></div></div>').join('') + '</div>';
      if (A) {
        const prev = S.snapshots.filter((s) => s.date < p.snap.date).slice(-1)[0] || null;
        const flows = diffSnapshots(prev, p.snap);
        p.flows = flows;
        const hits = S.alerts.filter((a) => a.active !== false).map((a) => ({ a, r: evalAlert(a, A) })).filter((x) => x.r.hit);
        p.hits = hits;
        body += '<div class="form-grid"><div class="field"><label for="imp-date">Date du relevé</label><input class="input" type="date" id="imp-date" value="' + esc(p.snap.date) + '"></div>' +
          '<div class="field"><label for="imp-cash">Liquidités du PEA (€, facultatif)</label><input class="input" id="imp-cash" inputmode="decimal" value="' + (ok(p.snap.cash) ? esc(String(p.snap.cash).replace('.', ',')) : '') + '" placeholder="Solde espèces"></div></div>' +
          (exists ? '<p class="small"><b>Un relevé existe déjà à cette date :</b> il sera remplacé.</p>' : '') +
          '<div class="kpis"><div class="kpi"><span class="label">Valeur</span><span class="value num">' + eur(A.total, 0) + '</span></div><div class="kpi"><span class="label">+/- value</span><span class="value num ' + tone(A.pnl) + '">' + sEur(A.pnl, 0) + '</span></div><div class="kpi"><span class="label">Lignes</span><span class="value num">' + A.lines.length + '</span></div></div>' +
          '<h3>Mouvements détectés</h3>' + (prev ? (flows.length ? '<ul class="plain">' + flows.map((f) => '<li>' + esc(FLOW_TYPES[f.type]) + ' · ' + esc(f.name) + (f.qty ? ' · ' + nb(f.qty, 0) + ' titre(s)' : '') + (f.amount ? ' · ~' + eur(f.amount, 0) : '') + '</li>').join('') + '</ul>' : '<p class="small muted">Aucun changement de position depuis le ' + dateFR(prev.date) + '.</p>') : '<p class="small muted">Premier relevé : les mouvements seront détectés à partir du prochain import.</p>') +
          '<h3>Alertes déclenchées</h3>' + (hits.length ? '<ul class="plain">' + hits.map((x) => '<li><b>' + esc(alertTitle(x.a)) + '</b>' + (x.r.matches.length ? ' : ' + esc(x.r.matches.join(', ')) : '') + '</li>').join('') + '</ul>' : '<p class="small muted">Aucune alerte déclenchée.</p>') +
          '<div class="actions"><button class="btn primary" type="button" data-act="commit">Enregistrer le relevé</button><button class="btn" type="button" data-act="pick">Changer de fichier</button></div>';
      } else {
        body += '<div class="actions"><button class="btn" type="button" data-act="pick">Choisir un autre fichier</button></div>';
      }
    }
    openSheet(body);
    const drop = $('#drop');
    if (drop) {
      drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
      drop.addEventListener('dragleave', () => drop.classList.remove('over'));
      drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]); });
    }
  }

  async function handleFile(file) {
    try {
      const buf = await file.arrayBuffer();
      const rows = readWorkbook(buf);
      const parsed = normalizeRows(rows);
      const snap = { id: todayISO(), date: todayISO(), source: 'Export BoursoBank', fileName: file.name, cash: null, positions: parsed.positions };
      S.pending = { fileName: file.name, parsed, snap, checks: qualityChecks(parsed.positions, parsed) };
    } catch (e) {
      S.pending = { fileName: file.name, error: (e && e.message) || 'Fichier illisible.' };
    }
    importSheet();
  }

  async function commitImport() {
    const p = S.pending;
    if (!p || !p.snap) return;
    const date = ($('#imp-date') && $('#imp-date').value) || todayISO();
    const cash = num($('#imp-cash') && $('#imp-cash').value);
    const snap = Object.assign({}, p.snap, { id: date, date, cash: ok(cash) ? cash : null, importedAt: new Date().toISOString() });
    const prev = S.snapshots.filter((s) => s.date < date).slice(-1)[0] || null;
    const flows = diffSnapshots(prev, snap);
    const A = analyze(snap);
    S.awaitId = snap.id;
    try {
      await save('snapshots', snap.id, snap);
      for (const f of flows) await save('flows', f.id, f);
      for (const a of S.alerts) {
        if (a.active === false) continue;
        const r = evalAlert(a, A);
        if (!r.hit) continue;
        const hist = (a.history || []).filter((h) => h.date !== date).concat([{ date, value: ok(r.current) ? r.current : null }]).slice(-20);
        await save('alerts', a.id, Object.assign({}, a, { lastHitDate: date, history: hist }));
      }
    } catch (e) { return; }
    S.demo = null;
    S.current = snap.id;
    closeSheet();
    toast('Relevé du ' + dateFR(date) + ' enregistré' + (flows.length ? ' · ' + flows.length + ' mouvement(s) détecté(s)' : '') + '.');
    renderAll();
  }

  function settingsSheet() {
    const st = S.settings;
    const f = (id, label, val, extra) => '<div class="field"><label for="st-' + id + '">' + label + '</label><input class="input" id="st-' + id + '" ' + (extra || 'inputmode="decimal"') + ' value="' + esc(val == null ? '' : val) + '"></div>';
    openSheet('<div class="sheet-head"><div><span class="eyebrow">Réglages</span><h2 id="sheetTitle">Seuils et cadre du PEA</h2></div><button class="btn" type="button" data-act="close">Fermer</button></div>' +
      '<form id="settingsForm" class="section" novalidate><h3>Votre PEA</h3><div class="form-grid">' +
      f('openDate', 'Date d’ouverture', st.openDate, 'type="date"') + f('deposits', 'Versements cumulés (€)', st.deposits) + '</div>' +
      '<h3>Seuils des contrôles (%)</h3><div class="form-grid">' +
      f('lineWarn', 'Ligne : vigilance', st.lineWarn) + f('lineAlert', 'Ligne : alerte', st.lineAlert) +
      f('sectorWarn', 'Secteur : vigilance', st.sectorWarn) + f('sectorAlert', 'Secteur : alerte', st.sectorAlert) +
      f('lossWarn', 'Moins-value : vigilance', st.lossWarn) + f('lossAlert', 'Moins-value : alerte', st.lossAlert) +
      f('coreTarget', 'Socle ETF Monde : cible', st.coreTarget) + f('coreMin', 'Socle : minimum', st.coreMin) +
      f('outsideEuropeMin', 'Hors Europe : minimum', st.outsideEuropeMin) + f('dustMax', 'Ligne négligeable sous', st.dustMax) + '</div>' +
      '<div class="actions"><button class="btn primary" type="submit"' + (S.readOnly ? ' disabled' : '') + '>Enregistrer</button><button class="btn" type="button" data-act="reset-settings">Seuils par défaut</button></div></form>' +
      (S.mode === 'local' ? '<div class="section"><h3>Sauvegarde</h3><p class="small muted">Vos données sont dans ce navigateur. Copiez la sauvegarde pour la conserver ou la transférer, et collez-la ici pour la restaurer.</p><textarea class="input" id="backup" rows="4" style="width:100%" placeholder="Collez une sauvegarde JSON pour la restaurer"></textarea><div class="actions"><button class="btn" type="button" data-act="copy-backup">Copier la sauvegarde</button><button class="btn" type="button" data-act="restore-backup">Restaurer</button></div></div>' : '<p class="small muted">Vos données sont enregistrées de façon privée avec cette page : vous les retrouvez sur tous vos appareils, et Claude peut les relire quand vous lui demandez une mise à jour.</p>'));
  }

  async function saveSettings(e) {
    e.preventDefault();
    const out = Object.assign({}, S.settings);
    ['lineWarn', 'lineAlert', 'sectorWarn', 'sectorAlert', 'lossWarn', 'lossAlert', 'coreTarget', 'coreMin', 'outsideEuropeMin', 'dustMax'].forEach((k) => {
      const v = num($('#st-' + k).value);
      if (ok(v)) out[k] = v;
    });
    const dep = num($('#st-deposits').value);
    out.deposits = ok(dep) ? dep : null;
    out.openDate = $('#st-openDate').value || '';
    if (out.lossWarn > 0) out.lossWarn = -out.lossWarn;
    if (out.lossAlert > 0) out.lossAlert = -out.lossAlert;
    try { await save('settings', 'main', out); } catch (err) { return; }
    S.settings = out;
    closeSheet();
    toast('Réglages enregistrés.');
    renderAll();
  }

  /* ================================================================ Démo */

  function demoSnapshot() {
    const pick = (isin, qty, pru) => { const m = R.instruments[isin] || {}; const last = m.consensus ? m.consensus.price : 6.31; return { name: (m.name || isin).toUpperCase(), isin, qty, pru, last, dayVar: 0.4, amount: qty * last }; };
    return { id: 'demo', date: todayISO(), source: 'Exemple', cash: 120, positions: [
      pick('FR001400U5Q4', 160, 5.70), pick('FR0000120271', 4, 61.20), pick('FR0005691656', 2, 138.00),
      pick('FR0000121709', 5, 58.40), pick('FR0000063737', 4, 44.10), pick('FR0000031577', 1, 286.00)
    ] };
  }

  /* ================================================================ Navigation et événements */

  function showTab(tab, silent) {
    if (!TABS.includes(tab)) tab = 'synthese';
    S.tab = tab;
    TABS.forEach((t) => {
      $('#tab-' + t).setAttribute('aria-selected', String(t === tab));
      $('#tab-' + t).tabIndex = t === tab ? 0 : -1;
      $('#panel-' + t).hidden = t !== tab;
    });
    if (!silent) { try { history.replaceState(null, '', '#' + tab); } catch (e) { /* frame sans historique */ } }
    try { localStorage.setItem(LS_KEY + ':tab', tab); } catch (e) { /* stockage indisponible */ }
    if (tab === 'flux') requestAnimationFrame(drawHistory);
  }

  function readAlertForm() {
    const v = (id) => { const el = $('#' + id); return el ? el.value : ''; };
    return { scope: v('al-scope'), target: v('al-target') || null, metric: v('al-metric'), op: v('al-op'), value: v('al-value'), note: v('al-note') };
  }

  function bindUI() {
    document.addEventListener('click', async (e) => {
      const t = e.target.closest('button, tr[data-detail], [data-goto]');
      if (!t) {
        if (e.target === $('#sheet')) closeSheet();
        return;
      }
      if (t.matches('.tab')) return showTab(t.dataset.tab);
      if (t.dataset.goto) return showTab(t.dataset.goto);
      if (t.dataset.detail && t.tagName === 'TR') return detailSheet(t.dataset.detail);
      if (t.dataset.sort) {
        const k = t.dataset.sort;
        S.posSort = { key: k, dir: S.posSort.key === k ? -S.posSort.dir : (k === 'label' ? 1 : -1) };
        return renderAll();
      }
      if (t.dataset.cfilter) { S.ctrlFilter = t.dataset.cfilter; return renderAll(); }
      if (t.dataset.isort) { S.ideaSort = t.dataset.isort; return renderAll(); }
      if (t.dataset.snapShow) { S.current = t.dataset.snapShow; showTab('synthese'); return renderAll(); }
      if (t.dataset.snapDel) {
        if (t.dataset.armed) { await remove('snapshots', t.dataset.snapDel); toast('Relevé supprimé.'); return; }
        t.dataset.armed = '1'; t.textContent = 'Confirmer'; setTimeout(() => { if (t.isConnected) { delete t.dataset.armed; t.textContent = 'Supprimer'; } }, 4000); return;
      }
      if (t.dataset.flowDel) {
        if (t.dataset.armed) { await remove('flows', t.dataset.flowDel); return; }
        t.dataset.armed = '1'; t.textContent = 'Confirmer'; setTimeout(() => { if (t.isConnected) { delete t.dataset.armed; t.textContent = 'Supprimer'; } }, 4000); return;
      }
      if (t.dataset.alertDel) {
        if (t.dataset.armed) { await remove('alerts', t.dataset.alertDel); return; }
        t.dataset.armed = '1'; t.textContent = 'Confirmer'; setTimeout(() => { if (t.isConnected) { delete t.dataset.armed; t.textContent = 'Supprimer'; } }, 4000); return;
      }
      if (t.dataset.alertToggle) {
        const a = S.alerts.find((x) => x.id === t.dataset.alertToggle);
        if (a) { try { await save('alerts', a.id, Object.assign({}, a, { active: a.active === false })); } catch (err) { /* signalé */ } }
        return;
      }
      switch (t.dataset.act || t.id) {
        case 'btnImport': case 'import': S.pending = null; return importSheet();
        case 'btnSettings': case 'settings': return settingsSheet();
        case 'pick': return $('#fileInput').click();
        case 'commit': return commitImport();
        case 'close': return closeSheet();
        case 'demo': S.demo = demoSnapshot(); return renderAll();
        case 'exit-demo': S.demo = null; return renderAll();
        case 'reset-settings': {
          const keep = { deposits: S.settings.deposits, openDate: S.settings.openDate };
          try { await save('settings', 'main', Object.assign({}, DEFAULT_SETTINGS, keep)); } catch (err) { return; }
          closeSheet(); toast('Seuils par défaut rétablis.'); return;
        }
        case 'alert-for': {
          S.alertDraft = { scope: 'line', target: t.dataset.isin, metric: 'price', op: '<=', value: '', note: '' };
          closeSheet(); showTab('alertes'); renderAll();
          const el = $('#al-value'); if (el) el.focus();
          return;
        }
        case 'add-suggested': {
          const A = analyze(currentSnapshot());
          const have = new Set(S.alerts.map(alertKey));
          const list = suggestedAlerts(A).filter((s) => !have.has(alertKey(s)));
          try {
            for (const s of list) { const id = uid(); await save('alerts', id, Object.assign({ id, active: true, createdAt: new Date().toISOString(), history: [] }, s)); }
          } catch (err) { return; }
          toast(list.length + ' alertes ajoutées.');
          return;
        }
        case 'copy-backup': {
          const txt = JSON.stringify(LocalStore.exportAll());
          try { await navigator.clipboard.writeText(txt); toast('Sauvegarde copiée.'); } catch (err) { const ta = $('#backup'); ta.value = txt; ta.select(); toast('Copie bloquée : la sauvegarde est sélectionnée dans le champ.'); }
          return;
        }
        case 'restore-backup': {
          try { LocalStore.importAll(JSON.parse($('#backup').value)); closeSheet(); toast('Sauvegarde restaurée.'); } catch (err) { toast('Sauvegarde invalide : collez le texte JSON complet.'); }
          return;
        }
        default: return;
      }
    });

    document.addEventListener('change', (e) => {
      const id = e.target.id;
      if (id === 'fileInput') { const f = e.target.files[0]; e.target.value = ''; if (f) handleFile(f); return; }
      if (id === 'snapSelect') { S.current = e.target.value; return renderAll(); }
      if (id === 'al-scope' || id === 'al-target' || id === 'al-metric') {
        const d = readAlertForm();
        if (id === 'al-scope') d.target = null;
        if (d.scope === 'line' && !d.target) { const A = analyze(currentSnapshot()); d.target = A && A.lines[0] ? A.lines[0].isin : null; }
        if (d.scope === 'sector' && !d.target) { const A = analyze(currentSnapshot()); d.target = A && A.sectors[0] ? A.sectors[0].name : null; }
        S.alertDraft = d;
        renderAll();
        const el = $('#' + id); if (el) el.focus();
      }
    });

    document.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (e.target.id === 'settingsForm') return saveSettings(e);
      if (e.target.id === 'alertForm') {
        const d = readAlertForm();
        const v = num(d.value);
        if (!ok(v)) { toast('Indiquez un seuil numérique.'); $('#al-value').focus(); return; }
        if ((d.scope === 'line' || d.scope === 'sector') && !d.target) { toast('Choisissez la ligne ou le secteur.'); return; }
        const id = uid();
        S.alertDraft = Object.assign({}, d, { value: '', note: '' });
        try { await save('alerts', id, { id, scope: d.scope, target: d.target, metric: d.metric, op: d.op, value: v, note: d.note || '', active: true, createdAt: new Date().toISOString(), history: [] }); } catch (err) { return; }
        toast('Alerte créée.');
        return;
      }
      if (e.target.id === 'flowForm') {
        const amount = num($('#fl-amount').value);
        if (!ok(amount) || amount <= 0) { toast('Indiquez un montant positif.'); $('#fl-amount').focus(); return; }
        const isin = $('#fl-line').value;
        const A = analyze(currentSnapshot());
        const l = A && A.lines.find((x) => x.isin === isin);
        const id = uid();
        try { await save('flows', id, { id, date: $('#fl-date').value || todayISO(), type: $('#fl-type').value, isin: isin || null, name: l ? l.label : ($('#fl-note').value || FLOW_TYPES[$('#fl-type').value]), amount, qty: 0, price: null, note: $('#fl-note').value || '', source: 'manuel' }); } catch (err) { return; }
        toast('Mouvement ajouté au journal.');
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !$('#sheet').hidden) closeSheet();
      if (e.key === 'Enter' && e.target.matches && e.target.matches('tr[data-detail]')) detailSheet(e.target.dataset.detail);
      if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && e.target.matches && e.target.matches('.tab')) {
        const i = TABS.indexOf(S.tab) + (e.key === 'ArrowRight' ? 1 : -1);
        const next = TABS[(i + TABS.length) % TABS.length];
        showTab(next);
        $('#tab-' + next).focus();
      }
    });

    document.addEventListener('pointerover', (e) => {
      const el = e.target.closest && e.target.closest('[data-tip]');
      if (el && el.dataset.tip) showTip(el.dataset.tip, e.clientX, e.clientY);
    });
    document.addEventListener('pointermove', (e) => {
      const el = e.target.closest && e.target.closest('[data-tip]');
      if (el && el.dataset.tip) showTip(el.dataset.tip, e.clientX, e.clientY);
      else if (!(e.target.closest && e.target.closest('#histChart'))) hideTip();
    });
    document.addEventListener('focusin', (e) => {
      const el = e.target.closest && e.target.closest('[data-tip]');
      if (el && el.dataset.tip) { const r = el.getBoundingClientRect(); showTip(el.dataset.tip, r.left + r.width / 2, r.bottom); } else hideTip();
    });
    window.addEventListener('scroll', hideTip, { passive: true });
    let rz = null;
    window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { if (S.tab === 'flux') drawHistory(); }, 150); });
  }

  /* ================================================================ Démarrage */

  async function boot() {
    let initial = (location.hash || '').replace('#', '');
    if (!TABS.includes(initial)) { try { initial = localStorage.getItem(LS_KEY + ':tab') || 'synthese'; } catch (e) { initial = 'synthese'; } }
    S.tab = initial;
    bindUI();
    renderAll();
    let db = null;
    if (window.claude && typeof window.claude.use === 'function') {
      try { db = await window.claude.use('db'); } catch (e) { db = null; }
    }
    S.store = db ? DbStore(db) : LocalStore;
    S.mode = db ? 'db' : 'local';
    S.store.init(applyData);
  }

  // Exposé pour les tests automatisés (aucun effet sur l'interface).
  window.PEA_TRACKER = { isinValid, normalizeRows, qualityChecks, diffSnapshots, analyze, runControls, evalAlert, ideaScore, num };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();

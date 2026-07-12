/* SQP-API-Adapter (HYBRID) — Ersatz für den Supabase-Client der SQPR-Seiten.
 *
 * - API-Kunden (mit SP-API-Anbindung, s. CLIENTS): sqpr_reports/rows/str_terms
 *   werden aus der API geliefert (ASIN-Level → Marken-Level aggregiert).
 * - Alle anderen Kunden (CSV-Upload): werden 1:1 an das echte Supabase durchgereicht
 *   → unverändertes Verhalten wie bisher.
 * - sqpr_clients & sqpr_clusters: immer echtes Supabase (alle Kunden sichtbar,
 *   Cluster lesen/schreiben wie gehabt).
 *
 * Zugriff auf die API-Endpunkte wird server-seitig per Origin-Allowlist gewährt
 * (kein Token im Client). window.SQP_API_CLIENTS listet die API-Kunden für das UI.
 *
 * Nutzung: const sb = createSqpAdapter();   // statt supabase.createClient(...)
 */
(function () {
  const REAL_URL = 'https://lgrnmiszhhahfcmctmwo.supabase.co';
  const REAL_KEY = 'sb_publishable_E5tO2TvBrU8f1s5djnVOOQ_vk1djyAI';
  const API = 'https://ppc-callback.vercel.app/api/sqp/data';
  const PPC = 'https://ppc-callback.vercel.app/api/sqp/ppc';

  // Kunden mit API-Daten (sqpr client_id -> SP-API selling_partner_id)
  const CLIENTS = [
    { id: '7c4acd87-fe09-4708-935c-35f94d3d273b', name: 'Recoactiv_DE', spid: 'AB0SPXUYQ1F1W' },
  ];
  window.SQP_API_CLIENTS = CLIENTS.map(c => c.id);       // fürs UI (Datenquelle-Banner)
  const isApiClient = (id) => CLIENTS.some(c => c.id === id);
  const spidForClient = (id) => (CLIENTS.find(c => c.id === id) || {}).spid;

  const HYBRID = new Set(['sqpr_reports', 'sqpr_rows', 'sqpr_str_terms']); // API oder echt, je Kunde
  const monthEnd = (m) => { const d = new Date(m + 'T00:00:00Z'); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10); };
  const num = (x) => (x == null ? 0 : +x || 0);

  // ---- API-Daten je spid (Cache) ----
  const cache = {};
  async function loadSpid(spid) {
    if (cache[spid]) return cache[spid];
    const clientId = (CLIENTS.find(c => c.spid === spid) || {}).id;
    const j = await (await fetch(`${API}?spid=${encodeURIComponent(spid)}`)).json();
    const apiRows = j.rows || [];
    const byKey = new Map();
    for (const r of apiRows) {
      const key = r.start_date + '||' + r.search_query;
      let e = byKey.get(key);
      if (!e) {
        e = { client_id: clientId, report_id: r.start_date, search_query: r.search_query,
          search_query_volume: 0, search_query_score: r.search_query_score,
          impressions_total: 0, clicks_total: 0, cart_adds_total: 0, purchases_total: 0,
          impressions_brand: 0, clicks_brand: 0, cart_adds_brand: 0, purchases_brand: 0 };
        byKey.set(key, e);
      }
      e.search_query_volume = Math.max(e.search_query_volume, num(r.search_query_volume));
      e.impressions_total = Math.max(e.impressions_total, num(r.total_query_impression_count));
      e.clicks_total = Math.max(e.clicks_total, num(r.total_click_count));
      e.cart_adds_total = Math.max(e.cart_adds_total, num(r.total_cart_add_count));
      e.purchases_total = Math.max(e.purchases_total, num(r.total_purchase_count));
      e.impressions_brand += num(r.asin_impression_count);
      e.clicks_brand += num(r.asin_click_count);
      e.cart_adds_brand += num(r.asin_cart_add_count);
      e.purchases_brand += num(r.asin_purchase_count);
    }
    const rows = [...byKey.values()].map(e => ({ ...e,
      impressions_brand_share: e.impressions_total ? 100 * e.impressions_brand / e.impressions_total : 0,
      clicks_brand_share: e.clicks_total ? 100 * e.clicks_brand / e.clicks_total : 0,
      cart_adds_brand_share: e.cart_adds_total ? 100 * e.cart_adds_brand / e.cart_adds_total : 0,
      purchases_brand_share: e.purchases_total ? 100 * e.purchases_brand / e.purchases_total : 0 }));
    const months = [...new Set(rows.map(r => r.report_id))].sort();
    const reports = months.map(m => ({ id: m, client_id: clientId, report_date_start: m, report_date_end: monthEnd(m), reporting_range: 'Monatlich' }));
    let strterms = [];
    try { const p = await (await fetch(`${PPC}?spid=${encodeURIComponent(spid)}`)).json(); strterms = p.rows || []; } catch (e) { /* PPC optional */ }
    cache[spid] = { reports, rows, strterms };
    return cache[spid];
  }

  // ---- Chainable Query-Builder: entscheidet zur Laufzeit API vs. echtes Supabase ----
  function HQuery(adapter, table) { this.a = adapter; this.table = table; this.filters = {}; this._sel = '*'; this._order = null; this._single = false; }
  HQuery.prototype.select = function (cols) { if (cols) this._sel = cols; return this; };
  HQuery.prototype.eq = function (col, val) { this.filters[col] = val; return this; };
  HQuery.prototype.order = function (col, opts) { this._order = { col, asc: opts ? opts.ascending !== false : true }; return this; };
  HQuery.prototype.single = function () { this._single = true; return this._resolve(); };
  HQuery.prototype.range = function (from, to) { return this._resolve(from, to); };
  HQuery.prototype.then = function (onF, onR) { return this._resolve().then(onF, onR); };
  HQuery.prototype._activeClientId = function () {
    return this.filters.client_id || (window.localStorage && localStorage.getItem('sqpr_active_client')) || null;
  };
  HQuery.prototype._resolve = async function (rangeFrom, rangeTo) {
    const clientId = this._activeClientId();
    // CSV-Kunde (oder unbekannt) -> an echtes Supabase durchreichen
    if (!isApiClient(clientId)) {
      let rq = this.a._real.from(this.table).select(this._sel);
      for (const k in this.filters) rq = rq.eq(k, this.filters[k]);
      if (this._order) rq = rq.order(this._order.col, { ascending: this._order.asc });
      if (this._single) return rq.single();
      if (rangeFrom != null) return rq.range(rangeFrom, rangeTo);
      return rq;
    }
    // API-Kunde -> aus API-Cache bedienen
    const spid = spidForClient(clientId);
    const d = await loadSpid(spid);
    let rows = this.table === 'sqpr_reports' ? d.reports
      : this.table === 'sqpr_rows' ? d.rows
      : d.strterms;
    if (this.table !== 'sqpr_str_terms') rows = rows.filter(r => !this.filters.client_id || r.client_id === this.filters.client_id);
    if (this._order) { const { col, asc } = this._order; rows = [...rows].sort((x, y) => (x[col] > y[col] ? 1 : x[col] < y[col] ? -1 : 0) * (asc ? 1 : -1)); }
    if (this._single) return { data: rows[0] || null, error: rows.length ? null : { message: 'no rows' } };
    if (rangeFrom != null) rows = rows.slice(rangeFrom, rangeTo + 1);
    return { data: rows, error: null };
  };

  function Adapter() { this._real = window.supabase.createClient(REAL_URL, REAL_KEY); this.auth = this._real.auth; }
  Adapter.prototype.from = function (table) {
    if (HYBRID.has(table)) return new HQuery(this, table);
    return this._real.from(table); // sqpr_clients, sqpr_clusters -> echtes Supabase
  };

  window.createSqpAdapter = function () { return new Adapter(); };
})();

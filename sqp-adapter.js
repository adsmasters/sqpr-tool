/* SQP-API-Adapter (nur für die eigene "Live-Analyse"-Seite live.html).
 * Ersetzt den Supabase-Client: liefert sqpr_clients/reports/rows/str_terms aus der
 * SP-API (ASIN-Level -> Marken-Level aggregiert); sqpr_clusters bleibt echtes Supabase.
 * Betrifft NUR live.html — dashboard.html / asin.html (CSV) sind unberührt.
 *
 * Zugriff auf die API-Endpunkte per Origin-Allowlist (kein Token im Client).
 * Nutzung: const sb = createSqpAdapter();
 */
(function () {
  const REAL_URL = 'https://lgrnmiszhhahfcmctmwo.supabase.co';
  const REAL_KEY = 'sb_publishable_E5tO2TvBrU8f1s5djnVOOQ_vk1djyAI';
  const API = 'https://ppc-callback.vercel.app/api/sqp/data';
  const PPC = 'https://ppc-callback.vercel.app/api/sqp/ppc';
  const CLIENTS_EP = 'https://ppc-callback.vercel.app/api/sqp/clients';

  // API-Kunden werden aus der DB (sqp_clients) geladen — kein Hardcoding.
  let CLIENTS = [];
  window.SQP_API_CLIENTS = [];
  const clientsReady = fetch(CLIENTS_EP).then(r => r.json()).then(j => {
    CLIENTS = (j.clients || [])
      .sort((a, b) => (b.has_data !== false) - (a.has_data !== false) || (a.name || '').localeCompare(b.name || ''))
      .map(c => c.has_data === false ? { ...c, name: (c.name || '') + ' · noch keine Daten' } : c);
    window.SQP_API_CLIENTS = CLIENTS.map(c => c.id);
    window.SQP_CLIENTS_FULL = CLIENTS; // fuer seitenuebergreifende Kundenwahl (spid<->id)
  }).catch(() => { CLIENTS = []; });
  window.SQP_CLIENTS_READY = clientsReady;
  const VIRTUAL = new Set(['sqpr_clients', 'sqpr_reports', 'sqpr_rows', 'sqpr_str_terms']);
  const monthEnd = (m) => { const d = new Date(m + 'T00:00:00Z'); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10); };
  const num = (x) => (x == null ? 0 : +x || 0);
  const spidForClient = (id) => (CLIENTS.find(c => c.id === id) || {}).spid;

  const cache = {};
  const getPeriod = () => (window.SQP_PERIOD === 'WEEK' ? 'WEEK' : 'MONTH');
  async function loadClient(client) {
    await clientsReady;
    const period = getPeriod();
    const mkt = (client.marketplace || 'DE').toUpperCase();
    const ck = client.id + '|' + period;
    if (cache[ck]) return cache[ck];
    const clientId = client.id;
    const spid = client.spid;
    const j = await (await fetch(`${API}?spid=${encodeURIComponent(spid)}&mkt=${mkt}&period=${period}`)).json();
    const endBy = {}; // start_date -> end_date (aus den Daten, funktioniert für Monat & Woche)
    const byKey = new Map();
    for (const r of (j.rows || [])) {
      endBy[r.start_date] = r.end_date;
      const key = r.start_date + '||' + r.search_query;
      let e = byKey.get(key);
      if (!e) { e = { client_id: clientId, report_id: r.start_date, search_query: r.search_query,
        search_query_volume: 0, search_query_score: r.search_query_score,
        impressions_total: 0, clicks_total: 0, cart_adds_total: 0, purchases_total: 0,
        impressions_brand: 0, clicks_brand: 0, cart_adds_brand: 0, purchases_brand: 0 }; byKey.set(key, e); }
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
    const periods = [...new Set(rows.map(r => r.report_id))].sort();
    const label = period === 'WEEK' ? 'Wöchentlich' : 'Monatlich';
    const reports = periods.map(m => ({ id: m, client_id: clientId, report_date_start: m, report_date_end: endBy[m] || monthEnd(m), reporting_range: label }));
    let strterms = [];
    try { const p = await (await fetch(`${PPC}?spid=${encodeURIComponent(spid)}&mkt=${mkt}`)).json(); strterms = p.rows || []; } catch (e) {}
    cache[ck] = { reports, rows, strterms };
    return cache[ck];
  }

  function VQuery(a, table) { this.a = a; this.table = table; this.filters = {}; this._order = null; this._single = false; this._sel = '*'; }
  VQuery.prototype.select = function (c) { if (c) this._sel = c; return this; };
  VQuery.prototype.eq = function (col, val) { this.filters[col] = val; return this; };
  VQuery.prototype.order = function (col, opts) { this._order = { col, asc: opts ? opts.ascending !== false : true }; return this; };
  VQuery.prototype.single = function () { this._single = true; return this._resolve(); };
  VQuery.prototype.range = function (f, t) { return this._resolve(f, t); };
  VQuery.prototype.then = function (onF, onR) { return this._resolve().then(onF, onR); };
  VQuery.prototype._resolve = async function (rangeFrom, rangeTo) {
    let rows = await this.a._data(this.table, this.filters);
    if (this._order) { const { col, asc } = this._order; rows = [...rows].sort((x, y) => (x[col] > y[col] ? 1 : x[col] < y[col] ? -1 : 0) * (asc ? 1 : -1)); }
    if (this._single) return { data: rows[0] || null, error: rows.length ? null : { message: 'no rows' } };
    if (rangeFrom != null) rows = rows.slice(rangeFrom, rangeTo + 1);
    return { data: rows, error: null };
  };

  function Adapter() { this._real = window.supabase.createClient(REAL_URL, REAL_KEY); this.auth = this._real.auth; this._activeClient = null; }
  Adapter.prototype.from = function (table) { return VIRTUAL.has(table) ? new VQuery(this, table) : this._real.from(table); };
  Adapter.prototype._data = async function (table, filters) {
    await clientsReady;
    if (table === 'sqpr_clients') {
      let list = CLIENTS.map(c => ({ id: c.id, name: c.name, marketplace: c.marketplace }));
      if (filters.id) list = list.filter(c => c.id === filters.id);
      return list;
    }
    // Kunde ueber die eindeutige Zeilen-ID aufloesen (Recoactiv DE+IT teilen sich die Seller-ID)
    const byId = filters.client_id && CLIENTS.find(c => c.id === filters.client_id);
    const client = byId || this._activeClient || CLIENTS[0];
    if (byId) this._activeClient = client;
    if (!client || !client.spid) return [];
    const d = await loadClient(client);
    if (table === 'sqpr_reports') return d.reports.filter(r => !filters.client_id || r.client_id === filters.client_id);
    if (table === 'sqpr_rows') return d.rows.filter(r => !filters.client_id || r.client_id === filters.client_id);
    if (table === 'sqpr_str_terms') return d.strterms;
    return [];
  };

  window.createSqpAdapter = function () { return new Adapter(); };
})();

/* SQP-API-Adapter — ersetzt den Supabase-Client für die SQPR-Seiten.
 * Liefert sqpr_clients / sqpr_reports / sqpr_rows / sqpr_str_terms aus der API
 * (ASIN-Level → Marken-Level hochaggregiert). sqpr_clusters wird an das echte
 * Supabase durchgereicht (Lesen/Schreiben wie bisher).
 *
 * Nutzung: const sb = createSqpAdapter();   // statt supabase.createClient(...)
 */
(function () {
  const REAL_URL = 'https://lgrnmiszhhahfcmctmwo.supabase.co';
  const REAL_KEY = 'sb_publishable_E5tO2TvBrU8f1s5djnVOOQ_vk1djyAI';
  // Zugriff wird server-seitig per Origin-Allowlist gewährt (kein Token im Client).
  const API = 'https://ppc-callback.vercel.app/api/sqp/data';
  const PPC = 'https://ppc-callback.vercel.app/api/sqp/ppc';

  // Kunden mit API-Daten (sqpr client_id -> SP-API selling_partner_id)
  const CLIENTS = [
    { id: '7c4acd87-fe09-4708-935c-35f94d3d273b', name: 'Recoactiv_DE', marketplace: 'DE', spid: 'AB0SPXUYQ1F1W' },
  ];
  const VIRTUAL = new Set(['sqpr_clients', 'sqpr_reports', 'sqpr_rows', 'sqpr_str_terms']);

  const monthEnd = (m) => { const d = new Date(m + 'T00:00:00Z'); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10); };
  const num = (x) => (x == null ? 0 : +x || 0);

  // Cache je spid: { reports, rows, strterms }
  const cache = {};
  async function loadSpid(spid) {
    if (cache[spid]) return cache[spid];
    const clientId = (CLIENTS.find(c => c.spid === spid) || {}).id;
    const j = await (await fetch(`${API}?spid=${encodeURIComponent(spid)}`)).json();
    const apiRows = j.rows || [];

    // ASIN-Level -> Marken-Level je (Monat, Suchbegriff)
    const byKey = new Map();
    for (const r of apiRows) {
      const key = r.start_date + '||' + r.search_query;
      let e = byKey.get(key);
      if (!e) {
        e = {
          client_id: clientId, report_id: r.start_date, search_query: r.search_query,
          search_query_volume: 0, search_query_score: r.search_query_score,
          impressions_total: 0, clicks_total: 0, cart_adds_total: 0, purchases_total: 0,
          impressions_brand: 0, clicks_brand: 0, cart_adds_brand: 0, purchases_brand: 0,
        };
        byKey.set(key, e);
      }
      // query-level Felder (über ASINs identisch) -> max
      e.search_query_volume = Math.max(e.search_query_volume, num(r.search_query_volume));
      e.impressions_total = Math.max(e.impressions_total, num(r.total_query_impression_count));
      e.clicks_total = Math.max(e.clicks_total, num(r.total_click_count));
      e.cart_adds_total = Math.max(e.cart_adds_total, num(r.total_cart_add_count));
      e.purchases_total = Math.max(e.purchases_total, num(r.total_purchase_count));
      // ASIN-Beiträge der Marke -> summieren
      e.impressions_brand += num(r.asin_impression_count);
      e.clicks_brand += num(r.asin_click_count);
      e.cart_adds_brand += num(r.asin_cart_add_count);
      e.purchases_brand += num(r.asin_purchase_count);
    }
    const rows = [...byKey.values()].map(e => ({
      ...e,
      impressions_brand_share: e.impressions_total ? 100 * e.impressions_brand / e.impressions_total : 0,
      clicks_brand_share: e.clicks_total ? 100 * e.clicks_brand / e.clicks_total : 0,
      cart_adds_brand_share: e.cart_adds_total ? 100 * e.cart_adds_brand / e.cart_adds_total : 0,
      purchases_brand_share: e.purchases_total ? 100 * e.purchases_brand / e.purchases_total : 0,
    }));
    const months = [...new Set(rows.map(r => r.report_id))].sort();
    const reports = months.map(m => ({ id: m, client_id: clientId, report_date_start: m, report_date_end: monthEnd(m), reporting_range: 'Monatlich' }));

    let strterms = [];
    try { const p = await (await fetch(`${PPC}?spid=${encodeURIComponent(spid)}`)).json(); strterms = p.rows || []; } catch (e) { /* PPC optional */ }

    cache[spid] = { reports, rows, strterms };
    return cache[spid];
  }

  const spidForClient = (clientId) => (CLIENTS.find(c => c.id === clientId) || {}).spid;

  // Chainable Query-Builder für die virtuellen Tabellen
  function VQuery(adapter, table) {
    this.a = adapter; this.table = table; this.filters = {}; this._order = null; this._single = false;
  }
  VQuery.prototype.select = function () { return this; };
  VQuery.prototype.eq = function (col, val) { this.filters[col] = val; return this; };
  VQuery.prototype.order = function (col, opts) { this._order = { col, asc: opts ? opts.ascending !== false : true }; return this; };
  VQuery.prototype.single = function () { this._single = true; return this._resolve(); };
  VQuery.prototype.range = function (from, to) { return this._resolve(from, to); };
  VQuery.prototype.then = function (onF, onR) { return this._resolve().then(onF, onR); };
  VQuery.prototype._resolve = async function (rangeFrom, rangeTo) {
    let rows = await this.a._data(this.table, this.filters);
    if (this._order) {
      const { col, asc } = this._order;
      rows = [...rows].sort((x, y) => (x[col] > y[col] ? 1 : x[col] < y[col] ? -1 : 0) * (asc ? 1 : -1));
    }
    if (this._single) return { data: rows[0] || null, error: rows.length ? null : { message: 'no rows' } };
    if (rangeFrom != null) rows = rows.slice(rangeFrom, rangeTo + 1);
    return { data: rows, error: null };
  };

  function Adapter() {
    this._real = window.supabase.createClient(REAL_URL, REAL_KEY);
    this._activeSpid = CLIENTS[0].spid;
    this.auth = this._real.auth; // für evtl. SSO
  }
  Adapter.prototype.from = function (table) {
    if (VIRTUAL.has(table)) return new VQuery(this, table);
    return this._real.from(table); // sqpr_clusters etc. -> echtes Supabase
  };
  Adapter.prototype._data = async function (table, filters) {
    if (table === 'sqpr_clients') {
      let list = CLIENTS.map(c => ({ id: c.id, name: c.name, marketplace: c.marketplace }));
      if (filters.id) list = list.filter(c => c.id === filters.id);
      return list;
    }
    // spid bestimmen
    let spid = null;
    if (filters.client_id) spid = spidForClient(filters.client_id);
    if (!spid) spid = this._activeSpid;
    if (filters.client_id && spidForClient(filters.client_id)) this._activeSpid = spid;
    if (!spid) return [];
    const d = await loadSpid(spid);
    if (table === 'sqpr_reports') return d.reports.filter(r => !filters.client_id || r.client_id === filters.client_id);
    if (table === 'sqpr_rows') return d.rows.filter(r => !filters.client_id || r.client_id === filters.client_id);
    if (table === 'sqpr_str_terms') return d.strterms; // account-weit; report_id-Filter wird ignoriert (PPC ≈ konstant)
    return [];
  };

  window.createSqpAdapter = function () { return new Adapter(); };
})();

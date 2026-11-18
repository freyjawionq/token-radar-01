// Token Radar page: renders window.BOARD_DATA (written by main.ts as data.js
// beside this page's folder), with search, category and chain filters,
// sortable columns and a per-protocol detail view. No network, no fetch:
// everything the page shows was computed by the entry's own program.

(function () {
  'use strict';

  var D = window.BOARD_DATA;
  var rowsEl = document.getElementById('rows');
  if (!D || !D.rows) {
    rowsEl.innerHTML = '<tr><td colspan="8">No data: run the entry program first so data.js exists beside the dashboard.</td></tr>';
    return;
  }

  var rows = D.rows;

  var state = { q: '', cat: '', chain: '', sort: 'rank', dir: 1, detail: null };

  var qEl = document.getElementById('q');
  var catEl = document.getElementById('cat');
  var chainEl = document.getElementById('chain');
  var countEl = document.getElementById('count');
  var emptyEl = document.getElementById('empty');
  var boardView = document.getElementById('board-view');
  var detailView = document.getElementById('detail-view');
  var detailEl = document.getElementById('detail');

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function money(n) {
    if (n === null || n === undefined) return '—';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + n;
  }

  function fullMoney(n) {
    return '$' + String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function changeHtml(v) {
    if (v === null || v === undefined) return '<span class="flat">—</span>';
    var cls = v > 0 ? 'up' : v < 0 ? 'down' : 'flat';
    var sign = v > 0 ? '+' : '';
    return '<span class="' + cls + '">' + sign + v.toFixed(1) + '%</span>';
  }

  function fillSelect(el, values, allLabel) {
    el.innerHTML = '';
    var opt = document.createElement('option');
    opt.value = '';
    opt.textContent = allLabel;
    el.appendChild(opt);
    values.forEach(function (v) {
      var o = document.createElement('option');
      o.value = v;
      o.textContent = v;
      el.appendChild(o);
    });
  }

  var cats = {};
  var chains = {};
  rows.forEach(function (r) {
    if (r.category) cats[r.category] = true;
    (r.chains || []).forEach(function (c) { chains[c] = true; });
  });
  fillSelect(catEl, Object.keys(cats).sort(), 'All categories');
  fillSelect(chainEl, Object.keys(chains).sort(), 'All chains');

  document.getElementById('masthead-meta').innerHTML =
    '<strong>' + rows.length + '</strong> protocols ranked<br>' +
    'Snapshot as of ' + esc(D.as_of) + ' &middot; watchlist floor ' + money(D.floor_usd) + '<br>' +
    'Dataset: ' + esc(D.source || 'sealed snapshot (source not recorded)');

  var mc = D.model_constants || {};
  document.getElementById('model-strip').innerHTML =
    'Model: <code>implied = TVL x category median mcap/TVL x momentum</code> ' +
    'Momentum clamps the 7d TVL change to [' + mc.changeFloor + '%, +' + mc.changeCap + '%] and scales it by ' + mc.momentumWeight +
    '. A category speaks for itself with at least ' + mc.minPeers + ' token peers; otherwise the global median multiple (' +
    Number(D.global_median_ratio).toFixed(3) + 'x) applies. Click any row for its farm plan and the exact inputs behind its value.';

  function visible() {
    var q = state.q.trim().toLowerCase();
    var list = rows.filter(function (r) {
      if (state.cat && r.category !== state.cat) return false;
      if (state.chain && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    var key = state.sort;
    var dir = state.dir;
    var val = {
      rank: function (r) { return r.rank; },
      name: function (r) { return r.name.toLowerCase(); },
      category: function (r) { return (r.category || '').toLowerCase(); },
      tvl: function (r) { return r.tvl_usd; },
      change: function (r) { return r.change_7d === null ? -Infinity : r.change_7d; },
      implied: function (r) { return r.implied_value_usd; },
      mult: function (r) { return r.tvl_usd > 0 ? r.implied_value_usd / r.tvl_usd : 0; }
    }[key];
    list.sort(function (a, b) {
      var va = val(a), vb = val(b);
      if (va < vb) return -dir;
      if (va > vb) return dir;
      return a.rank - b.rank;
    });
    return list;
  }

  function renderBoard() {
    var list = visible();
    countEl.textContent = list.length + ' of ' + rows.length + ' protocols';
    emptyEl.hidden = list.length > 0;
    rowsEl.innerHTML = list.map(function (r) {
      var mult = r.tvl_usd > 0 ? (r.implied_value_usd / r.tvl_usd).toFixed(2) + 'x' : '—';
      var badge = r.on_watchlist ? '<span class="watch">watchlist</span>' : '';
      return '<tr data-slug="' + esc(r.slug) + '">' +
        '<td class="num rank">' + r.rank + '</td>' +
        '<td class="name">' + esc(r.name) + badge + '<span class="slug">' + esc(r.slug) + '</span></td>' +
        '<td>' + esc(r.category || '—') + '</td>' +
        '<td class="chains">' + esc((r.chains || []).join(', ') || '—') + '</td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num">' + changeHtml(r.change_7d) + '</td>' +
        '<td class="num"><strong>' + money(r.implied_value_usd) + '</strong></td>' +
        '<td class="num">' + mult + '</td>' +
        '</tr>';
    }).join('');
    Array.prototype.forEach.call(rowsEl.querySelectorAll('tr'), function (tr) {
      tr.addEventListener('click', function () {
        location.hash = 'p/' + encodeURIComponent(tr.getAttribute('data-slug'));
      });
    });
  }

  function fact(k, v, note) {
    return '<div class="fact"><div class="k">' + esc(k) + '</div><div class="v">' + v + '</div>' +
      (note ? '<div class="note">' + esc(note) + '</div>' : '') + '</div>';
  }

  function renderDetail(r) {
    var m = r.model || {};
    var basis = m.ratio_basis === 'category'
      ? 'median of ' + m.ratio_peers + ' token peers in ' + (r.category || 'its category')
      : 'global median of ' + m.ratio_peers + ' token peers (category too thin)';
    var age = r.age_days === null || r.age_days === undefined ? 'not recorded' : r.age_days + ' days';
    detailEl.innerHTML =
      '<div class="card">' +
      '<h2>' + esc(r.name) + '</h2>' +
      '<p class="sub">Rank #' + r.rank + ' &middot; ' + esc(r.category || 'Uncategorised') + ' &middot; ' +
      esc((r.chains || []).join(', ') || 'no chains recorded') + (r.on_watchlist ? ' &middot; on the snapshot watchlist' : '') + '</p>' +
      '<div class="facts">' +
      fact('Implied value', fullMoney(r.implied_value_usd), 'the model claim for a future token') +
      fact('TVL', fullMoney(r.tvl_usd), 'sealed snapshot figure') +
      fact('Multiple applied', Number(m.ratio).toFixed(3) + 'x', basis) +
      fact('7d TVL change', r.change_7d === null ? 'not reported' : r.change_7d.toFixed(1) + '%',
        'clamped to ' + Number(m.change_clamped_pct).toFixed(1) + '% for the model') +
      fact('Momentum factor', Number(m.momentum_factor).toFixed(3) + 'x', '1 + clamped change x ' + mc.momentumWeight) +
      fact('Tracked for', age, r.listed_at ? 'first listed ' + r.listed_at : '') +
      '</div>' +
      '<h3>How this value is derived</h3>' +
      '<p>TVL ' + fullMoney(r.tvl_usd) + ' x multiple ' + Number(m.ratio).toFixed(3) + ' (' + esc(basis) + ') x momentum ' +
      Number(m.momentum_factor).toFixed(3) + ' = ' + fullMoney(r.implied_value_usd) + '. ' +
      'The multiple is what the market currently pays per dollar of TVL for comparable protocols that already record a token.</p>' +
      '<h3>Farm plan</h3>' +
      '<ol class="steps">' + (r.farm_steps || []).map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>' +
      '</div>';
    boardView.hidden = true;
    detailView.hidden = false;
    window.scrollTo(0, 0);
  }

  function showBoard() {
    detailView.hidden = true;
    boardView.hidden = false;
    renderBoard();
  }

  function bySlug(slug) {
    for (var i = 0; i < rows.length; i++) if (rows[i].slug === slug) return rows[i];
    return null;
  }

  function applyHash() {
    var h = location.hash.replace(/^#/, '');
    if (h.indexOf('p/') === 0) {
      var r = bySlug(decodeURIComponent(h.slice(2)));
      if (r) { renderDetail(r); return; }
    }
    if (h.indexOf('f/') === 0) {
      var parts = h.slice(2).split('/');
      var kind = parts[0];
      var value = decodeURIComponent(parts.slice(1).join('/'));
      state.q = ''; state.cat = ''; state.chain = '';
      if (kind === 'cat') state.cat = value;
      if (kind === 'chain') state.chain = value;
      if (kind === 'q') state.q = value;
      qEl.value = state.q;
      catEl.value = state.cat;
      chainEl.value = state.chain;
    }
    showBoard();
  }

  qEl.addEventListener('input', function () { state.q = qEl.value; renderBoard(); });
  catEl.addEventListener('change', function () { state.cat = catEl.value; renderBoard(); });
  chainEl.addEventListener('change', function () { state.chain = chainEl.value; renderBoard(); });
  document.getElementById('reset').addEventListener('click', function () {
    state.q = ''; state.cat = ''; state.chain = ''; state.sort = 'rank'; state.dir = 1;
    qEl.value = ''; catEl.value = ''; chainEl.value = '';
    if (location.hash) history.pushState(null, '', location.pathname + location.search);
    renderBoard();
  });
  document.getElementById('back').addEventListener('click', function () {
    if (history.length > 1) history.back();
    else { location.hash = ''; showBoard(); }
  });
  Array.prototype.forEach.call(document.querySelectorAll('th[data-sort]'), function (th) {
    th.addEventListener('click', function () {
      var key = th.getAttribute('data-sort');
      if (state.sort === key) state.dir = -state.dir;
      else { state.sort = key; state.dir = key === 'name' || key === 'category' || key === 'rank' ? 1 : -1; }
      renderBoard();
    });
  });
  window.addEventListener('hashchange', applyHash);

  applyHash();
})();

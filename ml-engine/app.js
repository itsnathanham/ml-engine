(function () {
  'use strict';
  const { SEGMENTS, SEGMENT_INFO, STRATEGIES } = Sim;
  const $ = (id) => document.getElementById(id);
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

  const DEFAULTS = { seed: 42, scenario: 'balanced', budget: 0.25, promoCost: 3, revenue: 8, lossWeight: 1 };
  const state = { ...DEFAULTS, world: null, results: null, hoSeed: 2 };

  // Plain-English names first, technical term second.
  const NAMES = {
    random:     { name: 'Random', short: 'Random', tech: 'Baseline', how: 'Picks members at random. The bar every other strategy has to clear.' },
    rules:      { name: 'Behavioral rules & triggers', short: 'Behavioral rules', tech: 'No ML', how: 'Scores simple signals: lapsed 2–6 weeks, active in the app, direct deposit, borrowed before.' },
    propensity: { name: 'Most likely to borrow', short: 'Likely to borrow', tech: 'Propensity model · ML', how: 'Learns who borrowed after getting last quarter’s promo, then picks look-alikes.' },
    uplift:     { name: 'Most likely to be persuaded', short: 'Persuadable', tech: 'Uplift model · ML', how: 'Two models predict borrowing with and without the promo. Picks the biggest gap.' },
    value:      { name: 'Persuadable and profitable', short: 'Persuadable + profitable', tech: 'Risk-aware uplift · ML', how: 'Same gap, converted to dollars after credit losses and discount cost. Skips money-losers.' },
    oracle:     { name: 'Perfect knowledge', short: 'Perfect knowledge' },
  };
  const KEYS = STRATEGIES.map((s) => s.key);

  // ---------- formatting ----------
  // The sim runs on 20,000 members; each one represents SCALE real members (12.0M total).
  const SCALE = 600;
  const compact = (v) => {
    const a = Math.abs(v), sign = v < 0 ? '−' : '';
    if (a >= 1e6) return sign + (a / 1e6).toFixed(1) + 'M';
    if (a >= 1e4) return sign + Math.round(a / 1e3) + 'K';
    if (a >= 1e3) return sign + (a / 1e3).toFixed(1) + 'K';
    return sign + Math.round(a);
  };
  const num = (v) => compact(v * SCALE);
  const usd = (v) => { const c = compact(v * SCALE); return c.startsWith('−') ? '−$' + c.slice(1) : '$' + c; };
  const pct = (v) => Math.round(v * 100) + '%';
  const segColor = (k) => css('--s-' + k);
  const stratColor = (k) => css('--c-' + k);
  const riskLabel = (w) => (w === 0 ? 'None' : w < 1 ? 'Low' : w === 1 ? 'Normal' : w <= 2 ? 'High' : 'Very high') + (w === 1 ? '' : ` (${w}×)`);

  // Bucket definitions, matching the cutoffs in sim.js.
  const RULES = {
    persuadable: 'Promo adds ≥ 8 pts',
    sure: '≥ 25% without promo, promo adds < 8 pts',
    lost: '< 25% without promo, promo adds < 8 pts',
    sleeping: 'Promo lowers conversion',
  };

  function renderSetupStrip() {
    const el = $('setup');
    if (!el) return;
    const pool = state.world ? state.world.pool.length : 10000;
    const ts = state.world ? state.world.trainStats : null;
    const train = ts ? ts.treatedN + ts.controlN : 10000;
    const chips = [
      `<b>${num(pool + train)}</b> simulated members`,
      `<b>${num(train)}</b> training (last quarter's randomized test)`,
      `<b>${num(pool)}</b> targetable`,
      `<b>14-day</b> window`,
      `<b>$${state.promoCost}</b> fee discount`,
    ];
    el.innerHTML = chips.map((c) => `<span class="chip">${c}</span>`).join('');
  }

  // ---------- controls ----------
  const econ = () => ({ budget: state.budget, promoCost: state.promoCost, revenue: state.revenue, lossWeight: state.lossWeight });
  function syncOutputs() {
    const poolN = state.world ? state.world.pool.length : 10000;
    $('budgetOut').textContent = `${num(Math.round(poolN * state.budget))} of ${num(poolN)} members`;
    renderSetupStrip();
    $('promoOut').textContent = '$' + state.promoCost + ' off';
    $('offerAmt').textContent = '$' + state.promoCost;
    $('revOut').textContent = '$' + state.revenue;
    $('lossOut').textContent = riskLabel(state.lossWeight);
  }
  function bind(id, key, transform) {
    $(id).addEventListener('input', (e) => { state[key] = transform(e.target.value); syncOutputs(); renderResults(); });
  }
  bind('budget', 'budget', (v) => +v / 100);
  bind('promo', 'promoCost', (v) => +v);
  bind('rev', 'revenue', (v) => +v);
  bind('loss', 'lossWeight', (v) => +v);
  $('scenario').addEventListener('change', (e) => { state.scenario = e.target.value; rebuild(); });
  $('reroll').addEventListener('click', () => { state.seed = 1 + Math.floor(Math.random() * 9999); rebuild(); });
  $('reset').addEventListener('click', () => {
    Object.assign(state, DEFAULTS);
    $('budget').value = 25; $('promo').value = 3; $('rev').value = 8; $('loss').value = 1; $('scenario').value = 'balanced';
    rebuild();
  });
  ['d3a'].forEach((id) => $(id).addEventListener('toggle', renderDeeper));


  // ---------- build ----------
  function rebuild() {
    syncOutputs();
    $('loading').classList.remove('hidden');
    setTimeout(() => {
      state.world = Sim.buildWorld(state.seed, state.scenario);
      $('loading').classList.add('hidden');
      renderSetup();
      syncOutputs();
      renderStrategies();
      renderResults();
    }, 30);
  }

  // ---------- 1: setup ----------
  function renderSetup() {
    const pool = state.world.pool;
    const sum = Sim.segmentSummary(pool);
    $('h1').textContent = `Only ${pct(sum.persuadable.n / pool.length)} of members can actually be persuaded`;
    $('segGrid').innerHTML = SEGMENTS.map((k) => {
      const s = sum[k];
      return `<div class="seg" style="--seg-c:${segColor(k)}">
        <div class="seg-label">${SEGMENT_INFO[k].label}</div>
        <div class="seg-short">${RULES[k]}</div>
        <div><span class="seg-n">${num(s.n)}</span> <span class="seg-pct">of ${num(pool.length)} · ${pct(s.n / pool.length)}</span></div>
        <div class="seg-probs">ExtraCash conversion: <b>${pct(s.p0)}</b> → <b>${pct(s.p1)}</b> with promo</div>
      </div>`;
    }).join('');

    const ts = state.world.trainStats;
    const gap = (ts.treatedRate - ts.controlRate) * 100;
    $('testRow').innerHTML = `
      <div class="test-cell"><div class="k">Got the promo</div><div class="v">${pct(ts.treatedRate)}</div><div class="d">borrowed · ${num(ts.treatedN)} members</div></div>
      <div class="test-cell"><div class="k">No promo</div><div class="v">${pct(ts.controlRate)}</div><div class="d">borrowed · ${num(ts.controlN)} members</div></div>
      <div class="test-cell gap"><div class="k">Average effect</div><div class="v">+${gap.toFixed(1)} pts</div><div class="d">caused by the promo</div></div>`;

    // Member sample: two from each group, interleaved.
    const sample = [];
    for (const k of SEGMENTS) sample.push(...pool.filter((m) => m.segment === k).slice(0, 2));
    sample.sort((a, b) => ((a.id * 7919) % 97) - ((b.id * 7919) % 97));
    const cad = { weekly: 'Weekly', biweekly: 'Biweekly', irregular: 'Gig' };
    const risk = { low: 'Low', med: 'Medium', high: 'High' };
    $('memberTable').innerHTML = `<thead><tr>
        <th>Member</th><th>Pay</th><th class="num">Last adv.</th><th class="num">Visits / 30d</th><th>Direct dep.</th><th>Checking</th><th>Goals</th><th>Risk</th>
        <th class="num hidden-col">No promo</th><th class="num hidden-col">With promo</th><th class="hidden-col">Group</th>
      </tr></thead><tbody>` + sample.map((m) => `<tr>
        <td>#${String(m.id * SCALE + (m.id * 7919) % SCALE)}</td><td>${cad[m.cadence]}</td><td class="num">${m.days}d ago</td>
        <td class="num">${m.sessions}</td><td>${m.dd ? 'Yes' : 'No'}</td><td>${m.checking ? 'Yes' : 'No'}</td><td>${m.goals ? 'Yes' : 'No'}</td><td>${risk[m.risk]}</td>
        <td class="num hidden-col">${pct(m.p0)}</td><td class="num hidden-col">${pct(m.p1)}</td>
        <td class="hidden-col"><span class="pill" style="--pill-c:${segColor(m.segment)}">${SEGMENT_INFO[m.segment].label}</span></td>
      </tr>`).join('') + '</tbody>';
  }

  // ---------- 2: strategies ----------
  function renderStrategies() {
    $('stratGrid').innerHTML = KEYS.map((k) => `<div class="strat" style="--c:${stratColor(k)}">
      <h3>${NAMES[k].name}</h3><span class="tech">${NAMES[k].tech}</span><p>${NAMES[k].how}</p></div>`).join('');
  }

  // ---------- summary + 3 + 4 ----------
  function renderResults() {
    if (!state.world) return;
    const e = econ();
    const pool = state.world.pool;
    const res = {};
    for (const k of KEYS) res[k] = Sim.evaluate(pool, k, e);
    state.results = res;
    const budgetN = Math.round(pool.length * e.budget);
    $('heroN').textContent = num(budgetN);

    const P = res.propensity;
    const best = KEYS.reduce((a, b) => (res[b].margin > res[a].margin ? b : a));

    // Summary strip
    const tile = (k) => `<div class="sum-tile" style="--c:${stratColor(k)}">
        <div class="sum-name">${NAMES[k].name}</div><div class="sum-tech">${NAMES[k].tech}</div>
        <div class="sum-stats"><div class="sum-stat"><span>Extra advances</span><b>${num(res[k].incr)}</b></div>
        <div class="sum-stat"><span>Net profit</span><b class="${res[k].margin < 0 ? 'neg' : 'pos'}">${usd(res[k].margin)}</b></div></div></div>`;
    $('summary').innerHTML =
      KEYS.map(tile).join('');

    // 3 — credited vs caused
    $('h3').textContent = 'Propensity list gets the most credit but drives the least incremental volume';
    const anyway = Math.max(0, P.attributed - P.incr) / P.attributed;
    $('sowhat3').innerHTML = `<b>So what:</b> about <strong>${pct(anyway)}</strong> of advances credited to the propensity list would have happened anyway. Optimizing to credited advances selects the worst strategy.`;
    $('legend3').innerHTML = `<span><i class="hatch" style="--c:${css('--ink-3')}"></i>Credited</span><span><i style="--c:${css('--ink-3')}"></i>Incremental</span>`;
    Charts.groupedBars($('chart3'), {
      cats: KEYS.map((k) => NAMES[k].short),
      series: [{ values: KEYS.map((k) => res[k].attributed) }, { values: KEYS.map((k) => Math.max(0, res[k].incr)) }],
      colorFn: (ci, si) => ({ fill: stratColor(KEYS[ci]), hatch: si === 0 }),
      fmt: num,
      annotate: { cat: KEYS.indexOf('propensity'), lines: ['Would have', 'borrowed anyway'] },
      tipFn: (ci, si) => { const r = res[KEYS[ci]]; return `<b>${NAMES[KEYS[ci]].name}</b><br>${si === 0 ? 'Credited' : 'Caused'}: ${num(si === 0 ? r.attributed : r.incr)} advances<br>Promos sent: ${num(r.n)}`; },
    });

    // 4 — money
    const V = res.value;
    $('h4').textContent = res[best].margin > 0
      ? `After discounts and credit losses, “${NAMES[best].name}” makes the most money`
      : 'At these settings, every strategy loses money';
    let so6 = `<b>So what:</b> discounts to sure things are pure cost, and incremental advances to high-risk members can be margin-negative. The objective is margin after losses, not volume.`;
    if (V.n < budgetN - 5) so6 += ` At these settings the risk-aware model deploys only <strong>${pct(V.n / budgetN)}</strong> of budget; the rest is expected to lose money.`;
    $('sowhat6').innerHTML = so6;
    Charts.divergingBars($('chart6'), {
      cats: KEYS.map((k) => NAMES[k].short),
      values: KEYS.map((k) => res[k].margin),
      colors: KEYS.map(stratColor),
      fmt: usd,
      tipFn: (ci) => { const r = res[KEYS[ci]]; return `<b>${NAMES[KEYS[ci]].name}</b><br>Revenue from extra advances: ${usd(r.revenueIncr)}<br>Credit losses on them: −${usd(r.lossIncr)}<br>Discounts paid: −${usd(r.spend)}<br><b>Net: ${usd(r.margin)}</b>`; },
    });

    renderDeeper();
  }

  // ---------- deeper (only when open, so charts measure real width) ----------
  function renderDeeper() {
    const res = state.results;
    if (!res) return;
    if ($('d3a').open) {
      $('legend4').innerHTML = SEGMENTS.map((k) => `<span><i style="--c:${segColor(k)}"></i>${SEGMENT_INFO[k].label}</span>`).join('');
      Charts.stackedBars($('chart4'), {
        cats: KEYS.map((k) => NAMES[k].short),
        parts: SEGMENTS.map((k) => ({ color: segColor(k), light: k === 'sure' || k === 'lost' })),
        values: KEYS.map((k) => SEGMENTS.map((sg) => res[k].seg[sg])),
        tipFn: (ci, pi) => `<b>${NAMES[KEYS[ci]].name}</b><br>${SEGMENT_INFO[SEGMENTS[pi]].label}: ${num(res[KEYS[ci]].seg[SEGMENTS[pi]])} of ${num(res[KEYS[ci]].n)} promos`,
      });
    }
  }

  let rt;
  window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(renderResults, 150); });

  rebuild();
})();

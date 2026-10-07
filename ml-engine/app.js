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
    rules:      { name: 'Hand-written rules', short: 'Rules', tech: 'Behavioral triggers · no ML', how: 'Scores simple signals: lapsed 2–6 weeks, active in the app, direct deposit, borrowed before.' },
    propensity: { name: 'Most likely to borrow', short: 'Likely to borrow', tech: 'Propensity model · ML', how: 'Learns who borrowed after getting last quarter’s promo, then picks look-alikes.' },
    uplift:     { name: 'Most likely to be persuaded', short: 'Persuadable', tech: 'Uplift model · ML', how: 'Two models predict borrowing with and without the promo. Picks the biggest gap.' },
    value:      { name: 'Persuadable and profitable', short: 'Persuadable + profitable', tech: 'Risk-aware uplift · ML', how: 'Same gap, converted to dollars after credit losses and discount cost. Skips money-losers.' },
    oracle:     { name: 'Perfect knowledge', short: 'Perfect knowledge' },
  };
  const KEYS = STRATEGIES.map((s) => s.key);

  // ---------- formatting ----------
  const num = (v) => Math.round(v).toLocaleString('en-US').replace('-', '−');
  const usd = (v) => (v < 0 ? '−$' : '$') + Math.abs(Math.round(v)).toLocaleString('en-US');
  const pct = (v) => Math.round(v * 100) + '%';
  const segColor = (k) => css('--s-' + k);
  const stratColor = (k) => css('--c-' + k);
  const riskLabel = (w) => (w === 0 ? 'None' : w < 1 ? 'Low' : w === 1 ? 'Normal' : w <= 2 ? 'High' : 'Very high') + (w === 1 ? '' : ` (${w}×)`);

  // ---------- controls ----------
  const econ = () => ({ budget: state.budget, promoCost: state.promoCost, revenue: state.revenue, lossWeight: state.lossWeight });
  function syncOutputs() {
    $('budgetOut').textContent = Math.round(state.budget * 100) + '% of members';
    $('promoOut').textContent = '$' + state.promoCost + ' off';
    $('offerAmt').textContent = '$' + state.promoCost;
    $('revOut').textContent = '$' + state.revenue;
    $('lossOut').textContent = riskLabel(state.lossWeight);
    $('seedOut').textContent = state.seed;
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
  $('reveal').addEventListener('change', (e) => $('memberTable').classList.toggle('revealed', e.target.checked));
  $('hoShare').addEventListener('input', (e) => { $('hoOut').textContent = e.target.value + '%'; renderHoldout(); });
  $('hoRerun').addEventListener('click', () => { state.hoSeed++; renderHoldout(); });
  ['d3a', 'd3b'].forEach((id) => $(id).addEventListener('toggle', renderDeeper));

  const hoSel = $('hoStrategy');
  KEYS.forEach((k) => { const o = document.createElement('option'); o.value = k; o.textContent = NAMES[k].name; hoSel.appendChild(o); });
  hoSel.value = 'uplift';
  hoSel.addEventListener('change', renderHoldout);

  // ---------- build ----------
  function rebuild() {
    syncOutputs();
    $('loading').classList.remove('hidden');
    setTimeout(() => {
      state.world = Sim.buildWorld(state.seed, state.scenario);
      $('loading').classList.add('hidden');
      renderSetup();
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
        <div class="seg-short">${SEGMENT_INFO[k].short}</div>
        <div><span class="seg-n">${num(s.n)}</span> <span class="seg-pct">${pct(s.n / pool.length)}</span></div>
        <div class="seg-probs">Chance of borrowing: <b>${pct(s.p0)}</b> → <b>${pct(s.p1)}</b> with promo</div>
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
    const cad = { weekly: 'Weekly', biweekly: 'Biweekly', irregular: 'Irregular / gig' };
    const risk = { low: 'Low', med: 'Medium', high: 'High' };
    $('memberTable').innerHTML = `<thead><tr>
        <th>Member</th><th>Pay</th><th class="num">Last advance</th><th class="num">App visits / 30d</th><th>Direct deposit</th><th>Risk</th>
        <th class="num hidden-col">No promo</th><th class="num hidden-col">With promo</th><th class="hidden-col">Group</th>
      </tr></thead><tbody>` + sample.map((m) => `<tr>
        <td>#${String(m.id).padStart(5, '0')}</td><td>${cad[m.cadence]}</td><td class="num">${m.days}d ago</td>
        <td class="num">${m.sessions}</td><td>${m.dd ? 'Yes' : 'No'}</td><td>${risk[m.risk]}</td>
        <td class="num hidden-col">${pct(m.p0)}</td><td class="num hidden-col">${pct(m.p1)}</td>
        <td class="hidden-col"><span class="pill" style="--pill-c:${segColor(m.segment)}">${SEGMENT_INFO[m.segment].label}</span></td>
      </tr>`).join('') + '</tbody>';
    $('memberTable').classList.toggle('revealed', $('reveal').checked);
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
    $('budgetN').textContent = num(budgetN);

    const P = res.propensity;
    const best = KEYS.reduce((a, b) => (res[b].margin > res[a].margin ? b : a));

    // Summary strip
    const tile = (k) => `<div class="sum-tile" style="--c:${stratColor(k)}">
        <div class="sum-name">${NAMES[k].name}</div><div class="sum-tech">${NAMES[k].tech}</div>
        <div class="sum-stat"><span>Extra advances</span><b>${num(res[k].incr)}</b></div>
        <div class="sum-stat"><span>Net profit</span><b class="${res[k].margin < 0 ? 'neg' : 'pos'}">${usd(res[k].margin)}</b></div></div>`;
    const bestK = best === 'propensity' ? 'value' : best;
    $('summary').innerHTML = `<div class="sum-lead"><p>Same ${num(budgetN)} promos each. <strong>${NAMES[bestK].name}</strong> ${res[bestK].margin >= 0 ? 'made' : 'lost'} <strong>${usd(Math.abs(res[bestK].margin))}</strong>. <strong>${NAMES.propensity.name}</strong> got the most credit and ${P.margin >= 0 ? 'made' : 'lost'} <strong>${usd(Math.abs(P.margin))}</strong>.</p></div>` +
      ['rules', 'propensity', bestK].map(tile).join('');

    // 3 — credited vs caused
    const mlIncr = ['propensity', 'uplift', 'value'].map((k) => res[k].incr);
    const propTopCredit = KEYS.every((k) => res[k].attributed <= P.attributed);
    const propLowImpact = P.incr <= Math.min(...mlIncr);
    $('h3').textContent = propTopCredit && propLowImpact
      ? 'The “most likely to borrow” list gets the most credit and causes the least'
      : 'Credit and impact tell different stories';
    const anyway = Math.max(0, P.attributed - P.incr) / P.attributed;
    $('sowhat3').innerHTML = `<b>Why it matters:</b> about <strong>${pct(anyway)}</strong> of the advances credited to “${NAMES.propensity.name}” would have happened anyway. Judge targeting by credit and you'd pick the worst list. That's why clean incrementality needs a comparison group.`;
    $('legend3').innerHTML = `<span><i class="hatch" style="--c:${css('--ink-3')}"></i>Credited by a typical dashboard</span><span><i style="--c:${css('--ink-3')}"></i>Actually caused by the promo</span>`;
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
    let so6 = `<b>Why it matters:</b> discounts paid to people who'd borrow anyway are pure cost, and extra advances to high-risk members can lose more than they earn. Try dragging <b>Credit risk</b> up.`;
    if (V.n < budgetN - 5) so6 += ` Right now the profitable list only used <strong>${pct(V.n / budgetN)}</strong> of its budget: the rest of the promos were expected to lose money.`;
    $('sowhat6').innerHTML = so6;
    Charts.divergingBars($('chart6'), {
      cats: KEYS.map((k) => NAMES[k].short),
      values: KEYS.map((k) => res[k].margin),
      colors: KEYS.map(stratColor),
      fmt: usd,
      tipFn: (ci) => { const r = res[KEYS[ci]]; return `<b>${NAMES[KEYS[ci]].name}</b><br>Revenue from extra advances: ${usd(r.revenueIncr)}<br>Credit losses on them: −${usd(r.lossIncr)}<br>Discounts paid: −${usd(r.spend)}<br><b>Net: ${usd(r.margin)}</b>`; },
    });

    renderDeeper();
    renderHoldout();
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
    if ($('d3b').open) {
      const e = econ(), pool = state.world.pool;
      const series = ['random', 'rules', 'propensity', 'uplift'].map((k) => ({ name: NAMES[k].short, color: stratColor(k), points: Sim.upliftCurve(pool, k, e) }));
      series.unshift({ name: NAMES.oracle.name, color: stratColor('oracle'), dash: '6 6', width: 2, points: Sim.upliftCurve(pool, 'oracle', e) });
      $('legend5').innerHTML = series.map((sr) => `<span><i class="${sr.dash ? 'dash' : ''}" style="--c:${sr.color}"></i>${sr.name}</span>`).join('');
      Charts.lineChart($('chart5'), { series, xFmt: pct, yFmt: num, marker: e.budget, markerLabel: 'Budget ' + pct(e.budget) });
    }
  }

  // ---------- 5: holdout ----------
  function renderHoldout() {
    if (!state.results) return;
    const share = +$('hoShare').value / 100;
    const ho = Sim.holdoutReadout(state.results[hoSel.value].treated, share, state.seed * 1000 + state.hoSeed);
    const truth = ho.trueIncrT;
    const missed = truth < ho.estLo || truth > ho.estHi;
    $('hoGrid').innerHTML = `
      <div class="ho-stat naive"><div class="k">Dashboard credit</div><div class="v">${num(ho.naiveCredit)}</div><div class="d">Advances taken by the ${num(ho.nT)} members who got the promo</div></div>
      <div class="ho-stat measured"><div class="k">Holdout estimate</div><div class="v">${num(ho.estIncr)}</div><div class="d">Likely between ${num(ho.estLo)} and ${num(ho.estHi)}. ${pct(ho.rT)} borrowed with the promo vs ${pct(ho.rH)} of ${num(ho.nH)} held back.</div></div>
      <div class="ho-stat"><div class="k">Hidden truth</div><div class="v">${num(truth)}</div><div class="d">${missed ? 'This run’s range <b>missed</b> the truth. It happens about 1 run in 20.' : 'Inside the estimated range.'}</div></div>`;
    Charts.intervalChart($('chart7'), { naive: ho.naiveCredit, lo: ho.estLo, hi: ho.estHi, est: ho.estIncr, truth, fmt: num });
  }

  let rt;
  window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(renderResults, 150); });

  rebuild();
})();

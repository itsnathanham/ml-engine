(function () {
  'use strict';
  const { SEGMENTS, SEGMENT_INFO, STRATEGIES } = Sim;
  const $ = (id) => document.getElementById(id);
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

  const DEFAULTS = { seed: 42, scenario: 'balanced', budget: 0.25, promoCost: 3, revenue: 8, lossWeight: 1 };
  const state = { ...DEFAULTS, world: null, results: null, hoSeed: 2 };

  // ---------- formatting ----------
  const num = (v) => Math.round(v).toLocaleString('en-US');
  const usd = (v) => (v < 0 ? '−$' : '$') + Math.abs(Math.round(v)).toLocaleString('en-US');
  const usd2 = (v) => (isFinite(v) ? '$' + v.toFixed(2) : '—');
  const pct = (v) => Math.round(v * 100) + '%';
  const segColor = (k) => css('--s-' + k);
  const stratColor = (k) => css('--c-' + k);
  const stratLabel = (k) => STRATEGIES.find((s) => s.key === k)?.label || 'Perfect knowledge';

  // ---------- controls ----------
  function econ() {
    return { budget: state.budget, promoCost: state.promoCost, revenue: state.revenue, lossWeight: state.lossWeight };
  }
  function syncOutputs() {
    $('budgetOut').textContent = Math.round(state.budget * 100) + '% of members';
    $('promoOut').textContent = '$' + state.promoCost;
    $('offerAmt').textContent = '$' + state.promoCost;
    $('revOut').textContent = '$' + state.revenue;
    $('lossOut').textContent = state.lossWeight.toFixed(state.lossWeight % 1 ? 2 : 1) + '×';
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

  const hoSel = $('hoStrategy');
  STRATEGIES.forEach((s) => { const o = document.createElement('option'); o.value = s.key; o.textContent = s.label; hoSel.appendChild(o); });
  hoSel.value = 'uplift';
  hoSel.addEventListener('change', renderHoldout);

  // ---------- build ----------
  function rebuild() {
    syncOutputs();
    $('loading').classList.remove('hidden');
    setTimeout(() => {
      state.world = Sim.buildWorld(state.seed, state.scenario);
      $('loading').classList.add('hidden');
      renderPopulation();
      renderStrategies();
      renderResults();
    }, 30);
  }

  // ---------- 1: population ----------
  function renderPopulation() {
    const pool = state.world.pool;
    const sum = Sim.segmentSummary(pool);
    $('segGrid').innerHTML = SEGMENTS.map((k) => {
      const s = sum[k];
      return `<div class="seg" style="--seg-c:${segColor(k)}">
        <div class="seg-label">${SEGMENT_INFO[k].label}</div>
        <div class="seg-short">${SEGMENT_INFO[k].short}</div>
        <div><span class="seg-n">${num(s.n)}</span> <span class="seg-pct">${pct(s.n / pool.length)}</span></div>
        <div class="seg-probs">Borrow odds <b>${pct(s.p0)}</b> → <b>${pct(s.p1)}</b> with promo</div>
      </div>`;
    }).join('');

    // Two members from each group, interleaved.
    const sample = [];
    for (const k of SEGMENTS) sample.push(...pool.filter((m) => m.segment === k).slice(0, 2));
    sample.sort((a, b) => (a.id * 7919) % 97 - (b.id * 7919) % 97);
    const cad = { weekly: 'Weekly', biweekly: 'Biweekly', irregular: 'Irregular / gig' };
    const risk = { low: 'Low', med: 'Medium', high: 'High' };
    $('memberTable').innerHTML = `<thead><tr>
        <th>Member</th><th>Pay</th><th class="num">Last advance</th><th class="num">Sessions / 30d</th><th>Direct dep.</th><th>Risk</th>
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
    const ts = state.world.trainStats;
    $('trainN').textContent = num(ts.treatedN + ts.controlN);
    const tags = { random: 'Baseline', rules: 'No ML', propensity: 'ML', uplift: 'ML', value: 'ML + economics' };
    $('stratGrid').innerHTML = STRATEGIES.map((s) => `<div class="strat">
      <div class="strat-top"><span class="swatch" style="--sw:${stratColor(s.key)}"></span><h3>${s.label}</h3></div>
      <span class="tag">${tags[s.key]}</span>
      <p>${s.how}</p></div>`).join('');
  }

  // ---------- 3–6: results ----------
  function renderResults() {
    if (!state.world) return;
    const e = econ();
    const pool = state.world.pool;
    const res = {};
    for (const s of STRATEGIES) res[s.key] = Sim.evaluate(pool, s.key, e);
    state.results = res;
    const keys = STRATEGIES.map((s) => s.key);
    const labels = STRATEGIES.map((s) => s.label);

    // 3 — credited vs caused
    const P = res.propensity, U = res.uplift;
    const wasted = Math.max(0, P.attributed - P.incr);
    const ratio = P.incr > 0 ? U.incr / P.incr : Infinity;
    $('insight3').innerHTML = `The propensity model gets credit for <strong>${num(P.attributed)}</strong> advances, the most of any strategy. But it only caused <strong>${num(P.incr)}</strong>. About <strong>${pct(wasted / P.attributed)}</strong> of its credited advances came from members who would have borrowed anyway. The uplift model gets less credit (${num(U.attributed)}) but causes <strong>${num(U.incr)}</strong> extra advances${isFinite(ratio) && ratio > 1.3 ? `, about <strong>${ratio.toFixed(1)}×</strong> as many` : ''}.`;
    $('legend3').innerHTML = `<span><i class="hatch" style="--c:${css('--ink-3')}"></i>Credited to promo</span><span><i style="--c:${css('--ink-3')}"></i>Actually caused by promo</span>`;
    Charts.groupedBars($('chart3'), {
      cats: labels,
      series: [{ name: 'Credited', values: keys.map((k) => res[k].attributed) }, { name: 'Caused', values: keys.map((k) => Math.max(0, res[k].incr)) }],
      colorFn: (ci, si) => ({ fill: stratColor(keys[ci]), hatch: si === 0 }),
      fmt: num,
      tipFn: (ci, si) => `<b>${labels[ci]}</b><br>${si === 0 ? 'Credited' : 'Caused'}: ${num(si === 0 ? res[keys[ci]].attributed : res[keys[ci]].incr)} advances<br>Promos sent: ${num(res[keys[ci]].n)}`,
    });

    // 4 — who was reached
    $('legend4').innerHTML = SEGMENTS.map((k) => `<span><i style="--c:${segColor(k)}"></i>${SEGMENT_INFO[k].label}</span>`).join('');
    Charts.stackedBars($('chart4'), {
      cats: labels,
      parts: SEGMENTS.map((k) => ({ name: SEGMENT_INFO[k].label, color: segColor(k), light: k === 'sure' || k === 'lost' })),
      values: keys.map((k) => SEGMENTS.map((sg) => res[k].seg[sg])),
      tipFn: (ci, pi) => `<b>${labels[ci]}</b><br>${SEGMENT_INFO[SEGMENTS[pi]].label}: ${num(res[keys[ci]].seg[SEGMENTS[pi]])} of ${num(res[keys[ci]].n)} promos`,
    });

    // 5 — uplift curve
    const curveKeys = ['random', 'rules', 'propensity', 'uplift'];
    const series = curveKeys.map((k) => ({ name: stratLabel(k), color: stratColor(k), points: Sim.upliftCurve(pool, k, e) }));
    series.unshift({ name: 'Perfect knowledge', color: stratColor('oracle'), dash: '6 6', width: 2, points: Sim.upliftCurve(pool, 'oracle', e) });
    $('legend5').innerHTML = series.map((sr) => `<span><i class="${sr.dash ? 'dash' : ''}" style="--c:${sr.color}"></i>${sr.name}</span>`).join('');
    Charts.lineChart($('chart5'), { series, xFmt: pct, yFmt: num, marker: e.budget, markerLabel: 'Budget ' + pct(e.budget) });

    // 6 — money
    const best = keys.reduce((a, b) => (res[b].margin > res[a].margin ? b : a));
    const worst = keys.reduce((a, b) => (res[b].margin < res[a].margin ? b : a));
    const V = res.value;
    $('insight6').innerHTML = `Best net margin: <strong>${stratLabel(best)}</strong> at <strong>${usd(res[best].margin)}</strong>. Worst: ${stratLabel(worst)} at <span class="nowrap">${usd(res[worst].margin)}</span>, mostly discounts paid on advances that were happening anyway.` +
      (V.n < Math.round(pool.length * e.budget) - 5 ? ` The risk-aware model only spent <strong>${pct(V.n / Math.round(pool.length * e.budget))}</strong> of its budget: past that point, every extra promo was expected to lose money.` : '');
    Charts.divergingBars($('chart6'), {
      cats: labels,
      values: keys.map((k) => res[k].margin),
      colors: keys.map(stratColor),
      fmt: usd,
      tipFn: (ci) => { const r = res[keys[ci]]; return `<b>${labels[ci]}</b><br>Extra revenue: ${usd(r.revenueIncr)}<br>Extra credit losses: −${usd(r.lossIncr)}<br>Discounts paid: −${usd(r.spend)}<br><b>Net: ${usd(r.margin)}</b>`; },
    });
    $('moneyTable').innerHTML = `<thead><tr><th>Strategy</th><th class="num opt">Promos sent</th><th class="num">Extra advances</th><th class="num opt">Discounts paid</th><th class="num">Cost per extra advance</th><th class="num opt">Extra credit losses</th><th class="num">Net margin</th></tr></thead><tbody>` +
      keys.map((k) => { const r = res[k]; return `<tr class="${k === best ? 'best' : ''}"><td>${stratLabel(k)}</td><td class="num opt">${num(r.n)}</td><td class="num">${num(r.incr)}</td><td class="num opt">${usd(r.spend)}</td><td class="num">${r.incr > 0 ? usd2(r.costPerIncr) : '—'}</td><td class="num opt">${usd(r.lossIncr)}</td><td class="num ${r.margin < 0 ? 'neg' : 'pos'}">${usd(r.margin)}</td></tr>`; }).join('') + '</tbody>';

    renderHoldout();
  }

  // ---------- 7: holdout ----------
  function renderHoldout() {
    if (!state.results) return;
    const k = hoSel.value;
    const share = +$('hoShare').value / 100;
    const ho = Sim.holdoutReadout(state.results[k].treated, share, state.seed * 1000 + state.hoSeed);
    const truth = ho.trueIncrT;
    const missed = truth < ho.estLo || truth > ho.estHi;
    $('hoGrid').innerHTML = `
      <div class="ho-stat naive"><div class="k">Dashboard credit</div><div class="v">${num(ho.naiveCredit)}</div><div class="d">Advances by the ${num(ho.nT)} members who got the promo</div></div>
      <div class="ho-stat measured"><div class="k">Holdout says</div><div class="v">${num(ho.estIncr)}</div><div class="d">95% range ${num(ho.estLo)} to ${num(ho.estHi)}<br>${pct(ho.rT)} borrowed with promo vs ${pct(ho.rH)} of ${num(ho.nH)} held back</div></div>
      <div class="ho-stat"><div class="k">Hidden truth</div><div class="v">${num(truth)}</div><div class="d">${missed ? 'This run’s range <b>missed</b> the truth. It happens about 1 run in 20.' : 'Inside the measured range.'}</div></div>`;
    Charts.intervalChart($('chart7'), { naive: ho.naiveCredit, lo: ho.estLo, hi: ho.estHi, est: ho.estIncr, truth, fmt: num });
  }

  // re-render charts on resize
  let rt;
  window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(renderResults, 150); });

  rebuild();
})();

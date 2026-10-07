// ML Engine — Targeting sandbox simulation.
// Pure logic, no DOM. Works in the browser (window.Sim) and in Node (module.exports).
(function (root) {
  'use strict';

  // ---------- Seeded randomness ----------
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  const sigmoid = (z) => 1 / (1 + Math.exp(-z));
  function normal(r) { // Box-Muller
    let u = 0, v = 0;
    while (u === 0) u = r();
    while (v === 0) v = r();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  function pick(r, items, weights) {
    let x = r() * weights.reduce((a, b) => a + b, 0);
    for (let i = 0; i < items.length; i++) { x -= weights[i]; if (x <= 0) return items[i]; }
    return items[items.length - 1];
  }

  // ---------- Scenarios ----------
  // Share of members who borrowed recently / lapsed / went dormant.
  const SCENARIOS = {
    balanced: { label: 'Balanced', mix: [0.40, 0.35, 0.25] },
    active:   { label: 'Mostly active borrowers', mix: [0.62, 0.23, 0.15] },
    dormant:  { label: 'Mostly lapsed & dormant', mix: [0.22, 0.38, 0.40] },
  };

  const SEGMENTS = ['persuadable', 'sure', 'lost', 'sleeping'];
  const SEGMENT_INFO = {
    persuadable: { label: 'Persuadables', short: 'Borrow because of the promo' },
    sure:        { label: 'Sure things', short: 'Would borrow anyway' },
    lost:        { label: 'Lost causes', short: "Won't borrow either way" },
    sleeping:    { label: 'Sleeping dogs', short: 'Promo makes them less likely' },
  };

  // Expected credit loss per advance by risk tier, in dollars (before the loss-weight slider).
  const LOSS_BY_RISK = { low: 0.5, med: 2.5, high: 9 };

  // ---------- Synthetic members ----------
  // Each member has observable features plus two hidden numbers:
  //   p0 = chance they take an ExtraCash advance in the next 14 days with NO promo
  //   p1 = chance they take one WITH the promo
  // In real life you only ever see one of those per member. Here we know both.
  function makeMember(r, id, mix) {
    const state = pick(r, ['recent', 'lapsed', 'dormant'], mix);
    const cadence = pick(r, ['weekly', 'biweekly', 'irregular'], [0.30, 0.45, 0.25]);
    const dd = r() < (cadence === 'irregular' ? 0.22 : 0.55);
    const risk = cadence === 'irregular'
      ? pick(r, ['low', 'med', 'high'], [0.25, 0.42, 0.33])
      : pick(r, ['low', 'med', 'high'], [0.45, 0.38, 0.17]);

    let days, adv, sessions;
    if (state === 'recent') {
      days = Math.floor(r() * 20);
      adv = 2 + Math.floor(r() * 4);
      sessions = Math.round(clamp(12 + normal(r) * 4, 3, 30));
    } else if (state === 'lapsed') {
      days = 21 + Math.floor(r() * 50);
      adv = 1 + Math.floor(r() * 2);
      sessions = Math.round(clamp(5 + normal(r) * 2.5, 0, 15));
    } else {
      days = 71 + Math.floor(r() * 80);
      adv = r() < 0.3 ? 1 : 0;
      sessions = Math.round(clamp(1.5 + normal(r) * 1.5, 0, 6));
    }
    if (days > 90) adv = 0; // advances in last 90 days can't exist if last advance was >90 days ago

    // Baseline: how likely to borrow with no nudge.
    const logit0 = -3.2 + 0.16 * Math.min(sessions, 20) + 0.35 * adv + (dd ? 0.4 : 0)
      - 0.015 * Math.min(days, 150) + normal(r) * 0.3;
    const p0 = clamp(sigmoid(logit0), 0.002, 0.95);

    // Treatment effect: how much the promo changes the odds.
    // Peaks for members ~5 weeks lapsed; irregular pay amplifies it;
    // dormant members who still route their paycheck to Dave are a hidden pocket.
    const bump = Math.exp(-Math.pow((days - 38) / 16, 2));
    let tau = 0.20 * bump * (cadence === 'irregular' ? 1.3 : 1)
      * (risk === 'low' ? 1.1 : risk === 'high' ? 0.85 : 1)
      + (dd && days > 70 ? 0.14 : 0) + 0.012;
    tau *= 0.7 + r() * 0.6;

    // Sleeping dogs: high-risk lapsed members for whom a nudge backfires.
    if (risk === 'high' && days >= 20 && days <= 120 && r() < 0.45) {
      tau = -(0.04 + r() * 0.05);
    }
    const p1 = clamp(p0 + tau, 0.001, 0.97);
    const trueTau = p1 - p0;

    let segment;
    if (trueTau < -0.01) segment = 'sleeping';
    else if (trueTau >= 0.08) segment = 'persuadable';
    else if (p0 >= 0.25) segment = 'sure';
    else segment = 'lost';

    return { id, cadence, dd, risk, days, adv, sessions, p0, p1, tau: trueTau, segment };
  }

  // ---------- Features the models are allowed to see ----------
  const DAY_BINS = [7, 20, 35, 50, 70, 100, Infinity];
  const SES_BINS = [0, 2, 5, 10, Infinity];
  const ADV_BINS = [0, 1, 3, Infinity];
  function binIndex(x, bins) { for (let i = 0; i < bins.length; i++) if (x <= bins[i]) return i; return bins.length - 1; }
  const NFEAT = 1 + DAY_BINS.length + SES_BINS.length + ADV_BINS.length + 3 + 2 + 3;
  function features(m) {
    const f = new Float64Array(NFEAT);
    let o = 0;
    f[o++] = 1;
    f[o + binIndex(m.days, DAY_BINS)] = 1; o += DAY_BINS.length;
    f[o + binIndex(m.sessions, SES_BINS)] = 1; o += SES_BINS.length;
    f[o + binIndex(m.adv, ADV_BINS)] = 1; o += ADV_BINS.length;
    f[o + ['weekly', 'biweekly', 'irregular'].indexOf(m.cadence)] = 1; o += 3;
    f[o++] = m.dd ? 1 : 0;
    f[o++] = m.dd && m.days > 70 ? 1 : 0; // engineered interaction: dormant but still direct-depositing
    f[o + ['low', 'med', 'high'].indexOf(m.risk)] = 1;
    return f;
  }

  // Plain logistic regression, batch gradient descent with light L2.
  function trainLogistic(X, y, iters = 350, lr = 0.8, l2 = 1e-3) {
    const n = X.length, d = X[0].length;
    const w = new Float64Array(d);
    const grad = new Float64Array(d);
    for (let it = 0; it < iters; it++) {
      grad.fill(0);
      for (let i = 0; i < n; i++) {
        const xi = X[i];
        let z = 0;
        for (let j = 0; j < d; j++) z += w[j] * xi[j];
        const err = sigmoid(z) - y[i];
        for (let j = 0; j < d; j++) grad[j] += err * xi[j];
      }
      for (let j = 0; j < d; j++) w[j] -= lr * (grad[j] / n + (j ? l2 * w[j] : 0));
    }
    return (x) => { let z = 0; for (let j = 0; j < d; j++) z += w[j] * x[j]; return sigmoid(z); };
  }

  // ---------- Build a world: population + a past randomized test + trained models ----------
  function buildWorld(seed, scenarioKey, n = 20000) {
    const r = rng(seed);
    const mix = SCENARIOS[scenarioKey].mix;
    const all = [];
    for (let i = 0; i < n; i++) all.push(makeMember(r, i + 1, mix));

    // Half the members were in last quarter's randomized promo test (training data);
    // the other half are this quarter's pool we need to target.
    const train = all.slice(0, n / 2);
    const pool = all.slice(n / 2);

    const Xt = [], yt = [], Xc = [], yc = [];
    for (const m of train) {
      const treated = r() < 0.5;
      const took = r() < (treated ? m.p1 : m.p0) ? 1 : 0;
      (treated ? Xt : Xc).push(features(m));
      (treated ? yt : yc).push(took);
    }
    const modelT = trainLogistic(Xt, yt); // P(advance | promo)
    const modelC = trainLogistic(Xc, yc); // P(advance | no promo)

    for (const m of pool) {
      const f = features(m);
      m.p1hat = modelT(f);
      m.p0hat = modelC(f);
      m.rand = r();
    }
    const trainStats = {
      treatedN: yt.length, controlN: yc.length,
      treatedRate: yt.reduce((a, b) => a + b, 0) / yt.length,
      controlRate: yc.reduce((a, b) => a + b, 0) / yc.length,
    };
    return { seed, scenarioKey, pool, trainStats };
  }

  // ---------- Strategies ----------
  const STRATEGIES = [
    { key: 'random', label: 'Random', how: 'Pick members at random. The baseline every other strategy has to beat.' },
    { key: 'rules', label: 'Behavioral rules', how: 'Hand-written trigger: lapsed 14–45 days, active in the app, direct deposit, borrowed before. Points add up; highest scores win.' },
    { key: 'propensity', label: 'Propensity model', how: 'ML model trained on who borrowed after getting last quarter’s promo. Targets members most likely to borrow.' },
    { key: 'uplift', label: 'Uplift model', how: 'Two ML models: one predicts borrowing with the promo, one without. Targets the biggest gap — who the promo actually moves.' },
    { key: 'value', label: 'Risk-aware uplift', how: 'Uplift model scored in dollars: extra advances × (revenue − expected credit loss) − promo cost. Skips members who lose money.' },
  ];

  function rulePoints(m) {
    let p = 0;
    if (m.days >= 14 && m.days <= 45) p += 3;
    if (m.sessions >= 3) p += 1;
    if (m.dd) p += 1;
    if (m.adv >= 1) p += 1;
    return p + m.rand * 0.01; // random tie-break
  }

  function scoreFn(key, econ) {
    switch (key) {
      case 'random': return (m) => m.rand;
      case 'rules': return rulePoints;
      case 'propensity': return (m) => m.p1hat;
      case 'uplift': return (m) => m.p1hat - m.p0hat;
      case 'value': return (m) => {
        const L = LOSS_BY_RISK[m.risk] * econ.lossWeight;
        return m.p1hat * (econ.revenue - econ.promoCost - L) - m.p0hat * (econ.revenue - L);
      };
      // Oracle: ranks by the true effect, which no real team can see.
      case 'oracle': return (m) => m.tau;
    }
  }

  function ranked(pool, key, econ) {
    const s = scoreFn(key, econ);
    return pool.map((m) => ({ m, s: s(m) })).sort((a, b) => b.s - a.s);
  }

  // Evaluate one strategy against the hidden truth.
  function evaluate(pool, key, econ) {
    const budgetN = Math.round(pool.length * econ.budget);
    let list = ranked(pool, key, econ).slice(0, budgetN);
    if (key === 'value') list = list.filter((x) => x.s > 0);
    const treated = list.map((x) => x.m);

    let incr = 0, attributed = 0, spend = 0, margin = 0, lossIncr = 0;
    const seg = { persuadable: 0, sure: 0, lost: 0, sleeping: 0 };
    for (const m of treated) {
      const L = LOSS_BY_RISK[m.risk] * econ.lossWeight;
      const d = m.p1 - m.p0;
      incr += d;
      attributed += m.p1;
      spend += econ.promoCost * m.p1;
      lossIncr += d * L;
      margin += d * (econ.revenue - L) - econ.promoCost * m.p1;
      seg[m.segment]++;
    }
    return {
      key, treated, n: treated.length, incr, attributed, spend, margin, lossIncr,
      revenueIncr: incr * econ.revenue,
      costPerIncr: incr > 0 ? spend / incr : Infinity,
      wastedShare: attributed > 0 ? (attributed - Math.max(incr, 0)) / attributed : 0,
      seg,
    };
  }

  // Qini-style curve: cumulative true incremental advances as you target more of the pool.
  function upliftCurve(pool, key, econ, steps = 50) {
    const list = ranked(pool, key, econ);
    const pts = [{ x: 0, y: 0 }];
    let cum = 0, idx = 0;
    for (let s = 1; s <= steps; s++) {
      const upto = Math.round((list.length * s) / steps);
      while (idx < upto) { cum += list[idx].m.tau; idx++; }
      pts.push({ x: s / steps, y: cum });
    }
    return pts;
  }

  // Simulated holdout test: hold back a slice of the chosen members, observe real (noisy) outcomes.
  function holdoutReadout(treated, holdoutShare, seed) {
    const r = rng(seed);
    let nT = 0, yT = 0, nH = 0, yH = 0, trueT = 0;
    for (const m of treated) {
      if (r() < holdoutShare) { nH++; if (r() < m.p0) yH++; }
      else { nT++; trueT += m.p1 - m.p0; if (r() < m.p1) yT++; }
    }
    const rT = nT ? yT / nT : 0, rH = nH ? yH / nH : 0;
    const diff = rT - rH;
    const se = Math.sqrt((nT ? rT * (1 - rT) / nT : 0) + (nH ? rH * (1 - rH) / nH : 0));
    return {
      nT, yT, nH, yH, rT, rH, diff, se,
      lo: diff - 1.96 * se, hi: diff + 1.96 * se,
      // What a naive dashboard would credit: every advance from a promo recipient.
      naiveCredit: yT,
      estIncr: diff * nT, estLo: (diff - 1.96 * se) * nT, estHi: (diff + 1.96 * se) * nT,
      trueIncrT: trueT,
    };
  }

  function segmentSummary(pool) {
    const out = {};
    for (const k of SEGMENTS) out[k] = { n: 0, p0: 0, p1: 0 };
    for (const m of pool) { const o = out[m.segment]; o.n++; o.p0 += m.p0; o.p1 += m.p1; }
    for (const k of SEGMENTS) { const o = out[k]; if (o.n) { o.p0 /= o.n; o.p1 /= o.n; } }
    return out;
  }

  const api = {
    rng, SCENARIOS, SEGMENTS, SEGMENT_INFO, STRATEGIES, LOSS_BY_RISK,
    buildWorld, evaluate, upliftCurve, holdoutReadout, segmentSummary,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Sim = api;
})(typeof window !== 'undefined' ? window : globalThis);

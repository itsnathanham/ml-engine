# ML Engine

An exploratory sandbox for ML-driven promotion targeting in app-based short-term cash advances. Built as interview prep; not affiliated with Dave.

**Who to target** (live): 20,000 synthetic members with hidden "with promo / without promo" borrowing odds. Five strategies compete (random, behavioral rules, propensity model, uplift model, risk-aware uplift), and the page shows credited vs. caused advances, who each strategy reached, a Qini curve, net margin after credit losses and promo cost, and a simulated holdout test.

Coming next: **Which promo** (multi-armed bandits) and **When to send** (timing).

## Stack
Static HTML/CSS/JS, no build step. Simulation and logistic-regression models run in the browser (`ml-engine/sim.js`). Deployed on Vercel; `/` redirects to `/ml-engine/`.

## Run locally
```
python3 -m http.server 8000
# open http://localhost:8000/ml-engine/
```

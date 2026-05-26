# Per-locale calibration gold sets

Each `<locale>/` sub-directory holds two artifacts:

- `gold-set.json` — at least 30 native-speaker-labeled gold cases, with
  two reviewer verdicts per case (and an arbiter resolution where the
  reviewers disagreed) so the inter-rater Cohen's κ for the gold set
  exceeds the 0.7 gate.
- `platt-curve.json` — the fitted Platt-scaling curve (intercept,
  slope, sample count, held-out ECE, held-out κ) for the locale. The
  per-locale ECE threshold is fixed at 0.10 (mirrored in
  `case-confidence-calibrator.ts`).

The reviewer pool for each locale is operator-curated. The harness only
consumes the fitted curve and the gold-set.

The extended locale set is PL-PL, ES-ES, NL-NL, CS-CZ, and HU-HU. The
original six locale fixtures remain the entry point; their data lives
alongside the aggregate calibration artifacts.

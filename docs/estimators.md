# CARDTAPE estimator contract

Every estimator is a pure function over immutable facts. The database job recomputes results and stores `computed_at`, provenance, uncertainty, and the method note together.

Synthetic inputs force result provenance to `demo`, even when the calculation is structurally an estimate or inference.

## Difference-in-differences

The outcome is evaluated on an account-day panel with explicit zero-spend days:

`outcome = intercept + treated + post + treated×post`

The interaction coefficient is the per-account-day effect. It is scaled by treated accounts and campaign days to obtain the total incremental outcome. The implementation supports USD settlement volume, transaction count, and active-card days.

Confidence intervals use a sandwich covariance matrix clustered by card account, with finite-sample correction. The identifying assumption is parallel trends. CARDTAPE separately computes the difference between eligible and control pre-period slopes across the preceding eight weeks; the UI must display that evidence above the estimate.

Campaigns without both an eligible and control tier are returned as not estimable, not silently converted into before/after claims.

## Signature match

The signature test applies the hand-reviewed registry threshold to eligible-tier settlements in the campaign window and the trailing 28-day baseline. It returns counts, shares, a normalized count lift, a difference-in-proportions interval, and a ticket histogram.

Merchant identity is never inferred. For the iPhone campaign, a settlement of at least $1,000 is a reproducible proxy, not proof of an Apple purchase.

## Persistence

The campaign cohort contains accounts whose first settlement occurs in the campaign window or whose preceding inactivity is at least 28 days. Retention is the share with a settlement in the seven-day window beginning at weeks 4, 8, and 12 after campaign end. Points beyond available history are stored as unavailable rather than zero.

The unstake cohort contains accounts staking ETHFI or depositing into Liquid during the 14-day run-up. The reported exit share covers unstake or withdrawal events through 30 days after campaign end.

## Token event study

Daily ETHFI and BTC log returns are aligned by UTC date. Alpha and beta are estimated over days -90 through -15 relative to the campaign announcement. Abnormal return is:

`ETHFI return − (alpha + beta × BTC return)`

The event series covers days -7 through +7. Cumulative intervals use the pre-event residual standard deviation and expand with the square root of observed event days.

## Required synthetic gates

1. The known injected iPhone volume must lie inside the clustered difference-in-differences interval.
2. The same estimator on a campaign-free placebo window must return an interval containing zero.
3. The iPhone ticket-signature lift must be positive.
4. Persistence and unstake cohorts must produce observable results.
5. The event study must estimate a finite beta and cumulative abnormal-return series.

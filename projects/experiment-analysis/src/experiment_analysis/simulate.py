"""Independent randomized orders and a separate, nonrandom location rollout."""

from dataclasses import asdict, dataclass

import numpy as np
import pandas as pd


@dataclass(frozen=True)
class Simulation:
    seed: int = 42
    ab_orders: int = 12000
    locations: int = 40
    pre_periods: int = 8
    post_periods: int = 8
    orders_per_cell: int = 50
    accuracy_effect: float = 0.035
    automation_effect: float = 0.10
    service_effect: float = -18.0
    # A deliberately invalid counterfactual for checking the diagnostic guards.
    differential_service_trend: float = 0.0


def simulate(config: Simulation | None = None) -> tuple[pd.DataFrame, dict]:
    """Return order rows and separate ground truth; analysis never reads the truth."""
    c = config or Simulation()
    if c.ab_orders < 100 or c.locations < 20 or c.locations % 2:
        raise ValueError("Use >=100 A/B orders and an even number of >=20 locations")
    if c.pre_periods < 4 or c.post_periods < 2 or c.orders_per_cell < 10:
        raise ValueError("Use >=4 pre periods, >=2 post periods and >=10 orders per cell")
    if not -0.10 <= c.accuracy_effect <= 0.06 or not -0.3 <= c.automation_effect <= 0.3:
        raise ValueError("Binary effects must keep all simulated probabilities inside (0, 1)")
    if not np.isfinite([c.service_effect, c.differential_service_trend]).all():
        raise ValueError("Service effects must be finite")
    rng = np.random.default_rng(c.seed)
    n = c.ab_orders
    arm = rng.binomial(1, 0.5, n)  # Bernoulli assignment, before observing outcomes.
    items = rng.integers(1, 6, n)
    ab = pd.DataFrame(
        {
            "experiment": "ab",
            "location": rng.integers(0, c.locations, n),
            "period": 0,
            "arm": arm,
            "items": items,
            "correct": rng.binomial(1, 0.90 + c.accuracy_effect * arm),
            "automated": rng.binomial(1, 0.55 + c.automation_effect * arm),
            "service_seconds": 180
            + 6 * items
            + c.service_effect * arm
            + rng.lognormal(3, 0.45, n)
            - np.exp(3 + 0.45**2 / 2),
        }
    )
    cells = []
    for location in range(c.locations):
        # Higher-index locations adopt together, rather than random assignment.
        treated = int(location >= c.locations // 2)
        baseline = location / (c.locations - 1) - 0.5
        persistent_shock = 0.0
        for period in range(-c.pre_periods, c.post_periods):
            n = c.orders_per_cell
            active = treated * int(period >= 0)
            persistent_shock = 0.6 * persistent_shock + rng.normal(0, 3)
            items = rng.integers(1, 6, n)
            cells.append(
                pd.DataFrame(
                    {
                        "experiment": "did",
                        "location": location,
                        "period": period,
                        "arm": treated,
                        "items": items,
                        "correct": rng.binomial(
                            1,
                            0.89 + 0.02 * baseline + 0.002 * period + c.accuracy_effect * active,
                            n,
                        ),
                        "automated": rng.binomial(
                            1,
                            0.53 + 0.04 * baseline + 0.003 * period + c.automation_effect * active,
                            n,
                        ),
                        "service_seconds": 180
                        + 6 * items
                        + 12 * baseline
                        + 0.8 * period
                        + c.service_effect * active
                        + persistent_shock
                        + c.differential_service_trend * treated * period
                        + rng.normal(0, 18, n),
                    }
                )
            )
    rows = pd.concat([ab, *cells], ignore_index=True)
    rows.insert(0, "order_id", np.arange(len(rows)))
    if (rows.service_seconds <= 0).any():
        raise ValueError("Simulation produced nonpositive service times; reduce the service effect")
    truth = {
        "config": asdict(c),
        "effects": {
            "correct": c.accuracy_effect,
            "automated": c.automation_effect,
            "service_seconds": c.service_effect,
        },
        "synthetic": True,
    }
    return rows, truth

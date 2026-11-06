"""Cash-flow coverage with annual rebalancing and explicit unpaid obligations."""

from dataclasses import dataclass

import numpy as np

from alm_model.model import finite_array


def liability_stream(years: int, first_payment: float, growth: float) -> np.ndarray:
    if isinstance(years, bool) or not isinstance(years, int) or years < 1:
        raise ValueError("years must be a positive integer")
    if not np.isfinite(first_payment) or first_payment <= 0:
        raise ValueError("first payment must be positive and finite")
    if not np.isfinite(growth) or growth <= -1:
        raise ValueError("payment growth must exceed -100%")
    payments = first_payment * (1 + growth) ** np.arange(years)
    if not np.all(np.isfinite(payments)):
        raise ValueError("liability stream overflowed")
    return payments


def present_value(payments: np.ndarray, discount_rate: float) -> float:
    payments = finite_array(payments, "payments", 1)
    if not np.isfinite(discount_rate) or discount_rate <= -1:
        raise ValueError("discount rate must exceed -100%")
    return float(np.sum(payments / (1 + discount_rate) ** np.arange(1, len(payments) + 1)))


@dataclass
class Coverage:
    path_metrics: dict[str, np.ndarray]
    yearly: list[dict]

    def summary(self) -> dict[str, float]:
        terminal = self.path_metrics["terminal_assets"]
        return {
            "shortfall_probability": float(self.path_metrics["shortfall"].mean()),
            "expected_pv_unpaid": float(self.path_metrics["pv_unpaid"].mean()),
            "mean_terminal_assets": float(terminal.mean()),
            "p05_terminal_assets": float(np.quantile(terminal, 0.05)),
            "mean_payment_coverage": float(self.path_metrics["payment_coverage"].mean()),
        }


def test_coverage(
    returns: np.ndarray,
    weights: np.ndarray,
    payments: np.ndarray,
    initial_assets: float,
    discount_rate: float,
) -> Coverage:
    """Grow assets, pay end-year liability, record gaps, then rebalance survivors.

    Unpaid amounts are recorded as shortfalls, never silently financed or forgiven.
    No new contributions, borrowing, transaction costs, or recovery from zero assets.
    """
    returns = finite_array(returns, "returns", 3)
    weights = finite_array(weights, "weights", 1)
    payments = finite_array(payments, "payments", 1)
    paths, years, assets = returns.shape
    if paths < 1 or years < 1 or assets != len(weights) or years != len(payments):
        raise ValueError("returns, weights and payments have inconsistent dimensions")
    if np.any(returns < -1) or np.any(weights < 0) or not np.isclose(weights.sum(), 1):
        raise ValueError("returns cannot be below -100%; weights must be long-only and sum to one")
    if np.any(payments < 0) or payments.sum() <= 0:
        raise ValueError("payments must be nonnegative with a positive total")
    if not np.isfinite(initial_assets) or initial_assets <= 0:
        raise ValueError("initial assets must be positive and finite")
    present_value(payments, discount_rate)  # validate the discount convention
    balance = np.full(paths, initial_assets, dtype=float)
    ever_failed = np.zeros(paths, dtype=bool)
    pv_unpaid = np.zeros(paths)
    total_paid = np.zeros(paths)
    yearly = []
    for t, due in enumerate(payments):
        balance *= 1 + returns[:, t, :] @ weights
        # PV of all still-due cash flows at this payment date, including today's payment.
        remaining_pv = np.sum(payments[t:] / (1 + discount_rate) ** np.arange(years - t))
        funded_ratio = balance / remaining_pv if remaining_pv else np.full(paths, np.nan)
        paid = np.minimum(balance, due)
        unpaid = due - paid
        # An absolute tolerance avoids treating sub-cent floating point residuals as default.
        ever_failed |= unpaid > 1e-8
        pv_unpaid += unpaid / (1 + discount_rate) ** (t + 1)
        total_paid += paid
        balance -= paid
        yearly.append(
            {
                "year": t + 1,
                "liability": float(due),
                "mean_assets_after_payment": float(balance.mean()),
                "p05_assets_after_payment": float(np.quantile(balance, 0.05)),
                "shortfall_probability_to_date": float(ever_failed.mean()),
                "mean_funded_ratio_before_payment": (
                    float(funded_ratio.mean()) if remaining_pv else None
                ),
            }
        )
    return Coverage(
        {
            "shortfall": ever_failed.astype(float),
            "pv_unpaid": pv_unpaid,
            "terminal_assets": balance,
            "payment_coverage": total_paid / payments.sum(),
        },
        yearly,
    )


# Avoid pytest collecting this public function if it is imported into a test module.
test_coverage.__test__ = False

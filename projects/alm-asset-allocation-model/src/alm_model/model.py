"""Annual lognormal return model and a convex, long-only allocation problem."""

import csv
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from scipy.optimize import linprog, minimize

ASSETS = ("us_equity", "treasury_10y", "baa_credit", "cash_3m")


def finite_array(value, name: str, ndim: int) -> np.ndarray:
    result = np.asarray(value, dtype=float)
    if result.ndim != ndim or not np.all(np.isfinite(result)):
        raise ValueError(f"{name} must be a finite {ndim}-dimensional array")
    return result


def covariance_matrix(value, size: int) -> np.ndarray:
    cov = finite_array(value, "covariance", 2)
    if cov.shape != (size, size) or not np.allclose(cov, cov.T, atol=1e-12, rtol=0):
        raise ValueError("covariance must be square and symmetric")
    if np.linalg.eigvalsh(cov).min() < -1e-12:
        raise ValueError("covariance must be positive semidefinite")
    return cov


def psd_root(cov: np.ndarray) -> np.ndarray:
    """Symmetric square root; supports zero variance and perfect correlation."""
    eig, vectors = np.linalg.eigh(covariance_matrix(cov, len(cov)))
    return (vectors * np.sqrt(np.maximum(eig, 0))) @ vectors.T


@dataclass(frozen=True)
class ReturnModel:
    assets: tuple[str, ...]
    log_mean: np.ndarray
    log_cov: np.ndarray

    def __post_init__(self):
        mean = finite_array(self.log_mean, "log means", 1)
        if len(mean) != len(self.assets) or not len(mean):
            raise ValueError("one mean is required per asset")
        if len(set(self.assets)) != len(self.assets):
            raise ValueError("asset names must be unique")
        cov = covariance_matrix(self.log_cov, len(mean))
        # Own immutable copies so a caller cannot change the model after validation.
        for key, value in (("log_mean", mean), ("log_cov", cov)):
            owned = value.copy()
            owned.setflags(write=False)
            object.__setattr__(self, key, owned)

    @property
    def mean(self) -> np.ndarray:
        """Arithmetic expected annual returns, consistent with simulated gross returns."""
        return np.expm1(self.log_mean + np.diag(self.log_cov) / 2)

    @property
    def cov(self) -> np.ndarray:
        gross_mean = 1 + self.mean
        return np.outer(gross_mean, gross_mean) * np.expm1(self.log_cov)

    @property
    def correlation(self) -> np.ndarray:
        std = np.sqrt(np.diag(self.log_cov))
        divisor = np.outer(std, std)
        corr = np.divide(self.log_cov, divisor, out=np.eye(len(std)), where=divisor > 0)
        np.fill_diagonal(corr, 1)
        return corr

    def stress_correlations(self, blend: float) -> "ReturnModel":
        """Blend log-return correlation with perfect positive co-movement, preserving marginals."""
        if not np.isfinite(blend) or not 0 <= blend <= 1:
            raise ValueError("correlation blend must be between 0 and 1")
        if blend == 0:
            return self
        std = np.sqrt(np.diag(self.log_cov))
        stressed_cov = (1 - blend) * self.log_cov + blend * np.outer(std, std)
        return ReturnModel(self.assets, self.log_mean, stressed_cov)

    def simulate(self, normal_shocks: np.ndarray) -> np.ndarray:
        shocks = finite_array(normal_shocks, "normal shocks", 3)
        if shocks.shape[2] != len(self.assets):
            raise ValueError("shock asset dimension must match the model")
        return np.expm1(self.log_mean + shocks @ psd_root(self.log_cov).T)


def load_history(path: str | Path) -> tuple[np.ndarray, np.ndarray]:
    """Strict, contiguous annual input. Returns are decimals, never percentages."""
    with Path(path).open(newline="") as stream:
        reader = csv.DictReader(stream)
        if reader.fieldnames != ["year", *ASSETS]:
            raise ValueError(f"history columns must be year,{','.join(ASSETS)}")
        rows = list(reader)
    if len(rows) < 3:
        raise ValueError("at least three annual observations are required")
    years = np.array([int(row["year"]) for row in rows])
    returns = finite_array([[row[a] for a in ASSETS] for row in rows], "returns", 2)
    if np.any(np.diff(years) != 1):
        raise ValueError("years must be ordered, unique and contiguous")
    if np.any(returns <= -1):
        raise ValueError("simple returns must exceed -100%")
    return years, returns


def calibrate(returns: np.ndarray, assets: tuple[str, ...] = ASSETS) -> ReturnModel:
    returns = finite_array(returns, "returns", 2)
    if returns.shape[0] < 3 or returns.shape[1] != len(assets) or np.any(returns <= -1):
        raise ValueError("need at least three valid observations with one column per asset")
    logs = np.log1p(returns)
    return ReturnModel(assets, logs.mean(axis=0), np.atleast_2d(np.cov(logs, rowvar=False)))


@dataclass(frozen=True)
class Allocation:
    weights: np.ndarray
    expected_return: float
    volatility: float


def optimize(model: ReturnModel, target_return: float, max_weight: float = 0.65) -> Allocation:
    """Minimum annual variance subject to return floor, full investment and position cap."""
    n = len(model.assets)
    if not np.isfinite(target_return) or not np.isfinite(max_weight) or not 0 < max_weight <= 1:
        raise ValueError("target and cap must be finite, with cap in (0, 1]")
    if n * max_weight < 1 - 1e-12:
        raise ValueError("position cap cannot accommodate a fully invested portfolio")
    mean, cov = model.mean, model.cov
    feasible = linprog(
        -mean, A_eq=np.ones((1, n)), b_eq=[1], bounds=[(0, max_weight)] * n, method="highs"
    )
    if not feasible.success or mean @ feasible.x < target_return - 1e-10:
        raise ValueError("target return is infeasible under the position cap")
    result = minimize(
        lambda w: float(w @ cov @ w),
        feasible.x,
        jac=lambda w: 2 * cov @ w,
        method="SLSQP",
        bounds=[(0, max_weight)] * n,
        constraints=[
            {"type": "eq", "fun": lambda w: w.sum() - 1, "jac": lambda w: np.ones(n)},
            {"type": "ineq", "fun": lambda w: w @ mean - target_return, "jac": lambda w: mean},
        ],
        options={"ftol": 1e-12, "maxiter": 1000},
    )
    w = result.x
    if (
        not result.success
        or abs(w.sum() - 1) > 1e-8
        or w.min() < -1e-8
        or w.max() > max_weight + 1e-8
        or w @ mean < target_return - 1e-8
    ):
        raise RuntimeError(f"allocation optimizer failed: {result.message}")
    return Allocation(w, float(w @ mean), float(np.sqrt(max(w @ cov @ w, 0))))

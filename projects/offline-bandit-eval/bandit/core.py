"""Contextual policies, simulated logs, and off-policy estimators.

Rewards are Bernoulli outcomes; propensities are conditional on the full
history available to the logging policy at the time of each decision.
"""
from dataclasses import dataclass
import numpy as np

# Intercept, queue pressure, and road condition. All probabilities lie in [0, 1].
COEFFICIENTS = np.array([[.30, .35, -.10], [.42, -.15, .25], [.25, .10, .30]])


@dataclass
class Log:
    context: np.ndarray
    action: np.ndarray
    propensity: np.ndarray
    reward: np.ndarray
    probabilities: np.ndarray

    def take(self, index):
        return Log(self.context[index], self.action[index], self.propensity[index], self.reward[index], self.probabilities[index])


class EpsilonGreedy:
    def __init__(self, actions, features, epsilon):
        if not 0 < epsilon <= 1:
            raise ValueError("epsilon must be in (0, 1]")
        self.epsilon = epsilon
        self.a = np.tile(np.eye(features), (actions, 1, 1))
        self.b = np.zeros((actions, features))

    def probabilities(self, x):
        scores = np.array([x @ np.linalg.solve(a, b) for a, b in zip(self.a, self.b)])
        p = np.full(len(scores), self.epsilon / len(scores))
        p[np.argmax(scores)] += 1 - self.epsilon
        return p

    def update(self, x, action, reward):
        self.a[action] += np.outer(x, x)
        self.b[action] += reward * x


class LinUCB(EpsilonGreedy):
    def __init__(self, actions, features, alpha=1.0):
        super().__init__(actions, features, 1.0)
        self.alpha = alpha

    def probabilities(self, x):
        scores = []
        for a, b in zip(self.a, self.b):
            inv_x = np.linalg.solve(a, x)
            scores.append(b @ inv_x + self.alpha * np.sqrt(x @ inv_x))
        p = np.zeros(len(scores))
        p[np.argmax(scores)] = 1.0
        return p


def simulate(n, policy, rng):
    if n <= 0:
        raise ValueError("n must be positive")
    context = np.column_stack((np.ones(n), rng.random((n, 2))))
    actions = np.empty(n, dtype=int)
    propensities = np.empty(n)
    rewards = np.empty(n)
    probabilities = np.empty((n, len(COEFFICIENTS)))
    for i, x in enumerate(context):
        p = policy.probabilities(x)
        probabilities[i] = p
        action = rng.choice(len(p), p=p)
        reward = float(rng.random() < x @ COEFFICIENTS[action])
        actions[i], propensities[i], rewards[i] = action, p[action], reward
        policy.update(x, action, reward)
    return Log(context, actions, propensities, rewards, probabilities)


def safe_policy(target, logging_probabilities, minimum):
    """Remove actions with low conditional logging probability, then renormalize.

    If all target mass is removed, choose the supported action with the highest
    logging probability. Fail closed if no action meets the threshold.
    """
    target = np.asarray(target, dtype=float)
    support = np.asarray(logging_probabilities, dtype=float)
    if target.ndim != 2 or target.shape != support.shape or not 0 < minimum <= 1:
        raise ValueError("invalid policy, support or threshold")
    if (not np.isfinite(target).all() or not np.isfinite(support).all()
            or np.any(target < 0) or np.any(support < 0) or np.any(support > 1)
            or not np.allclose(target.sum(axis=1), 1)
            or not np.allclose(support.sum(axis=1), 1)):
        raise ValueError("policy and logging probabilities must be distributions")
    mask = support >= minimum
    if np.any(~mask.any(axis=1)):
        raise ValueError("no supported action for at least one context")
    result = target * mask
    empty = result.sum(axis=1) == 0
    if empty.any():
        rows = np.flatnonzero(empty)
        result[rows, np.argmax(np.where(mask[rows], support[rows], -1), axis=1)] = 1
    return result / result.sum(axis=1, keepdims=True)


def fit_reward_model(log):
    """Fit one linear outcome model per action on an independent log."""
    models = []
    for action in range(len(COEFFICIENTS)):
        mask = log.action == action
        if mask.sum() < log.context.shape[1]:
            raise ValueError("insufficient observations to fit reward model")
        models.append(np.linalg.lstsq(log.context[mask], log.reward[mask], rcond=None)[0])
    return np.array(models)


def evaluate(log, target, model):
    target = np.asarray(target, dtype=float)
    n = len(log.reward)
    if (n == 0 or target.shape != (n, len(model)) or not np.isfinite(target).all()
            or np.any(target < 0) or not np.allclose(target.sum(axis=1), 1)
            or np.any(log.propensity <= 0) or np.any(log.propensity > 1)):
        raise ValueError("invalid log or target policy")
    rows = np.arange(n)
    weights = target[rows, log.action] / log.propensity
    if weights.sum() == 0:
        raise ValueError("no logged actions overlap with target")
    predictions = np.einsum("ij,kj->ik", log.context, model)
    ips = np.mean(weights * log.reward)
    dr = np.mean(np.sum(target * predictions, axis=1) + weights * (log.reward - predictions[rows, log.action]))
    return {"ips": float(ips), "snips": float(np.sum(weights * log.reward) / weights.sum()), "dr": float(dr)}


def bootstrap(log, target, model, rng, samples=500, confidence=.95):
    """Percentile intervals, resampling evaluation rows; fitted model stays fixed."""
    if samples < 2 or not 0 < confidence < 1:
        raise ValueError("invalid bootstrap parameters")
    results = {key: [] for key in ("ips", "snips", "dr")}
    for _ in range(samples):
        idx = rng.integers(0, len(log.reward), len(log.reward))
        for key, value in evaluate(log.take(idx), target[idx], model).items():
            results[key].append(value)
    tail = (1 - confidence) / 2
    return {key: tuple(np.quantile(values, [tail, 1 - tail])) for key, values in results.items()}


def true_value(context, target):
    return float(np.mean(np.sum(target * (np.einsum("ij,kj->ik", context, COEFFICIENTS)), axis=1)))

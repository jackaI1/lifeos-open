import numpy as np
import pytest
from bandit.core import (EpsilonGreedy, LinUCB, simulate, evaluate, fit_reward_model,
                         safe_policy, true_value, bootstrap)


def test_policies_and_logging():
    rng = np.random.default_rng(1)
    for policy in (EpsilonGreedy(3, 3, .2), LinUCB(3, 3)):
        log = simulate(200, policy, rng)
        assert log.context.shape == (200, 3)
        assert np.all((log.propensity > 0) & (log.propensity <= 1))
        assert np.isfinite(log.reward).all()


def test_support_blocks_unsupported_actions():
    target = np.array([[0., 1., 0.], [0., 0., 1.]])
    support = np.array([[.4, .05, .55], [.5, .4, .1]])
    result = safe_policy(target, support, .2)
    np.testing.assert_allclose(result, [[0, 0, 1], [1, 0, 0]])
    with pytest.raises(ValueError):
        safe_policy(target, np.zeros_like(target), .2)


def test_estimators_recover_known_value_and_bootstrap():
    rng = np.random.default_rng(42)
    train = simulate(8000, EpsilonGreedy(3, 3, .5), rng)
    log = simulate(30000, EpsilonGreedy(3, 3, .5), rng)
    model = fit_reward_model(train)
    target = np.tile([.2, .5, .3], (len(log.reward), 1))
    truth = true_value(log.context, target)
    estimates = evaluate(log, target, model)
    for estimate in estimates.values():
        assert abs(estimate - truth) < .05
    ci = bootstrap(log, target, model, rng, samples=100)
    for lo, hi in ci.values():
        assert lo < hi


def test_ips_bias_and_variance_fall_with_sample_size():
    rng = np.random.default_rng(123)
    errors = {250: [], 4000: []}
    for n in errors:
        for _ in range(80):
            log = simulate(n, EpsilonGreedy(3, 3, .5), rng)
            target = np.tile([.2, .5, .3], (n, 1))
            errors[n].append(evaluate(log, target, np.zeros((3, 3)))["ips"] - true_value(log.context, target))
    assert abs(np.mean(errors[4000])) < .03
    assert np.var(errors[4000]) < np.var(errors[250]) / 5

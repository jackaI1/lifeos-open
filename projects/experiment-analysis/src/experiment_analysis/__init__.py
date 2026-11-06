"""Restaurant configuration experiments; all bundled observations are synthetic."""

from .ab import analyze_ab, plan_sample_size
from .did import analyze_did
from .simulate import Simulation, simulate

__all__ = ["Simulation", "simulate", "analyze_ab", "analyze_did", "plan_sample_size"]

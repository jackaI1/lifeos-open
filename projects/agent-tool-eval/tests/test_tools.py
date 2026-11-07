import pytest

from agent_tool_eval.tools import Sandbox, ToolError


@pytest.mark.parametrize(
    "name,args",
    [
        ("calculator", {"expression": 2}),
        ("calculator", {"expression": "1+1", "extra": True}),
        ("file_lookup", {}),
        ("file_lookup", {"path": "../private"}),
        ("ticket_update", {"id": "T-101", "status": "deleted"}),
        ("ticket_get", {"id": 101}),
        ("unknown", {}),
    ],
)
def test_bad_arguments_are_rejected_before_execution(name, args):
    with pytest.raises(ToolError):
        Sandbox().execute(name, args)


@pytest.mark.parametrize(
    "expression", ["__import__('os').getcwd()", "2**100000", "1/0", "True + 1", "[1][0]", "1e309"]
)
def test_calculator_cannot_execute_code_or_exhaust_resources(expression):
    with pytest.raises(ToolError):
        Sandbox().execute("calculator", {"expression": expression})


def test_calculation_and_file_results_are_real():
    sandbox = Sandbox()
    assert sandbox.execute("calculator", {"expression": "(18 + 6) / 4"}) == 6
    assert sandbox.execute("file_lookup", {"path": "inventory.json"})["sensor_count"] == 24
    assert sandbox.execute("file_lookup", {"path": "missing.json"}) == {"error": "not_found"}


def test_ticket_update_is_visible_only_in_its_own_sandbox():
    sandbox = Sandbox()
    assert (
        sandbox.execute("ticket_update", {"id": "T-101", "status": "closed"})["status"] == "closed"
    )
    assert sandbox.execute("ticket_get", {"id": "T-101"})["status"] == "closed"
    assert Sandbox().execute("ticket_get", {"id": "T-101"})["status"] == "open"
    assert sandbox.execute("ticket_get", {"id": "T-999"}) == {"error": "not_found"}

"""Declared tools over synthetic records. No host filesystem or external ticket access."""

import ast
import json
import math
import operator
from copy import deepcopy
from importlib.resources import files

from jsonschema import Draft202012Validator


class ToolError(ValueError):
    """A call cannot be validated or executed."""


def object_schema(properties, required):
    return {
        "type": "object",
        "properties": properties,
        "required": required,
        "additionalProperties": False,
    }


ID = {"type": "string", "pattern": r"^T-[0-9]{3}$"}
STATUS = {"type": "string", "enum": ["open", "in_progress", "closed"]}
SCHEMAS = {
    "file_lookup": object_schema(
        {"path": {"type": "string", "maxLength": 80, "pattern": r"^[a-z][a-z0-9_-]*\.json$"}},
        ["path"],
    ),
    "calculator": object_schema(
        {"expression": {"type": "string", "minLength": 1, "maxLength": 120}}, ["expression"]
    ),
    "ticket_get": object_schema({"id": ID}, ["id"]),
    "ticket_search": object_schema(
        {"status": STATUS, "priority": {"type": "string", "enum": ["low", "medium", "high"]}}, []
    ),
    "ticket_update": object_schema({"id": ID, "status": STATUS}, ["id", "status"]),
}
DESCRIPTIONS = {
    "file_lookup": "Read a synthetic JSON file by name: inventory.json, schedule.json, "
    "limits.json, batch.json, manual.json. Missing names return not_found.",
    "calculator": "Evaluate arithmetic using +, -, *, / and parentheses. No powers or code.",
    "ticket_get": "Read a mock ticket by ID. Missing IDs return not_found.",
    "ticket_search": "List mock tickets matching all supplied filters, sorted by ID.",
    "ticket_update": "Set a mock ticket status; return the updated ticket, or not_found.",
}
DECLARATIONS = [
    {
        "type": "function",
        "function": {"name": name, "description": DESCRIPTIONS[name], "parameters": schema},
    }
    for name, schema in SCHEMAS.items()
]
VALIDATORS = {name: Draft202012Validator(schema) for name, schema in SCHEMAS.items()}


def validate_arguments(name, arguments):
    if not isinstance(name, str) or name not in VALIDATORS:
        raise ToolError("unknown tool")
    errors = list(VALIDATORS[name].iter_errors(arguments))
    if errors:
        raise ToolError("arguments do not match declared JSON schema")


def calculate(expression):
    """Bounded arithmetic AST; never Python eval, names, calls, powers or subscripts."""
    binary = {
        ast.Add: operator.add,
        ast.Sub: operator.sub,
        ast.Mult: operator.mul,
        ast.Div: operator.truediv,
    }
    unary = {ast.UAdd: operator.pos, ast.USub: operator.neg}

    def visit(node):
        if isinstance(node, ast.Constant) and type(node.value) in (int, float):
            value = node.value
        elif isinstance(node, ast.BinOp) and type(node.op) in binary:
            value = binary[type(node.op)](visit(node.left), visit(node.right))
        elif isinstance(node, ast.UnaryOp) and type(node.op) in unary:
            value = unary[type(node.op)](visit(node.operand))
        else:
            raise ToolError("unsupported arithmetic")
        if not math.isfinite(value) or abs(value) > 1e12:
            raise ToolError("arithmetic result outside safe range")
        return value

    try:
        tree = ast.parse(expression, mode="eval")
        if sum(1 for _ in ast.walk(tree)) > 80:
            raise ToolError("expression too complex")
        return visit(tree.body)
    except (SyntaxError, ArithmeticError, RecursionError, ValueError) as exc:
        raise ToolError("invalid arithmetic") from exc


class Sandbox:
    def __init__(self):
        self.world = json.loads(files("agent_tool_eval").joinpath("data/world.json").read_text())

    def execute(self, name, arguments):
        validate_arguments(name, arguments)
        if name == "calculator":
            return calculate(arguments["expression"])
        if name == "file_lookup":
            return deepcopy(self.world["files"].get(arguments["path"], {"error": "not_found"}))
        tickets = self.world["tickets"]
        if name == "ticket_search":
            return [
                deepcopy(tickets[key])
                for key in sorted(tickets)
                if all(tickets[key][field] == value for field, value in arguments.items())
            ]
        ticket = tickets.get(arguments["id"])
        if ticket is None:
            return {"error": "not_found"}
        if name == "ticket_update":
            ticket["status"] = arguments["status"]
        return deepcopy(ticket)

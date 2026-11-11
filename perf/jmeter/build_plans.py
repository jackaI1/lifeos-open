"""Writes the four JMeter plans in plans/ from plans.json.

The plans are generated so the four files stay the same shape and cannot drift apart.
Run `python3 perf/jmeter/build_plans.py` after editing plans.json or the requests below.
tests/test_perf.py fails if the committed .jmx files are out of date.

Every value that changes between runs is a JMeter property (${__P(...)}), so run_suite.py
can override threads, duration and the access token with -J flags and no edits to the files.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from xml.sax.saxutils import escape, quoteattr

HERE = Path(__file__).resolve().parent
CONFIG = HERE / "plans.json"
OUT_DIR = HERE / "plans"

# Calendar event for the write scenario. Fictional, and inside a fixed week so reruns are comparable.
CALENDAR_BODY = (
    '{"mutationId":"${__UUID()}","id":"${__UUID()}","version":0,'
    '"title":"Fictional study block","location":"Fictional room A",'
    '"start":"2026-11-20T15:00:00.000Z","end":"2026-11-20T16:00:00.000Z","deleted":false}'
)


def _prop(name: str, value, kind: str = "string") -> str:
    if kind == "bool":
        # Accept True/False or the strings "true"/"false". A non-empty "false" string is truthy in Python.
        truthy = value is True or str(value).lower() == "true"
        return f'<boolProp name="{name}">{"true" if truthy else "false"}</boolProp>'
    if kind == "int":
        return f'<intProp name="{name}">{value}</intProp>'
    return f'<stringProp name="{name}">{escape(str(value))}</stringProp>'


def _header_manager(headers: dict[str, str]) -> str:
    items = "".join(
        '<elementProp name="" elementType="Header">'
        + _prop("Header.name", k)
        + _prop("Header.value", v)
        + "</elementProp>"
        for k, v in headers.items()
    )
    return (
        '<HeaderManager guiclass="HeaderPanel" testclass="HeaderManager" testname="Headers" enabled="true">'
        f'<collectionProp name="HeaderManager.headers">{items}</collectionProp>'
        "</HeaderManager><hashTree/>"
    )


def _arguments(args: list[tuple[str, str]]) -> str:
    items = "".join(
        '<elementProp name=' + quoteattr(name) + ' elementType="HTTPArgument">'
        '<boolProp name="HTTPArgument.always_encode">false</boolProp>'
        + _prop("Argument.value", value)
        + '<stringProp name="Argument.metadata">=</stringProp>'
        + _prop("Argument.name", name)
        + '<boolProp name="HTTPArgument.use_equals">true</boolProp>'
        "</elementProp>"
        for name, value in args
    )
    return (
        '<elementProp name="HTTPsampler.Arguments" elementType="Arguments">'
        f'<collectionProp name="Arguments.arguments">{items}</collectionProp></elementProp>'
    )


def _raw_body(body: str) -> str:
    return (
        '<elementProp name="HTTPsampler.Arguments" elementType="Arguments">'
        '<collectionProp name="Arguments.arguments"><elementProp name="" elementType="HTTPArgument">'
        '<boolProp name="HTTPArgument.always_encode">false</boolProp>'
        + _prop("Argument.value", body)
        + '<stringProp name="Argument.metadata">=</stringProp>'
        "</elementProp></collectionProp></elementProp>"
    )


def _sampler(name: str, method: str, path: str, *, body: str | None = None,
             form: list[tuple[str, str]] | None = None, expect: int = 200,
             extras: str = "") -> str:
    """One HTTP request plus the assertion that its status code is the expected one."""
    if body is not None:
        args = _raw_body(body)
        raw = "true"
    else:
        args = _arguments(form or [])
        raw = "false"
    follow = "false"
    sampler = (
        f'<HTTPSamplerProxy guiclass="HttpTestSampleGui" testclass="HTTPSamplerProxy" testname={quoteattr(name)} enabled="true">'
        + _prop("HTTPSampler.follow_redirects", follow, "bool")
        + _prop("HTTPSampler.auto_redirects", "false", "bool")
        + _prop("HTTPSampler.method", method)
        + _prop("HTTPSampler.postBodyRaw", raw, "bool")
        + args
        + _prop("HTTPSampler.path", path)
        + _prop("HTTPSampler.use_keepalive", "true", "bool")
        + _prop("HTTPSampler.implementation", "HttpClient4")
        + "</HTTPSamplerProxy><hashTree>"
        + f'<ResponseAssertion guiclass="AssertionGui" testclass="ResponseAssertion" testname="Status {expect}" enabled="true">'
        + f'<collectionProp name="Asserion.test_strings"><stringProp name="0">{expect}</stringProp></collectionProp>'
        + _prop("Assertion.test_field", "Assertion.response_code")
        + _prop("Assertion.assume_success", "false", "bool")
        + _prop("Assertion.test_type", "8", "int")
        + "</ResponseAssertion><hashTree/>"
        + extras
        + "</hashTree>"
    )
    return sampler


def _json_extractor(reference: str, path: str) -> str:
    return (
        '<JSONPostProcessor guiclass="JSONPostProcessorGui" testclass="JSONPostProcessor" testname="Extract session CSRF" enabled="true">'
        + _prop("JSONPostProcessor.referenceNames", reference)
        + _prop("JSONPostProcessor.jsonPathExprs", path)
        + _prop("JSONPostProcessor.match_numbers", "1")
        + _prop("JSONPostProcessor.defaultValues", "NO_CSRF")
        + "</JSONPostProcessor><hashTree/>"
    )


def _think_timer() -> str:
    return (
        '<ConstantTimer guiclass="ConstantTimerGui" testclass="ConstantTimer" testname="Think time" enabled="true">'
        + _prop("ConstantTimer.delay", "${__P(think_ms,0)}")
        + '</ConstantTimer><hashTree/>'
    )


def build_plan(name: str, description: str, scheduled: bool) -> str:
    """Returns the .jmx XML for one plan. The same user journey is used for every plan."""
    session_start = (
        '<OnceOnlyController guiclass="OnceOnlyControllerGui" testclass="OnceOnlyController" testname="Sign in once per user" enabled="true"/><hashTree>'
        + _sampler(
            "Sign in", "POST", "/auth/local",
            form=[("token", "${__P(token)}")], expect=303,
        )
        + _sampler("Session", "GET", "/api/session", expect=200,
                   extras=_json_extractor("csrf", "$.csrf"))
        + "</hashTree>"
    )
    calendar_read = _sampler("Calendar read", "GET", "/api/records/calendar-event?limit=200")
    calendar_write = _sampler(
        "Calendar write", "POST", "/api/actions/local-calendar",
        body=CALENDAR_BODY, expect=200,
        extras=_header_manager({"Content-Type": "application/json", "x-lifeos-csrf": "${csrf}"}),
    )
    # LifeOS has no free-text search endpoint. This is the paged task lookup the app uses to find tasks.
    search = _sampler("Search tasks", "GET", "/api/records/task?limit=50&offset=${__Random(0,40,offset)}", expect=200)

    main_controller = (
        '<elementProp name="ThreadGroup.main_controller" elementType="LoopController" guiclass="LoopControlPanel" testclass="LoopController" testname="Loop Controller" enabled="true">'
        + _prop("LoopController.continue_forever", "false", "bool")
        + _prop("LoopController.loops", "${__P(loops,-1)}")
        + "</elementProp>"
    )
    thread_group = (
        f'<ThreadGroup guiclass="ThreadGroupGui" testclass="ThreadGroup" testname={quoteattr("Users: " + name)} enabled="true">'
        + _prop("ThreadGroup.on_sample_error", "continue")
        + main_controller
        + _prop("ThreadGroup.num_threads", "${__P(threads,1)}")
        + _prop("ThreadGroup.ramp_time", "${__P(ramp,0)}")
        + _prop("ThreadGroup.scheduler", "true" if scheduled else "false", "bool")
        + _prop("ThreadGroup.duration", "${__P(duration,0)}")
        + _prop("ThreadGroup.delay", "0")
        + _prop("ThreadGroup.same_user_on_next_iteration", "true", "bool")
        + "</ThreadGroup><hashTree>"
        + session_start
        + calendar_read
        + calendar_write
        + search
        + _think_timer()
        + "</hashTree>"
    )
    defaults = (
        '<ConfigTestElement guiclass="HttpDefaultsGui" testclass="ConfigTestElement" testname="LifeOS server" enabled="true">'
        + _prop("HTTPSampler.domain", "${__P(host,127.0.0.1)}")
        + _prop("HTTPSampler.port", "${__P(port,8787)}")
        + _prop("HTTPSampler.protocol", "http")
        + "</ConfigTestElement><hashTree/>"
    )
    cookies = (
        '<CookieManager guiclass="CookiePanel" testclass="CookieManager" testname="Cookies" enabled="true">'
        '<collectionProp name="CookieManager.cookies"/>'
        + _prop("CookieManager.clearEachIteration", "false", "bool")
        + "</CookieManager><hashTree/>"
    )
    headers = _header_manager({"Origin": "${__P(origin,http://127.0.0.1:8787)}", "Accept": "application/json"})
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<jmeterTestPlan version="1.2" properties="5.0" jmeter="5.6.3">\n'
        '<hashTree>\n'
        f'<TestPlan guiclass="TestPlanGui" testclass="TestPlan" testname={quoteattr("LifeOS " + name)} enabled="true">'
        + _prop("TestPlan.comments", description)
        + _prop("TestPlan.functional_mode", "false", "bool")
        + _prop("TestPlan.serialize_threadgroups", "false", "bool")
        + '<elementProp name="TestPlan.user_defined_variables" elementType="Arguments" guiclass="ArgumentsPanel" testclass="Arguments" testname="User Defined Variables" enabled="true"><collectionProp name="Arguments.arguments"/></elementProp>'
        + _prop("TestPlan.user_define_classpath", "")
        + "</TestPlan><hashTree>"
        + defaults + cookies + headers + thread_group
        + "</hashTree></hashTree></jmeterTestPlan>\n"
    )


def main(argv: list[str]) -> int:
    config = json.loads(CONFIG.read_text(encoding="utf-8"))
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for name, plan in config["plans"].items():
        scheduled = bool(plan["properties"].get("scheduled", False))
        xml = build_plan(name, plan["description"], scheduled)
        (OUT_DIR / f"{name}.jmx").write_text(xml, encoding="utf-8")
        print(f"wrote plans/{name}.jmx")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

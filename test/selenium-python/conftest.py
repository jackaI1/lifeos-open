"""Shared Selenium setup for the LifeOS browser checks.

Every test gets one headless Chrome window that is quit in teardown, including
when the test fails. A failing test also saves a screenshot for debugging.
Set LIFEOS_TEST_URL to a disposable workspace; tools/run-selenium-tests.mjs
starts one with fictional records and sets this value.
"""
import os
import re
from pathlib import Path

import pytest
from selenium import webdriver
from selenium.webdriver.chrome.service import Service

RESULTS_DIR = Path(os.environ.get("LIFEOS_TEST_RESULTS", "test-results/selenium"))


@pytest.fixture(scope="session")
def base_url():
    url = os.environ.get("LIFEOS_TEST_URL", "").strip()
    if not url:
        raise pytest.UsageError("Set LIFEOS_TEST_URL to a disposable LifeOS workspace.")
    return url.rstrip("/")


def _chrome_options():
    options = webdriver.ChromeOptions()
    for argument in (
        "--headless=new",
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--window-size=1440,1000",
    ):
        options.add_argument(argument)
    # CHROME_BIN and CHROMEDRIVER are optional. When unset, Selenium Manager
    # finds a matching driver itself.
    if os.environ.get("CHROME_BIN"):
        options.binary_location = os.environ["CHROME_BIN"]
    return options


@pytest.fixture
def driver():
    driver_path = os.environ.get("CHROMEDRIVER")
    service = Service(executable_path=driver_path) if driver_path else Service()
    browser = webdriver.Chrome(service=service, options=_chrome_options())
    browser.set_script_timeout(15)
    try:
        yield browser
    finally:
        browser.quit()


@pytest.hookimpl(hookwrapper=True)
def pytest_runtest_makereport(item, call):
    outcome = yield
    report = outcome.get_result()
    browser = item.funcargs.get("driver")
    if report.when == "call" and report.failed and browser is not None:
        RESULTS_DIR.mkdir(parents=True, exist_ok=True)
        name = re.sub(r"[^\w.-]+", "_", item.nodeid)
        browser.save_screenshot(str(RESULTS_DIR / (name + ".png")))

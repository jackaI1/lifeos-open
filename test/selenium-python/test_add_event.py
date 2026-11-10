"""Adding an event on the Today screen, checked on screen and through the API."""
import uuid

from selenium.webdriver.common.by import By

from pages import TodayPage


def unique_title(prefix):
    return f"{prefix} {uuid.uuid4().hex[:8]}"


def test_added_event_appears_on_today_and_is_saved(driver, base_url):
    page = TodayPage(driver, base_url)
    page.open()
    today = page.today_from_api().isoformat()
    title = unique_title("Selenium fictional lab")

    page.add_event(title, start="12:00", end="13:00", location="Fictional room S-204")
    page.wait_for_schedule_title(title)

    saved = [
        item
        for item in page.api("/api/bootstrap")["records"]["calendar-event"]
        if item["data"]["title"] == title
    ]
    assert len(saved) == 1, f"expected one saved event named {title!r}"
    assert saved[0]["data"]["start"]["dateTime"].startswith(today)
    assert saved[0]["data"]["location"] == "Fictional room S-204"


def test_entered_markup_is_shown_as_text(driver, base_url):
    page = TodayPage(driver, base_url)
    page.open()
    title = '<img src=x onerror="window.lifeosInjected=true"> fictional'

    page.add_event(title, start="12:00", end="13:00")
    page.wait_for_schedule_title(title)

    assert not driver.execute_script("return window.lifeosInjected === true")
    assert driver.find_elements(By.CSS_SELECTOR, "[data-schedule-id] h3 img") == []

"""The Today schedule shows the same entries, times and titles as the API."""
from selenium.webdriver.common.by import By

from pages import TodayPage


def test_displayed_schedule_matches_the_api(driver, base_url):
    page = TodayPage(driver, base_url)
    page.open()
    timeline = page.api("/api/bootstrap")["today"]["timeline"]
    entries = [entry for entry in timeline if not entry.get("hidden")]

    rows = page.schedule_rows()
    assert len(rows) == len(entries), "the number of schedule rows differs from the API"
    rows_by_id = {row.get_attribute("data-schedule-id"): row for row in rows}
    for entry in entries:
        row = rows_by_id[entry["id"]]
        assert row.get_attribute("data-schedule-start") == entry["start"]
        assert row.find_element(By.TAG_NAME, "h3").text == entry["title"]
        assert row.find_element(By.TAG_NAME, "time").get_attribute("datetime") == entry["start"]

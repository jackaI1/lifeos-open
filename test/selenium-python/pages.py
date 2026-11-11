"""Page objects for the LifeOS screens the browser checks use.

Selectors live here, not in the tests. Waits are explicit conditions (a dialog
closing, a row appearing); the tests never sleep for a fixed time.
"""
import json
import re
from datetime import date

from selenium.common.exceptions import StaleElementReferenceException
from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait


def literal(text):
    """Return text as an XPath string literal, including text with quotes."""
    if "'" not in text:
        return "'" + text + "'"
    if '"' not in text:
        return '"' + text + '"'
    pieces = ["'" + part + "'" for part in text.split("'")]
    return "concat(" + ", \"'\", ".join(pieces) + ")"


def display_day(day):
    """The short form the app prints for a date-only deadline, e.g. Dec 1."""
    return f"{day:%b} {day.day}"


class LifeOSPage:
    def __init__(self, driver, base_url):
        self.driver = driver
        self.base_url = base_url
        self.wait = WebDriverWait(
            driver, 20, ignored_exceptions=(StaleElementReferenceException,)
        )

    def open(self, route):
        self.driver.get(f"{self.base_url}/#{route}")
        self.wait.until(EC.presence_of_element_located((By.CSS_SELECTOR, "#main h1")))

    def button(self, name):
        xpath = f"//button[normalize-space(.)={literal(name)} or @aria-label={literal(name)}]"
        # Row option menus keep their items in the page, hidden, after they have been opened.
        # The first match can therefore be a hidden copy, so the first clickable match is used.
        def clickable(driver):
            for element in driver.find_elements(By.XPATH, xpath):
                if element.is_displayed() and element.is_enabled():
                    return element
            return False

        return self.wait.until(clickable)

    def field(self, label):
        # The app wraps each input in its label, so the label text identifies it.
        xpath = (
            f"//label[normalize-space(.)={literal(label)}]//input"
            f" | //label[normalize-space(.)={literal(label)}]//textarea"
        )
        return self.wait.until(EC.visibility_of_element_located((By.XPATH, xpath)))

    def type_text(self, element, text):
        element.clear()
        element.send_keys(text)

    def set_value_directly(self, element, value):
        """Set a date or time input and fire the events the app listens for.

        Typing into native date and time pickers depends on the browser locale,
        so the value is written and then announced with input and change events.
        """
        self.driver.execute_script(
            "const input = arguments[0];"
            "input.value = arguments[1];"
            "input.dispatchEvent(new Event('input', {bubbles: true}));"
            "input.dispatchEvent(new Event('change', {bubbles: true}));",
            element,
            value,
        )

    def wait_for_dialog_to_close(self):
        self.wait.until(EC.invisibility_of_element_located((By.ID, "dialog")))

    def api(self, path):
        raw = self.driver.execute_async_script(
            "const done = arguments[arguments.length - 1];"
            "fetch(arguments[0])"
            ".then(response => { if (!response.ok) { throw new Error('HTTP ' + response.status); } return response.text(); })"
            ".then(done)"
            ".catch(error => done(JSON.stringify({error: String(error)})));",
            path,
        )
        payload = json.loads(raw)
        if isinstance(payload, dict) and "error" in payload:
            raise AssertionError(f"{path} failed: {payload['error']}")
        return payload

    def today_from_api(self):
        return date.fromisoformat(self.api("/api/bootstrap")["today"]["date"])


class TodayPage(LifeOSPage):
    def open(self):
        super().open("today")
        self.wait.until(lambda d: len(self.schedule_rows()) > 0)

    def schedule_rows(self):
        return self.driver.find_elements(By.CSS_SELECTOR, "[data-schedule-id]")

    def schedule_titles(self):
        return [h.text for h in self.driver.find_elements(By.CSS_SELECTOR, "[data-schedule-id] h3")]

    def add_event(self, title, start, end, location=""):
        self.button("Add event").click()
        self.type_text(self.field("Event title"), title)
        self.set_value_directly(self.field("Start time"), start)
        self.set_value_directly(self.field("End time"), end)
        if location:
            self.type_text(self.field("Location"), location)
        self.button("Save event").click()
        self.wait_for_dialog_to_close()

    def wait_for_schedule_title(self, title):
        self.wait.until(lambda d: title in self.schedule_titles())


class SchoolPage(LifeOSPage):
    def open(self):
        super().open("school")
        self.wait.until(EC.element_to_be_clickable((By.XPATH, "//button[normalize-space(.)='New task']")))

    def _card_xpath(self, title):
        # The course code is a child of the heading, so match the title as a substring.
        return f"//article[.//h3[contains(., {literal(title)})]]"

    def card(self, title):
        return self.wait.until(EC.visibility_of_element_located((By.XPATH, self._card_xpath(title))))

    def card_text(self, title):
        # Non-waiting read, so polling inside wait.until does not nest timeouts.
        cards = self.driver.find_elements(By.XPATH, self._card_xpath(title))
        return cards[0].text if cards else ""

    def create_task(self, title, due_day):
        self.button("New task").click()
        self.type_text(self.field("Task title"), title)
        self.set_value_directly(self.field("Due date"), due_day.isoformat())
        self.button("Save task").click()
        self.wait_for_dialog_to_close()
        self.card(title)

    def move_deadline(self, title, due_day):
        card = self.card(title)
        card.find_element(By.XPATH, ".//button[@aria-label='Task options']").click()
        self.button("Edit task").click()
        self.set_value_directly(self.field("Due date"), due_day.isoformat())
        self.button("Save task").click()
        self.wait_for_dialog_to_close()

    def wait_for_deadline_text(self, title, due_day):
        # The lookahead stops "Dec 1" from matching inside "Dec 14".
        pattern = re.compile(r"Due " + re.escape(display_day(due_day)) + r"(?!\d)")
        self.wait.until(lambda d: pattern.search(self.card_text(title)) is not None)

    def saved_task(self, title):
        matches = [
            item for item in self.api("/api/records/task")["items"]
            if item["data"].get("title") == title
        ]
        assert len(matches) == 1, f"expected one saved task named {title!r}, found {len(matches)}"
        return matches[0]

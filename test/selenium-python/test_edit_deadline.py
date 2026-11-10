"""Creating a task with a deadline, then moving that deadline in the School screen."""
import uuid
from datetime import timedelta

from pages import SchoolPage


def test_task_deadline_is_created_then_moved(driver, base_url):
    page = SchoolPage(driver, base_url)
    page.open()
    today = page.today_from_api()
    first_due = today + timedelta(days=14)
    second_due = today + timedelta(days=21)
    title = f"Selenium fictional task {uuid.uuid4().hex[:8]}"

    page.create_task(title, first_due)
    page.wait_for_deadline_text(title, first_due)
    assert page.saved_task(title)["data"]["dueDate"] == first_due.isoformat()

    page.move_deadline(title, second_due)
    page.wait_for_deadline_text(title, second_due)
    assert page.saved_task(title)["data"]["dueDate"] == second_due.isoformat()

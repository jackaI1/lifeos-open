package ca.jacklai.lifeos

import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import ca.jacklai.lifeos.core.*
import java.time.Instant
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

class TodayScreenTest {
    @get:Rule val compose = createComposeRule()
    private val now = Instant.parse("2026-11-05T15:00:00Z")
    private val snapshot = Snapshot(now.toEpochMilli(), "America/Toronto",
        listOf(Event("lecture", "Materials lecture", "Example lecture hall", now.minusSeconds(1800).toEpochMilli(), now.plusSeconds(1200).toEpochMilli())),
        listOf(Deadline("report", "Submit the lab report", "Example course", now.plusSeconds(3600).toEpochMilli(), false),
            Deadline("done", "Completed quiz", "Example course", now.toEpochMilli(), true)))
    private fun show(state: TodayState, at: Instant = now, refresh: () -> Unit = {}) {
        compose.setContent { LifeOSTheme { TodayScreen(state, at, refresh) } }
    }
    @Test fun scheduleShowsTimesAndLocation() {
        show(TodayState(CompanionState(snapshot, Status.LIVE, true), false))
        compose.onNodeWithText("Materials lecture").assertIsDisplayed()
        compose.onNodeWithText("09:30 to 10:20").assertIsDisplayed()
        compose.onNodeWithText("Example lecture hall").assertIsDisplayed()
    }
    @Test fun onlyUnfinishedDeadlinesAreShown() {
        show(TodayState(CompanionState(snapshot, Status.LIVE, true), false))
        compose.onNodeWithText("Submit the lab report").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Completed quiz").assertDoesNotExist()
    }
    @Test fun refreshCallsActionAndDisablesDuringDownload() {
        val state = mutableStateOf(TodayState(CompanionState(), false))
        var calls = 0
        compose.setContent { LifeOSTheme { TodayScreen(state.value, now) { calls++; state.value = state.value.copy(refreshing = true) } } }
        compose.onNodeWithTag("refresh").performClick()
        compose.onNodeWithTag("refresh").assertIsNotEnabled()
        compose.onNodeWithTag("loading").assertIsDisplayed()
        assertEquals(1, calls)
    }
    @Test fun retryRecoversFromFirstDownloadFailure() {
        val state = mutableStateOf(TodayState(CompanionState(status = Status.UNAVAILABLE), false))
        compose.setContent { LifeOSTheme { TodayScreen(state.value, now) { state.value = TodayState(CompanionState(snapshot, Status.LIVE, true), false) } } }
        compose.onNodeWithText("No saved schedule yet").assertIsDisplayed()
        compose.onNodeWithText("Try again").performClick()
        compose.onNodeWithText("Materials lecture").assertIsDisplayed()
        compose.onNodeWithTag("connectionStatus").assertTextEquals("Demo updated and saved on this phone")
    }
    @Test fun failedRefreshKeepsSavedScheduleVisible() {
        show(TodayState(CompanionState(snapshot, Status.OFFLINE, true), false))
        compose.onNodeWithTag("connectionStatus").assertTextEquals("Could not refresh. Showing the saved copy.")
        compose.onNodeWithText("Materials lecture").assertIsDisplayed()
    }
    @Test fun oldSnapshotDoesNotPretendToBeToday() {
        show(TodayState(CompanionState(snapshot, Status.OFFLINE, true), false), now.plusSeconds(86400))
        compose.onNodeWithTag("staleCopy").assertIsDisplayed()
        compose.onNodeWithText("No commitments for today in this copy.").assertIsDisplayed()
        compose.onNodeWithText("Materials lecture").assertDoesNotExist()
        compose.onNodeWithText("Overdue in this copy").performScrollTo().assertIsDisplayed()
    }
    @Test fun emptyListsHaveClearMessages() {
        show(TodayState(CompanionState(snapshot.copy(schedule = emptyList(), deadlines = emptyList()), Status.LIVE, true), false))
        compose.onNodeWithText("No commitments for today in this copy.").assertIsDisplayed()
        compose.onNodeWithText("No unfinished deadlines in this copy.").assertIsDisplayed()
    }
    @Test fun failedSaveHasAnHonestOfflineWarning() {
        show(TodayState(CompanionState(snapshot, Status.NOT_SAVED, false), false))
        compose.onNodeWithTag("connectionStatus").assertTextEquals("This copy could not be saved for offline use. Refresh to retry.")
        compose.onNodeWithText("Materials lecture").assertIsDisplayed()
    }
    @Test fun midnightUpdatesScheduleWithoutDownloading() {
        val time = mutableStateOf(now)
        compose.setContent { LifeOSTheme { TodayScreen(TodayState(CompanionState(snapshot, Status.SAVED, true), false), time.value) {} } }
        compose.onNodeWithText("Materials lecture").assertIsDisplayed()
        compose.runOnIdle { time.value = now.plusSeconds(86400) }
        compose.onNodeWithText("No commitments for today in this copy.").assertIsDisplayed()
        compose.onNodeWithTag("staleCopy").assertIsDisplayed()
    }
}

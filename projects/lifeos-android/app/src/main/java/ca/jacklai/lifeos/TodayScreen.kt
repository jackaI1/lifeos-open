package ca.jacklai.lifeos

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import ca.jacklai.lifeos.core.*
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

private val Blue = Color(0xFF245BB2)
private val Ink = Color(0xFF192D48)

@Composable fun LifeOSTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = lightColorScheme(primary = Blue, onPrimary = Color.White,
        background = Color(0xFFF6F8FC), surface = Color.White, onSurface = Ink, onBackground = Ink), content = content)
}

@Composable fun TodayScreen(state: TodayState, now: Instant, onRefresh: () -> Unit) {
    val snapshot = state.content.snapshot
    val zone = snapshot?.zone ?: TORONTO
    val uri = LocalUriHandler.current
    Scaffold { padding ->
        LazyColumn(Modifier.fillMaxSize().padding(padding).testTag("agenda"),
            contentPadding = PaddingValues(horizontal = 24.dp, vertical = 20.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)) {
            item {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Text("Today", style = MaterialTheme.typography.headlineLarge, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                    Button(onClick = onRefresh, enabled = !state.refreshing, modifier = Modifier.testTag("refresh")) { Text("Refresh") }
                }
                Text(format(now.toEpochMilli(), "EEEE, MMMM d", zone), style = MaterialTheme.typography.titleMedium)
                Text("LifeOS public demo", style = MaterialTheme.typography.bodyMedium)
            }
            item {
                Surface(color = Color(0xFFE8EFFB), shape = MaterialTheme.shapes.medium) {
                    Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text(statusText(state), fontWeight = FontWeight.Medium, modifier = Modifier.testTag("connectionStatus"))
                        if (state.refreshing) LinearProgressIndicator(Modifier.fillMaxWidth().testTag("loading"))
                        if (snapshot != null) {
                            Text("Last downloaded ${format(snapshot.fetchedAt, "MMM d, yyyy 'at' HH:mm", zone)}", style = MaterialTheme.typography.bodySmall)
                            if (!snapshot.isFromSameDay(now)) Text("This saved copy is from an earlier day. Refresh for a current demo schedule.", modifier = Modifier.testTag("staleCopy"))
                        }
                    }
                }
            }
            if (snapshot == null && !state.refreshing) {
                item {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text("No saved schedule yet", style = MaterialTheme.typography.titleLarge)
                        Text("Connect to the internet and tap Try again. After the first download, this phone can show the saved copy offline.")
                        OutlinedButton(onClick = onRefresh) { Text("Try again") }
                    }
                }
            }
            if (snapshot != null) {
                item { SectionTitle("Today's schedule") }
                val events = snapshot.eventsOn(now)
                if (events.isEmpty()) item { Text("No commitments for today in this copy.") }
                items(events, key = { "event-${it.id}" }) { event ->
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                        Box(Modifier.width(4.dp).height(64.dp).background(Blue))
                        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text("${format(event.start, "HH:mm", zone)} to ${format(event.end, "HH:mm", zone)}", color = Blue, fontWeight = FontWeight.Medium)
                            Text(event.title, style = MaterialTheme.typography.titleMedium)
                            if (event.location.isNotBlank()) Text(event.location, style = MaterialTheme.typography.bodyMedium)
                        }
                    }
                }
                item { SectionTitle("Upcoming deadlines") }
                if (snapshot.pendingDeadlines.isEmpty()) item { Text("No unfinished deadlines in this copy.") }
                items(snapshot.pendingDeadlines, key = { "deadline-${it.id}" }) { deadline ->
                    Column(Modifier.fillMaxWidth().padding(bottom = 8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text(deadline.title, style = MaterialTheme.typography.titleMedium)
                        Text(deadline.course, style = MaterialTheme.typography.bodyMedium)
                        Text(format(deadline.due, "MMM d, yyyy 'at' HH:mm", zone), fontWeight = FontWeight.Medium)
                        if (deadline.due < now.toEpochMilli()) Text("Overdue in this copy", color = Color(0xFF9D3500), fontWeight = FontWeight.Medium)
                        HorizontalDivider(Modifier.padding(top = 12.dp))
                    }
                }
            }
            item {
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text("Fictional examples, not your personal workspace. Times are in ${zone.id}. Refresh starts a new demo day; saved dates stay fixed offline.", style = MaterialTheme.typography.bodySmall)
                    TextButton(onClick = { uri.openUri("https://lifeos.jacklai.ca") }) { Text("Open LifeOS in the browser") }
                    TextButton(onClick = { uri.openUri(DEMO_ENDPOINT) }) { Text("View the public demo feed") }
                }
            }
        }
    }
}

@Composable private fun SectionTitle(text: String) {
    Text(text, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = 8.dp))
}
private fun format(millis: Long, pattern: String, zone: ZoneId): String =
    DateTimeFormatter.ofPattern(pattern, Locale.getDefault()).withZone(zone).format(Instant.ofEpochMilli(millis))

private fun statusText(state: TodayState): String = if (state.refreshing) "Downloading the demo…" else when (state.content.status) {
    Status.READY -> "Ready to download"
    Status.SAVED -> "Showing the saved copy"
    Status.LIVE -> "Demo updated and saved on this phone"
    Status.OFFLINE -> if (state.content.saved) "Could not refresh. Showing the saved copy." else "Could not refresh. This copy is not saved for offline use."
    Status.UNAVAILABLE -> "Could not download. Check your connection and retry."
    Status.NOT_SAVED -> "This copy could not be saved for offline use. Refresh to retry."
}

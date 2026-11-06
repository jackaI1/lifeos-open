package ca.jacklai.lifeos.core

import java.time.Instant
import java.time.ZoneId
import org.junit.Assert.*
import org.junit.Test

class DemoFeedTest {
    private val now = Instant.parse("2026-11-05T15:00:00Z")
    private fun feed(zone: String = "America/Toronto", offset: Int = 0, start: String = "09:30", end: String = "10:20") = """
        {"schemaVersion":1,"timeZone":"$zone","schedule":[
        {"id":"lecture","title":"Materials lecture","location":"Example hall","dayOffset":$offset,"start":"$start","end":"$end"}],
        "deadlines":[{"id":"report","title":"Lab report","course":"Example course","dayOffset":2,"due":"23:59","completed":false}]}
    """.trimIndent()
    private fun resolve(text: String = feed(), at: Instant = now) = DemoFeed.resolve(text.toByteArray(), at)
    private fun rejects(text: String, at: Instant = now) { assertThrows(Exception::class.java) { resolve(text, at) } }

    @Test fun `public fixture resolves today and future deadlines`() {
        val bytes = javaClass.getResourceAsStream("/today.json")!!.use { it.readBytes() }
        val snapshot = DemoFeed.resolve(bytes, now)
        assertEquals(2, snapshot.eventsOn(now).size)
        assertEquals(3, snapshot.pendingDeadlines.size)
        assertEquals(Instant.parse("2026-11-05T14:30:00Z").toEpochMilli(), snapshot.schedule.first().start)
        assertEquals(Instant.parse("2026-11-08T04:59:00Z").toEpochMilli(), snapshot.pendingDeadlines[1].due)
    }
    @Test fun `Toronto day wins over UTC and device day`() {
        val snapshot = resolve(at = Instant.parse("2026-11-06T02:00:00Z"))
        assertEquals(Instant.parse("2026-11-05T14:30:00Z").toEpochMilli(), snapshot.schedule.first().start)
    }
    @Test fun `day offset crosses month and year`() {
        val snapshot = resolve(feed(offset = 1), Instant.parse("2026-12-31T17:00:00Z"))
        assertEquals(Instant.parse("2027-01-01T14:30:00Z").toEpochMilli(), snapshot.schedule.first().start)
    }
    @Test fun `leap day is a calendar day`() {
        val snapshot = resolve(feed(offset = 1), Instant.parse("2028-02-28T17:00:00Z"))
        assertEquals("2028-02-29", Instant.ofEpochMilli(snapshot.schedule.first().start).atZone(TORONTO).toLocalDate().toString())
    }
    @Test fun `spring change adds calendar days instead of 24 hours`() {
        val snapshot = resolve(feed(offset = 1), Instant.parse("2026-03-07T17:00:00Z"))
        assertEquals(Instant.parse("2026-03-08T13:30:00Z").toEpochMilli(), snapshot.schedule.first().start)
    }
    @Test fun `nonexistent spring time is rejected`() {
        rejects(feed(start = "02:30", end = "03:30"), Instant.parse("2026-03-08T16:00:00Z"))
    }
    @Test fun `autumn ambiguous time uses first occurrence`() {
        val snapshot = resolve(feed(start = "01:30", end = "02:30"), Instant.parse("2026-11-01T16:00:00Z"))
        assertEquals(Instant.parse("2026-11-01T05:30:00Z").toEpochMilli(), snapshot.schedule.first().start)
    }
    @Test fun `saved copy does not move when day changes`() {
        val snapshot = resolve()
        val reopened = SnapshotCodec.decode(SnapshotCodec.encode(snapshot))
        val tomorrow = now.plusSeconds(86400)
        assertEquals(snapshot, reopened)
        assertFalse(reopened.isFromSameDay(tomorrow))
        assertTrue(reopened.eventsOn(tomorrow).isEmpty())
        assertEquals(snapshot.pendingDeadlines, reopened.pendingDeadlines)
    }
    @Test fun `staleness changes at feed midnight`() {
        val snapshot = resolve()
        assertTrue(snapshot.isFromSameDay(Instant.parse("2026-11-06T04:59:59Z")))
        assertFalse(snapshot.isFromSameDay(Instant.parse("2026-11-06T05:00:00Z")))
    }
    @Test fun `completed deadlines are hidden and others sorted stably`() {
        val snapshot = resolve().copy(deadlines = listOf(
            Deadline("z", "Last", "Example", 2, false), Deadline("done", "Done", "Example", 0, true),
            Deadline("b", "Second", "Example", 1, false), Deadline("a", "First", "Example", 1, false)))
        assertEquals(listOf("a", "b", "z"), snapshot.pendingDeadlines.map { it.id })
    }
    @Test fun `events sorted by time then id`() {
        val snapshot = resolve().copy(schedule = listOf(
            Event("z", "Later", "", 2000, 3000), Event("b", "Same time", "", 1000, 2000), Event("a", "First", "", 1000, 1500)))
        assertEquals(listOf("a", "b", "z"), snapshot.eventsOn(Instant.EPOCH).map { it.id })
    }
    @Test fun `unknown fields remain forward compatible`() { resolve(feed().replace("\"schemaVersion\":1", "\"extra\":42,\"schemaVersion\":1")) }
    @Test fun `invalid timezone rejected`() { rejects(feed(zone = "Not/AZone")) }
    @Test fun `unsupported version rejected`() { rejects(feed().replace("\"schemaVersion\":1", "\"schemaVersion\":2")) }
    @Test fun `bad clock values rejected`() { listOf("9:30", "24:00", "10:60", "noon").forEach { rejects(feed(start = it)) } }
    @Test fun `offset bounds enforced`() { listOf(-8, 31).forEach { rejects(feed(offset = it)) }; resolve(feed(offset = -7)); resolve(feed(offset = 30)) }
    @Test fun `end must be after start`() { rejects(feed(end = "09:30")); rejects(feed(end = "08:00")) }
    @Test fun `duplicate ids rejected`() {
        val event = """{"id":"same","title":"Example","location":"","dayOffset":0,"start":"09:00","end":"10:00"}"""
        rejects("""{"schemaVersion":1,"timeZone":"UTC","schedule":[$event,$event],"deadlines":[]}""")
    }
    @Test fun `blank title and missing fields rejected`() { rejects(feed().replace("Materials lecture", " ")); rejects("{}") }
    @Test fun `oversized feed rejected`() { assertThrows(Exception::class.java) { DemoFeed.resolve(ByteArray(MAX_BYTES + 1), now) } }
    @Test fun `too many rows rejected`() {
        val rows = (0..500).joinToString(",") { """{"id":"$it","title":"Example","location":"","dayOffset":0,"start":"09:00","end":"10:00"}""" }
        rejects("""{"schemaVersion":1,"timeZone":"UTC","schedule":[$rows],"deadlines":[]}""")
    }
    @Test fun `corrupt snapshots rejected`() {
        assertThrows(Exception::class.java) { SnapshotCodec.decode("{}".toByteArray()) }
        assertThrows(Exception::class.java) { SnapshotCodec.encode(resolve().copy(timeZone = "Invalid/Zone")) }
        assertThrows(Exception::class.java) { SnapshotCodec.encode(resolve().copy(schedule = listOf(Event("x", "X", "", 10, 1)))) }
    }
}

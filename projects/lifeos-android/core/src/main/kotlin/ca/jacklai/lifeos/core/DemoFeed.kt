package ca.jacklai.lifeos.core

import java.time.Instant
import java.time.LocalTime
import java.time.ZoneId
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

const val MAX_BYTES = 1_048_576
val TORONTO: ZoneId = ZoneId.of("America/Toronto")
private val json = Json { ignoreUnknownKeys = true }

@Serializable
data class Event(val id: String, val title: String, val location: String, val start: Long, val end: Long)
@Serializable
data class Deadline(val id: String, val title: String, val course: String, val due: Long, val completed: Boolean)
@Serializable
data class Snapshot(val fetchedAt: Long, val timeZone: String, val schedule: List<Event>, val deadlines: List<Deadline>) {
    val zone: ZoneId get() = ZoneId.of(timeZone)
    fun eventsOn(now: Instant): List<Event> = schedule.filter {
        Instant.ofEpochMilli(it.start).atZone(zone).toLocalDate() == now.atZone(zone).toLocalDate()
    }.sortedWith(compareBy({ it.start }, { it.id }))
    val pendingDeadlines: List<Deadline> get() = deadlines.filterNot { it.completed }.sortedWith(compareBy({ it.due }, { it.id }))
    fun isFromSameDay(now: Instant): Boolean = Instant.ofEpochMilli(fetchedAt).atZone(zone).toLocalDate() == now.atZone(zone).toLocalDate()
}

@Serializable
private data class FeedEvent(val id: String, val title: String, val location: String, val dayOffset: Int, val start: String, val end: String)
@Serializable
private data class FeedDeadline(val id: String, val title: String, val course: String, val dayOffset: Int, val due: String, val completed: Boolean)
@Serializable
private data class Feed(val schemaVersion: Int, val timeZone: String, val schedule: List<FeedEvent>, val deadlines: List<FeedDeadline>)

object DemoFeed {
    fun resolve(bytes: ByteArray, now: Instant): Snapshot {
        require(bytes.size <= MAX_BYTES) { "Feed is too large" }
        val feed = json.decodeFromString<Feed>(bytes.toString(Charsets.UTF_8))
        require(feed.schemaVersion == 1) { "Unsupported feed version" }
        val zone = ZoneId.of(feed.timeZone)
        val today = now.atZone(zone).toLocalDate()
        require(feed.schedule.size <= 500 && feed.deadlines.size <= 500)
        fun resolveTime(time: String, offset: Int): Long {
            require(offset in -7..30 && Regex("[0-9]{2}:[0-9]{2}").matches(time))
            val local = today.plusDays(offset.toLong()).atTime(LocalTime.parse(time))
            // No silent clock shift in a spring-forward gap. In an autumn overlap,
            // choose the first occurrence, matching the iOS companion.
            val offsets = zone.rules.getValidOffsets(local)
            require(offsets.isNotEmpty()) { "Nonexistent local time" }
            return local.toInstant(offsets.first()).toEpochMilli()
        }
        val snapshot = Snapshot(now.toEpochMilli(), feed.timeZone,
            feed.schedule.map {
                Event(it.id, it.title, it.location, resolveTime(it.start, it.dayOffset), resolveTime(it.end, it.dayOffset))
            }.sortedWith(compareBy({ it.start }, { it.id })),
            feed.deadlines.map { Deadline(it.id, it.title, it.course, resolveTime(it.due, it.dayOffset), it.completed) })
        return SnapshotCodec.validate(snapshot)
    }
}

object SnapshotCodec {
    fun encode(snapshot: Snapshot): ByteArray = json.encodeToString(validate(snapshot)).toByteArray(Charsets.UTF_8).also {
        require(it.size <= MAX_BYTES)
    }
    fun decode(bytes: ByteArray): Snapshot {
        require(bytes.size <= MAX_BYTES)
        return validate(json.decodeFromString<Snapshot>(bytes.toString(Charsets.UTF_8)))
    }
    internal fun validate(snapshot: Snapshot): Snapshot {
        snapshot.zone
        Instant.ofEpochMilli(snapshot.fetchedAt)
        require(snapshot.schedule.size <= 500 && snapshot.deadlines.size <= 500)
        require(snapshot.schedule.map { it.id }.toSet().size == snapshot.schedule.size)
        require(snapshot.deadlines.map { it.id }.toSet().size == snapshot.deadlines.size)
        snapshot.schedule.forEach { require(it.id.isNotBlank() && it.title.isNotBlank() && it.end > it.start) }
        snapshot.deadlines.forEach { require(it.id.isNotBlank() && it.title.isNotBlank()) }
        return snapshot
    }
}

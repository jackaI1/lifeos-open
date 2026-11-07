package ca.jacklai.lifeos.core

import java.time.Clock

fun interface FeedSource { fun download(): ByteArray }
interface SnapshotStore {
    fun read(): ByteArray?
    /** Replace the complete previous snapshot or leave it unchanged on failure. */
    fun write(bytes: ByteArray)
}
enum class Status { READY, SAVED, LIVE, OFFLINE, UNAVAILABLE, NOT_SAVED }
data class CompanionState(val snapshot: Snapshot? = null, val status: Status = Status.READY, val saved: Boolean = false)

/** Blocking IO, called on the IO dispatcher by Android. Serializes reads and refreshes. */
class CompanionRepository(private val source: FeedSource, private val store: SnapshotStore, private val clock: Clock = Clock.systemUTC()) {
    private var state = CompanionState()
    @Synchronized fun open(): CompanionState {
        state = try {
            store.read()?.let { CompanionState(SnapshotCodec.decode(it), Status.SAVED, true) } ?: CompanionState()
        } catch (_: Exception) { CompanionState() }
        return state
    }
    @Synchronized fun refresh(): CompanionState {
        val snapshot = try {
            DemoFeed.resolve(source.download(), clock.instant())
        } catch (_: Exception) {
            state = state.copy(status = if (state.snapshot == null) Status.UNAVAILABLE else Status.OFFLINE)
            return state
        }
        state = try {
            store.write(SnapshotCodec.encode(snapshot))
            CompanionState(snapshot, Status.LIVE, true)
        } catch (_: Exception) { CompanionState(snapshot, Status.NOT_SAVED, false) }
        return state
    }
}

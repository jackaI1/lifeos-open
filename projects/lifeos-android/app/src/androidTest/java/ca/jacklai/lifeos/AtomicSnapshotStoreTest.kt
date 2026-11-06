package ca.jacklai.lifeos

import android.util.AtomicFile
import androidx.test.platform.app.InstrumentationRegistry
import ca.jacklai.lifeos.core.*
import java.io.File
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset
import org.junit.Assert.*
import org.junit.Test

class AtomicSnapshotStoreTest {
    private fun withFile(test: (File) -> Unit) {
        val directory = File(InstrumentationRegistry.getInstrumentation().targetContext.cacheDir, "atomic-test-${System.nanoTime()}")
        check(directory.mkdirs())
        try { test(File(directory, "snapshot.json")) } finally { directory.deleteRecursively() }
    }
    @Test fun atomicStorePersistsAcrossNewInstances() = withFile { file ->
        assertNull(AtomicSnapshotStore(file).read())
        AtomicSnapshotStore(file).write("first".toByteArray())
        assertArrayEquals("first".toByteArray(), AtomicSnapshotStore(file).read())
        AtomicSnapshotStore(file).write("second".toByteArray())
        assertArrayEquals("second".toByteArray(), AtomicSnapshotStore(file).read())
    }
    @Test fun interruptedAtomicWritePreservesPreviousCompleteCopy() = withFile { file ->
        val store = AtomicSnapshotStore(file)
        store.write("complete".toByteArray())
        val atomic = AtomicFile(file)
        val unfinished = atomic.startWrite()
        unfinished.write("partial".toByteArray())
        // Simulate a process stopping before finishWrite, leaving the staged file.
        unfinished.close()
        assertArrayEquals("complete".toByteArray(), AtomicSnapshotStore(file).read())
    }
    @Test fun realStoreReopensResolvedDatesOffline() = withFile { file ->
        val feed = """{"schemaVersion":1,"timeZone":"America/Toronto","schedule":[{"id":"lecture","title":"Materials lecture","location":"Example hall","dayOffset":0,"start":"09:30","end":"10:20"}],"deadlines":[]}""".toByteArray()
        val clock = Clock.fixed(Instant.parse("2026-11-05T15:00:00Z"), ZoneOffset.UTC)
        val online = CompanionRepository(FeedSource { feed }, AtomicSnapshotStore(file), clock).refresh()
        val offline = CompanionRepository(FeedSource { error("Offline") }, AtomicSnapshotStore(file), Clock.offset(clock, java.time.Duration.ofDays(1)))
        assertEquals(online.snapshot, offline.open().snapshot)
        val state = offline.refresh()
        assertEquals(Status.OFFLINE, state.status)
        assertEquals(online.snapshot, state.snapshot)
        assertTrue(state.snapshot!!.eventsOn(clock.instant().plusSeconds(86400)).isEmpty())
    }
    @Test fun oversizedReplacementLeavesPreviousCopy() = withFile { file ->
        val store = AtomicSnapshotStore(file)
        store.write("complete".toByteArray())
        assertThrows(Exception::class.java) { store.write(ByteArray(MAX_BYTES + 1)) }
        assertArrayEquals("complete".toByteArray(), store.read())
    }
}

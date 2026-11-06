package ca.jacklai.lifeos.core

import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset
import org.junit.Assert.*
import org.junit.Test

class CompanionRepositoryTest {
    private val now = Instant.parse("2026-11-05T15:00:00Z")
    private val clock = Clock.fixed(now, ZoneOffset.UTC)
    private val fixture = javaClass.getResourceAsStream("/today.json")!!.use { it.readBytes() }
    private class MemoryStore : SnapshotStore {
        var bytes: ByteArray? = null
        var failWrite = false
        override fun read() = bytes
        override fun write(bytes: ByteArray) { if (failWrite) error("Disk full"); this.bytes = bytes }
    }
    @Test fun `first launch without a saved copy is ready`() {
        assertEquals(Status.READY, CompanionRepository(FeedSource { fixture }, MemoryStore(), clock).open().status)
    }
    @Test fun `refresh saves a fully resolved snapshot`() {
        val store = MemoryStore()
        val state = CompanionRepository(FeedSource { fixture }, store, clock).refresh()
        assertEquals(Status.LIVE, state.status)
        assertTrue(state.saved)
        assertEquals(state.snapshot, SnapshotCodec.decode(store.bytes!!))
    }
    @Test fun `offline restart retains original dates`() {
        val store = MemoryStore()
        val original = CompanionRepository(FeedSource { fixture }, store, clock).refresh().snapshot
        val offline = CompanionRepository(FeedSource { error("No connection") }, store, Clock.fixed(now.plusSeconds(86400), ZoneOffset.UTC))
        assertEquals(Status.SAVED, offline.open().status)
        val failed = offline.refresh()
        assertEquals(Status.OFFLINE, failed.status)
        assertEquals(original, failed.snapshot)
        assertTrue(failed.saved)
    }
    @Test fun `first offline launch has a retryable unavailable state`() {
        val repository = CompanionRepository(FeedSource { error("No connection") }, MemoryStore(), clock)
        assertNull(repository.open().snapshot)
        assertEquals(Status.UNAVAILABLE, repository.refresh().status)
    }
    @Test fun `retry recovers from a download failure`() {
        var offline = true
        val repository = CompanionRepository(FeedSource { if (offline) error("Offline"); fixture }, MemoryStore(), clock)
        assertEquals(Status.UNAVAILABLE, repository.refresh().status)
        offline = false
        assertEquals(Status.LIVE, repository.refresh().status)
    }
    @Test fun `malformed refresh cannot replace the saved snapshot`() {
        val store = MemoryStore()
        val first = CompanionRepository(FeedSource { fixture }, store, clock).refresh()
        val bytes = store.bytes!!.copyOf()
        val repository = CompanionRepository(FeedSource { "{}".toByteArray() }, store, clock)
        repository.open()
        assertEquals(first.snapshot, repository.refresh().snapshot)
        assertArrayEquals(bytes, store.bytes)
    }
    @Test fun `write failure is distinct and leaves disk unchanged`() {
        val store = MemoryStore()
        val first = CompanionRepository(FeedSource { fixture }, store, clock).refresh()
        val bytes = store.bytes!!.copyOf()
        store.failWrite = true
        val repository = CompanionRepository(FeedSource { fixture }, store, Clock.fixed(now.plusSeconds(86400), ZoneOffset.UTC))
        repository.open()
        val state = repository.refresh()
        assertEquals(Status.NOT_SAVED, state.status)
        assertFalse(state.saved)
        assertNotEquals(first.snapshot, state.snapshot)
        assertArrayEquals(bytes, store.bytes)
    }
    @Test fun `save retry recovers`() {
        val store = MemoryStore().also { it.failWrite = true }
        val repository = CompanionRepository(FeedSource { fixture }, store, clock)
        assertEquals(Status.NOT_SAVED, repository.refresh().status)
        store.failWrite = false
        assertEquals(Status.LIVE, repository.refresh().status)
    }
    @Test fun `failed network after failed save never claims snapshot is persisted`() {
        val store = MemoryStore().also { it.failWrite = true }
        var failNetwork = false
        val repository = CompanionRepository(FeedSource { if (failNetwork) error("Offline"); fixture }, store, clock)
        repository.refresh()
        failNetwork = true
        assertFalse(repository.refresh().saved)
    }
    @Test fun `corrupt saved file can be replaced by a good refresh`() {
        val store = MemoryStore().also { it.bytes = "broken".toByteArray() }
        val repository = CompanionRepository(FeedSource { fixture }, store, clock)
        assertNull(repository.open().snapshot)
        assertEquals(Status.LIVE, repository.refresh().status)
    }
    @Test fun `unreadable saved file does not block downloading`() {
        val store = object : SnapshotStore {
            override fun read(): ByteArray? = error("Unreadable")
            override fun write(bytes: ByteArray) = Unit
        }
        val repository = CompanionRepository(FeedSource { fixture }, store, clock)
        assertNull(repository.open().snapshot)
        assertEquals(Status.LIVE, repository.refresh().status)
    }
}

package ca.jacklai.lifeos.core

import java.nio.file.Files
import java.nio.file.StandardCopyOption

/** Optional live check. Normal tests never require the public feed to be online. */
fun main() {
    val directory = Files.createTempDirectory("lifeos-demo-check-")
    val file = directory.resolve("snapshot.json")
    val temporary = directory.resolve("snapshot.new")
    try {
        val store = object : SnapshotStore {
            override fun read() = if (Files.exists(file)) Files.readAllBytes(file) else null
            override fun write(bytes: ByteArray) {
                Files.write(temporary, bytes)
                Files.move(temporary, file, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
            }
        }
        val fresh = CompanionRepository(FeedHttpClient(), store).refresh()
        check(fresh.status == Status.LIVE)
        check(fresh.snapshot!!.schedule.isNotEmpty() && fresh.snapshot.pendingDeadlines.isNotEmpty())
        val offline = CompanionRepository(FeedSource { error("Offline") }, store)
        check(offline.open().snapshot == fresh.snapshot)
        check(offline.refresh().status == Status.OFFLINE)
        println("Live feed resolved, atomically saved, and reopened offline: ${fresh.snapshot.schedule.size} events, ${fresh.snapshot.pendingDeadlines.size} unfinished deadlines")
    } finally {
        Files.deleteIfExists(temporary)
        Files.deleteIfExists(file)
        Files.deleteIfExists(directory)
    }
}

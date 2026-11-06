package ca.jacklai.lifeos

import android.util.AtomicFile
import ca.jacklai.lifeos.core.MAX_BYTES
import ca.jacklai.lifeos.core.SnapshotStore
import java.io.File
import java.io.FileNotFoundException

class AtomicSnapshotStore(file: File) : SnapshotStore {
    private val atomic = AtomicFile(file)
    @Synchronized override fun read(): ByteArray? = try {
        atomic.openRead().use { input ->
            val output = java.io.ByteArrayOutputStream()
            val buffer = ByteArray(8192)
            while (true) {
                val count = input.read(buffer)
                if (count == -1) break
                require(output.size() + count <= MAX_BYTES)
                output.write(buffer, 0, count)
            }
            output.toByteArray()
        }
    } catch (_: FileNotFoundException) { null }

    @Synchronized override fun write(bytes: ByteArray) {
        require(bytes.size <= MAX_BYTES)
        val stream = atomic.startWrite()
        try {
            stream.write(bytes)
            atomic.finishWrite(stream)
        } catch (error: Exception) {
            atomic.failWrite(stream)
            throw error
        }
        // AtomicFile logs some sync/rename failures instead of throwing. Confirm
        // the committed bytes before telling the user this download was saved.
        check(read()?.contentEquals(bytes) == true) { "Snapshot could not be committed" }
    }
}

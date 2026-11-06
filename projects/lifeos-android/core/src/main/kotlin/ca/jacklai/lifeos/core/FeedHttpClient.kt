package ca.jacklai.lifeos.core

import java.net.HttpURLConnection
import java.net.URL

const val DEMO_ENDPOINT = "https://raw.githubusercontent.com/jackaI1/lifeos-ios/main/demo-api/today.json"

class FeedHttpClient(private val endpoint: URL = URL(DEMO_ENDPOINT)) : FeedSource {
    override fun download(): ByteArray {
        val connection = endpoint.openConnection() as HttpURLConnection
        try {
            connection.connectTimeout = 10_000
            connection.readTimeout = 10_000
            connection.instanceFollowRedirects = false
            connection.useCaches = false
            connection.setRequestProperty("Accept", "application/json")
            check(connection.responseCode == 200) { "Demo download failed" }
            require(connection.contentLengthLong <= MAX_BYTES) { "Feed is too large" }
            return connection.inputStream.use { input ->
                val output = java.io.ByteArrayOutputStream()
                val buffer = ByteArray(8192)
                while (true) {
                    val count = input.read(buffer)
                    if (count == -1) break
                    require(output.size() + count <= MAX_BYTES) { "Feed is too large" }
                    output.write(buffer, 0, count)
                }
                output.toByteArray()
            }
        } finally { connection.disconnect() }
    }
}

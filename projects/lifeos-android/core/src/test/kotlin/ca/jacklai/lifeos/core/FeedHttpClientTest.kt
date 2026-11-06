package ca.jacklai.lifeos.core

import com.sun.net.httpserver.HttpServer
import java.net.InetSocketAddress
import java.net.URL
import org.junit.Assert.*
import org.junit.Test

class FeedHttpClientTest {
    private fun server(status: Int = 200, chunked: Boolean = false, body: ByteArray = "demo".toByteArray(), block: (FeedHttpClient) -> Unit) {
        val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        try {
            server.createContext("/today.json") { exchange ->
                try {
                    exchange.sendResponseHeaders(status, if (chunked) 0 else body.size.toLong())
                    exchange.responseBody.use { it.write(body) }
                } finally { exchange.close() }
            }
            server.start()
            block(FeedHttpClient(URL("http://127.0.0.1:${server.address.port}/today.json")))
        } finally { server.stop(0) }
    }
    @Test fun `successful HTTP response returns exact bytes`() { server { assertArrayEquals("demo".toByteArray(), it.download()) } }
    @Test fun `HTTP errors are not parsed as feeds`() { server(status = 503) { client -> assertThrows(Exception::class.java) { client.download() } } }
    @Test fun `redirect response is not followed`() { server(status = 302) { client -> assertThrows(Exception::class.java) { client.download() } } }
    @Test fun `oversized declared body rejected`() { server(body = ByteArray(MAX_BYTES + 1)) { client -> assertThrows(Exception::class.java) { client.download() } } }
    @Test fun `oversized chunked body rejected`() { server(chunked = true, body = ByteArray(MAX_BYTES + 1)) { client -> assertThrows(Exception::class.java) { client.download() } } }
}

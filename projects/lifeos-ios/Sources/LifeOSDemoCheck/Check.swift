import Foundation
import LifeOSCore

@main
struct LiveDemoCheck {
    @MainActor static func main() async throws {
        let url = CommandLine.arguments.dropFirst().first.flatMap(URL.init(string:)) ?? DemoHTTP.endpoint
        guard url.scheme == "https" else { throw FeedError.invalidData }
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let cache = SnapshotCache(url: directory.appendingPathComponent("snapshot.json"))
        let store = CompanionStore(cache: cache, transport: { _ in try await DemoHTTP.fetch(url) })
        await store.refresh()
        guard store.status == .live, let snapshot = store.snapshot else { throw FeedError.invalidResponse }
        let offline = CompanionStore(cache: cache, transport: { _ in throw URLError(.notConnectedToInternet) })
        offline.restore()
        await offline.refresh()
        guard offline.status == .offline, offline.snapshot == snapshot else { throw FeedError.invalidData }
        print("Live HTTPS download: \(snapshot.events(on: Date()).count) commitments today, \(snapshot.pendingDeadlines.count) deadlines; offline relaunch preserved the saved snapshot.")
    }
}

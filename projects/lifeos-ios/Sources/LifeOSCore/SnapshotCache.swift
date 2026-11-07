import Foundation

public struct SnapshotCache: Sendable {
    public let url: URL
    public init(url: URL) { self.url = url }

    public static var application: SnapshotCache {
        let directory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("LifeOSCompanion", isDirectory: true)
        return SnapshotCache(url: directory.appendingPathComponent("snapshot-v1.json"))
    }

    public func read() throws -> Snapshot {
        let data = try Data(contentsOf: url)
        guard data.count <= 1_048_576 else { throw FeedError.invalidData }
        let snapshot = try JSONDecoder().decode(Snapshot.self, from: data)
        guard TimeZone(identifier: snapshot.timeZone) != nil else { throw FeedError.invalidData }
        return snapshot
    }

    public func write(_ snapshot: Snapshot) throws {
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        // Atomic replacement keeps a failed write from destroying the last good download.
        try JSONEncoder().encode(snapshot).write(to: url, options: .atomic)
    }
}

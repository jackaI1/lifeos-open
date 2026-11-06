import Foundation
import Observation

public enum DemoHTTP {
    public static let endpoint = URL(string: "https://raw.githubusercontent.com/jackaI1/lifeos-ios/main/demo-api/today.json")!

    public static func validate(_ data: Data, response: URLResponse) throws -> Data {
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode),
              data.count <= 1_048_576 else { throw FeedError.invalidResponse }
        return data
    }

    public static func fetch(_ url: URL) async throws -> Data {
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 15)
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        let (data, response) = try await URLSession.shared.data(for: request)
        return try validate(data, response: response)
    }
}

@MainActor @Observable
public final class CompanionStore {
    public enum Status: Equatable { case idle, saved, live, offline, unavailable, notSaved }
    public private(set) var snapshot: Snapshot?
    public private(set) var isRefreshing = false
    public private(set) var status: Status = .idle
    private let cache: SnapshotCache
    private let transport: @MainActor (URL) async throws -> Data
    private let clock: @MainActor () -> Date

    public init(cache: SnapshotCache = .application,
                transport: @escaping @MainActor (URL) async throws -> Data = { try await DemoHTTP.fetch($0) },
                clock: @escaping @MainActor () -> Date = { Date() }) {
        self.cache = cache
        self.transport = transport
        self.clock = clock
    }

    public func restore() {
        guard snapshot == nil else { return }
        if let saved = try? cache.read() {
            snapshot = saved
            status = .saved
        }
    }

    public func refresh() async {
        guard !isRefreshing else { return }
        isRefreshing = true
        defer { isRefreshing = false }
        do {
            let data = try await transport(DemoHTTP.endpoint)
            try Task.checkCancellation()
            let fresh = try DemoFeed.decode(data).snapshot(at: clock())
            snapshot = fresh
            do {
                try cache.write(fresh)
                status = .live
            } catch {
                status = .notSaved
            }
        } catch {
            if snapshot == nil {
                status = .unavailable
            } else if status != .notSaved {
                status = .offline
            }
        }
    }
}

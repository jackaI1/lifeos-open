import Foundation
import XCTest

@MainActor private final class RequestState { var fails = false }
@testable import LifeOSCore

@MainActor
final class CompanionStoreTests: XCTestCase {
    private func directory() throws -> URL {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: url) }
        return url
    }

    func testSuccessfulRefreshPersistsAbsoluteSnapshotAcrossRelaunch() async throws {
        let cache = SnapshotCache(url: try directory().appendingPathComponent("cache.json"))
        let data = try fixture()
        let now = instant("2026-11-03T16:00:00Z")
        let store = CompanionStore(cache: cache, transport: { _ in data }, clock: { now })
        await store.refresh()
        XCTAssertEqual(store.snapshot?.schedule.first?.title, "Materials lecture")
        XCTAssertEqual(store.status, .live)
        let reopened = CompanionStore(cache: cache, transport: { _ in throw URLError(.notConnectedToInternet) },
                                      clock: { instant("2026-11-05T16:00:00Z") })
        reopened.restore()
        XCTAssertEqual(reopened.snapshot?.fetchedAt, now)
        XCTAssertEqual(reopened.status, .saved)
        await reopened.refresh()
        XCTAssertEqual(reopened.status, .offline)
        XCTAssertTrue(reopened.snapshot!.events(on: instant("2026-11-05T16:00:00Z")).isEmpty)
        XCTAssertEqual(reopened.snapshot?.pendingDeadlines.count, 3)
    }

    func testFirstOfflineLaunchCanRecoverByRetrying() async throws {
        let cache = SnapshotCache(url: try directory().appendingPathComponent("cache.json"))
        let state = RequestState()
        state.fails = true
        let data = try fixture()
        let store = CompanionStore(cache: cache, transport: { _ in
            if state.fails { throw URLError(.notConnectedToInternet) }
            return data
        })
        store.restore()
        await store.refresh()
        XCTAssertNil(store.snapshot)
        XCTAssertEqual(store.status, .unavailable)
        state.fails = false
        await store.refresh()
        XCTAssertNotNil(store.snapshot)
        XCTAssertEqual(store.status, .live)
    }

    func testMalformedResponsePreservesLastSuccessfulDiskCopy() async throws {
        let cache = SnapshotCache(url: try directory().appendingPathComponent("cache.json"))
        let snapshot = try DemoFeed.decode(fixture()).snapshot(at: instant("2026-11-03T16:00:00Z"))
        try cache.write(snapshot)
        let store = CompanionStore(cache: cache, transport: { _ in Data("not JSON".utf8) })
        store.restore()
        await store.refresh()
        XCTAssertEqual(store.status, .offline)
        XCTAssertEqual(try cache.read(), snapshot)
        XCTAssertEqual(store.snapshot, snapshot)
    }

    func testCorruptCacheIsIgnoredAndReplacedOnSuccessfulRefresh() async throws {
        let path = try directory().appendingPathComponent("cache.json")
        try Data("broken".utf8).write(to: path)
        let data = try fixture()
        let store = CompanionStore(cache: SnapshotCache(url: path), transport: { _ in data })
        store.restore()
        XCTAssertNil(store.snapshot)
        await store.refresh()
        XCTAssertEqual(store.status, .live)
        XCTAssertEqual(try SnapshotCache(url: path).read(), store.snapshot)
    }

    func testFailedCacheWriteStillDisplaysFreshDataAndExplainsItIsNotSaved() async throws {
        let parentFile = try directory().appendingPathComponent("file")
        try Data().write(to: parentFile)
        let data = try fixture()
        let store = CompanionStore(cache: SnapshotCache(url: parentFile.appendingPathComponent("cache.json")),
                                   transport: { _ in data })
        await store.refresh()
        XCTAssertNotNil(store.snapshot)
        XCTAssertEqual(store.status, .notSaved)
    }

    func testOverlappingRefreshIsIgnored() async throws {
        let data = try fixture()
        var requests = 0
        let store = CompanionStore(cache: SnapshotCache(url: try directory().appendingPathComponent("cache.json")),
                                   transport: { _ in
            requests += 1
            await Task.yield()
            return data
        })
        async let first: Void = store.refresh()
        async let second: Void = store.refresh()
        _ = await (first, second)
        XCTAssertEqual(requests, 1)
        XCTAssertEqual(store.status, .live)
    }

    func testFailedRefreshDoesNotHidePersistenceFailure() async throws {
        let parentFile = try directory().appendingPathComponent("file")
        try Data().write(to: parentFile)
        let data = try fixture()
        let state = RequestState()
        let store = CompanionStore(cache: SnapshotCache(url: parentFile.appendingPathComponent("cache.json")),
                                   transport: { _ in
            if state.fails { throw URLError(.notConnectedToInternet) }
            return data
        })
        await store.refresh()
        XCTAssertEqual(store.status, .notSaved)
        let displayed = store.snapshot
        state.fails = true
        await store.refresh()
        XCTAssertEqual(store.status, .notSaved)
        XCTAssertEqual(store.snapshot, displayed)
    }

    func testCacheCreatesParentAndReplacesPreviousSnapshot() throws {
        let cache = SnapshotCache(url: try directory().appendingPathComponent("nested/cache.json"))
        let first = try DemoFeed.decode(fixture()).snapshot(at: instant("2026-11-03T16:00:00Z"))
        let second = try DemoFeed.decode(fixture()).snapshot(at: instant("2026-11-04T16:00:00Z"))
        try cache.write(first)
        try cache.write(second)
        XCTAssertEqual(try cache.read(), second)
    }
}

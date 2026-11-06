import Foundation
import XCTest
@testable import LifeOSCore

func instant(_ text: String) -> Date { ISO8601DateFormatter().date(from: text)! }
func fixture() throws -> Data {
    #if SWIFT_PACKAGE
    let url = Bundle.module.url(forResource: "today", withExtension: "json", subdirectory: "Fixtures")!
    #else
    let url = Bundle(for: DemoFeedTests.self).url(forResource: "today", withExtension: "json", subdirectory: "Fixtures")!
    #endif
    return try Data(contentsOf: url)
}

final class DemoFeedTests: XCTestCase {
    func testResolvesLocalTimesAndFiltersTodayInFeedTimezone() throws {
        let snapshot = try DemoFeed.decode(fixture()).snapshot(at: instant("2026-11-04T02:00:00Z"))
        XCTAssertEqual(snapshot.events(on: instant("2026-11-04T02:00:00Z")).map(\.id), ["lecture", "lab"])
        XCTAssertEqual(snapshot.schedule.first?.start, instant("2026-11-03T14:30:00Z"))
        XCTAssertEqual(snapshot.schedule.last?.start, instant("2026-11-04T15:00:00Z"))
        XCTAssertEqual(snapshot.pendingDeadlines.map(\.id), ["reading", "report", "quiz"])
    }

    func testTomorrowUsesCalendarArithmeticAcrossDaylightSaving() throws {
        let snapshot = try DemoFeed.decode(fixture()).snapshot(at: instant("2026-10-31T16:00:00Z"))
        XCTAssertEqual(snapshot.schedule.last?.start, instant("2026-11-01T15:00:00Z"))
    }

    func testOldSnapshotDoesNotMoveScheduleToNewDay() throws {
        let snapshot = try DemoFeed.decode(fixture()).snapshot(at: instant("2026-11-03T16:00:00Z"))
        XCTAssertTrue(snapshot.events(on: instant("2026-11-05T16:00:00Z")).isEmpty)
        XCTAssertFalse(snapshot.isFromSameDay(as: instant("2026-11-05T16:00:00Z")))
        XCTAssertEqual(snapshot.pendingDeadlines.count, 3, "Unfinished overdue deadlines stay visible")
    }

    func testSortsAndOmitsCompletedDeadlines() throws {
        let json = String(decoding: try fixture(), as: UTF8.self)
            .replacingOccurrences(of: "\"completed\": false", with: "\"completed\": true")
        let snapshot = try DemoFeed.decode(Data(json.utf8)).snapshot(at: instant("2026-11-03T16:00:00Z"))
        XCTAssertTrue(snapshot.pendingDeadlines.isEmpty)
    }

    func testRejectsInvalidVersionTimezoneTimesIDsAndEventOrder() throws {
        let original = String(decoding: try fixture(), as: UTF8.self)
        let mutations = [
            original.replacingOccurrences(of: "\"schemaVersion\": 1", with: "\"schemaVersion\": 99"),
            original.replacingOccurrences(of: "America/Toronto", with: "Unknown/Zone"),
            original.replacingOccurrences(of: "09:30", with: "25:30"),
            original.replacingOccurrences(of: "10:20", with: "08:20"),
            original.replacingOccurrences(of: "\"id\": \"lab\"", with: "\"id\": \"lecture\""),
            original.replacingOccurrences(of: "\"dayOffset\": 0", with: "\"dayOffset\": 9999"),
            original.replacingOccurrences(of: "Materials lecture", with: " ")
        ]
        for json in mutations {
            XCTAssertThrowsError(try DemoFeed.decode(Data(json.utf8)).snapshot(at: instant("2026-11-03T16:00:00Z")))
        }
    }

    func testEmptyFeedIsValid() throws {
        let data = Data(#"{"schemaVersion":1,"timeZone":"America/Toronto","schedule":[],"deadlines":[]}"#.utf8)
        let snapshot = try DemoFeed.decode(data).snapshot(at: instant("2026-11-03T16:00:00Z"))
        XCTAssertTrue(snapshot.schedule.isEmpty)
        XCTAssertTrue(snapshot.pendingDeadlines.isEmpty)
    }
}

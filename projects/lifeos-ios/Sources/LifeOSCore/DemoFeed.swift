import Foundation

public enum FeedError: Error { case invalidData, invalidResponse }

public struct ScheduleEvent: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let title: String
    public let location: String
    public let start: Date
    public let end: Date
}

public struct Deadline: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let title: String
    public let course: String
    public let due: Date
    public let completed: Bool
}

public struct Snapshot: Codable, Equatable, Sendable {
    public let fetchedAt: Date
    public let timeZone: String
    public let schedule: [ScheduleEvent]
    public let deadlines: [Deadline]

    public var calendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: timeZone) ?? .gmt
        return calendar
    }

    public func events(on date: Date) -> [ScheduleEvent] {
        schedule.filter { calendar.isDate($0.start, inSameDayAs: date) }
            .sorted { ($0.start, $0.id) < ($1.start, $1.id) }
    }

    public var pendingDeadlines: [Deadline] {
        deadlines.filter { !$0.completed }.sorted { ($0.due, $0.id) < ($1.due, $1.id) }
    }

    public func isFromSameDay(as date: Date) -> Bool {
        calendar.isDate(fetchedAt, inSameDayAs: date)
    }
}

public struct DemoFeed: Decodable, Sendable {
    private struct Event: Decodable, Sendable {
        let id: String, title: String, location: String, start: String, end: String
        let dayOffset: Int
    }
    private struct Task: Decodable, Sendable {
        let id: String, title: String, course: String, due: String
        let dayOffset: Int
        let completed: Bool
    }
    private let schemaVersion: Int
    private let timeZone: String
    private let schedule: [Event]
    private let deadlines: [Task]

    public static func decode(_ data: Data) throws -> DemoFeed {
        guard data.count <= 1_048_576 else { throw FeedError.invalidData }
        return try JSONDecoder().decode(Self.self, from: data)
    }

    public func snapshot(at date: Date) throws -> Snapshot {
        guard schemaVersion == 1, let zone = TimeZone(identifier: timeZone),
              schedule.count <= 500, deadlines.count <= 500,
              Set(schedule.map(\.id)).count == schedule.count,
              Set(deadlines.map(\.id)).count == deadlines.count else { throw FeedError.invalidData }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = zone
        func valid(_ text: String) -> Bool { !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
        func resolve(_ time: String, offset: Int) throws -> Date {
            let parts = time.split(separator: ":", omittingEmptySubsequences: false)
            guard (-7...30).contains(offset), parts.count == 2, parts.allSatisfy({ $0.count == 2 }),
                  let hour = Int(parts[0]), let minute = Int(parts[1]),
                  (0...23).contains(hour), (0...59).contains(minute),
                  let day = calendar.date(byAdding: .day, value: offset, to: calendar.startOfDay(for: date)),
                  let resolved = calendar.date(bySettingHour: hour, minute: minute, second: 0, of: day) else {
                throw FeedError.invalidData
            }
            // Reject a nonexistent wall-clock time rather than silently shifting it through a DST gap.
            guard calendar.component(.hour, from: resolved) == hour,
                  calendar.component(.minute, from: resolved) == minute else { throw FeedError.invalidData }
            return resolved
        }
        let events = try schedule.map { event in
            guard valid(event.id), valid(event.title) else { throw FeedError.invalidData }
            let start = try resolve(event.start, offset: event.dayOffset)
            let end = try resolve(event.end, offset: event.dayOffset)
            guard end > start else { throw FeedError.invalidData }
            return ScheduleEvent(id: event.id, title: event.title, location: event.location, start: start, end: end)
        }.sorted { ($0.start, $0.id) < ($1.start, $1.id) }
        let tasks = try deadlines.map { task in
            guard valid(task.id), valid(task.title) else { throw FeedError.invalidData }
            return Deadline(id: task.id, title: task.title, course: task.course,
                            due: try resolve(task.due, offset: task.dayOffset), completed: task.completed)
        }
        return Snapshot(fetchedAt: date, timeZone: timeZone, schedule: events, deadlines: tasks)
    }
}

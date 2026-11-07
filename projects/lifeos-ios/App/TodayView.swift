import SwiftUI
import LifeOSCore

struct TodayView: View {
    let store: CompanionStore

    var body: some View {
        // Re-evaluate at midnight and while foregrounded, even without another download.
        TimelineView(.periodic(from: .now, by: 60)) { context in
            content(now: context.date)
        }
    }

    private func content(now: Date) -> some View {
        NavigationStack {
            List {
                Section {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(format(now, style: .dateTime.weekday(.wide).month(.wide).day(),
                                    zone: store.snapshot?.calendar.timeZone ?? TimeZone(identifier: "America/Toronto")!))
                            .font(.title2.bold())
                        Text("LifeOS public demo")
                            .font(.subheadline).foregroundStyle(.secondary)
                        Label(statusText, systemImage: statusIcon)
                            .font(.callout)
                            .accessibilityIdentifier("connectionStatus")
                        if let snapshot = store.snapshot {
                            Text("Last downloaded \(snapshot.fetchedAt.formatted(date: .abbreviated, time: .shortened))")
                                .font(.caption).foregroundStyle(.secondary)
                            if !snapshot.isFromSameDay(as: now) {
                                Text("This saved copy is from an earlier day. Refresh for a current demo schedule.")
                                    .font(.callout).foregroundStyle(.orange)
                            }
                        }
                    }
                    .padding(.vertical, 6)
                }

                if let snapshot = store.snapshot {
                    Section("Today's schedule") {
                        let events = snapshot.events(on: now)
                        if events.isEmpty {
                            Text("No commitments for today in this copy.")
                                .foregroundStyle(.secondary)
                        }
                        ForEach(events) { event in
                            HStack(alignment: .top, spacing: 12) {
                                Image(systemName: "calendar").foregroundStyle(.blue)
                                    .accessibilityHidden(true)
                                VStack(alignment: .leading, spacing: 5) {
                                    Text(event.title).font(.headline)
                                    Text("\(time(event.start, snapshot)) to \(time(event.end, snapshot))")
                                        .font(.subheadline)
                                    if !event.location.isEmpty {
                                        Text(event.location).font(.subheadline).foregroundStyle(.secondary)
                                    }
                                }
                            }
                            .padding(.vertical, 5)
                            .accessibilityElement(children: .combine)
                        }
                    }
                    Section("Upcoming deadlines") {
                        if snapshot.pendingDeadlines.isEmpty {
                            Text("No unfinished deadlines in this copy.").foregroundStyle(.secondary)
                        }
                        ForEach(snapshot.pendingDeadlines) { deadline in
                            HStack(alignment: .top, spacing: 12) {
                                Image(systemName: "flag").foregroundStyle(.orange)
                                    .accessibilityHidden(true)
                                VStack(alignment: .leading, spacing: 5) {
                                    Text(deadline.title).font(.headline)
                                    Text(deadline.course).font(.subheadline).foregroundStyle(.secondary)
                                    Text(format(deadline.due, style: .dateTime.month(.abbreviated).day().hour().minute(),
                                                zone: snapshot.calendar.timeZone))
                                        .font(.subheadline)
                                    if deadline.due < now {
                                        Text("Overdue in this copy").font(.caption.bold()).foregroundStyle(.orange)
                                    }
                                }
                            }
                            .padding(.vertical, 5)
                            .accessibilityElement(children: .combine)
                        }
                    }
                } else if store.isRefreshing {
                    Section { ProgressView("Downloading the demo…") }
                } else {
                    Section {
                        ContentUnavailableView {
                            Label("No saved schedule yet", systemImage: "wifi.slash")
                        } description: {
                            Text("Connect to the internet and tap Refresh. After the first download, this phone can show the saved copy offline.")
                        } actions: {
                            Button("Try again") { Task { await store.refresh() } }
                        }
                    }
                }
                Section {
                    Text("Fictional examples, not your personal workspace. Times are in America/Toronto. Refresh starts a new demo day; saved dates stay fixed offline.")
                        .font(.footnote).foregroundStyle(.secondary)
                    Link("Open LifeOS in the browser", destination: URL(string: "https://lifeos.jacklai.ca")!)
                    Link("View the public demo feed", destination: DemoHTTP.endpoint)
                }
            }
            .navigationTitle("Today")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        Task { await store.refresh() }
                    } label: {
                        Label("Refresh", systemImage: "arrow.clockwise")
                    }
                    .disabled(store.isRefreshing)
                    .accessibilityIdentifier("refreshButton")
                }
            }
            .refreshable { await store.refresh() }
        }
    }

    private func time(_ date: Date, _ snapshot: Snapshot) -> String {
        format(date, style: .dateTime.hour().minute(), zone: snapshot.calendar.timeZone)
    }

    private func format(_ date: Date, style: Date.FormatStyle, zone: TimeZone) -> String {
        var style = style
        style.timeZone = zone
        return date.formatted(style)
    }

    private var statusIcon: String {
        switch store.status {
        case .live: "checkmark.circle"
        case .offline, .unavailable: "wifi.slash"
        case .notSaved: "exclamationmark.triangle"
        case .idle, .saved: "clock"
        }
    }

    private var statusText: String {
        switch store.status {
        case .idle: "Ready to download"
        case .saved: "Showing the saved copy"
        case .live: "Demo updated and saved on this phone"
        case .offline: "Could not refresh. Showing the saved copy."
        case .unavailable: "Could not download. Check your connection and retry."
        case .notSaved: "This copy could not be saved for offline use. Refresh to retry."
        }
    }
}

import SwiftUI
import LifeOSCore

@main
struct LifeOSApp: App {
    @State private var store = CompanionStore()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            TodayView(store: store)
                .task {
                    store.restore()
                    await store.refresh()
                }
                .onChange(of: scenePhase) { _, phase in
                    if phase == .active { Task { await store.refresh() } }
                }
        }
    }
}

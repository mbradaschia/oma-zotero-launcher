import AppKit
import ServiceManagement

// Open at login (macos/PLAN.md phase 10): the app as a login item through SMAppService, its state read from the
// service, never stored. When macOS wants your OK first (requiresApproval), it says so and opens System Settings ›
// General › Login Items. The tests use a fake service.
protocol LoginService {
    var status: SMAppService.Status { get }
    func register() throws
    func unregister() throws
}

extension SMAppService: LoginService {}

@MainActor
final class LoginItem: ObservableObject {
    private let service: LoginService
    private let openSettings: () -> Void
    @Published private(set) var enabled = false
    @Published private(set) var needsApproval = false
    @Published private(set) var problem = ""
    private var activeObserver: NSObjectProtocol?

    init(service: LoginService = SMAppService.mainApp, openSettings: @escaping () -> Void = { SMAppService.openSystemSettingsLoginItems() }) {
        self.service = service
        self.openSettings = openSettings
        refresh()
        // changed in System Settings meanwhile (approved, removed): read again when the app comes forward
        activeObserver = NotificationCenter.default.addObserver(forName: NSApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.refresh() }
        }
    }

    deinit { if let activeObserver { NotificationCenter.default.removeObserver(activeObserver) } }

    func refresh() {
        enabled = service.status == .enabled
        needsApproval = service.status == .requiresApproval
        if enabled || needsApproval { problem = "" } // (macOS's own state says more than the error did)
    }

    // On (registered) or off; macOS asking for your OK opens Login Items.
    func set(_ on: Bool) {
        problem = ""
        do {
            if on { try service.register() } else { try service.unregister() }
        } catch {
            problem = (on ? "Couldn't turn on Open at login: " : "Couldn't turn off Open at login: ") + error.localizedDescription
        }
        refresh()
        if on && needsApproval { openSettings() }
    }

    var detail: String {
        if !problem.isEmpty { return problem }
        if needsApproval { return "macOS asks you first: System Settings › General › Login Items, allow Zotero Launcher" }
        return enabled ? "It starts when you log in, in the menu bar" : "Start it yourself, from Applications or Spotlight"
    }
}

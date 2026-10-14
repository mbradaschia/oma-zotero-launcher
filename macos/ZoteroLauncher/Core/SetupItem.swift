import Foundation

// A step of the setup page as lib/Settings.js's setupItems builds it. Only id, icon and label are
// always there; the rest depends on the step and its state.
struct SetupItem: Decodable, Equatable {
    var id: String
    var icon: String
    var label: String
    var detail: String?
    var ok: Bool?
    var action: String? // "" or absent: nothing to do here
    var rowId: String?
    var badge: String?
    var submenu: Bool?
    var steps: [String]? // what to do by hand, in order
}

import Foundation

// view.json's arrangement of the menus and the results (Service.qml:161-243): each menu's pins,
// the rows moved to Other, your row order within each section, and the sections' order.
extension ViewPrefs {
    func sectionOrder(_ key: String) -> [String] { (values["sectionOrder"] as? [String: Any])?[key] as? [String] ?? [] }
    func menuPins(_ view: String) -> [String] { (values["menuPins"] as? [String: Any])?[view] as? [String] ?? [] }
    func menuOther(_ view: String) -> [String] { (values["menuOther"] as? [String: Any])?[view] as? [String] ?? [] }
    // A section whose order isn't a list of names is left out, not the whole menu.
    func menuOrder(_ view: String) -> [String: [String]] {
        ((values["menuOrder"] as? [String: Any])?[view] as? [String: Any] ?? [:]).compactMapValues { $0 as? [String] }
    }

    mutating func saveMenuPins(_ view: String, _ ids: [String]) throws {
        try set("menuPins", replacing(view, in: "menuPins", with: ids.isEmpty ? nil : ids))
    }

    mutating func saveMenuOther(_ view: String, _ ids: [String]) throws {
        try set("menuOther", replacing(view, in: "menuOther", with: ids.isEmpty ? nil : ids))
    }

    mutating func saveMenuOrder(_ view: String, _ section: String, _ ids: [String]) throws {
        reload()
        var menu = menuOrder(view)
        menu[section] = ids
        try set("menuOrder", replacing(view, in: "menuOrder", with: menu))
    }

    mutating func saveSectionOrder(_ key: String, _ names: [String]) throws {
        try set("sectionOrder", replacing(key, in: "sectionOrder", with: names))
    }

    // The object under `pref` with `key` set (nil removes it), from the file as it is now.
    private mutating func replacing(_ key: String, in pref: String, with value: Any?) -> [String: Any] {
        reload()
        var all = values[pref] as? [String: Any] ?? [:]
        all[key] = value
        return all
    }
}

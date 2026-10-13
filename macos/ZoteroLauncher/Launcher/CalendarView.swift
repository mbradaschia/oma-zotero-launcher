import SwiftUI

// The due date's calendar (todo-due): the month of the highlighted day, the day marked; arrows,
// PgUp/PgDn, Home, Delete and Enter come through the key router.
struct CalendarView: View {
    @ObservedObject var model: LauncherModel

    private var month: (title: String, days: [[String: Any]]) {
        let json = (try? model.core?.glueJSON("calendarMonth", [model.tasks.calDate, model.nowMs])) ?? "{}"
        let m = (try? JSONSerialization.jsonObject(with: Data(json.utf8))) as? [String: Any] ?? [:]
        return (m["title"] as? String ?? "", m["days"] as? [[String: Any]] ?? [])
    }

    var body: some View {
        let m = month
        VStack(spacing: 8) {
            Text(m.title).font(.headline)
            Grid(horizontalSpacing: 6, verticalSpacing: 6) {
                GridRow { ForEach(["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"], id: \.self) { Text($0).font(.caption).foregroundStyle(.secondary).frame(width: 34) } }
                ForEach(0..<6, id: \.self) { week in
                    GridRow {
                        ForEach(0..<7, id: \.self) { d in
                            let day = m.days.indices.contains(week * 7 + d) ? m.days[week * 7 + d] : [:]
                            let chosen = day["date"] as? String == model.tasks.calDate
                            Text("\(day["day"] as? Int ?? 0)")
                                .frame(width: 34, height: 26)
                                .background(chosen ? Color.accentColor : Color.clear, in: RoundedRectangle(cornerRadius: 6))
                                .foregroundStyle(chosen ? Color.white : (day["inMonth"] as? Bool == true ? Color.primary : Color.secondary))
                        }
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

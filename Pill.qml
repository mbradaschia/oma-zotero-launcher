import QtQuick
import qs.Commons
import qs.Ui

// A pill, the same everywhere (the results, the paper's menu, its header, the note window, the footer).
// Three states (Views.pillPalette's notes):
//   "on"  the one chosen among choices, or the active badge: filled in its kind's colour, bold
//   "tag" something the item has: tinted, outlined, in its kind's colour
//   "off" the other choices, a minor mark: a faint outline, dimmed text
// kind: status, task, rank, taxonomy, scope, priority or neutral; colors: Views.pillPalette()'s.
Rectangle {
  id: pill

  property string text: ""
  property string kind: "neutral"
  property string mode: "tag"
  property var colors: ({})
  property bool hot: false // on the highlighted row: a touch stronger
  property color background: Color.menu.background
  property color foreground: Color.menu.text
  property string fontFamily: ""
  property int fontSize: Style.font.caption
  property real maxHeight: 0 // 0: as tall as the text needs
  property real maxWidth: 0 // 0: as wide as the text needs; else the text is cut short with …
  property int padX: Style.space(12)
  property int padY: Style.space(3)

  readonly property color ink: (pill.colors && pill.colors[pill.kind]) || pill.foreground

  readonly property real labelWidth: pill.maxWidth > 0 ? Math.min(label.implicitWidth, pill.maxWidth - pill.padX) : label.implicitWidth
  implicitWidth: pill.labelWidth + pill.padX
  implicitHeight: pill.maxHeight > 0 ? Math.min(label.implicitHeight + pill.padY, pill.maxHeight) : label.implicitHeight + pill.padY
  width: implicitWidth
  height: implicitHeight
  radius: height / 2
  color: pill.mode === "on" ? pill.ink : pill.mode === "tag" ? Util.alpha(pill.ink, pill.hot ? 0.28 : 0.16) : "transparent"
  border.width: pill.mode === "on" ? 0 : 1
  border.color: pill.mode === "tag" ? Util.alpha(pill.ink, pill.hot ? 0.95 : 0.6) : Util.alpha(pill.ink, pill.hot ? 0.55 : 0.32)

  Text {
    id: label
    anchors.centerIn: parent
    width: pill.labelWidth
    horizontalAlignment: Text.AlignHCenter
    elide: Text.ElideRight
    textFormat: Text.PlainText
    text: pill.text
    color: pill.mode === "on" ? pill.background : pill.ink
    opacity: pill.mode === "off" ? (pill.hot ? 0.8 : 0.6) : 1
    font.family: pill.fontFamily
    font.pixelSize: pill.fontSize
    font.weight: pill.mode === "on" ? Font.DemiBold : Font.Normal
  }
}

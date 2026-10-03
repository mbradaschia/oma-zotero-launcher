import QtQuick
import qs.Commons

// The keys of a window of its own (the note window, the chat window), over its content: ? or F1 shows it,
// again (or Esc) hides it. rows: [[keys, what they do]] (Views.VIEW_KEYS).
Rectangle {
  id: panel

  property string title: "Keys"
  property var rows: []
  property color background: Color.menu.background
  property color foreground: Color.menu.text
  property color accent: Color.menu.selectedText
  property string fontFamily: Style.font.menuFamily

  visible: false
  anchors.fill: parent
  color: Qt.rgba(0, 0, 0, 0.45)

  MouseArea { anchors.fill: parent; onClicked: panel.visible = false }

  Rectangle {
    anchors.centerIn: parent
    width: Math.min(parent.width - Style.space(40), Style.space(560))
    height: Math.min(parent.height - Style.space(40), list.implicitHeight + Style.space(28))
    radius: Style.cornerRadius
    color: panel.background
    border.width: 1
    border.color: Qt.rgba(panel.foreground.r, panel.foreground.g, panel.foreground.b, 0.2)
    clip: true

    Column {
      id: list
      anchors.fill: parent
      anchors.margins: Style.space(14)
      spacing: Style.space(6)
      Text {
        textFormat: Text.PlainText
        text: panel.title.toUpperCase() + "   ·   ? or F1 hides them"
        color: panel.foreground
        opacity: 0.5
        font.family: panel.fontFamily
        font.pixelSize: Style.font.caption
        font.letterSpacing: 1
        bottomPadding: Style.space(4)
      }
      Repeater {
        model: panel.rows
        delegate: Item {
          required property var modelData
          width: list.width
          height: what.implicitHeight
          Text {
            id: keys
            width: Style.space(170)
            textFormat: Text.PlainText
            text: modelData[0]
            color: panel.accent
            font.family: panel.fontFamily
            font.pixelSize: Style.font.bodySmall
            elide: Text.ElideRight
          }
          Text {
            id: what
            anchors.left: keys.right
            anchors.leftMargin: Style.space(12)
            anchors.right: parent.right
            textFormat: Text.PlainText
            text: modelData[1]
            color: panel.foreground
            opacity: 0.85
            wrapMode: Text.Wrap
            font.family: panel.fontFamily
            font.pixelSize: Style.font.bodySmall
          }
        }
      }
    }
  }
}

import QtQuick
import Quickshell
import qs.Commons

// One note in its own window: a normal Hyprland toplevel you can tile, float,
// resize and move, which stays after the overlay closes. The header names the
// paper (APA 7 authors and year, title, publication); the top bar opens the note in
// Zotero, copies it or saves it as Markdown, and closes the window.
//
// Created by ZoteroSearch.qml (Alt+W on a note); destroys itself when closed.
FloatingWindow {
  id: win

  property var service: null
  property var note: ({ key: "", libraryID: 1, title: "Note" }) // { key, libraryID, title }
  property var noteData: null // bridge /note response (display format)
  property string error: ""
  property string flash: ""
  signal done()

  readonly property var paper: noteData && noteData.paper ? noteData.paper : null
  readonly property color background: Color.menu.background
  readonly property color foreground: Color.menu.text
  readonly property color accent: Color.menu.selectedText
  readonly property color hoverBackground: Color.menu.selectedBackground
  readonly property string fontFamily: Style.font.menuFamily

  title: "Zotero note — " + (noteData ? noteData.title : note.title)
  color: win.background
  implicitWidth: 860
  implicitHeight: 920
  minimumSize: Qt.size(420, 320)
  visible: true

  // Closed from the top bar, a key, or the compositor (e.g. SUPER+W).
  onVisibleChanged: if (!visible) win.close()

  function close() {
    win.visible = false
    win.done()
    win.destroy()
  }

  function load() {
    if (!win.service) return
    win.service.noteContent(win.note, { format: "display", linkColor: String(win.accent).replace(/^#ff/i, "#") }, function(res) {
      if (res.kind === "ok") {
        win.noteData = res.data
        win.error = ""
      } else {
        win.error = res.message || res.kind
      }
    })
  }

  function showFlash(text) {
    win.flash = text
    flashTimer.restart()
  }

  function openInZotero() {
    if (win.service) win.service.openNote({ key: win.note.key, libraryID: win.note.libraryID, title: win.note.title })
  }

  // The note as Zotero exports it (Markdown with zotero:// links): copied, or saved to Downloads.
  function exportNote(how) {
    if (!win.service) return
    win.showFlash(how === "save" ? "Saving…" : "Copying…")
    win.service.noteContent(win.note, { format: "export" }, function(res) {
      if (res.kind !== "ok") return win.showFlash("Couldn't get the note" + (res.message ? ": " + res.message : ""))
      if (how === "copy") return win.showFlash(win.service.copyText(res.data.markdown) ? "Copied as Markdown" : "Couldn't copy the note")
      const started = win.service.saveMarkdown(res.data.title || win.note.title, res.data.markdown, function(path, err) {
        win.showFlash(path ? "Saved " + path.replace(Quickshell.env("HOME"), "~") : "Couldn't save the note: " + err)
      })
      if (!started) win.showFlash("Still saving the last note")
    })
  }

  function openLink(link) {
    if (/^(https?|mailto):/i.test(String(link))) Util.execArgv(["uwsm-app", "--", "xdg-open", String(link)])
  }

  Component.onCompleted: win.load()

  Timer {
    id: flashTimer
    interval: 3500
    onTriggered: win.flash = ""
  }

  FocusScope {
    anchors.fill: parent
    focus: true

    Keys.onPressed: function(event) {
      const ctrl = (event.modifiers & Qt.ControlModifier) !== 0
      const shift = (event.modifiers & Qt.ShiftModifier) !== 0
      const k = event.key
      if (k === Qt.Key_Escape || (ctrl && k === Qt.Key_W)) win.close()
      else if (ctrl && shift && k === Qt.Key_C) win.exportNote("copy")
      else if (ctrl && k === Qt.Key_S) win.exportNote("save")
      else if (ctrl && k === Qt.Key_O) win.openInZotero()
      else if (k === Qt.Key_Down || k === Qt.Key_J) flick.scrollBy(60)
      else if (k === Qt.Key_Up || k === Qt.Key_K) flick.scrollBy(-60)
      else if (k === Qt.Key_PageDown || k === Qt.Key_Space) flick.scrollBy(flick.height - 80)
      else if (k === Qt.Key_PageUp) flick.scrollBy(-(flick.height - 80))
      else if (k === Qt.Key_Home) flick.contentY = 0
      else if (k === Qt.Key_End) flick.scrollBy(1e9)
      else return
      event.accepted = true
    }

    // ---- top bar: note title, actions, close
    Rectangle {
      id: topBar
      anchors { left: parent.left; right: parent.right; top: parent.top }
      height: Style.space(44)
      color: Qt.rgba(win.foreground.r, win.foreground.g, win.foreground.b, 0.05)

      Row {
        anchors { left: parent.left; leftMargin: Style.space(14); verticalCenter: parent.verticalCenter }
        spacing: Style.space(8)
        Text {
          anchors.verticalCenter: parent.verticalCenter
          text: ""
          color: win.accent
          font.family: win.fontFamily
          font.pixelSize: Style.font.title
        }
        Text {
          anchors.verticalCenter: parent.verticalCenter
          width: Math.max(0, topBar.width - buttons.width - Style.space(70))
          textFormat: Text.PlainText
          text: win.flash || (win.noteData ? win.noteData.title : win.note.title)
          color: win.foreground
          opacity: win.flash ? 1 : 0.8
          font.family: win.fontFamily
          font.pixelSize: Style.font.body
          elide: Text.ElideRight
        }
      }

      Row {
        id: buttons
        anchors { right: parent.right; rightMargin: Style.space(8); verticalCenter: parent.verticalCenter }
        spacing: Style.space(4)

        BarButton { icon: ""; label: "Open in Zotero"; tip: "Ctrl+O"; onClicked: win.openInZotero() }
        BarButton { icon: ""; label: "Copy .md"; tip: "Ctrl+Shift+C"; onClicked: win.exportNote("copy") }
        BarButton { icon: ""; label: "Save .md"; tip: "Ctrl+S: to Downloads"; onClicked: win.exportNote("save") }
        BarButton { icon: ""; label: ""; tip: "Close (Esc)"; onClicked: win.close() }
      }
    }

    // ---- the note
    Flickable {
      id: flick
      anchors { left: parent.left; right: parent.right; top: topBar.bottom; bottom: parent.bottom }
      clip: true
      contentWidth: width
      contentHeight: column.implicitHeight + Style.space(40)
      boundsBehavior: Flickable.StopAtBounds

      function scrollBy(dy) {
        flick.contentY = Math.max(0, Math.min(flick.contentHeight - flick.height, flick.contentY + dy))
      }

      Column {
        id: column
        x: Style.space(28)
        y: Style.space(22)
        width: Math.min(flick.width - Style.space(56), 980)
        spacing: Style.space(6)

        // Paper header: year · authors, title, publication
        Text {
          width: parent.width
          visible: text.length > 0
          textFormat: Text.PlainText
          // APA 7 narrative citation: "Sirmon et al. (2007)"
          text: win.paper ? [win.paper.authors, win.paper.year ? "(" + win.paper.year + ")" : ""].filter(function(x) { return x }).join(" ") : ""
          color: win.accent
          font.family: win.fontFamily
          font.pixelSize: Style.font.body
          wrapMode: Text.Wrap
        }
        Text {
          width: parent.width
          visible: text.length > 0
          textFormat: Text.PlainText
          text: win.paper ? win.paper.title : ""
          color: win.foreground
          font.family: win.fontFamily
          font.pixelSize: Math.round(Style.font.title * 1.35)
          font.weight: Font.DemiBold
          wrapMode: Text.Wrap
        }
        Text {
          width: parent.width
          visible: text.length > 0
          textFormat: Text.PlainText
          text: win.paper ? win.paper.publication : ""
          color: win.foreground
          opacity: 0.65
          font.family: win.fontFamily
          font.pixelSize: Style.font.body
          font.italic: true
          wrapMode: Text.Wrap
        }
        Rectangle {
          visible: win.paper !== null
          width: parent.width
          height: 1
          color: win.foreground
          opacity: 0.15
        }
        Item { width: 1; height: Style.space(6); visible: win.paper !== null }

        Text {
          width: parent.width
          visible: !win.noteData
          textFormat: Text.PlainText
          text: win.error ? "Couldn't load the note: " + win.error : "Loading…"
          color: win.foreground
          opacity: 0.6
          font.family: win.fontFamily
          font.pixelSize: Style.font.body
          wrapMode: Text.Wrap
        }

        // Selectable (Ctrl+C copies a selection; Ctrl+Shift+C the whole note).
        TextEdit {
          id: body
          width: parent.width
          readOnly: true
          selectByMouse: true
          selectByKeyboard: true
          textFormat: TextEdit.MarkdownText
          wrapMode: TextEdit.Wrap
          text: win.noteData ? win.noteData.markdown : ""
          color: win.foreground
          selectionColor: win.hoverBackground
          selectedTextColor: win.accent
          font.family: win.fontFamily
          font.pixelSize: Style.font.title
          onLinkActivated: function(link) { win.openLink(link) }

          HoverHandler {
            cursorShape: body.hoveredLink ? Qt.PointingHandCursor : Qt.IBeamCursor
          }
        }

        Text {
          width: parent.width
          visible: win.noteData !== null && win.noteData.truncated
          textFormat: Text.PlainText
          text: "This note is long: the first part is shown here. Open it in Zotero to read all of it."
          color: win.foreground
          opacity: 0.55
          font.family: win.fontFamily
          font.pixelSize: Style.font.bodySmall
          wrapMode: Text.Wrap
        }
      }
    }
  }

  // A top-bar button: icon, optional label, hover highlight, tooltip-like hint in the bar.
  component BarButton: Rectangle {
    id: btn
    property string icon: ""
    property string label: ""
    property string tip: ""
    signal clicked()

    width: content.implicitWidth + Style.space(16)
    height: Style.space(30)
    radius: Style.cornerRadius
    color: mouse.containsMouse ? win.hoverBackground : "transparent"

    Row {
      id: content
      anchors.centerIn: parent
      spacing: Style.space(6)
      Text {
        anchors.verticalCenter: parent.verticalCenter
        text: btn.icon
        color: mouse.containsMouse ? win.accent : win.foreground
        font.family: win.fontFamily
        font.pixelSize: Style.font.body
      }
      Text {
        anchors.verticalCenter: parent.verticalCenter
        visible: btn.label !== ""
        text: btn.label
        color: mouse.containsMouse ? win.accent : win.foreground
        font.family: win.fontFamily
        font.pixelSize: Style.font.bodySmall
      }
    }

    MouseArea {
      id: mouse
      anchors.fill: parent
      hoverEnabled: true
      cursorShape: Qt.PointingHandCursor
      onClicked: btn.clicked()
      onContainsMouseChanged: if (containsMouse && btn.tip) win.showFlash(btn.tip)
    }
  }
}

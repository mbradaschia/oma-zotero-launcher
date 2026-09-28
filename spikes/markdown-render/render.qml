// Phase 0 spike (d): render a note's Markdown with Text.MarkdownText, offscreen.
//   QT_QPA_PLATFORM=offscreen QT_QUICK_BACKEND=software QML_XHR_ALLOW_FILE_READ=1 \
//     qml render.qml -- <note.md> <out.png>
import QtQuick

Rectangle {
  id: root
  width: 720
  height: Math.max(200, body.implicitHeight + 40)
  color: "#1a1b26"
  property string markdown: ""

  Text {
    id: body
    x: 20; y: 20
    width: root.width - 40
    wrapMode: Text.Wrap
    textFormat: Text.MarkdownText
    color: "#c0caf5"
    linkColor: "#7aa2f7"
    font.pixelSize: 14
    text: root.markdown
  }

  Component.onCompleted: {
    const args = Qt.application.arguments
    const src = args[args.length - 2], out = args[args.length - 1]
    const xhr = new XMLHttpRequest()
    xhr.open("GET", "file://" + src, false)
    xhr.send()
    root.markdown = xhr.responseText
    Qt.callLater(function() {
      root.grabToImage(function(result) {
        console.warn("RESULT saved=" + result.saveToFile(out) + " height=" + root.height + " lines=" + body.lineCount)
        Qt.quit()
      })
    })
  }
}

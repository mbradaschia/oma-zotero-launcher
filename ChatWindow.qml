import QtQuick
import Quickshell
import Quickshell.Io
import qs.Commons
import "lib/Views.js" as Views
import "lib/Settings.js" as Settings
import "lib/Client.js" as Client

// Chat with one paper: a normal window (tile it, float it, resize it) with the paper's
// past chats on the left and the conversation on the right. Every answer is grounded in
// the paper's text (its extracted-text note when there is one, else the PDF read now);
// each can be copied, saved to Zotero as a note or downloaded as Markdown, and so can the
// whole chat. The prompt runner does the work: `oma-zotero-prompt chat` streams one turn
// as JSON lines, and resumes the Claude session on the next.
//
// Created by ZoteroSearch.qml ("Chat with the paper"); destroys itself when closed.
FloatingWindow {
  id: win

  property var service: null
  property var item: ({ key: "", libraryID: 1, title: "" }) // the paper
  property var paper: null // bridge paperInfo: { title, authors, year, publication, rank }
  property var savedText: null // its extracted-text note { key, title }, or null
  property string sessionId: ""
  property string initialSession: "" // a past chat to open when the window opens
  property bool newMenuOpen: false
  property bool pickerOpen2: false // choosing another paper for a new chat
  property var pickResults: []
  property real pickerX: 0 // where the model picker opens (above the question box)
  property real pickerY: 0
  property var sessions: [] // [{ id, title, updated, turns }], newest first
  property bool busy: false
  property string grounding: ""
  // What a new chat reads: "note" (the extracted-text .md note) or "pdf" (the PDF, read fresh).
  // A chat keeps the source it started with.
  property string groundSource: "note"
  property string renaming: "" // the past chat being renamed
  // How much of the model's context window the chat uses (from the runner, after each answer);
  // the runner summarizes earlier questions when it nears the limit.
  property int contextUsed: 0
  property int contextWindow: 0
  property string statusText: "" // what the runner is doing before the answer streams in

  function kTokens(n) {
    return n >= 1000000 ? (n / 1000000).toFixed(n % 1000000 ? 1 : 0) + "M" : n >= 1000 ? Math.round(n / 1000) + "k" : String(n)
  }
  property string model: "default" // "provider:model", or "default" (Settings › Defaults › Chat)
  property string effort: win.service ? win.service.settings.defaults.chat.effort : "high"
  property bool pickerOpen: false
  property bool showSessions: false // the past chats: collapsed by default (☰ shows them)
  property string flash: ""
  signal done()
  // Back to the launcher, on this paper's menu with "Chat with the paper" highlighted.
  signal menuRequested(var item, var select)

  readonly property string cite: Views.paperCite(paper) || item.title
  readonly property color background: Color.menu.background
  readonly property color foreground: Color.menu.text
  readonly property color accent: Color.menu.selectedText
  readonly property color hoverBackground: Color.menu.selectedBackground
  readonly property string fontFamily: Style.font.menuFamily
  readonly property color subtle: Qt.rgba(foreground.r, foreground.g, foreground.b, 0.06)
  readonly property color line: Qt.rgba(foreground.r, foreground.g, foreground.b, 0.15)
  readonly property int lineHeight: Math.round(Style.font.title * 1.45)

  title: "Chat — " + win.cite
  color: win.background
  implicitWidth: 1100
  implicitHeight: 900
  minimumSize: Qt.size(520, 420)
  visible: true

  onVisibleChanged: if (!visible) win.close()

  function close() {
    if (turnProc.running) turnProc.running = false
    win.visible = false
    win.done()
    win.destroy()
  }

  function argv(args) {
    return ["bash", "-lc", 'exec "$@"', "bash"].concat(Client.promptArgv(win.service ? win.service.settings : null, args))
  }

  function itemArgs() {
    return ["--key", win.item.key, "--library", String(win.item.libraryID || 1)]
  }

  function showFlash(text) {
    win.flash = text
    flashTimer.restart()
  }

  Timer {
    id: flashTimer
    interval: 4000
    onTriggered: win.flash = ""
  }

  Component.onCompleted: {
    win.setGrounding()
    if (!win.paper) win.loadPaper() // opened from the chats list or a picked paper
    win.refreshSessions()
    if (win.initialSession) win.openSession(win.initialSession)
    if (win.service && !win.service.models) win.service.refreshModels()
    Qt.callLater(function() { input.forceActiveFocus() })
  }

  function setGrounding() {
    if (!win.savedText) win.groundSource = "pdf"
    win.grounding = win.groundSource === "note" && win.savedText ? "the extracted text (.md note), page by page" : "the PDF, read when you ask"
  }

  // Ground new chats in the .md note or the PDF; a chat in progress keeps its source, so
  // switching starts a new one.
  function setSource(src) {
    if (src === win.groundSource || win.busy) return
    if (src === "note" && !win.savedText) return win.showFlash("Extract the text first")
    win.groundSource = src
    if (messages.count > 0) {
      win.newChat()
      win.showFlash("A new chat, grounded in " + (src === "note" ? "the extracted text" : "the PDF"))
    }
    win.setGrounding()
  }

  // The paper's header and whether its text is extracted, from the bridge.
  function loadPaper() {
    if (!win.service || !win.item.key) return
    win.service.request("POST", "/item", { key: win.item.key, libraryID: win.item.libraryID }, 8000, function(res) {
      if (res.kind !== "ok") return
      win.paper = res.data.paper
      win.savedText = Views.fulltextNote(res.data)
      if (!win.sessionId) win.setGrounding()
    })
  }

  // A new chat about another paper: the window switches to it.
  function switchPaper(row) {
    if (win.busy) return
    win.item = { key: row.key, libraryID: row.libraryID, title: row.title }
    win.paper = null
    win.savedText = null
    win.sessionId = ""
    win.sessions = []
    messages.clear()
    win.pickerOpen2 = false
    win.setGrounding()
    win.loadPaper()
    win.refreshSessions()
    input.forceActiveFocus()
  }

  function searchPapers(q) {
    if (!win.service) return
    win.service.request("POST", "/search", { query: q, limit: 12 }, 4000, function(res) {
      if (res.kind !== "ok") return
      const rows = String(q).trim() ? res.data.results : (res.data.pinned || []).concat(res.data.open || [], res.data.recent || [])
      win.pickResults = rows.filter(function(r) { return r.kind !== "collection" && r.itemType !== "attachment" && r.itemType !== "note" })
    })
  }

  // Pop-ups close on a click anywhere else, or Esc.
  function closePopups() {
    win.pickerOpen = false
    win.newMenuOpen = false
    win.pickerOpen2 = false
  }

  // ---------------------------------------------------------------- sessions

  Process {
    id: listProc
    stdout: StdioCollector { id: listOut; waitForEnd: true }
    onExited: (code) => {
      try { win.sessions = JSON.parse(listOut.text).chats || [] } catch (e) { win.sessions = [] }
    }
  }

  Process {
    id: renameProc
    stderr: StdioCollector { id: renameErr; waitForEnd: true }
    onExited: (code) => {
      if (code !== 0) win.showFlash("Couldn't rename: " + String(renameErr.text).trim().split("\n").pop())
      win.refreshSessions()
    }
  }

  function renameSession(id, title) {
    win.renaming = ""
    const t = String(title || "").trim()
    if (!t || renameProc.running) return
    renameProc.command = win.argv(["chat-rename", "--session", id, "--title", t].concat(win.itemArgs()))
    renameProc.running = true
  }

  function refreshSessions() {
    if (listProc.running) return
    listProc.command = win.argv(["chats"].concat(win.itemArgs()))
    listProc.running = true
  }

  Process {
    id: showProc
    stdout: StdioCollector { id: showOut; waitForEnd: true }
    stderr: StdioCollector { id: showErr; waitForEnd: true }
    onExited: (code) => {
      let s = null
      try { s = JSON.parse(showOut.text) } catch (e) {}
      if (!s) return win.showFlash("Couldn't open that chat: " + String(showErr.text).trim().split("\n").pop())
      messages.clear()
      for (const m of s.messages || []) messages.append({ role: m.role, text: m.text, pending: false, failed: false, info: m.role === "assistant" ? win.answerInfo(m.model, m.quotes, m.costUsd) : "" })
      win.sessionId = s.id
      win.contextUsed = s.context ? s.context.used : 0
      win.contextWindow = s.context ? s.context.window : 0
      if (s.model) win.model = s.model
      if (s.effort !== undefined) win.effort = s.effort
      if (s.grounding) {
        win.grounding = s.grounding.label
        win.groundSource = s.grounding.source === "note" ? "note" : "pdf"
      }
      Qt.callLater(function() { chatList.positionViewAtEnd() })
    }
  }

  function openSession(id) {
    if (win.busy || showProc.running) return
    showProc.command = win.argv(["chat-show", "--session", id].concat(win.itemArgs()))
    showProc.running = true
  }

  function newChat() {
    if (win.busy) return
    win.sessionId = ""
    win.contextUsed = 0
    win.contextWindow = 0
    win.model = "default"
    win.effort = win.service ? win.service.settings.defaults.chat.effort : "high"
    messages.clear()
    input.forceActiveFocus()
  }

  // ---------------------------------------------------------------- one turn

  ListModel { id: messages } // { role: "user" | "assistant" | "note", text, pending, failed, info }

  // The line under an answer: its model, what it cost, and the quote check.
  function answerInfo(model, quotes, costUsd) {
    const bits = []
    if (model) bits.push(Views.modelLabel(win.service ? win.service.models : null, model))
    if (typeof costUsd === "number") bits.push(costUsd < 0.01 ? (costUsd ? "< $0.01" : "free") : "$" + costUsd.toFixed(2))
    if (quotes && quotes.checked) {
      const miss = quotes.missing || []
      bits.push(miss.length ? "⚠ " + miss.length + " of " + quotes.checked + (quotes.checked === 1 ? " quote" : " quotes") + " not found word for word in the paper: " +
        miss.map(function(q) { return "“" + (q.length > 80 ? q.slice(0, 77) + "…" : q) + "”" }).join("; ")
        : "✓ " + (quotes.checked === 1 ? "the quote was" : "all " + quotes.checked + " quotes were") + " found in the paper")
    }
    return bits.join(" · ")
  }

  Process {
    id: turnProc
    property string pending: ""
    stdinEnabled: true
    stdout: SplitParser { onRead: (line) => win.onEvent(line) }
    stderr: StdioCollector { id: turnErr; waitForEnd: true }
    onStarted: {
      write(turnProc.pending)
      turnProc.pending = ""
      stdinEnabled = false // closes stdin: the question is complete
    }
    onExited: (code) => {
      win.busy = false
      win.statusText = ""
      const last = messages.count - 1
      if (last >= 0 && messages.get(last).pending) {
        const had = messages.get(last).text
        messages.setProperty(last, "pending", false)
        messages.setProperty(last, "failed", true)
        messages.setProperty(last, "text", had ? had + "\n\n*(stopped)*" : "*(stopped: " + (String(turnErr.text).trim().split("\n").pop() || "no answer") + ")*")
      }
      win.refreshSessions()
    }
  }

  function onEvent(line) {
    let ev = null
    try { ev = JSON.parse(line) } catch (e) { return }
    const last = messages.count - 1
    if (ev.type === "session") {
      win.sessionId = ev.id
      if (ev.grounding) win.grounding = ev.grounding.label
      if (ev.model) win.model = ev.model
    } else if (ev.type === "context") {
      win.contextUsed = ev.used || 0
      win.contextWindow = ev.window || 0
      if (ev.compacted) win.showFlash("Earlier questions were summarized to fit the context")
    } else if (ev.type === "status") {
      win.statusText = ev.text
    } else if (ev.type === "note" && last >= 1) {
      messages.insert(last - 1, { role: "note", text: ev.text, pending: false, failed: false, info: "" }) // before this question
    } else if (ev.type === "delta" && last >= 0) {
      win.statusText = ""
      messages.setProperty(last, "text", messages.get(last).text + ev.text)
      if (chatList.atYEnd || chatList.contentHeight - chatList.contentY - chatList.height < 200) Qt.callLater(function() { chatList.positionViewAtEnd() })
    } else if (ev.type === "quotes" && last >= 0) {
      win.pendingQuotes = { checked: ev.checked, missing: ev.missing || [] }
    } else if (ev.type === "done" && last >= 0) {
      messages.setProperty(last, "text", ev.text)
      messages.setProperty(last, "pending", false)
      messages.setProperty(last, "info", win.answerInfo(ev.model, win.pendingQuotes, ev.costUsd))
      win.pendingQuotes = null
    } else if (ev.type === "error" && last >= 0) {
      messages.setProperty(last, "text", "Couldn't answer: " + ev.message)
      messages.setProperty(last, "pending", false)
      messages.setProperty(last, "failed", true)
    }
  }

  property var pendingQuotes: null // the quote check, until the answer is done

  function send() {
    const text = input.text.trim()
    if (!text || win.busy || !win.service) return
    messages.append({ role: "user", text: text, pending: false, failed: false, info: "" })
    messages.append({ role: "assistant", text: "", pending: true, failed: false, info: "" })
    input.text = ""
    win.busy = true
    const args = ["chat"].concat(win.itemArgs(), ["--model", win.model || "default", "--effort", win.effort || "default"])
    if (win.sessionId) args.push("--session", win.sessionId)
    else args.push("--source", win.groundSource)
    turnProc.command = win.argv(args)
    turnProc.pending = text
    turnProc.stdinEnabled = true
    turnProc.running = true
    Qt.callLater(function() { chatList.positionViewAtEnd() })
  }

  function stop() {
    if (turnProc.running) turnProc.running = false
  }

  // ---------------------------------------------------------------- outputs

  // The question an answer replies to (for its note's title and file name).
  function questionBefore(index) {
    for (let i = index - 1; i >= 0; i--) if (messages.get(i).role === "user") return messages.get(i).text
    return ""
  }

  function transcript() {
    const lines = ["# Chat: " + (win.sessions.find(function(s) { return s.id === win.sessionId }) || { title: win.item.title }).title, "",
      "*" + win.cite + (win.paper && win.paper.title ? " — " + win.paper.title : "") + "*", ""]
    for (let i = 0; i < messages.count; i++) {
      const m = messages.get(i)
      lines.push(m.role === "note" ? "*" + m.text + "*" : (m.role === "user" ? "**You:** " : "**Claude:** ") + m.text, "")
    }
    return lines.join("\n")
  }

  function copyText(text) {
    win.showFlash(win.service && win.service.copyText(text) ? "Copied as Markdown" : "Couldn't copy")
  }

  function download(name, text) {
    if (!win.service) return
    const started = win.service.saveMarkdown(name, text, function(path, err) {
      win.showFlash(path ? "Saved " + path.replace(Quickshell.env("HOME"), "~") : "Couldn't save: " + err)
    })
    if (!started) win.showFlash("Still saving the last file")
  }

  Process {
    id: noteProc
    property string pending: ""
    stdinEnabled: true
    stdout: StdioCollector { id: noteOut; waitForEnd: true }
    stderr: StdioCollector { id: noteErr; waitForEnd: true }
    onStarted: {
      write(noteProc.pending)
      noteProc.pending = ""
      stdinEnabled = false
    }
    onExited: (code) => win.showFlash(code === 0 ? "Saved to Zotero as a note on the paper" : "Couldn't save to Zotero: " + String(noteErr.text).trim().split("\n").pop())
  }

  function saveToZotero(title, text) {
    if (noteProc.running) return win.showFlash("Still saving the last note")
    noteProc.command = win.argv(["note", "--title", title, "--tag", "oma-chat"].concat(win.itemArgs()))
    noteProc.pending = text
    noteProc.stdinEnabled = true
    noteProc.running = true
    win.showFlash("Saving to Zotero…")
  }

  function answerTitle(index) {
    return "Chat: " + Views.chatTitle(win.questionBefore(index))
  }

  // ---------------------------------------------------------------- extract

  Process {
    id: extractProc
    stdout: StdioCollector { id: extractOut; waitForEnd: true }
    stderr: StdioCollector { id: extractErr; waitForEnd: true }
    onExited: (code) => {
      let r = null
      try { r = JSON.parse(extractOut.text) } catch (e) {}
      if (code !== 0 || !r) return win.showFlash("Couldn't extract: " + String(extractErr.text).trim().split("\n").pop())
      win.savedText = { key: r.note, title: "" }
      if (!win.sessionId) { win.groundSource = "note"; win.setGrounding() }
      win.showFlash(r.status === "exists" ? "The text was already extracted" : "Extracted " + r.pages + " pages (p. " + r.first + "–" + r.last + "): new chats use it")
    }
  }

  function extract() {
    if (extractProc.running) return
    extractProc.command = win.argv(["extract", "--json", "--quiet"].concat(win.itemArgs()))
    extractProc.running = true
    win.showFlash("Extracting the text…")
  }

  // ---------------------------------------------------------------- layout

  Item {
    id: rootItem
    anchors.fill: parent

    // ---- top bar
    Rectangle {
      id: topBar
      anchors { left: parent.left; right: parent.right; top: parent.top }
      height: Style.space(44)
      color: win.subtle

      Row {
        anchors { left: parent.left; leftMargin: Style.space(8); verticalCenter: parent.verticalCenter }
        spacing: Style.space(8)
        BarButton { icon: ""; label: ""; tip: win.showSessions ? "Hide the past chats" : "Show the past chats"; onClicked: win.showSessions = !win.showSessions }
        Text {
          anchors.verticalCenter: parent.verticalCenter
          width: Math.max(0, topBar.width - topButtons.width - Style.space(90))
          textFormat: Text.PlainText
          text: win.flash || (win.cite + (win.paper && win.paper.title ? " · " + win.paper.title : ""))
          color: win.flash ? win.accent : win.foreground
          font.family: win.fontFamily
          font.pixelSize: Style.font.body
          elide: Text.ElideRight
        }
      }

      Row {
        id: topButtons
        anchors { right: parent.right; rightMargin: Style.space(8); verticalCenter: parent.verticalCenter }
        spacing: Style.space(4)
        BarButton { icon: "\uf060"; label: "Menu"; tip: "Back to the launcher, on this paper's menu (Alt+M)"; onClicked: win.menuRequested({ key: win.item.key, libraryID: win.item.libraryID, title: win.item.title, itemType: "" }, { rowId: "chat" }) }
        BarButton { icon: ""; label: "New chat ▾"; tip: "A new chat: about this paper, or another one"; onClicked: win.newMenuOpen = !win.newMenuOpen }
        BarButton { icon: ""; label: ""; tip: "Copy the whole chat as Markdown"; enabled: messages.count > 0; onClicked: win.copyText(win.transcript()) }
        BarButton { icon: ""; label: ""; tip: "Save the whole chat to Zotero, as a note on the paper"; enabled: messages.count > 0 && !win.busy; onClicked: win.saveToZotero("Chat: " + Views.chatTitle(win.questionBefore(1)), win.transcript()) }
        BarButton { icon: ""; label: ""; tip: "Download the whole chat as a .md file"; enabled: messages.count > 0; onClicked: win.download("Chat — " + win.cite + " — " + Views.chatTitle(win.questionBefore(1)), win.transcript()) }
        BarButton { icon: ""; label: ""; tip: "Close (SUPER+W)"; onClicked: win.close() }
      }
    }

    // ---- what the chat reads: is the text extracted, and which source new chats use
    Rectangle {
      id: banner
      anchors { left: parent.left; right: parent.right; top: topBar.bottom }
      height: Style.space(34)
      color: "transparent"
      Rectangle { anchors { left: parent.left; right: parent.right; bottom: parent.bottom } height: 1; color: win.line }
      Row {
        anchors { left: parent.left; leftMargin: Style.space(12); verticalCenter: parent.verticalCenter }
        spacing: Style.space(8)
        // extracted or not
        Rectangle {
          anchors.verticalCenter: parent.verticalCenter
          width: statusText.implicitWidth + Style.space(14)
          height: statusText.implicitHeight + Style.space(4)
          radius: height / 2
          color: "transparent"
          border.width: 1
          border.color: win.savedText ? win.accent : win.line
          Text {
            id: statusText
            anchors.centerIn: parent
            textFormat: Text.PlainText
            text: win.savedText ? "\u2713 Text extracted" : "Text not extracted"
            color: win.savedText ? win.accent : win.foreground
            opacity: win.savedText ? 1 : 0.7
            font.family: win.fontFamily
            font.pixelSize: Style.font.caption
          }
        }
        BarButton {
          anchors.verticalCenter: parent.verticalCenter
          visible: !win.savedText
          small: true
          height: Style.space(24)
          icon: "\uf1c1"; label: extractProc.running ? "Extracting…" : "Extract text"
          tip: "Save the PDF's text as a page-numbered .md note on the paper, and ground new chats in it"
          onClicked: win.extract()
        }
        Text {
          anchors.verticalCenter: parent.verticalCenter
          text: "Ground in"
          color: win.foreground
          opacity: 0.55
          font.family: win.fontFamily
          font.pixelSize: Style.font.caption
        }
        // .md | PDF
        Row {
          anchors.verticalCenter: parent.verticalCenter
          spacing: 0
          Repeater {
            model: [{ src: "note", label: ".md (extracted)" }, { src: "pdf", label: "PDF" }]
            delegate: Rectangle {
              required property var modelData
              required property int index
              readonly property bool on: win.groundSource === modelData.src
              readonly property bool usable: modelData.src === "pdf" || !!win.savedText
              width: segText.implicitWidth + Style.space(16)
              height: segText.implicitHeight + Style.space(6)
              radius: Style.cornerRadius
              color: on ? win.hoverBackground : "transparent"
              border.width: 1
              border.color: on ? win.accent : win.line
              opacity: usable ? 1 : 0.4
              Text {
                id: segText
                anchors.centerIn: parent
                textFormat: Text.PlainText
                text: modelData.label
                color: parent.on ? win.accent : win.foreground
                font.family: win.fontFamily
                font.pixelSize: Style.font.caption
              }
              MouseArea {
                anchors.fill: parent
                hoverEnabled: true
                cursorShape: parent.usable ? Qt.PointingHandCursor : Qt.ArrowCursor
                onClicked: win.setSource(modelData.src)
                onContainsMouseChanged: if (containsMouse) win.showFlash(modelData.src === "note"
                  ? (win.savedText ? "Ground new chats in the extracted text (the .md note, with page numbers)" : "Extract the text first")
                  : "Ground new chats in the PDF, read fresh each time (not saved)")
              }
            }
          }
        }
        Text {
          anchors.verticalCenter: parent.verticalCenter
          textFormat: Text.PlainText
          text: (win.sessionId ? "this chat: " + win.grounding + " · " : "") + Views.modelLabel(win.service ? win.service.models : null, win.model, win.service ? win.service.modelDefaults.chat : "") + (win.effort ? " · " + win.effort : "")
            + (win.contextWindow ? "  ·  context " + win.kTokens(win.contextUsed) + " / " + win.kTokens(win.contextWindow) + " (" + Math.round(100 * win.contextUsed / win.contextWindow) + "%)" : "")
          // the context meter turns to the accent color once the chat uses more than 60% of the window
          color: win.contextWindow && win.contextUsed / win.contextWindow > 0.6 ? win.accent : win.foreground
          opacity: win.contextWindow && win.contextUsed / win.contextWindow > 0.6 ? 0.9 : 0.5
          font.family: win.fontFamily
          font.pixelSize: Style.font.caption
          elide: Text.ElideRight
          width: Math.max(0, banner.width - x - Style.space(24))
        }
      }
    }

    // ---- past chats
    Rectangle {
      id: sidebar
      anchors { left: parent.left; top: banner.bottom; bottom: parent.bottom }
      width: win.showSessions ? Math.min(Style.space(280), parent.width * 0.3) : 0
      visible: win.showSessions
      color: win.subtle

      Text {
        id: sideTitle
        x: Style.space(14); y: Style.space(12)
        textFormat: Text.PlainText
        text: win.sessions.length ? "PAST CHATS" : "No past chats yet"
        color: win.foreground
        opacity: 0.45
        font.family: win.fontFamily
        font.pixelSize: Style.font.caption
        font.letterSpacing: 1
      }

      ListView {
        anchors { left: parent.left; right: parent.right; top: sideTitle.bottom; bottom: parent.bottom; topMargin: Style.space(8) }
        clip: true
        model: win.sessions
        delegate: Rectangle {
          required property var modelData
          width: ListView.view.width
          height: sessionCol.implicitHeight + Style.space(14)
          color: modelData.id === win.sessionId ? win.hoverBackground : sessionMouse.containsMouse ? win.subtle : "transparent"
          Column {
            id: sessionCol
            x: Style.space(14)
            width: parent.width - Style.space(24)
            anchors.verticalCenter: parent.verticalCenter
            spacing: Style.space(2)
            Text {
              width: parent.width - Style.space(22)
              visible: win.renaming !== modelData.id
              textFormat: Text.PlainText
              text: modelData.title
              color: modelData.id === win.sessionId ? win.accent : win.foreground
              font.family: win.fontFamily
              font.pixelSize: Style.font.bodySmall
              wrapMode: Text.Wrap
              maximumLineCount: 2
              elide: Text.ElideRight
            }
            // renaming: Enter saves, Esc (or clicking away) cancels
            Rectangle {
              visible: win.renaming === modelData.id
              width: parent.width
              height: renameInput.implicitHeight + Style.space(6)
              radius: Style.cornerRadius
              color: win.background
              border.width: 1
              border.color: win.accent
              TextInput {
                id: renameInput
                anchors { fill: parent; leftMargin: Style.space(6); rightMargin: Style.space(6) }
                verticalAlignment: TextInput.AlignVCenter
                color: win.foreground
                font.family: win.fontFamily
                font.pixelSize: Style.font.bodySmall
                clip: true
                onVisibleChanged: if (visible) { text = modelData.title; selectAll(); forceActiveFocus() }
                onActiveFocusChanged: if (!activeFocus && win.renaming === modelData.id) win.renaming = ""
                Keys.onPressed: function(event) {
                  if (event.key === Qt.Key_Return || event.key === Qt.Key_Enter) { win.renameSession(modelData.id, text); event.accepted = true }
                  else if (event.key === Qt.Key_Escape) { win.renaming = ""; event.accepted = true }
                }
              }
            }
            Text {
              textFormat: Text.PlainText
              text: String(modelData.updated || "").slice(0, 10) + " · " + modelData.turns + (modelData.turns === 1 ? " question" : " questions")
              color: win.foreground
              opacity: 0.45
              font.family: win.fontFamily
              font.pixelSize: Style.font.caption
            }
          }
          MouseArea {
            id: sessionMouse
            anchors.fill: parent
            enabled: win.renaming !== modelData.id
            hoverEnabled: true
            cursorShape: Qt.PointingHandCursor
            onClicked: win.openSession(modelData.id)
            onDoubleClicked: win.renaming = modelData.id
          }
          // ✎ rename (on hover)
          Rectangle {
            visible: (sessionMouse.containsMouse || renameMouse.containsMouse) && win.renaming !== modelData.id
            anchors { right: parent.right; rightMargin: Style.space(6); top: parent.top; topMargin: Style.space(6) }
            width: Style.space(22); height: Style.space(22)
            radius: Style.cornerRadius
            color: renameMouse.containsMouse ? win.hoverBackground : "transparent"
            Text {
              anchors.centerIn: parent
              text: "\uf044"
              color: renameMouse.containsMouse ? win.accent : win.foreground
              font.family: win.fontFamily
              font.pixelSize: Style.font.bodySmall
            }
            MouseArea {
              id: renameMouse
              anchors.fill: parent
              hoverEnabled: true
              cursorShape: Qt.PointingHandCursor
              onClicked: win.renaming = modelData.id
              onContainsMouseChanged: if (containsMouse) win.showFlash("Rename this chat (or double-click it)")
            }
          }
        }
      }
    }

    // ---- the conversation
    Item {
      id: main
      anchors { left: sidebar.right; right: parent.right; top: banner.bottom; bottom: parent.bottom }

      Text {
        anchors.centerIn: chatList
        width: Math.min(chatList.width - Style.space(60), 560)
        visible: messages.count === 0
        textFormat: Text.PlainText
        horizontalAlignment: Text.AlignHCenter
        wrapMode: Text.Wrap
        text: "Ask anything about " + win.cite + ".\n\nAnswers quote the paper with page numbers and cite it APA 7 style. Enter sends, Shift+Enter starts a new line, Esc stops an answer."
        color: win.foreground
        opacity: 0.5
        font.family: win.fontFamily
        font.pixelSize: Style.font.body
      }

      ListView {
        id: chatList
        anchors { left: parent.left; right: parent.right; top: parent.top; bottom: inputBar.top }
        anchors.margins: Style.space(14)
        clip: true
        spacing: Style.space(14)
        model: messages
        delegate: Item {
          id: msg
          required property int index
          required property string role
          required property string text
          required property bool pending
          required property bool failed
          required property string info
          readonly property bool mine: msg.role === "user"
          readonly property bool note: msg.role === "note" // where earlier questions were summarized
          width: ListView.view.width
          height: msg.note ? noteLine.implicitHeight + Style.space(10) : msgCol.implicitHeight

          Text {
            id: noteLine
            visible: msg.note
            anchors.centerIn: parent
            width: Math.min(parent.width - Style.space(40), 760)
            horizontalAlignment: Text.AlignHCenter
            wrapMode: Text.Wrap
            textFormat: Text.PlainText
            text: "— " + msg.text + " —"
            color: win.foreground
            opacity: 0.45
            font.family: win.fontFamily
            font.pixelSize: Style.font.caption
            font.italic: true
          }

          Column {
            id: msgCol
            visible: !msg.note
            width: msg.mine ? Math.min(implicitWidthHint.implicitWidth + Style.space(28), parent.width * 0.8) : parent.width
            anchors.right: msg.mine ? parent.right : undefined
            spacing: Style.space(4)

            Text { id: implicitWidthHint; visible: false; text: msg.text; font.family: win.fontFamily; font.pixelSize: Style.font.title }

            Rectangle {
              width: parent.width
              height: body.implicitHeight + Style.space(msg.mine ? 16 : 4)
              radius: Style.cornerRadius
              color: msg.mine ? win.hoverBackground : "transparent"
              TextEdit {
                id: body
                x: msg.mine ? Style.space(14) : 0
                y: msg.mine ? Style.space(8) : Style.space(2)
                width: parent.width - (msg.mine ? Style.space(28) : 0)
                readOnly: true
                selectByMouse: true
                textFormat: msg.mine ? TextEdit.PlainText : TextEdit.MarkdownText
                wrapMode: TextEdit.Wrap
                text: msg.text || (msg.pending ? (win.statusText || "Reading the paper…") : "")
                color: msg.mine ? win.accent : win.foreground
                opacity: msg.pending && !msg.text ? 0.5 : 1
                selectionColor: win.hoverBackground
                selectedTextColor: win.accent
                font.family: win.fontFamily
                font.pixelSize: Style.font.title
                onLinkActivated: function(link) { if (/^https?:/i.test(link)) Util.execArgv(["uwsm-app", "--", "xdg-open", link]) }
              }
            }

            // Its model, cost and quote check
            Text {
              visible: !msg.mine && !msg.pending && msg.info !== ""
              width: parent.width
              wrapMode: Text.Wrap
              textFormat: Text.PlainText
              text: msg.info
              color: msg.info.indexOf("⚠") >= 0 ? win.accent : win.foreground
              opacity: msg.info.indexOf("⚠") >= 0 ? 0.9 : 0.45
              font.family: win.fontFamily
              font.pixelSize: Style.font.caption
            }

            // An answer's outputs
            Row {
              visible: !msg.mine && !msg.pending && !msg.failed && msg.text !== ""
              spacing: Style.space(4)
              BarButton { icon: ""; label: "Copy"; tip: "Copy this answer as Markdown"; onClicked: win.copyText(msg.text) }
              BarButton { icon: ""; label: "Save to Zotero"; tip: "Save this answer as a note on the paper"; onClicked: win.saveToZotero(win.answerTitle(msg.index), msg.text) }
              BarButton { icon: ""; label: "Download"; tip: "Save this answer as a .md file in Downloads"; onClicked: win.download("Chat — " + win.cite + " — " + Views.chatTitle(win.questionBefore(msg.index)), msg.text) }
            }
          }
        }
      }

      // ---- the question
      Rectangle {
        id: inputBar
        anchors { left: parent.left; right: parent.right; bottom: parent.bottom; margins: Style.space(12) }
        // One line to start with, growing with the question up to eight; the model row sits below it.
        height: inputFlick.height + inputTools.height + Style.space(22)
        radius: Style.cornerRadius
        color: win.subtle
        border.width: 1
        border.color: input.activeFocus ? win.accent : win.line

        Flickable {
          id: inputFlick
          anchors { left: parent.left; right: parent.right; top: parent.top; leftMargin: Style.space(12); rightMargin: Style.space(12); topMargin: Style.space(10) }
          height: Math.min(Math.max(input.implicitHeight, win.lineHeight), win.lineHeight * 8)
          clip: true
          contentHeight: input.implicitHeight
          contentWidth: width
          function ensureVisible(r) {
            if (contentY >= r.y) contentY = r.y
            else if (contentY + height <= r.y + r.height) contentY = r.y + r.height - height
          }
          TextEdit {
            id: input
            width: inputFlick.width
            wrapMode: TextEdit.Wrap
            textFormat: TextEdit.PlainText
            color: win.foreground
            selectionColor: win.hoverBackground
            font.family: win.fontFamily
            font.pixelSize: Style.font.title
            onCursorRectangleChanged: inputFlick.ensureVisible(cursorRectangle)
            Keys.onPressed: function(event) {
              const enter = event.key === Qt.Key_Return || event.key === Qt.Key_Enter
              if (enter && !(event.modifiers & Qt.ShiftModifier)) { win.send(); event.accepted = true }
              else if (event.key === Qt.Key_M && (event.modifiers & Qt.AltModifier)) {
                win.menuRequested({ key: win.item.key, libraryID: win.item.libraryID, title: win.item.title, itemType: "" }, { rowId: "chat" }); event.accepted = true
              }
              else if (event.key === Qt.Key_Escape && win.busy) { win.stop(); event.accepted = true }
              else if (event.key === Qt.Key_Escape && (win.pickerOpen || win.newMenuOpen)) { win.closePopups(); event.accepted = true }
            }
          }
          Text {
            visible: !input.text && !input.activeFocus
            text: "Ask about the paper…"
            color: win.foreground
            opacity: 0.4
            font.family: win.fontFamily
            font.pixelSize: Style.font.title
          }
        }

        // The model (left) and Send (right), a thin row under the question.
        Item {
          id: inputTools
          anchors { left: parent.left; right: parent.right; top: inputFlick.bottom; leftMargin: Style.space(6); rightMargin: Style.space(6); topMargin: Style.space(4) }
          height: Style.space(22)
          BarButton {
            anchors { left: parent.left; verticalCenter: parent.verticalCenter }
            height: Style.space(22)
            small: true
            icon: ""
            label: Views.modelLabel(win.service ? win.service.models : null, win.model, win.service ? win.service.modelDefaults.chat : "") + (win.effort ? " · " + win.effort : "") + " ▾"
            tip: "The model and effort for the next answers"
            onClicked: {
              const p = inputBar.mapToItem(rootItem, 0, 0)
              win.pickerX = p.x
              win.pickerY = p.y - Style.space(6)
              win.pickerOpen = !win.pickerOpen
              if (win.service && !win.service.models) win.service.refreshModels()
            }
          }
          BarButton {
            id: sendButton
            anchors { right: parent.right; verticalCenter: parent.verticalCenter }
            height: Style.space(22)
            small: true
            icon: win.busy ? "" : ""
            label: win.busy ? "Stop" : "Send"
            tip: win.busy ? "Stop this answer (Esc)" : "Send (Enter; Shift+Enter for a new line)"
            onClicked: win.busy ? win.stop() : win.send()
          }
        }
      }

      // ---- model and effort picker
      Rectangle {
        visible: win.pickerOpen
        parent: rootItem // above the click catcher, which closes it on a click elsewhere
        z: 10
        x: win.pickerX
        y: win.pickerY - height
        width: Style.space(360)
        height: pickerCol.implicitHeight + Style.space(16)
        radius: Style.cornerRadius
        color: win.background
        border.width: 1
        border.color: win.line
        Column {
          id: pickerCol
          x: Style.space(8); y: Style.space(8)
          width: parent.width - Style.space(16)
          spacing: Style.space(2)
          Text { text: "MODEL"; color: win.foreground; opacity: 0.45; font.family: win.fontFamily; font.pixelSize: Style.font.caption; font.letterSpacing: 1 }
          PickRow {
            width: parent.width
            label: "Default"
            detail: win.service && win.service.modelDefaults.chat ? "now " + win.service.modelDefaults.chat + " (Settings › Defaults)" : "Settings › Defaults"
            checked: !win.model || win.model === "default"
            onClicked: win.model = "default"
          }
          // Every enabled provider's models, under its name; scrolls when there are many.
          ListView {
            id: modelList
            width: parent.width
            height: Math.min(contentHeight, Style.space(320))
            clip: true
            boundsBehavior: Flickable.StopAtBounds
            model: win.service && win.service.models ? win.service.models : []
            section.property: "group"
            section.delegate: Text {
              required property string section
              width: ListView.view.width
              topPadding: Style.space(6)
              text: section.toUpperCase()
              color: win.foreground; opacity: 0.4
              font.family: win.fontFamily; font.pixelSize: Style.font.caption; font.letterSpacing: 1
            }
            delegate: PickRow {
              required property var modelData
              width: ListView.view.width
              label: modelData.displayName
              detail: Settings.modelDetail(modelData)
              checked: Views.findModel([modelData], win.model) !== null
              onClicked: {
                win.effort = Views.effortFor(win.service.models, modelData.value, win.effort)
                win.model = modelData.value
              }
            }
          }
          Text {
            visible: win.service && win.service.models && !win.service.models.length
            width: parent.width; wrapMode: Text.Wrap
            text: "No models: turn a provider on in the launcher's Settings"
            color: win.foreground; opacity: 0.6; font.family: win.fontFamily; font.pixelSize: Style.font.bodySmall
          }
          Item { width: 1; height: Style.space(6) }
          Text { text: "EFFORT"; color: win.foreground; opacity: 0.45; font.family: win.fontFamily; font.pixelSize: Style.font.caption; font.letterSpacing: 1 }
          Repeater {
            model: {
              const m = win.service && win.service.models ? Views.findModel(win.service.models, !win.model || win.model === "default" ? win.service.modelDefaults.chat : win.model) : null
              return m ? (m.efforts || []) : ["low", "medium", "high", "xhigh", "max"]
            }
            delegate: PickRow {
              required property var modelData
              label: modelData
              detail: ""
              checked: modelData === win.effort
              onClicked: { win.effort = modelData; win.pickerOpen = false }
            }
          }
        }
      }
    }
  }

  // ---- a click outside an open pop-up closes it
  MouseArea {
    parent: rootItem
    anchors.fill: parent
    z: 9
    visible: win.pickerOpen || win.newMenuOpen || win.pickerOpen2
    onClicked: win.closePopups()
  }

  // ---- "New chat ▾": this paper, or another one
  Rectangle {
    visible: win.newMenuOpen
    parent: rootItem
    z: 10
    x: rootItem.width - width - Style.space(12)
    y: Style.space(46)
    width: Style.space(300)
    height: newCol.implicitHeight + Style.space(12)
    radius: Style.cornerRadius
    color: win.background
    border.width: 1
    border.color: win.line
    Column {
      id: newCol
      x: Style.space(6); y: Style.space(6)
      width: parent.width - Style.space(12)
      PickRow { label: "About this paper"; detail: win.cite; onClicked: { win.newMenuOpen = false; win.newChat() } }
      PickRow {
        label: "About another paper…"; detail: "pick it from your library"
        onClicked: { win.newMenuOpen = false; win.pickerOpen2 = true; pickInput.text = ""; win.searchPapers(""); pickInput.forceActiveFocus() }
      }
    }
  }

  // ---- picking another paper
  Rectangle {
    visible: win.pickerOpen2
    parent: rootItem
    z: 10
    anchors.centerIn: parent
    width: Math.min(rootItem.width - Style.space(40), Style.space(640))
    height: Math.min(rootItem.height - Style.space(80), Style.space(520))
    radius: Style.cornerRadius
    color: win.background
    border.width: 1
    border.color: win.accent

    Rectangle {
      id: pickBox
      anchors { left: parent.left; right: parent.right; top: parent.top; margins: Style.space(12) }
      height: Style.space(38)
      radius: Style.cornerRadius
      color: win.subtle
      TextInput {
        id: pickInput
        anchors { fill: parent; leftMargin: Style.space(12); rightMargin: Style.space(12) }
        verticalAlignment: TextInput.AlignVCenter
        color: win.foreground
        font.family: win.fontFamily
        font.pixelSize: Style.font.title
        onTextChanged: { pickDebounce.restart(); pickList.currentIndex = 0 }
        Keys.onPressed: function(event) {
          if (event.key === Qt.Key_Escape) { win.pickerOpen2 = false; input.forceActiveFocus(); event.accepted = true }
          else if (event.key === Qt.Key_Down) { pickList.incrementCurrentIndex(); event.accepted = true }
          else if (event.key === Qt.Key_Up) { pickList.decrementCurrentIndex(); event.accepted = true }
          else if ((event.key === Qt.Key_Return || event.key === Qt.Key_Enter) && win.pickResults.length) {
            win.switchPaper(win.pickResults[Math.max(0, pickList.currentIndex)]); event.accepted = true
          }
        }
        Text {
          visible: !pickInput.text
          anchors.verticalCenter: parent.verticalCenter
          text: "Search for the paper to chat about…"
          color: win.foreground
          opacity: 0.4
          font.family: win.fontFamily
          font.pixelSize: Style.font.title
        }
      }
      Timer { id: pickDebounce; interval: 150; onTriggered: win.searchPapers(pickInput.text) }
    }

    ListView {
      id: pickList
      anchors { left: parent.left; right: parent.right; top: pickBox.bottom; bottom: parent.bottom; margins: Style.space(12) }
      clip: true
      model: win.pickResults
      delegate: Rectangle {
        required property var modelData
        required property int index
        width: ListView.view.width
        height: pickRowCol.implicitHeight + Style.space(12)
        radius: Style.cornerRadius
        color: index === pickList.currentIndex || pickRowMouse.containsMouse ? win.hoverBackground : "transparent"
        Column {
          id: pickRowCol
          x: Style.space(10)
          width: parent.width - Style.space(20)
          anchors.verticalCenter: parent.verticalCenter
          Text {
            width: parent.width
            textFormat: Text.PlainText
            text: modelData.title
            color: index === pickList.currentIndex ? win.accent : win.foreground
            font.family: win.fontFamily
            font.pixelSize: Style.font.body
            elide: Text.ElideRight
          }
          Text {
            width: parent.width
            textFormat: Text.PlainText
            text: [modelData.creator, modelData.year, modelData.publication].filter(function(x) { return x }).join(" · ")
            color: win.foreground
            opacity: 0.5
            font.family: win.fontFamily
            font.pixelSize: Style.font.bodySmall
            elide: Text.ElideRight
          }
        }
        MouseArea {
          id: pickRowMouse
          anchors.fill: parent
          hoverEnabled: true
          cursorShape: Qt.PointingHandCursor
          onClicked: win.switchPaper(modelData)
        }
      }
    }
  }

  // A small button: icon, optional label; hovering shows its tip in the top bar.
  component BarButton: Rectangle {
    id: btn
    property string icon: ""
    property string label: ""
    property string tip: ""
    property bool small: false // the thin row under the question
    signal clicked()
    width: content.implicitWidth + Style.space(btn.small ? 10 : 16)
    height: Style.space(28)
    radius: Style.cornerRadius
    opacity: btn.enabled ? 1 : 0.4
    color: mouse.containsMouse && btn.enabled ? win.hoverBackground : "transparent"
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
        opacity: btn.small && !mouse.containsMouse ? 0.7 : 1
        font.family: win.fontFamily
        font.pixelSize: btn.small ? Style.font.caption : Style.font.bodySmall
      }
    }
    MouseArea {
      id: mouse
      anchors.fill: parent
      hoverEnabled: true
      cursorShape: Qt.PointingHandCursor
      onClicked: if (btn.enabled) btn.clicked()
      onContainsMouseChanged: if (containsMouse && btn.tip) win.showFlash(btn.tip)
    }
  }

  component PickRow: Rectangle {
    id: pick
    property string label: ""
    property string detail: ""
    property bool checked: false
    signal clicked()
    width: parent ? parent.width : 0
    height: pickText.implicitHeight + Style.space(10)
    radius: Style.cornerRadius
    color: pickMouse.containsMouse ? win.hoverBackground : "transparent"
    Text {
      id: pickText
      x: Style.space(8)
      width: parent.width - Style.space(16)
      anchors.verticalCenter: parent.verticalCenter
      textFormat: Text.PlainText
      text: (pick.checked ? "● " : "○ ") + pick.label + (pick.detail ? "  ·  " + pick.detail : "")
      color: pick.checked ? win.accent : win.foreground
      font.family: win.fontFamily
      font.pixelSize: Style.font.bodySmall
      elide: Text.ElideRight
    }
    MouseArea {
      id: pickMouse
      anchors.fill: parent
      hoverEnabled: true
      cursorShape: Qt.PointingHandCursor
      onClicked: pick.clicked()
    }
  }
}

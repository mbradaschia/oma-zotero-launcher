// Glue's wrappers for phase 8: the chat window's logic (reference/ChatWindow.qml) as pure functions
// (its events, the lines under answers, the conversation as HTML, the transcript), and the launcher's
// chats and artifacts (ZoteroSearch.qml's chat menu, rename pages, the Chats view, an artifact's
// menu). Merged into Glue (Glue.js); JSON in, JSON out. `Mk`: the vendored marked (Resources/vendor).
function GlueChat(V, F, Mk) {
  var esc = function (s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;") }
  // A model's Markdown as HTML: safeMarkdown first (no tag, no image), then only the links a click may follow
  // (the web, mail, an artifact): the app's own oma-answer: links, or javascript: and file:, never come from it.
  var md = function (text) {
    var safe = V.safeMarkdown(text)
    var html = Mk && Mk.marked ? Mk.marked.parse(safe, { gfm: true, async: false }) : Mk && Mk.parse ? Mk.parse(safe, { gfm: true, async: false }) : "<p>" + esc(safe) + "</p>"
    return html.replace(/<a href="([^"]*)"/g, function (m, href) { return /^(https?:|mailto:|oma-artifact:)/i.test(href) ? m : "<a" })
  }

  // ChatWindow.qml's kTokens: 12k, 1.5M.
  var kTokens = function (n) {
    n = Number(n) || 0
    return n >= 1000000 ? (n / 1000000).toFixed(n % 1000000 ? 1 : 0) + "M" : n >= 1000 ? Math.round(n / 1000) + "k" : String(n)
  }

  // While an answer streams in, an artifact's text shows as one line (it becomes a link when saved).
  var streamView = function (text) {
    return String(text || "").replace(/<artifact\b[^>]*?title="([^"]*)"[^>]*>[\s\S]*?<\/artifact>/gi, "\n\n▣ *$1: saved when the answer ends*\n\n")
      .replace(/<artifact\b[^>]*>[\s\S]*?<\/artifact>/gi, "\n\n▣ *An artifact: saved when the answer ends*\n\n")
      .replace(/<artifact\b([^>]*)(>[\s\S]*)?$/i, function (m, attrs) {
        var t = /title="([^"]*)"/.exec(attrs || "")
        return "\n\n▣ *Writing " + (t ? "“" + t[1] + "”" : "an artifact") + "…*"
      })
  }

  // The line under an answer: its model, what it cost, and the quote check.
  var answerInfo = function (models, model, quotes, costUsd) {
    var bits = []
    if (model) bits.push(V.modelLabel(models || null, model))
    if (typeof costUsd === "number") bits.push(costUsd < 0.01 ? (costUsd ? "< $0.01" : "free") : "$" + costUsd.toFixed(2))
    if (quotes && quotes.checked) {
      var miss = quotes.missing || []
      bits.push(miss.length ? "⚠ " + miss.length + " of " + quotes.checked + (quotes.checked === 1 ? " quote" : " quotes") + " not found word for word in the paper: " +
        miss.map(function (q) { q = String(q); return "“" + (q.length > 80 ? q.slice(0, 77) + "…" : q) + "”" }).join("; ")
        : "✓ " + (quotes.checked === 1 ? "the quote was" : "all " + quotes.checked + " quotes were") + " found in the paper")
    }
    return bits.join(" · ")
  }

  // One event line of `chat` applied to the window's state ({ messages: [{ role, text, pending, failed, info,
  // model }], sessionId, grounding, model, contextUsed, contextWindow, statusText, pendingQuotes }). → { state,
  // flash, artifact: { id, view } | null, scroll }
  var chatEvent = function (state, line, models) {
    var ev = null
    try { ev = JSON.parse(line) } catch (e) { return { state: state, flash: "", artifact: null } }
    var s = JSON.parse(JSON.stringify(state))
    var ms = s.messages
    var last = ms.length - 1
    var out = { state: s, flash: "", artifact: null }
    if (!ev || typeof ev !== "object") return out
    if (ev.type === "session") {
      s.sessionId = ev.id || s.sessionId
      if (ev.grounding) s.grounding = ev.grounding.label
      if (ev.model) s.model = ev.model
    } else if (ev.type === "context") {
      s.contextUsed = ev.used || 0
      s.contextWindow = ev.window || 0
      if (ev.compacted) out.flash = "Earlier questions were summarized to fit the context"
    } else if (ev.type === "status") {
      s.statusText = String(ev.text || "")
    } else if (ev.type === "note" && last >= 1) {
      ms.splice(last - 1, 0, { role: "note", text: String(ev.text || ""), pending: false, failed: false, info: "" }) // before this question
    } else if (ev.type === "delta" && last >= 0) {
      s.statusText = ""
      ms[last].text += String(ev.text || "")
    } else if (ev.type === "artifact") {
      out.artifact = { id: ev.id, view: ev.view || "" }
      out.flash = (ev.isNew ? "Made “" : "Changed “") + ev.title + "” (" + ev.formatLabel + ", version " + ev.version + "): click it to open" + (ev.warning ? " · it may not display: " + ev.warning : "")
    } else if (ev.type === "quotes") {
      s.pendingQuotes = { checked: ev.checked || 0, missing: ev.missing || [] }
    } else if (ev.type === "done" && last >= 0) {
      ms[last].text = String(ev.text || "")
      ms[last].pending = false
      ms[last].model = ev.model || ""
      ms[last].info = answerInfo(models, ev.model, s.pendingQuotes, ev.costUsd)
      s.pendingQuotes = null
    } else if (ev.type === "error" && last >= 0) {
      ms[last].text = "Couldn't answer: " + ev.message
      ms[last].pending = false
      ms[last].failed = true
    }
    return out
  }

  // The turn ended (the process exited): an answer still pending was stopped (or failed with nothing).
  var turnEnded = function (state, stderrLast) {
    var s = JSON.parse(JSON.stringify(state))
    var last = s.messages.length - 1
    s.statusText = ""
    if (last >= 0 && s.messages[last].pending) {
      var had = s.messages[last].text
      s.messages[last].pending = false
      s.messages[last].failed = true
      s.messages[last].text = had ? had + "\n\n*(stopped)*" : "*(stopped: " + (stderrLast || "no answer") + ")*"
    }
    return s
  }

  // A past chat (chat-show) as the window's messages.
  var sessionMessages = function (session, models) {
    return ((session && session.messages) || []).map(function (m) {
      return { role: m.role, text: String(m.text || ""), pending: false, failed: false, model: m.model || "", info: m.role === "assistant" ? answerInfo(models, m.model, m.quotes, m.costUsd) : "" }
    })
  }

  // The conversation as the web view's body (JavaScript off: an answer's Copy, Save to Zotero and Download
  // are oma-answer: links the app takes). o: { cite, status } → HTML
  var chatHtml = function (messages, o) {
    o = o || {}
    if (!messages || !messages.length) {
      return '<p class="empty">Ask anything about ' + esc(o.cite || "the paper") + ".</p><p class=\"empty\">Answers quote the paper with page numbers and cite it APA 7 style. " +
        "Enter sends, ⇧↵ starts a new line, esc stops an answer.</p>"
    }
    return messages.map(function (m, i) {
      if (m.role === "user") return '<div class="msg user"><div class="bubble">' + esc(m.text).replace(/\n/g, "<br>") + "</div></div>"
      if (m.role === "note") return '<p class="note"><em>' + esc(m.text) + "</em></p>"
      var body = m.pending && !m.text ? '<p class="status">' + esc(o.status || "Reading the paper…") + "</p>" : md(m.pending ? streamView(m.text) : m.text)
      var info = !m.pending && m.info ? '<p class="info' + (/^⚠|· ⚠/.test(m.info) ? " warn" : "") + '">' + esc(m.info) + "</p>" : ""
      var acts = !m.pending && !m.failed && m.text ? '<p class="acts"><a href="oma-answer:copy/' + i + '">Copy</a> · <a href="oma-answer:save/' + i +
        '">Save to Zotero</a> · <a href="oma-answer:download/' + i + '">Download</a></p>' : ""
      return '<div class="msg assistant' + (m.failed ? " failed" : "") + '" id="m' + i + '">' + body + info + acts + "</div>"
    }).join("\n")
  }

  // The question an answer replies to (its note's title, its file's name).
  var questionBefore = function (messages, index) {
    for (var i = index - 1; i >= 0; i--) if (messages[i].role === "user") return messages[i].text
    return ""
  }

  // The whole chat as Markdown: a title, the paper, then each turn (the answer's model named, not "Claude").
  var transcript = function (messages, o) {
    o = o || {}
    var lines = ["# Chat: " + (o.title || o.paperTitle || "chat"), "", "*" + o.cite + (o.paperTitle ? " · " + o.paperTitle : "") + "*", ""]
    ;(messages || []).forEach(function (m) {
      var who = m.model ? V.modelLabel(o.models || null, m.model) : "The model"
      lines.push(m.role === "note" ? "*" + m.text + "*" : (m.role === "user" ? "**You:** " : "**" + who + ":** ") + m.text, "")
    })
    return lines.join("\n")
  }

  // The banner's line: what this chat reads, its model and effort, the context used.
  var chatInfoLine = function (o, models, chatDefault) {
    var used = Number(o.contextUsed) || 0, win = Number(o.contextWindow) || 0
    return { text: (o.sessionId ? "this chat: " + o.grounding + " · " : "") + V.modelLabel(models || null, o.model || "default", chatDefault || "") + (o.effort ? " · " + o.effort : "")
      + (win ? "  ·  context " + kTokens(used) + " / " + kTokens(win) + " (" + Math.round(100 * used / win) + "%)" : ""), high: !!win && used / win > 0.6 }
  }

  // `chat`'s argv after the command: a chat in progress resumes; a new one says what it reads.
  var chatArgs = function (item, o) {
    var a = ["chat", "--key", item.key, "--library", String(item.libraryID || 1), "--model", o.model || "default", "--effort", o.effort || "default"]
    return a.concat(o.sessionId ? ["--session", o.sessionId] : ["--source", o.source === "note" ? "note" : "pdf"])
  }

  // The model picker's rows: Default (now <the chat default>), the models by provider; then the efforts.
  var modelMenu = function (models, model, effort, chatDefault) {
    var groups = []
    ;(models || []).forEach(function (m) {
      var g = groups.filter(function (x) { return x.name === (m.group || "") })[0]
      if (!g) { g = { name: m.group || "", models: [] }; groups.push(g) }
      g.models.push({ spec: m.spec, label: m.displayName || m.spec, checked: m.spec === model })
    })
    var cur = V.findModel(models || null, model === "default" ? chatDefault : model)
    var efforts = cur && cur.efforts && cur.efforts.length ? cur.efforts : ["low", "medium", "high", "xhigh", "max"]
    return { defaultDetail: chatDefault ? "now " + V.modelLabel(models || null, chatDefault) + " (Settings › Defaults)" : "Settings › Defaults", defaultChecked: !model || model === "default",
      groups: groups, efforts: efforts.map(function (e) { return { name: e, checked: e === effort } }), none: !(models || []).length }
  }

  return {
    kTokens: kTokens,
    streamView: streamView,
    answerInfo: function (models, model, quotes, costUsd) { return answerInfo(models, model, quotes, costUsd) },
    chatEvent: chatEvent,
    turnEnded: function (state, stderrLast) { return turnEnded(state, stderrLast || "") },
    sessionMessages: sessionMessages,
    chatHtml: function (messages, o) { return chatHtml(messages, o) },
    questionBefore: questionBefore,
    transcript: transcript,
    chatInfoLine: chatInfoLine,
    chatArgs: chatArgs,
    modelMenu: modelMenu,
    chatTitle: function (q) { return V.chatTitle(q) },
    modelLabel: function (models, spec, resolved) { return V.modelLabel(models || null, spec, resolved || "") },
    // ---- the launcher
    chatRows: function (chats, query, color) { return V.buildChatRows(chats || [], query || "", color, F.filter) },
    chatMenuRows: function (chat) {
      var c = chat || {}
      return [
        V.listRow({ rowId: "chat-menu-open", icon: "\uf442", label: "Open", detail: "Continue it in its chat window", available: true, trailing: "window" }),
        V.listRow({ rowId: "chat-menu-rename", icon: "\uf448", label: "Rename…", detail: c.title || "", available: true, submenu: true }),
        V.listRow({ rowId: "chat-menu-delete", icon: "\uf48e", label: "Delete this chat", detail: "Its answers saved as notes stay in Zotero", available: true })
      ]
    },
    // The rename pages (a chat's, an artifact's): one row, Enter renames.
    renameRows: function (rowId, text) {
      var t = String(text || "").trim()
      return [V.listRow({ rowId: rowId, icon: rowId === "chat-rename-save" ? "\uf448" : "\uf044", label: t ? "Rename to “" + t + "”" : "Type the new name", available: !!t, value: t })]
    },
    // (its folder's path with ~, as every path a row shows)
    artifactMenu: function (a, home) {
      if (!a) return []
      return V.buildArtifactMenu(a).map(function (r) {
        if (home && typeof r.detail === "string" && r.detail.indexOf(home + "/") === 0) r.detail = "~" + r.detail.slice(home.length)
        return r
      })
    },
    artifactChangeRows: function (a, text, ready) { return a ? V.buildArtifactChangeRows(a, text || "", !!ready) : [] }
  }
}

if (typeof module !== "undefined") module.exports = GlueChat

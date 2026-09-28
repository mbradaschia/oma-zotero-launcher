// Phase 0 spike (a) + (c): run with `quickshell -p spikes/qs-bridge-test`.
// Exercises the bridge from Quickshell exactly as the plugin will (FileView
// handshake, QML XMLHttpRequest), then Hyprland window lookup + focus dispatch.
// Prints RESULT lines and quits. Focus is handed back to the original window.
import QtQuick
import Quickshell
import Quickshell.Io
import Quickshell.Hyprland

ShellRoot {
  id: root

  property var hs: null
  property var latencies: []
  property var parseTimes: []
  property int step: 0
  property string originalAddress: ""
  readonly property var queries: ["s", "su", "sup", "supp", "suppl", "supply", "supply c", "supply ch", "supply chain", "stev", "stev r", "stev resil", "pimm", "pimm 1984", "#resilience"]

  function log(msg) { console.warn("RESULT " + msg) }

  FileView {
    path: Quickshell.env("XDG_RUNTIME_DIR") + "/oma-zotero/bridge.json"
    onLoaded: { root.hs = JSON.parse(text()); root.log("handshake ok port=" + root.hs.port); root.echo() }
    onLoadFailed: function(err) { root.log("handshake load failed: " + err); Qt.quit() }
  }

  function request(path, body, cb, opts) {
    opts = opts || {}
    const xhr = new XMLHttpRequest()
    const t0 = Date.now()
    xhr.onreadystatechange = function() {
      if (xhr.readyState === XMLHttpRequest.DONE) cb(xhr.status, xhr.responseText, Date.now() - t0)
    }
    xhr.open(body === null ? "GET" : "POST", "http://127.0.0.1:" + root.hs.port + "/oma-zotero" + path)
    if (!opts.noAllowHeader) xhr.setRequestHeader("Zotero-Allowed-Request", "1")
    xhr.setRequestHeader("Authorization", "Bearer " + root.hs.token)
    xhr.setRequestHeader("Content-Type", "application/json")
    xhr.send(body === null ? "" : JSON.stringify(body))
  }

  // 1. Which headers does Qt's XHR send (User-Agent? Origin?)
  function echo() {
    request("/dev/echo", { from: "quickshell" }, function(status, text) {
      const r = JSON.parse(text)
      root.log("echo status=" + status + " headers=" + JSON.stringify(r.headers))
      root.log("qt sends origin: " + ("origin" in r.headers))
      root.withoutAllowHeader()
    })
  }

  // 2. Without Zotero-Allowed-Request, Zotero should drop us (status 0).
  function withoutAllowHeader() {
    request("/ping", null, function(status) {
      root.log("without Zotero-Allowed-Request: status=" + status + " (0 = dropped)")
      root.nextSearch()
    }, { noAllowHeader: true })
  }

  // 3. End-to-end latency incl. JSON.parse, like typing (sequential).
  function nextSearch() {
    if (root.step >= root.queries.length * 2) return root.reportLatency()
    const q = root.queries[root.step % root.queries.length]
    root.step++
    request("/search", { query: q, limit: 60 }, function(status, text, ms) {
      const t0 = Date.now()
      const r = JSON.parse(text)
      root.parseTimes.push(Date.now() - t0)
      if (status !== 200 || !r.ok) root.log("search failed: " + status + " " + text.slice(0, 200))
      root.latencies.push(ms)
      root.nextSearch()
    })
  }

  function pct(arr, p) {
    const s = arr.slice().sort(function(a, b) { return a - b })
    return s[Math.min(s.length - 1, Math.floor(s.length * p))]
  }

  function reportLatency() {
    root.log("search round-trip ms: p50=" + pct(root.latencies, 0.5) + " p95=" + pct(root.latencies, 0.95) + " max=" + pct(root.latencies, 1) + " n=" + root.latencies.length)
    root.log("JSON.parse ms: p50=" + pct(root.parseTimes, 0.5) + " max=" + pct(root.parseTimes, 1))
    root.hyprland()
  }

  // 4. Hyprland: find Zotero windows, focus the main one, then restore focus.
  // A fresh Quickshell instance fills the toplevel model asynchronously (the
  // long-running omarchy-shell always has it), so wait for it here.
  property int hyprTries: 0
  Component.onCompleted: Hyprland.refreshToplevels()
  Timer { id: hyprRetry; interval: 500; onTriggered: root.hyprland() }

  function hyprland() {
    if (Hyprland.toplevels.values.length === 0 && root.hyprTries++ < 10) {
      Hyprland.refreshToplevels()
      return hyprRetry.start()
    }
    root.log("toplevels available after " + root.hyprTries + " retries: " + Hyprland.toplevels.values.length)
    const active = Hyprland.activeToplevel
    root.originalAddress = active ? String(active.address) : ""
    const zotero = []
    const all = Hyprland.toplevels.values
    for (let i = 0; i < all.length; i++) {
      const t = all[i]
      const ipc = t.lastIpcObject || {}
      if (ipc.class === "Zotero") zotero.push({ address: String(t.address), title: t.title, initialTitle: ipc.initialTitle, initialClass: ipc.initialClass })
    }
    root.log("zotero toplevels: " + JSON.stringify(zotero))
    root.log("original active: " + root.originalAddress + " " + (active ? active.title : ""))
    const main = zotero.filter(function(z) { return /( - )?Zotero$/.test(z.title) })[0]
    if (!main) { root.log("no main window found"); return Qt.quit() }
    const addr = main.address.indexOf("0x") === 0 ? main.address : "0x" + main.address
    root.log("dispatch: hl.dsp.focus({ window = \"address:" + addr + "\" })")
    Hyprland.dispatch("hl.dsp.focus({ window = \"address:" + addr + "\" })")
    checkTimer.target = main.address.replace(/^0x/, "")
    checkTimer.start()
  }

  Timer {
    id: checkTimer
    property string target: ""
    interval: 400
    onTriggered: {
      const a = Hyprland.activeToplevel
      const now = a ? String(a.address).replace(/^0x/, "") : ""
      root.log("focus via Hyprland.dispatch(Lua): " + (now === target ? "OK" : "FAILED (active=" + now + ")"))
      if (root.originalAddress) {
        const back = root.originalAddress.indexOf("0x") === 0 ? root.originalAddress : "0x" + root.originalAddress
        Hyprland.dispatch("hl.dsp.focus({ window = \"address:" + back + "\" })")
      }
      quitTimer.start()
    }
  }

  Timer { id: quitTimer; interval: 300; onTriggered: Qt.quit() }
  Timer { interval: 30000; running: true; onTriggered: { root.log("timeout"); Qt.quit() } }
}

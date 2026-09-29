// Every root.fn() / win.fn() a QML file calls is a function or signal it declares, and every
// service.fn() exists in Service.qml. qmllint can't see these (they resolve at run time), and
// a missing one only fails when that key or button is used.
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const BUILTIN = new Set(["destroy", "forceActiveFocus"]);
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const declared = (src) => new Set([
  ...[...src.matchAll(/function (\w+)\s*\(/g)].map((m) => m[1]),
  ...[...src.matchAll(/^\s*signal (\w+)/gm)].map((m) => m[1]),
]);
const service = declared(read("Service.qml"));
let bad = 0;
for (const [file, self] of [["ZoteroSearch.qml", "root"], ["Service.qml", "root"], ["NoteWindow.qml", "win"], ["ChatWindow.qml", "win"]]) {
  const src = read(file);
  const own = declared(src);
  for (const m of src.matchAll(new RegExp(`\\b${self}\\.(\\w+)\\(`, "g"))) {
    if (!own.has(m[1]) && !BUILTIN.has(m[1])) { console.error(`${file}: ${self}.${m[1]}() is not declared`); bad++; }
  }
  for (const m of src.matchAll(/\bservice\.(\w+)\(/g)) {
    if (!service.has(m[1])) { console.error(`${file}: service.${m[1]}() is not in Service.qml`); bad++; }
  }
}
process.exit(bad ? 1 : 0);

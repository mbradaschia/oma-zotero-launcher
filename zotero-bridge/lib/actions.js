/* "Enter" semantics (PLAN.md §5.6): decide with the pure `plan()`, act with
 * `execute()`. describe() turns a Zotero item into plain data so that plan()
 * can be unit-tested without Zotero. */
/* global Zotero, OmaTabs, omaHttpError */

var OmaActions = {
  READER_TYPES: ["pdf", "epub", "snapshot"],

  // Plain-data view of the item the user wants to open. "best" is the first file
  // that the reader can show *and* exists: Zotero's own getBestAttachment() can
  // pick a PDF whose file is missing while a sibling PDF is there.
  async describe(item) {
    if (item.isRegularItem()) {
      const childIDs = item.getAttachments(false).concat(item.getNotes(false));
      const files = await OmaActions.fileAttachments(item);
      const best = files.find((f) => f.exists && OmaActions.READER_TYPES.includes(f.readerType)) || files[0];
      return {
        kind: "regular",
        id: item.id,
        childIDs,
        best: best ? { id: Zotero.Items.getIDFromLibraryAndKey(best.libraryID, best.key), readerType: best.readerType, exists: best.exists } : null,
      };
    }
    if (item.isAttachment()) return { kind: "attachment", id: item.id, childIDs: [], best: await OmaActions.readable(item) };
    if (item.isNote()) return { kind: "note", id: item.id, childIDs: [], best: null };
    throw omaHttpError(400, "unsupported", `cannot open a ${item.itemType} item`);
  },

  async readable(att) {
    const readerType = att.attachmentReaderType || null; // pdf | epub | snapshot, file attachments only
    const exists = readerType ? !!(await att.getFilePathAsync()) : false;
    return { id: att.id, readerType, exists };
  },

  // The item's files (a standalone attachment is its own file), for the actions
  // view: existing files first, then Zotero's best attachment, then PDFs, then by
  // title. Linked URLs have no file.
  async fileAttachments(item) {
    let atts;
    if (item.isRegularItem()) atts = Zotero.Items.get(item.getAttachments(false));
    else if (item.isAttachment()) atts = [item];
    else return [];
    const best = item.isRegularItem() ? await item.getBestAttachment() : null;
    const out = [];
    for (const att of atts) {
      if (!att.isFileAttachment()) continue;
      out.push({
        key: att.key,
        libraryID: att.libraryID,
        title: att.getDisplayTitle() || att.attachmentFilename || "(untitled)",
        filename: att.attachmentFilename || "",
        contentType: att.attachmentContentType || "",
        readerType: att.attachmentReaderType || null,
        exists: !!(await att.getFilePathAsync()),
        best: !!(best && best.id === att.id),
      });
    }
    return out.sort(OmaActions.compareAttachments);
  },

  compareAttachments(a, b) {
    const pdf = (x) => (x.contentType === "application/pdf" ? 1 : 0);
    return (
      (b.exists ? 1 : 0) - (a.exists ? 1 : 0) ||
      (b.best ? 1 : 0) - (a.best ? 1 : 0) ||
      pdf(b) - pdf(a) ||
      String(a.title).localeCompare(String(b.title))
    );
  },

  /**
   * @param target  describe() result
   * @param open    OmaTabs.list() rows: { kind: "tab"|"window", tabType, tabId, itemID, selected, timeSelected, index }
   * @returns       { action: "switch-tab"|"focus-window"|"open-note"|"open-reader"|"select", itemID, tabId?, windowKind? }
   */
  plan(target, open) {
    // 1. Already open (the item itself or any of its attachments/notes): go there.
    const ids = new Set([target.id].concat(target.childIDs || []));
    const mine = (open || []).filter((o) => ids.has(o.itemID));
    const tabs = mine
      .filter((o) => o.kind === "tab")
      .sort(
        (a, b) =>
          (b.selected ? 1 : 0) - (a.selected ? 1 : 0) ||
          (b.timeSelected || 0) - (a.timeSelected || 0) ||
          (a.index || 0) - (b.index || 0)
      );
    if (tabs.length) return { action: "switch-tab", tabId: tabs[0].tabId, itemID: tabs[0].itemID };
    const win = mine.find((o) => o.kind === "window");
    if (win) return { action: "focus-window", itemID: win.itemID, windowKind: win.tabType };

    // 2. Open it: notes in the note editor, readable files in Zotero's reader.
    if (target.kind === "note") return { action: "open-note", itemID: target.id };
    const best = target.best;
    if (best && best.exists && OmaActions.READER_TYPES.includes(best.readerType)) {
      return { action: "open-reader", itemID: best.id };
    }

    // 3. Nothing to open (no attachment, missing file, linked URL, …): show it in the library.
    return { action: "select", itemID: target.id };
  },

  // Returns { windowKind: "main"|"reader"|"note", windowTitle } so the shell can focus the right window.
  async execute(plan) {
    const win = Zotero.getMainWindow();
    const main = () => ({ windowKind: "main", windowTitle: win && !win.closed ? win.document.title : null });
    const requireMain = () => {
      if (!win || win.closed) throw omaHttpError(409, "no-main-window", "Zotero's main window is not open");
    };

    switch (plan.action) {
      case "switch-tab":
        requireMain();
        win.Zotero_Tabs.select(plan.tabId);
        return main();

      case "focus-window": {
        const w = OmaTabs.findWindow(plan.itemID, plan.windowKind);
        if (!w) throw omaHttpError(409, "window-gone", "the item's window was closed");
        w.focus();
        return { windowKind: plan.windowKind, windowTitle: w.document.title };
      }

      case "open-reader": {
        // A tab normally; a window when Zotero's "open PDFs in new window" pref is on.
        const reader = await Zotero.Reader.open(plan.itemID);
        if (reader && !reader.tabID && reader._window) {
          return { windowKind: "reader", windowTitle: reader._window.document.title };
        }
        return main();
      }

      case "open-note": {
        await Zotero.Notes.open(plan.itemID);
        const w = OmaTabs.findWindow(plan.itemID, "note");
        return w ? { windowKind: "note", windowTitle: w.document.title } : main();
      }

      case "select": {
        requireMain();
        // Selects in the current view, else switches to the library root (or trash).
        await win.ZoteroPane.selectItem(plan.itemID);
        const selected = win.ZoteroPane.getSelectedItems(true, { libraryTabOnly: true }).includes(plan.itemID);
        if (!selected) throw omaHttpError(409, "not-selectable", "Zotero could not select the item");
        return main();
      }

      default:
        throw omaHttpError(400, "bad-plan", `unknown action ${plan.action}`);
    }
  },
};

if (typeof module !== "undefined") module.exports = OmaActions;

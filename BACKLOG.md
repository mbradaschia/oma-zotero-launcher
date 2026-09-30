# Backlog

## Search properties (the `@` picker and the query syntax)

- **Item status**: a paper's status (Settings › Paper status), or none. E.g. `status:reading`, `status:none`.
- **List**: whether the paper is in a list, or in a given one.
- **Task**: has a task or not (`has:task`).
- **Task status**: the status of a paper's tasks (`task:waiting`).
- **Note**: has a note or not (`has:notes` exists; add its negation, `NOT has:notes`, to the picker).
- **Chat**: has a chat or not (`has:chat`).
- **Year operators**: `y:>2020`, `y:<2020`, `y:=2020`, `y:>=2020`, `y:<=2020` (today: `y:2020` and `y:2019..2021`).

Tasks and chats live outside Zotero (`todos.json`, the runner's chat store), so the launcher hands the bridge the
keys that match, the way a saved search's ids are resolved.

# Sourced by the scripts that replace a directory's contents (rsync --delete): install-runner.sh
# (the prompt runner) and dev-sync.sh (the plugin copy).
#
#   safe_dest DEST BASE IS_OURS
#
# Before anything is copied or deleted, checks that DEST is a directory of ours inside BASE, and
# exits (status 1) otherwise:
#   - DEST is BASE/<name>[/<name>…]: absolute, no "." or "..";
#   - BASE, once resolved, is a directory you own (it may itself be a link: ~/.config often is);
#   - neither DEST nor any directory between BASE and DEST is a symbolic link, and each one that
#     exists is a directory you own;
#   - DEST, resolved, is still inside BASE resolved;
#   - DEST, if it exists and isn't empty, is ours: IS_OURS (a command, given DEST) says so.
# rsync itself never follows a link inside DEST (no --keep-dirlinks): it replaces or deletes the
# link, not what it points to.

safe_dest() {
  local dest=$1 base=$2 is_ours=$3
  local me p part rb rd
  me=$(id -u)
  _refuse() {
    echo "${0##*/}: refusing to write into $dest: $1" >&2
    exit 1
  }
  [[ $dest == /* && $base == /* ]] || _refuse "not an absolute path"
  [[ /$dest/ != *"/./"* && /$dest/ != *"/../"* && /$base/ != *"/../"* ]] || _refuse "the path has . or .."
  case $dest in "${base%/}"/?*) ;; *) _refuse "it isn't inside $base" ;; esac

  mkdir -p "$base"
  [[ -d $base ]] || _refuse "$base isn't a directory"
  [[ $(stat -L -c %u "$base") == "$me" ]] || _refuse "$base isn't yours"

  p=${base%/}
  local parts
  IFS=/ read -ra parts <<<"${dest#"${base%/}"/}"
  for part in "${parts[@]}"; do
    [[ -n $part ]] || continue
    p=$p/$part
    [[ -L $p ]] && _refuse "$p is a symbolic link"
    if [[ -e $p ]]; then
      [[ -d $p ]] || _refuse "$p isn't a directory"
      [[ $(stat -c %u "$p") == "$me" ]] || _refuse "$p isn't yours"
    fi
  done

  rb=$(realpath -e "$base")
  if [[ -e $dest ]]; then
    rd=$(realpath -e "$dest")
    [[ $rd == "$rb"/?* ]] || _refuse "it resolves to $rd, outside $rb"
    if [[ -n $(ls -A "$dest") ]] && ! "$is_ours" "$dest"; then
      _refuse "it already holds something that isn't ours"
    fi
  fi
}

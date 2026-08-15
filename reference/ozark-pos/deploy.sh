#!/usr/bin/env bash
# deploy.sh — the ONLY way to put code on the droplet.
#
#   ./deploy.sh              # app + hub if either changed (restarts the hub only when it must)
#   ./deploy.sh --app        # Ozark-POS.html only
#   ./deploy.sh --hub        # hub-server.js (+ the read-only tools) only
#   ./deploy.sh --dry-run    # run every check, deploy nothing
#
# WHY THIS EXISTS — incident 2026-08-11. A session deployed a build from a base 64 commits stale, which
# removed crash reporting, stampSanitize and blobGuard from production. The delta log shows the real window:
# 11:29 AM to 5:04 PM, 235 revisions, permanently unreplayable.
#
# ⚠️ ALL SIX GATES PASSED THAT DAY. They test whether the CODE IS CORRECT. Nothing tested whether the code
# was CURRENT, and nothing checked afterwards that what landed was what was meant to land. Those are the two
# checks below, and between them they close the entire failure mode.

set -euo pipefail

HOST="root@142.93.2.141"
# ⚠️ The key is NOT named the same on every machine. The home PC has ozark_hub; the Arkadelphia ASSEMBLY PC
# has ozark_deploy and nothing else, so this script refused to run there — and refusing sends a keyed machine
# down the manual scp path, which is exactly the route that put a 64-commit-stale build on production and
# skipped every gate this file exists to enforce. Take the first key that is actually present, and let
# OZARK_SSH_KEY override for anything unusual.
KEY="${OZARK_SSH_KEY:-}"
if [ -z "$KEY" ]; then
  for k in "$HOME/.ssh/ozark_hub" "$HOME/.ssh/ozark_deploy"; do
    [ -f "$k" ] && KEY="$k" && break
  done
fi
KEY="${KEY:-$HOME/.ssh/ozark_hub}"   # keep the original path in the error message when none exists
REMOTE="/opt/ozark"
DO_APP=1; DO_HUB=1; DRY=0
for a in "$@"; do
  case "$a" in
    --app) DO_HUB=0 ;;
    --hub) DO_APP=0 ;;
    --dry-run) DRY=1 ;;
    *) echo "unknown option: $a"; exit 2 ;;
  esac
done

say(){ printf '\n\033[1m%s\033[0m\n' "$1"; }
ok(){  printf '  \033[32m✅ %s\033[0m\n' "$1"; }
bad(){ printf '  \033[31m❌ %s\033[0m\n' "$1"; exit 1; }

# ── 0. can we even reach it? failing here costs nothing; failing halfway costs a shop ────────────────
say "0 · access"
[ -f "$KEY" ] || bad "no SSH key at $KEY — this machine cannot deploy. Commit and push; deploy from a keyed PC."
ssh -i "$KEY" -o ConnectTimeout=10 -o BatchMode=yes "$HOST" true 2>/dev/null || bad "cannot reach $HOST over SSH"
ok "key present and the droplet answers"

# ── 1. IS THIS BUILD CURRENT? the check that was missing ─────────────────────────────────────────────
say "1 · is this build current?"
git fetch origin -q
BEHIND=$(git rev-list --count HEAD..origin/main)
[ "$BEHIND" = "0" ] || bad "BEHIND origin/main by $BEHIND commit(s) — pull first. This is exactly the 8/11 incident."
ok "up to date with origin/main"

DIRTY=$(git status --porcelain -- Ozark-POS.html hub-server.js check-invariants.js hub-replay.js || true)
[ -z "$DIRTY" ] || { echo "$DIRTY"; bad "uncommitted changes in files about to be deployed — commit them so the droplet matches a known commit"; }
ok "no uncommitted changes in the deployable files"

AHEAD=$(git rev-list --count origin/main..HEAD)
[ "$AHEAD" = "0" ] || bad "$AHEAD local commit(s) not pushed — push first, so the repo can never be behind the droplet"
ok "everything local is pushed"

# ── 2. the six gates ─────────────────────────────────────────────────────────────────────────────────
# Six of these check whether the code is CORRECT. The seventh checks whether it is still ORGANISED — every unit
# carrying a searchable keyword — because coverage with no ratchet regresses, and one untagged function is how the
# slide back starts. It ratchets on the COUNT, never on a fixed zero: refuses an increase, lowers the bar when we
# improve. See ORGANIZATION-PLAN.md.
say "2 · the seven gates"
node check-app-js.js Ozark-POS.html    >/dev/null || bad "check-app-js"
node test-money.js Ozark-POS.html      >/dev/null || bad "test-money"
node test-render.js Ozark-POS.html     >/dev/null || bad "test-render"
node check-dead-buttons.js Ozark-POS.html >/dev/null || bad "check-dead-buttons"
node test-hub.js                       >/dev/null || bad "test-hub"
node audit-patterns.js Ozark-POS.html  >/dev/null || bad "audit-patterns"
node codebase-index.js --gate          >/dev/null || bad "codebase-index --gate (a unit with no keyword, or a tag outside the vocabulary)"
ok "all seven green"
# ⚠️ A NOTICE, NOT A GATE. CODEMAP naming a function that no longer exists is a map pointing at a ghost, and
# somebody will follow it — but a stale sentence in a document must never stop the shop from getting a fix.
node check-codemap.js >/dev/null 2>&1 || echo "   ⚠️  CODEMAP.md names a function that no longer exists — run: node check-codemap.js"

# ── 3. markers — prove afterwards that what landed is what we meant ─────────────────────────────────
# Each is a symbol from work that has already been lost once to a stale deploy. Add to this list whenever
# something lands that would be expensive to silently lose again.
APP_MARKERS=(errNote errFlush draftPromote looseEnds stampNewer)
HUB_MARKERS=(stampSanitize blobGuard errAppend deltaLogAppend hubMerge)

say "3 · markers present in what we are about to send"
for m in "${APP_MARKERS[@]}"; do grep -q "$m" Ozark-POS.html || bad "local Ozark-POS.html is missing '$m' — is this really the current build?"; done
for m in "${HUB_MARKERS[@]}"; do grep -q "$m" hub-server.js  || bad "local hub-server.js is missing '$m' — is this really the current build?"; done
ok "local files carry every marker"

if [ "$DRY" = "1" ]; then say "dry run — nothing deployed"; exit 0; fi

# ── 4. deploy, atomically ────────────────────────────────────────────────────────────────────────────
say "4 · deploy"
ssh -i "$KEY" "$HOST" "cd $REMOTE && cp -f hub-server.js hub-server.prev.js 2>/dev/null || true"
if [ "$DO_APP" = "1" ]; then
  scp -q -i "$KEY" Ozark-POS.html "$HOST:$REMOTE/Ozark-POS.html.new"
  # ⚠️ THE LIVE-DATA GATE, and it runs in the gap between staging and going into service — the ONLY moment the new
  # build and the real database are both available and nobody is using the new one yet. On 2026-08-13 the counter
  # could not use Detail at all because six real orders had no `lines` array; all seven gates were green, because
  # every one of them tests the CODE and this is the only one that asks whether the build survives the SHOP.
  # A failure here leaves the .new file unmoved, so the staff keep working on the build they already had.
  scp -q -i "$KEY" test-render-live.js "$HOST:$REMOTE/" 2>/dev/null || true
  ssh -i "$KEY" "$HOST" "cd $REMOTE && node test-render-live.js Ozark-POS.html.new hub-data/ozark-db.json" \
    || { ssh -i "$KEY" "$HOST" "rm -f $REMOTE/Ozark-POS.html.new"; \
         bad "a screen throws on REAL data — nothing was swapped in, the shop is still on the previous build"; }
  ssh -i "$KEY" "$HOST" "mv $REMOTE/Ozark-POS.html.new $REMOTE/Ozark-POS.html"
  ok "Ozark-POS.html (and it survives the real shop)"
fi
if [ "$DO_HUB" = "1" ]; then
  scp -q -i "$KEY" hub-server.js "$HOST:$REMOTE/hub-server.js.new"
  # ⚠️ node --check refuses a .new extension, so rename first, THEN check, and restore on failure
  ssh -i "$KEY" "$HOST" "cd $REMOTE && mv hub-server.js.new hub-server.js && (node --check hub-server.js || (cp -f hub-server.prev.js hub-server.js; echo SYNTAX_FAIL; exit 1))" \
    || bad "hub-server.js failed node --check on the droplet — previous version restored, hub untouched"
  scp -q -i "$KEY" check-invariants.js hub-replay.js station-id.js station-remote.js backup-crypto.js backup-verify.js "$HOST:$REMOTE/" 2>/dev/null || true
  ssh -i "$KEY" "$HOST" "systemctl restart ozark-hub" && sleep 4
  ok "hub-server.js (+ tools), service restarted"
fi

# ── 5. VERIFY WHAT ACTUALLY LANDED — the second half of the 8/11 lesson ─────────────────────────────
say "5 · verify the droplet"
for m in "${APP_MARKERS[@]}"; do
  ssh -i "$KEY" "$HOST" "grep -q '$m' $REMOTE/Ozark-POS.html" || bad "DEPLOYED app is missing '$m' — a stale or partial build is live RIGHT NOW"
done
for m in "${HUB_MARKERS[@]}"; do
  ssh -i "$KEY" "$HOST" "grep -q '$m' $REMOTE/hub-server.js" || bad "DEPLOYED hub is missing '$m' — a stale or partial build is live RIGHT NOW"
done
ok "every marker present on the droplet"

# byte-for-byte, ignoring line endings (a Windows checkout is CRLF, the droplet is LF — comparing raw
# hashes reports a false difference every time, which cost a scare on 8/11)
for f in Ozark-POS.html hub-server.js; do
  L=$(tr -d '\r' < "$f" | md5sum | cut -d' ' -f1)
  R=$(ssh -i "$KEY" "$HOST" "tr -d '\r' < $REMOTE/$f | md5sum | cut -d' ' -f1")
  [ "$L" = "$R" ] || bad "$f on the droplet does NOT match this commit"
done
ok "droplet matches this commit exactly"

ssh -i "$KEY" "$HOST" "systemctl is-active ozark-hub" >/dev/null || bad "ozark-hub is not running"
ssh -i "$KEY" "$HOST" "curl -s localhost:8090/api/health" | node -e "
let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{ let j={}; try{ j=JSON.parse(d); }catch(e){}
  if(!j.ok){ console.log('  ❌ health did not answer ok'); process.exit(1); }
  console.log('  ✅ hub healthy — rev '+j.rev+'  appRev '+j.appRev); });"

say "deployed · $(git rev-parse --short HEAD) · $(git log -1 --format=%s | cut -c1-60)"

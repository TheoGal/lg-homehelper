#!/bin/sh
# Host tests for the remote watcher (key filter, relay startup, IR, watchdog).
# Needs a C compiler (gcc or cc). Run from the repository root.
set -e
CC=${CC:-cc}
out=build/native-tests
mkdir -p "$out"
cd relay
for t in test_filter test_startup test_relay_ir test_relay_startup test_relay_watchdog; do
  extra=""
  [ "$t" = test_startup ] || extra=filter.c
  "$CC" -w -o "../$out/$t" "$t.c" $extra
  "../$out/$t" >/dev/null
  echo "ok $t"
done

# Shortcut tiles: falls through to the next app id when webOS refuses one.
cd ..
tmp="$out/shortcut"
mkdir -p "$tmp"
cat > "$tmp/fake-luna" <<'FAKE'
#!/bin/sh
printf '%s\n' "$*" >> "$(dirname "$0")/calls.log"
case "$*" in *first.app*) echo '{"returnValue":false}';; *) echo '{"returnValue":true}';; esac
FAKE
chmod +x "$tmp/fake-luna"
rm -f "$tmp/calls.log"
"$CC" -w -o "$tmp/launch" '-DTARGETS="first.app","second.app"' shortcuts/launch.c
SHORTCUT_LUNA_SEND="$tmp/fake-luna" "$tmp/launch"
grep -q 'second.app' "$tmp/calls.log"
if SHORTCUT_LUNA_SEND=/bin/false "$tmp/launch"; then echo "shortcut must fail when every id is refused"; exit 1; fi
echo "ok shortcut fallback"

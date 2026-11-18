#!/bin/sh
# Host tests for the remote watcher (key filter, relay startup, IR, watchdog).
# Needs a C compiler (gcc or cc). Run from the repository root.
set -e
CC=${CC:-cc}
out=build/native-tests
mkdir -p "$out"
cd relay
for t in test_filter test_keymap test_startup test_relay_ir test_relay_keys test_relay_pointer test_relay_startup test_relay_watchdog; do
  extra=""
  [ "$t" = test_startup ] || extra=filter.c
  "$CC" -w -o "../$out/$t" "$t.c" $extra
  "../$out/$t" >/dev/null
  echo "ok $t"
done

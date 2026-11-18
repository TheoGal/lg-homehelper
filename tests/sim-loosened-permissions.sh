#!/bin/sh
# Needs root (creates the TV's real paths and runs as the TV's users).
# Reproduces webOS loosening Developer Mode app folders to 0777 when other apps
# are installed or removed, and checks that the helper keeps running, keeps its
# log, and that Stop still works, in both loosened and normal folders.
set -e
R=$(cd "$(dirname "$0")/.." && pwd)
D=/media/developer/apps/usr/palm/applications/io.github.theogal.homehelper; S=$D/state
AS="setpriv --reuid=5261 --regid=5000 --clear-groups"
T=$(mktemp -d)
[ "$(id -u)" = 0 ] || { echo "run as root"; exit 1; }
[ ! -e /media/developer ] || { echo "/media/developer exists; not touching it"; exit 1; }
trap 'rm -rf /media/developer "$T"' EXIT
reset() { rm -rf /media/developer; mkdir -p $S; cp "$R"/app/*.js $D/; chown -R 0:0 /media/developer; chmod 777 $D; chown 5999:5000 $S; chmod 770 $S; }
cat > $T/g.c <<C
#define main relay_main
#include "$R/relay/relay.c"
#undef main
int main(int argc,char**argv){setup_generation=argv[1];return generation_current()?0:1;}
C
cc -w -I"$R/relay" -I"$R/app" -o $T/g $T/g.c "$R/relay/filter.c"; chmod 755 $T $T/g
node() { $AS /usr/bin/env node -e "const s=require('$D/state-permissions.js'),fs=require('fs'),D='$S';$1"; }
start() { node "s(D,()=>{},true);process.stdout.write(s.stopGeneration(D,'manual'))"; }
runs() { $AS $T/g "$1"; }
reset; G=$(start); runs $G; node "s.appendLog(D,'{\"e\":1}')"
chmod 777 $S $S/*                                  # webOS loosens everything
runs $G                                            || { echo "FAIL: loosened folder stopped the relay"; exit 1; }
node "s.appendLog(D,'{\"e\":2}');if(fs.readFileSync(D+'/controller.log','utf8').split('\n').length!==3)process.exit(1)" || { echo "FAIL: log not kept"; exit 1; }
node "s.requestStop(D);if(!/stop/.test(fs.readFileSync(D+'/control.json','utf8'))||!fs.existsSync(D+'/blocked'))process.exit(1)" || { echo "FAIL: Stop in loosened folder"; exit 1; }
reset; G=$(start); node "s.requestStop(D)"; ! runs $G || { echo "FAIL: Stop no longer stops the relay"; exit 1; }
reset; G=$(start); : > $S/stop-generation; ! runs $G || { echo "FAIL: damaged record no longer stops"; exit 1; }
reset; G=$(start); chown 5261:5000 $S; chmod 777 $S; ! runs $G || { echo "FAIL: non-webOS loosening accepted"; exit 1; }
echo "loosened permissions: ok"

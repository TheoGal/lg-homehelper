#!/usr/bin/env python3
"""Build the Home Helper packages for an LG webOS TV.

  python3 scripts/build.py                          # Home opens the settings app until you pick one on the TV
  python3 scripts/build.py --target com.plexapp.plex  # Home opens Plex by default
  python3 scripts/build.py --retarget dist/io.github.theogal.homehelper_1.0.0_arm.ipk --target org.jellyfin.webos

A target set here is only a default: a choice made later in Home Helper
Settings on the TV takes priority. Never contacts a TV.
Needs: npm ci (JS compiler for the TV's old Node) and pip install ziglang==0.14.1.
"""
import argparse
import gzip
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys
import tarfile

ROOT = Path(__file__).resolve().parents[1]
HELPER = 'io.github.theogal.homehelper'
SERVICE = HELPER + '.service'
SETTINGS = HELPER + '.settings'
SETTINGS_SERVICE = SETTINGS + '.service'
APP_DIR = 'usr/palm/applications/' + HELPER
SERVICE_DIR = 'usr/palm/services/' + SERVICE
SETTINGS_SERVICE_DIR = 'usr/palm/services/' + SETTINGS_SERVICE
# Controller (app) and jailed service run as different users: share the jailer group.
SHARED_STATE = {APP_DIR + '/state', SERVICE_DIR + '/state', SETTINGS_SERVICE_DIR + '/state'}
EXECUTABLES = ('detach', 'relay', 'resume')
RESERVED = {'com.webos.app.home', 'com.webos.app.cpcover', HELPER}
APP_ID = re.compile(r'^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$')
MTIME = 1704067200  # webOS rejects epoch-zero tar dates


# ---- IPK format: an ar archive of debian-binary, control.tar.gz, data.tar.gz ----

def ar(parts):
    out = bytearray(b'!<arch>\n')
    for name, data in parts.items():
        out += f'{name + "/":<16}{0:<12}{0:<6}{0:<6}{"100644":<8}{len(data):<10}`\n'.encode()
        out += data
        if len(data) % 2:
            out += b'\n'
    return bytes(out)


def read_ar(data):
    if data[:8] != b'!<arch>\n':
        raise SystemExit('Not an IPK file')
    parts, offset = {}, 8
    while offset < len(data):
        header = data[offset:offset + 60]
        name, size = header[:16].decode().strip().rstrip('/'), int(header[48:58])
        parts[name] = data[offset + 60:offset + 60 + size]
        offset += 60 + size + (size % 2)
    return parts


def tgz(files, executable=()):
    dirs = set()
    for name in files:
        p = PurePosixPath(name)
        if p.is_absolute() or '..' in p.parts:
            raise ValueError('Unsafe path: ' + name)
        dirs.update(str(d) for d in p.parents if str(d) != '.')
    raw = io.BytesIO()
    with tarfile.open(fileobj=raw, mode='w', format=tarfile.USTAR_FORMAT) as archive:
        for name in sorted(dirs):
            entry = tarfile.TarInfo(name)
            entry.mtime, entry.type, entry.mode = MTIME, tarfile.DIRTYPE, 0o755
            if name in SHARED_STATE:
                entry.uid, entry.gid, entry.mode = 5999, 5000, 0o770
                entry.uname, entry.gname = 'prisoner', 'jailer'
            archive.addfile(entry)
        for name, data in sorted(files.items()):
            entry = tarfile.TarInfo(name)
            entry.mtime, entry.size = MTIME, len(data)
            entry.mode = 0o755 if name in executable else 0o644
            archive.addfile(entry, io.BytesIO(data))
    out = io.BytesIO()
    with gzip.GzipFile(filename='', fileobj=out, mode='wb', compresslevel=9, mtime=0) as packed:
        packed.write(raw.getvalue())
    return out.getvalue()


def ipk(app, version, files, executable=(), arch='all'):
    control = f'Package: {app}\nVersion: {version}\nArchitecture: {arch}\nMaintainer: Ted\nDescription: Home Helper\n'
    control_tgz = tgz({'control': control.encode()})
    return ar({'debian-binary': b'2.0\n', 'control.tar.gz': control_tgz, 'data.tar.gz': tgz(files, executable)})


def unpack(data):
    with tarfile.open(fileobj=io.BytesIO(read_ar(data)['data.tar.gz']), mode='r:gz') as archive:
        files = {m.name: archive.extractfile(m).read() for m in archive if m.isfile()}
        executable = {m.name for m in archive if m.isfile() and m.mode & 0o111}
    return files, executable


# ---- Build steps ----

def check_target(value):
    if value in (None, '', 'none'):
        return None
    if not APP_ID.match(value) or value in RESERVED:
        raise SystemExit('Invalid Home target app id: ' + value)
    return value


def set_target(files, target):
    files = dict(files)
    if target:
        files[APP_DIR + '/target.json'] = (json.dumps({'id': target}) + '\n').encode()
    else:
        files.pop(APP_DIR + '/target.json', None)
    return files


def read_tree(folder, keep=lambda name: True):
    base = ROOT / folder
    return {p.relative_to(base).as_posix(): p.read_bytes() for p in sorted(base.rglob('*'))
            if p.is_file() and not p.is_symlink() and keep(p.relative_to(base).as_posix())}


def compile_js(files):
    """Transpile to ES5 and add polyfills for the TV's Node 0.10/0.12 runtime."""
    scripts = {n: b.decode() for n, b in files.items() if n.endswith('.js')}
    result = subprocess.run(['node', str(ROOT / 'scripts/compile-js.cjs')], input=json.dumps(scripts),
                            capture_output=True, text=True, encoding='utf-8', cwd=ROOT, timeout=300)
    if result.returncode:
        raise SystemExit('JS compile failed. Run "npm ci" first.\n' + result.stderr)
    return dict(files, **{n: c.encode() for n, c in json.loads(result.stdout).items()})


def arm_cc(work, name, sources, *flags):
    """Compile a static ARM binary for the TV with the pinned Zig toolchain."""
    try:
        import ziglang
    except ImportError:
        raise SystemExit('Missing C compiler: pip install ziglang==0.14.1')
    zig = Path(ziglang.__file__).parent / ('zig.exe' if os.name == 'nt' else 'zig')
    env = dict(os.environ, ZIG_GLOBAL_CACHE_DIR=str(work / 'zig-global'), ZIG_LOCAL_CACHE_DIR=str(work / 'zig-local'))
    target = work / name
    subprocess.run([str(zig), 'cc', '-target', 'arm-linux-musleabi', '-Os', '-static', '-s',
                    *flags, *sources, '-o', str(target)], cwd=ROOT, env=env, check=True)
    return target.read_bytes()


def compile_native(work):
    return {name: arm_cc(work, name, sources)
            for name, sources in {'detach': ['app/detach.c'], 'resume': ['app/resume.c'],
                                  'relay': ['relay/relay.c', 'relay/filter.c']}.items()}


# Independent tile apps that open one of LG's own panels. The first app id
# webOS accepts is used: the ids differ between webOS versions.
SHORTCUTS = {
    'lgsettings': ['com.palm.app.settings', 'com.webos.app.settings'],
    'lgquicksettings': ['com.webos.app.quicksettings'],
    'lgnotifications': ['com.webos.app.notificationcenter'],
    'lglivetv': ['com.webos.app.livetv'],
}


def build_shortcut(work, folder, targets):
    files = read_tree('shortcuts/' + folder)
    info = json.loads(files['appinfo.json'])
    app, version = info['id'], info['version']
    define = '-DTARGETS=' + ','.join('"%s"' % t for t in targets)
    files['launch'] = arm_cc(work, folder + '-launch', ['shortcuts/launch.c'], define)
    out = {'usr/palm/applications/' + app + '/' + n: b for n, b in files.items()}
    out['usr/palm/packages/' + app + '/packageinfo.json'] = json.dumps(
        {'id': app, 'version': version, 'app': app}).encode()
    return app, version, ipk(app, version, out, {'usr/palm/applications/' + app + '/launch'}, 'arm')


def build_helper(work):
    app = read_tree('app', lambda n: n.endswith(('.js', '.json', '.png')) or n.startswith('vendor/'))
    service = read_tree('service')
    # The service sandbox cannot import from the app directory.
    for name in ('state-permissions.js', 'contract-events.js'):
        service[name] = app[name]
    app, service = compile_js(app), compile_js(service)
    app.update(compile_native(work))
    version = json.loads(app['appinfo.json'])['version']
    if json.loads(service['package.json'])['version'] != version:
        raise SystemExit('app/appinfo.json and service/package.json versions differ')
    files = {APP_DIR + '/' + n: b for n, b in app.items()}
    files.update({SERVICE_DIR + '/' + n: b for n, b in service.items()})
    files[APP_DIR + '/state/.keep'] = b''
    files[SERVICE_DIR + '/state/.keep'] = b''
    files['usr/palm/packages/' + HELPER + '/packageinfo.json'] = json.dumps(
        {'id': HELPER, 'version': version, 'app': HELPER, 'services': [SERVICE]}).encode()
    executable = {APP_DIR + '/' + n for n in EXECUTABLES}
    return version, files, executable


def build_settings():
    files = read_tree('settings')
    version = json.loads(files['appinfo.json'])['version']
    # The page may only call services from its own package (webOS 23), so the
    # read-only service it asks travels with it.
    service = compile_js(read_tree('settings-service'))
    if json.loads(service['package.json'])['version'] != version:
        raise SystemExit('settings/appinfo.json and settings-service/package.json versions differ')
    out = {'usr/palm/applications/' + SETTINGS + '/' + n: b for n, b in files.items()}
    out.update({SETTINGS_SERVICE_DIR + '/' + n: b for n, b in service.items()})
    out[SETTINGS_SERVICE_DIR + '/state/.keep'] = b''
    out['usr/palm/packages/' + SETTINGS + '/packageinfo.json'] = json.dumps(
        {'id': SETTINGS, 'version': version, 'app': SETTINGS, 'services': [SETTINGS_SERVICE]}).encode()
    return version, ipk(SETTINGS, version, out)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--target', help='App id the Home button opens by default')
    parser.add_argument('--retarget', type=Path, metavar='IPK', help='Change the target of a built Helper .ipk')
    parser.add_argument('--output', type=Path, default=ROOT / 'dist')
    args = parser.parse_args()
    target = check_target(args.target)
    args.output.mkdir(parents=True, exist_ok=True)

    if args.retarget:
        files, executable = unpack(args.retarget.read_bytes())
        info = json.loads(files[APP_DIR + '/appinfo.json'])
        out = args.output / args.retarget.name
        if out.resolve() == args.retarget.resolve():
            out = out.with_name(out.stem + '-retargeted.ipk')
        out.write_bytes(ipk(HELPER, info['version'], set_target(files, target), executable, 'arm'))
        print('Helper:', out, '->', target or 'chosen on the TV')
        return

    work = ROOT / 'build'
    work.mkdir(exist_ok=True)
    version, files, executable = build_helper(work)
    out = args.output / f'{HELPER}_{version}_arm.ipk'
    out.write_bytes(ipk(HELPER, version, set_target(files, target), executable, 'arm'))
    print('Helper:', out, '->', target or 'chosen on the TV')
    sversion, settings = build_settings()
    sout = args.output / f'{SETTINGS}_{sversion}_all.ipk'
    sout.write_bytes(settings)
    print('Settings:', sout)
    for folder, targets in SHORTCUTS.items():
        app, version, data = build_shortcut(work, folder, targets)
        path = args.output / f'{app}_{version}_arm.ipk'
        path.write_bytes(data)
        print('Shortcut:', path)


if __name__ == '__main__':
    main()

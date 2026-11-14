<p align="center"><img src="docs/icon.png" alt="Home Helper icon" width="128"></p>

<h1 align="center">Home Helper</h1>

Makes the LG webOS remote's **Home** button open an app of your choice instead
of LG Home, without rooting the TV (Developer Mode is enough). Optionally it
also brings you back to that app when another app closes.

Until you choose an app, Home keeps going to LG Home as normal. Choosing
**LG Home** in the settings app switches the redirect off again.

Inspired by and based on the Home Helper from
[Clean Your TV](https://github.com/Razdva122/clean-your-tv-lg-webos), which in
turn builds on [webos-vibehack](https://github.com/OmkarK97/webos-vibehack).
See [Credits](#credits).

Source: https://github.com/TheoGal/lg-homehelper

Tested on a C3 with 43.91.26 firmware and [Hearth](https://github.com/rudra-avatar/Hearth)
as a launcher.

## Install

You need a TV with **Developer Mode** on, and **BOTH** packages from the
[latest release](https://github.com/TheoGal/lg-homehelper/releases/latest):

| Package | What it is |
| --- | --- |
| `io.github.theogal.homehelper_1.0.0_arm.ipk` | **Home Helper**: the background helper that catches the Home button |
| `io.github.theogal.homehelper.settings_1.0.0_all.ipk` | **Home Helper Settings**: start the helper and pick the app |

**With webOS Dev Manager** (easiest): install
[webOS Dev Manager](https://github.com/webosbrew/dev-manager-desktop) on your
computer, add your TV, then open its Apps page and install both .ipk files.

**With the webOS CLI** (`ares-cli`):

```
ares-install --device tv io.github.theogal.homehelper_1.0.0_arm.ipk
ares-install --device tv io.github.theogal.homehelper.settings_1.0.0_all.ipk
```

### Two tiles, on purpose

After installing you'll see **two tiles** in LG Home: **Home Helper** and
**Home Helper Settings**. Both open the settings screen. This is deliberate:
apps that install invisibly are annoying, because you can't see they're there
or remove them from the TV like any other app. Both parts show up, so both can
be found and uninstalled from LG's own app menu. (webOS Dev Manager may not
offer to remove apps installed from a loose .ipk file.)

## Set up

Open **Home Helper Settings** on the TV:

1. Choose **Start Home Helper**. The first time, your TV asks you to allow
   it: choose **Allow**. Home Helper needs this to list your apps and to bring
   you back to your app when another app closes
2. Pick the app the Home button should open (right side, OK). The first
   entry, **LG Home**, turns the redirect off again

After that the helper starts by itself on every boot. Home Helper only runs
while your TV allows it: if you choose not to, it doesn't start, and choosing
**Start Home Helper** again asks again. The first start needs the TV to be
online.

![Home Helper Settings with Hearth chosen](docs/settings-app-chosen.png)

Use the arrow keys to move between the buttons on the left and the app list on
the right; OK selects.

From a computer instead:

```
ares-launch --device tv io.github.theogal.homehelper -p '{"nativeHomeTarget":"com.plexapp.plex"}'
ares-launch --device tv io.github.theogal.homehelper -p '{"nativeHomeStart":true}'
ares-launch --device tv io.github.theogal.homehelper -p '{"nativeHomeStop":true}'
```

`{"nativeHomeTarget":"com.webos.app.home"}` goes back to LG Home;
`{"nativeHomeTarget":""}` clears the TV choice (packaged default, else LG Home).

## Stop

- Choose **Stop Home Helper** in the settings app, or press **Home three
  times within two seconds** (the emergency stop). Either way the Home button
  goes back to LG Home, and the helper stays off until you start it again from
  the settings app.
- Stopping from the settings app also removes the helper's start-at-boot task.
  The emergency stop only stops the helper; the boot task stays but does
  nothing while the helper is stopped.

## Uninstall

1. **Stop the helper first.** Open **Home Helper Settings** and choose
   **Stop Home Helper**. Wait until the status reads *Home Helper is stopped*.
   This hands the Home button back to LG and removes the start-at-boot task.
2. **Remove both apps from LG's app menu.** Press **Home** to open LG Home,
   go to the app list, and switch it to edit mode (on webOS 23: highlight a
   tile and hold **OK**, or use the pencil/*Edit* option at the end of the
   list). Select **Home Helper**, choose *Delete*, then do the same for
   **Home Helper Settings**. Remove any of the optional tiles the same way.
   Apps installed from a downloaded `.ipk` file don't show an uninstall option
   in webOS Dev Manager, so use LG's menu.
3. **Check that nothing is left (optional).** In webOS Dev Manager's terminal:
   `ls /media/developer/apps/usr/palm/applications/ /media/developer/apps/usr/palm/services/ | grep theogal`
   It should print nothing. The pairing key and all settings lived in the
   apps' own folders, so they are gone with them.

If you uninstalled without stopping first, nothing breaks: the boot task stays
behind but only points at the removed app, so it does nothing. To remove it,
reinstall both packages, start the helper, choose **Stop Home Helper**,
then uninstall again.

**From a computer** (with the webOS CLI, `ares`):
`ares-install --device tv --remove io.github.theogal.homehelper`
`ares-install --device tv --remove io.github.theogal.homehelper.settings`

**If the TV is hard to use:** press Home three times quickly (emergency stop),
or remove the apps from a computer as above and then unplug the TV for 30
seconds. Last resort: turn Developer Mode off and restart; the TV deletes all
Developer Mode apps.

## Notes

- If Developer Mode expires, the TV removes these apps; reinstall and repeat
  the setup.
- At power-on, Home Helper only replaces LG Home. If your TV is set to start
  with its last input or app, that is what you get. If it starts with LG Home,
  you may see it briefly before your app opens.
- Back is never changed. When an app has used up its own Back steps and
  closes, you land in your chosen app instead of LG Home.
  Holding Back does whatever your TV normally does (accessibility zoom on
  newer models); Home Helper doesn't act on it.
- Works with the Magic Remote. A basic IR remote also works, with a short
  flash of LG Home before your app opens.
- Don't run this together with Clean Your TV's Home Helper: both would react
  to the Home button.

## For launcher developers

Your launcher can use Home Helper as its Home button on unrooted TVs. Users
install Home Helper next to your launcher; your launcher then sets itself as
the target and starts the helper by launching it with parameters:

```js
function launchHelper(params) {
  webOS.service.request('luna://com.webos.applicationManager', {
    method: 'launch',
    parameters: { id: 'io.github.theogal.homehelper', params: params }
  });
}
launchHelper({ nativeHomeTarget: 'your.launcher.id' });
launchHelper({ nativeHomeStart: true });
```

| Parameter | Effect |
| --- | --- |
| `nativeHomeTarget: "<app id>"` | Home opens that app |
| `nativeHomeTarget: "com.webos.app.home"` | Home goes to LG Home (redirect off) |
| `nativeHomeTarget: ""` | Clears the TV choice (packaged default, else LG Home) |
| `nativeHomeStart: true` | Starts the helper (also after a stop). The first time, the TV asks the user to allow it; if they don't, it doesn't start |
| `nativeHomeStop: true` | Stops the helper; it stays off until started again |

When opened again by Home, your launcher receives a normal relaunch
(`webOSRelaunch`) with no special parameters. The Home key itself does not
reach your page.

## Build

```
npm install
pip install -r requirements.txt
python3 scripts/build.py
```

Packages land in `dist/`. Tests: `npm test`, and `npm run test:native`
for the remote handling (needs a C compiler). To set a default app before
installing:

```
python3 scripts/build.py --target com.plexapp.plex
```

To change the default in an already built package (no toolchain needed):

```
python3 scripts/build.py --retarget dist/io.github.theogal.homehelper_1.0.0_arm.ipk --target org.jellyfin.webos
```

A choice made on the TV always wins over the packaged default (including
choosing LG Home). With neither, Home goes to LG Home.

## Optional extra tiles: LG Settings, LG Quick Settings, LG Notifications, Live TV

These four are **optional** and separate from Home Helper. Use them only if
your preferred launcher doesn't offer a way to open these LG apps itself.
Each is its own package: install any, all or none. They work with or without
Home Helper.

| Package | Tile | Opens |
| --- | --- | --- |
| `io.github.theogal.lgsettings_1.0.0_arm.ipk` | **LG Settings** (solid gear) | LG's settings, the same as the gear in LG Home |
| `io.github.theogal.lgquicksettings_1.0.0_arm.ipk` | **LG Quick Settings** (outlined gear) | LG's Quick Settings panel, the same as a short press of the remote's settings button |
| `io.github.theogal.lgnotifications_1.0.0_arm.ipk` | **LG Notifications** (bell) | LG's notifications |
| `io.github.theogal.lglivetv_1.0.0_arm.ipk` | **Live TV** (TV) | The TV tuner (Live TV source) |

Install them the same way as Home Helper, then add the tiles to your launcher
like any other app. Remove them from LG's app menu. A tile has no window of its own: it asks webOS to open the
LG app and exits, so nothing keeps running. The app ids differ between webOS
versions; LG Settings tries `com.palm.app.settings`, then
`com.webos.app.settings`. LG Quick Settings opens `com.webos.app.quicksettings`,
LG Notifications opens `com.webos.app.notificationcenter` and Live TV opens
`com.webos.app.livetv`.

## Credits

Home Helper was inspired by
[Clean Your TV](https://github.com/Razdva122/clean-your-tv-lg-webos), and its
background helper is based on Clean Your TV's Home Helper (MIT). Clean Your TV
in turn builds on
[OmkarK97/webos-vibehack](https://github.com/OmkarK97/webos-vibehack) and
[Gathin23/cleanyourtv](https://github.com/Gathin23/cleanyourtv).
Bundles [ws](https://github.com/websockets/ws) (MIT, see `app/vendor`).
Not affiliated with LG.

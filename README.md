# Home Helper

Makes the LG webOS remote's **Home** button open an app of your choice instead
of LG Home, without rooting the TV (Developer Mode is enough). Optionally it
also brings you back to that app when another app closes.

Until you choose an app, Home keeps going to LG Home as normal. Choosing
**LG Home** in the settings app switches the redirect off again.

Source: https://github.com/TheoGal/lg-homehelper

Two packages:

| Package | What it is |
| --- | --- |
| `io.github.theogal.homehelper` | Background helper that catches the Home button (native app + service) |
| `io.github.theogal.homehelper.settings` | On-TV settings: pick the app, start the helper, pair |

## Build

```
npm install
pip install -r requirements.txt
python3 scripts/build.py
```

Packages land in `dist/`. Tests: `npm test`, and `npm run test:native`
for the remote handling (needs a C compiler). To set a default app before installing:

```
python3 scripts/build.py --target com.plexapp.plex
```

To change the default in an already built package (no toolchain needed):

```
python3 scripts/build.py --retarget dist/io.github.theogal.homehelper_1.0.0_arm.ipk --target org.jellyfin.webos
```

A choice made on the TV always wins over the packaged default (including
choosing LG Home). With neither, Home goes to LG Home.

## Install

Developer Mode must be on.

```
ares-install --device tv dist/io.github.theogal.homehelper_1.0.0_arm.ipk
ares-install --device tv dist/io.github.theogal.homehelper.settings_1.0.0_all.ipk
```

Open **Home Helper Settings** on the TV:

1. Pick the app the Home button should open (right side, OK). The first
   entry, **LG Home**, turns the redirect off again
2. Choose **Start / resume Home Helper**
3. Optional: choose **Return to this app when others close**, then **Allow**
   on the prompt the TV shows

After that the helper starts by itself on every boot.

From a PC instead:

```
ares-launch --device tv io.github.theogal.homehelper -p '{"nativeHomeTarget":"com.plexapp.plex"}'
ares-launch --device tv io.github.theogal.homehelper -p '{"nativeHomeStart":true}'
ares-launch --device tv io.github.theogal.homehelper -p '{"nativeHomePair":true}'
```

`{"nativeHomeTarget":"com.webos.app.home"}` goes back to LG Home;
`{"nativeHomeTarget":""}` clears the TV choice (packaged default, else LG Home).

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
| `nativeHomeStart: true` | Starts or resumes the helper |
| `nativeHomePair: true` | Asks the TV to pair, for returning after apps close |

Status (current target, running, paired) is available from
`luna://io.github.theogal.homehelper.service/target`.

When opened again by Home, your launcher receives a normal relaunch
(`webOSRelaunch`) with no special parameters. The Home key itself does not
reach your page.

## Stop or remove

- Press **Home three times within two seconds** to stop the helper and return
  to LG Home. Resume from the settings app.
- If that fails, remove it from a PC, then unplug the TV for 30 seconds:
  `ares-install --device tv --remove io.github.theogal.homehelper`
- Last resort: turn Developer Mode off and restart; the TV deletes all dev apps.

## Notes

- If Developer Mode expires, the TV removes these apps; reinstall and repeat
  the setup.
- Back is never changed. With pairing on, when an app has used up its own
  Back steps and closes, you land in your chosen app instead of LG Home.
  Holding Back does whatever your TV normally does (accessibility zoom on
  newer models); Home Helper doesn't act on it.
- Don't run this together with Clean Your TV's Home Helper: both would react
  to the Home button.

## Credits

The background helper is based on the Home Helper from
[Clean Your TV](https://github.com/Razdva122/clean-your-tv-lg-webos)
(MIT), itself built on
[Gathin23/cleanyourtv](https://github.com/Gathin23/cleanyourtv) and
[OmkarK97/webos-vibehack](https://github.com/OmkarK97/webos-vibehack).
Bundles [ws](https://github.com/websockets/ws) (MIT, see `app/vendor`).
Not affiliated with LG.

# SR Video Lab

Chrome-only desktop page for testing video super-resolution. Point it at a folder of MP4s, group the same title across resolutions and upscalers, play them, and compare source vs upscaled. Licence and notes live in a JSON database.

## Open it

Chrome only. Double-click `index.html` (or drag it onto a Chrome window). Works as `file://` — no server, no build, no accounts.

Safari / Firefox / Edge are not the target. Folder picking uses Chrome `webkitdirectory`.

## Files stay on disk

Video files are **never copied, moved, or written**. The app only reads the folder you select. Playback uses `URL.createObjectURL` on those `File` objects. After a refresh, select the same folder again so the player can attach to the files. Metadata (titles, licence, notes, categories, order) survives in `localStorage` and can be written out with **Export JSON**.

The inspector marks every on-disk variant with an **in place** badge.

## Filename convention (hyphens, not underscores)

```
{category}-{title}-{resolution}.mp4
{category}-{title}-{resolution}-{technology}.mp4
{category}-{title}-{resolution}-{fps}fps.mp4
{category}-{title}-{resolution}-{fps}fps-{technology}.mp4
```

Examples:

```
a-big-buck-bunny-360p.mp4
a-big-buck-bunny-720p.mp4
a-big-buck-bunny-720p-24fps.mp4
a-big-buck-bunny-720p-VSR.mp4
a-big-buck-bunny-720p-24fps-VSR.mp4
a-big-buck-bunny-720p-RealESRGAN.mp4
a-big-buck-bunny-4k.mp4
s-goal-slowmo-1080p.mp4
c-night-street-1080p-Topaz.mp4
```

- Resolutions, matched from the **right**: `240p`, `360p`, `480p`, `720p`, `1080p`, `1440p`, `4k`, `2160p`, `8k`. `4k` and `2160p` rank the same.
- Optional frame rate **immediately after** the resolution: `-24fps`, `-30fps`, `-60fps`, `-23.976fps`. If omitted, **60 fps** is assumed.
- Everything after resolution (and optional fps) is the tech / upscaler tag (`VSR`, `RealESRGAN`, `Topaz`, …). Empty tech = original.
- **FPS chips** sit next to the resolution chips and list only frame rates that exist as files (a missing `-Nfps` tag counts as 60). Defaults to **60**. Click to switch. Arrow keys step one frame at the active clip's fps.
- Category is the first segment if it matches a known category **id**. Otherwise Uncategorized.
- Display title is the slug title-cased (`big-buck-bunny` → `Big Buck Bunny`). You can edit the display title; the group id stays stable.

## Compare modes

- **Single** — one variant. Switching keeps current time and play/pause.
- **Wipe** — two stacked videos, draggable vertical divider, synced clocks.
- **Side by side** — two synced players with A / B labels.

On opening a group: **A** = highest original (no tech suffix). **B** = first upscaled variant (prefer same resolution as A). If only originals, A = highest, B = next highest.

Original chips look like `720p` (blue). Upscalers look like `720p · VSR` (amber). Any variant can be compared to any other.

Audio comes from A only. B is muted so sound is not doubled. Use the mute toggle for A.

## Fullscreen

Fullscreen is the **picture only** — transport, mode tabs, and chips hide so the video fills the screen. Wipe and side-by-side still work. Space / arrows still control playback. Move the mouse and press `F` or `Esc` to leave.

- Toolbar button
- `F` key (toggles off if already fullscreen)
- Double-click the picture
- `Esc` exits (browser default)

## Keyboard

Ignored while typing in an input or textarea.

| Key | Action |
| --- | --- |
| Space | Play / pause (toggle) |
| F8 | Play |
| F9 | Stop |
| ← / → | Previous / next frame |
| Shift + ← / → | Jump ±1 second |
| F | Toggle stage fullscreen |

## JSON, autosave, delete

Working metadata is autosaved to `localStorage` key `sr-video-lab-db` on every change. The top-bar pill shows **Autosaved locally · Export to update videos.json**.

- **Export JSON** downloads `videos.json` (categories, groups, variant file/path/resolution/tech, settings). No blob URLs or File objects.
- **Import JSON** (file picker) merges by group id: incoming fields overlay existing; variants merge key-by-key; categories merge by id (incoming name/color win). New groups/categories are appended.
- **Remove saved data for this group** (inspector, with confirm) deletes that group from the library and localStorage, even if you already loaded its folder. Video files on disk are never touched. Load the folder again to re-import them as a fresh group.
- **Rename files** (inspector) changes the title slug in every filename in the group — the part after the category id and before the resolution. Category, resolution, fps, and tech stay the same. Example: `a-big-buck-bunny-720p-24fps-VSR.mp4` → `a-new-name-720p-24fps-VSR.mp4`. Chrome renames the real files in place (no copy) when the folder was opened with **Load video folder** (write access). Preview + confirm. Collisions abort.

## Categories

Default prefixes:

| Id | Name | Colour |
| --- | --- | --- |
| `a` | Animations | blue |
| `s` | Sport | teal |
| `c` | Cinema | pink |

Add / edit / delete categories in the **Categories** modal. The **id** is the short filename prefix (letters/digits). Duplicate ids are rejected. Deleting a category that is in use reassigns those groups to Uncategorized — groups are not deleted.

## Why Import JSON on `file://`

Chrome blocks `fetch('./videos.json')` from `file://` (CORS). The same sample is therefore embedded in `app.js` as `DEFAULT_DB`. If you open the page over http, `videos.json` is fetched when possible. Edits live in `localStorage`; after a refresh they win over the sample. To share or back up the database — or to pick up a `videos.json` you edited by hand — use **Import JSON**.

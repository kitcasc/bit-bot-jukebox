# Bit-Bot Jukebox

Bit-Bot Jukebox is an 8-bit style browser music sketchpad. Users edit 16-step loops, save them into a loop library, arrange selected loops into a song order, save arrangement drafts, preview the editor loop, a draft, or the full arrangement, and export only the arranged loops as an MP3.

## Project Structure

```text
src/
  App.jsx                     App shell and page layout
  main.jsx                    React entry point
  styles.css                  Tailwind import and global styles
  components/
    Sequencer.jsx             16x16 editor, loop library, drafts, arrangement, MP3 export
```

## Commands

```bash
npm install
npm run dev
npm run build
```

## Current Features

- 16 notes x 16 steps bit grid
- Square wave playback with Tone.js
- Separate Play Loop and Play Song controls
- Tempo slider from 60 to 180 BPM
- Save the current pattern as Loop 1, Loop 2, Loop 3, and so on
- Click a loop or draft title to rename it inline
- Loading a loop makes editor changes auto-save back into that loop
- Keep all saved loops in the Loop Library
- Drag loops into Arrangement and reorder them
- Save the current Arrangement order as Draft 1, Draft 2, Draft 3, and so on
- Saving a Draft does not clear the final Arrangement
- Open a Draft to preview, reorder, or edit its loops
- Add a full Draft into the final Arrangement
- A ghost insertion line marks the target position while dragging
- Remove loops from Arrangement without deleting them from the Library
- Play Song previews only the current Arrangement order
- Play Draft previews only the open Draft
- Play Loop previews only the editor pattern
- The grid follows the currently playing loop and flashing step
- Download MP3 exports only the loops currently placed in Arrangement
- MP3 files default to `bit-bot-jukebox_YYYY-MM-DD.mp3`

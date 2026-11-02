# +1 Speed to Break Glass

A multiplayer running game for the browser, built with **Three.js** and **Colyseus** for Bloxity. **Every step makes you faster, and Speed is what breaks glass.** Run down a long corridor of giant panes: push one and its health drains at your Speed while cracks spread across it, until it bursts. Behind each stage a Shard Pad pays out and sends you home. Spend Shards on sneakers, train on treadmills, rebirth, open new worlds, and press PLAY to race everyone else through a field of shared glass.

The genre, the loop and the pacing follow the Roblox game *[+1 Speed to Break Glass](https://www.roblox.com/games/79267674237007/1-Speed-to-Break-Glass)* (see the video in `reference/`). Everything players see and hear is our own: the worlds, the glass, the items, the HUD art, the text, the sounds and the music.

**There are no in-app purchases.** Everything costs Shards (from the Shard Pads and races) or Gems (from quests, daily tasks, the FREE chest, gifts, the wheel, Glass Rush, the daily reward and codes).

It shares its engine with the other Legion games (the server, Bloxity login and avatars, the top games' character animation, the camera and lighting rig, the quality system, profiles, saves, play stats; forked from +1 Jump Higher ASMR).

## Project layout

| Folder | What it is |
|---|---|
| `client/` | Vite + Three.js client: `main.js` (boot and warm-up, your character on the shared physics, steps, treadmills, pushing glass, the camera, keyboard / mouse / touch / controller, other players smoothed on the server's clock, the network, your race, Auto Run), `world.js` (a world on screen: the spawn, the treadmills, sneaker pads, leaderboards, the Run and its stages, each world's scenery, every sign in one batched mesh), `rushview.js` (a race's track), `glass.js` (the panes, their cracks and the flying shards, on the graphics card), `neon.js` (the painted glow: pools of light and columns of colour), `asmr.js` (every sound synthesised sample by sample at load), `chars.js` (a character: avatar, squash and stretch, name tag, trail, aura), `smooth.js` (the server's clock and the snapshot buffer), `shadows.js` (contact shadows on Low), `icons.js` (the HUD's drawn icons), `ui.js` + `index.html` (HUD and panels), `audio.js`, `fx.js`, `engine.js`, `geo.js`, `blobs.js`, `avatar.js`, `animator.js` |
| `server/` | Colyseus 0.18 server: the `glass` room (`GlassRoom.js`: steps and their token bucket, treadmills, the move guard, every pane of the Run, pads, sneakers, rebirths, worlds, the wheel, trails, auras, levels, ranks, tasks, quests, rewards, codes, the hub bots), `Rush.js` (the PLAY queue, the start line, the race, its guards, its bots, the finish, the prizes), profiles (MongoDB on Legion), leaderboards, play stats |
| `shared/` | `config.js` (Speed, sneakers, rebirths, treadmills, worlds, pane health, pad Shards, what a race is like at a Level, prizes, the wheel, trails, auras, ranks, tasks, quests, rewards, codes), `world.js` (where everything stands in a world: the client draws it, the server checks moves against it), `rush.js` (a race's course from its seed), `physics.js` (moving and jumping: your screen runs it for you, the server for the bots) |
| `covers/` | The two store covers (1920x1080, 800x800), rendered from the game |

## Run it locally

Needs Node 20 or newer. Double-click `start-local.bat`, or:

```sh
npm install          # installs client and server too
npm run build        # builds the client into client/dist
npm start            # server + game on http://localhost:2877
```

For development run `npm run dev:server` and `npm run dev:client`, then open http://localhost:5439 (the client talks to the server on port 2877; `VITE_SERVER_URL` overrides that). Dev builds (or a build with `VITE_QA=1`) expose `window.__qa` (an autopilot, perf readings, teleports). Restart the server after changing `shared/`. For testing only, `QA=1` lets the client give itself Speed, Shards, Gems, levels and rebirths (`__qa.give`) and pick a race's map; it is refused on Legion.

## Gameplay

- **Speed.** Every step gives Speed ("+1" pops up beside you with a bolt, a chime climbs a scale as they come). One Speed takes one point of a pane's health a second. You also run faster the more you have (22 studs a second at nothing, up to 78).
- **The spawn** of each world: the **treadmills** on a dark platform to the west (x1, then x2, x3, x5, x8, x12, x20 and x35 as rebirths open them; each its own neon colour along the belt, the frame and the handrail, a glowing screen, sparks off your heels, READY or RUNNING over it; stand on one and your feet do the rest, at a faster pace than running), the **sneaker pads** on a dark platform to the east (18 pairs from Canvas Kicks to Infinity Sneaks, the first FREE; each a raised hexagon of its own neon colour with a column of light rising off it and the sneakers floating in it; an arrow marks the next pair; step on it to buy), the leaderboards, the **WORLDS** portal, the **GLASS RUSH** gate and a FREE chest behind you, and chevrons pointing north.
- **The Run**: a long corridor of **six stages of five panes**, each stage with its own glass and floor colour and a gate with its name. A pane fills the corridor: run into it and you push it (you keep gaining Speed as you push). The big health bar shows it going, the cracks spread from where you hit, the glass strains, and it bursts into hundreds of shards that fly past you. Leave a pane alone and within a second it starts to heal, fast. Your glass is your own: everyone else runs through theirs.
- **Shard Pads** behind each stage's last pane give Shards and send you home (the further the stage, the more: 3 for stage 1, 98 for stage 6 of the first world), and the panes are back up.
- **Rebirth** (130 Shards, then 319, 780...): back to 0 Speed, every step worth x1.5, x2, x2.5... for good, and the next treadmill opens. You keep your sneakers.
- **Four worlds**: **Glasshouse Gardens** (planters, hedges and sunshine), **Skyline Sprint** (towers with lit windows at golden hour), **Frostpane Peaks** (snow, pines, an aurora), **Ember Foundry** (lava channels, chimneys, a violet dusk). Clearing a world's last stage opens the next; the glass is 1000 times tougher and the Shards 40 times bigger each time.
- **Glass Rush** (PLAY): everyone who presses PLAY at about the same time goes in one race, and the queue shows how many were found ("2/6 found · 7s"). A late PLAY on the start line still takes a bot's place. Bots fill only the empty places, and take over at once from a player who leaves or drops. The track is rows of panes side by side: thin, clear, tough, golden (a burst of pace) and, at higher Levels, steel you must go round. A pane is shared: once anyone breaks it, the hole is there for everyone, so leading costs time and following saves it, but only the panes you smash pay extra. Speed strips on the floor give a burst of pace. The last row is one **giant pane** everyone hammers together, and the finish line is behind it. In a race your Speed counts only so much (a log scale), so a new player can beat a veteran by reading the glass. The maps take turns, so even a new player sees the later worlds.
- **Content grows with you**: your Level climbs with panes, pads, races and quests, and a race's length, toughness and prizes follow the racers' Level: 11 rows and about 26 seconds at Level 2, 34 rows and about 75 seconds by Level 30, with more tough glass and steel and bigger Shards, Gems and XP.
- **Auto Run** (free, one tap): the game plays the loop for you: the next sneakers when you can afford them, a spell on the best treadmill when you're too slow, the Run, the last pad you cleared. It also runs a race. Steering takes over at once. A new phone player's first race starts on it.
- **Progress**: the **Progress bar** at the top shows everyone in your world by the pane they're up to (in a race, how far along the course); a chain of 29 **quests** under it (they complete themselves and pay at once); 3 **daily tasks**; the **Lucky Wheel** (a free spin every 8 minutes of play, up to 3 saved; prizes grow as you get further); a 7-day **daily reward**; **FREE gifts** at 2 / 5 / 9 / 14 / 20 / 30 / 45 minutes; a FREE chest every 15 minutes; **x2 Speed** and **x2 Shards** (25 Gems for 15 minutes); trails and auras; ranks by Shards collected (Bronze → Champion); three leaderboards (Shards, Top Speed, Rush Wins); codes (`GLASS`, `SMASH`, `SHATTER`, `BLOXITY`, `LEGION`, `ZOOM`).
- **Pacing** (a simulation of a typical first session, on the real formulas): the first pad and sneakers at under a minute, stage 4 at under 3 minutes, the first race by 5, stage 5 at 9, the last stage and the second world at about 25 minutes (the first rebirth about then, or sooner for anyone who saves up for it), and new sneakers, stages and races every few minutes through the first hour. It is a simulation: nobody has playtested the pacing yet.
- **Multiplayer**: up to 16 players share a server. Other players are drawn on the server's clock from time-stamped snapshots through a buffer that follows the real delay (tested at a 360 ms round trip), your own movement stays on your device, and races are shared glass. When it's quiet a few bots (in the platform's outfits) run the treadmills and the Run; each real player sends one home.
- **The server decides**: every step (a token bucket; you must have just moved, be pushing a pane, or be on an open treadmill), every pane (its health drains at your Speed as the server sees you there; a position past standing glass is sent back after a moment's grace), every pad, sneaker, chest and purchase, every race pane, every place and prize. Moving further than you could is sent back.
- **Portrait phones**: the HUD sizes itself by the screen's width; the Progress bar sits right of the Bloxity corner; the stick and JUMP sit above the Level bar; the health bar sits below the menus (on short phones, below the character); the cameras widen. Checked at 390x844, 360x800, 375x667, 844x390 and 1280x720.

## Controls

| Action | Keyboard | Controller | Touch |
|---|---|---|---|
| Run | WASD / arrows | Left stick | The stick |
| Jump | Space | A | JUMP |
| Use (a sneaker pad, the portal, the gate) | E | X | Tap the bubble |
| Camera | Drag, wheel | Right stick | Drag, pinch |
| Auto Run | T | | AUTO RUN |
| Glass Rush | P | | PLAY |
| Back to the spawn | R | | Settings |
| Wheel / Quests / Shop | F / Q / G | LB / Y / RB | The buttons |

## Sound

- **The sounds** are synthesised sample by sample while the game loads: a struck sheet of glass rings with a handful of inharmonic partials; a pushing thud with a tap on it; cracks that splinter in a run of tiny ticks; a pane going is a crack like a shot, a low whump, the sheet ringing out and a rain of pieces (2-3 variations of each, 150 pieces in the big one); footsteps, the Speed chime, a Speed strip's zip, the pad's crystal chimes. A sound in play is one buffer source and a gain (and a panner for someone else's), never more than 22 at once.
- **Music**, all generated: "Tailwind" in the worlds (118 BPM, plucked arpeggios and an easy backbeat) and "Shatterpoint" in races (150 BPM, four-on-the-floor, stabbing saws, a lead for the last stretch). Each is rendered once into loops by an OfflineAudioContext behind the loading screen and plays from memory. On Low the music is never played note by note.

## Graphics and performance

- **The top games' lighting** (hemisphere 1.1, ambient 0.45, sun 1.5, PCF shadows, no tone mapping). **Only matte (Lambert) and unlit materials**: no reflections, no environment map, no bloom or post-processing.
- **Neon without bloom**: the strips are unlit parts of the scenery's one material, a wave of brightness chasing along them in the vertex shader, so they add no draw calls. The glow round them (pools of light on the floor, columns of colour off the pads, a low wall of light round each treadmill) is one additive mesh of a few hundred quads, painted in the shader, faded out in the distance, written once. The stages' floors, pane frames and gates carry the same neon in their glass's colour; a race's panes show their kind in neon along the top, so a row can be read from far off. A rainbow arcs over the Run in the sky shader.
- **The glass** is one instanced quad per pane in one unlit draw; its tint, its damage and where it was hit are per-instance numbers. The cracks come from one texture whose lines store when they appear, so they grow out from the impact and thicken as the pane weakens, for one texture read per pixel. The sheen is painted bands, not reflections. Only the next 5 panes (or the next rows of a race) are drawn at all.
- **The shards** fly on the graphics card: each is a sliver with a start, a velocity and a spin written once; the vertex shader works out where it is (gravity, a low skip off the floor, shrinking away). A burst is a few small uploads and no work per frame after that, and it isn't drawn at all when nothing is flying.
- **Draw calls**: all the scenery goes into one kit per chunk of the map and one **BatchedMesh** per material (each chunk still culled on its own; the draw list is only changed when one comes into view or goes out); trees and rocks are instanced soft blocks by square of the map, boxes in the distance; every sign is in one draw (the sneaker and treadmill signs in small textures of their own, as they change); the belts are one instanced mesh.
- **Loading**: every shader (scenery plain and batched, the glass, the shards, the signs, effects, the avatar) is compiled and drawn once behind the loading screen; every HUD screen and panel is painted once; every emoji is drawn once in the page and once in a canvas. A world switch or a race builds and draws behind a fade.
- **The HUD** writes to the page only when a value changes and moves its bars and markers with transforms; nothing in the frame loop reads layout. The leaderboards redraw only when they change. The numbers that pop up reuse their textures.
- Phones and weak PCs start on **Low** (no shadow code, no multisampling on PCs, decided before the WebGL context exists). Below 54 FPS the resolution steps down first, then the quality below 45. Integrated graphics draw Medium at the window's own pixel size. On 120 Hz+ screens with uneven frames the game draws every other refresh for even pacing.
- **Measured** (this PC: Intel UHD Graphics on ANGLE D3D11, headless Chrome, vsync on a 144 Hz display, so 144 is the ceiling):

  | Device | Spawn | The Run (smashing panes) | A race (5 bots) | Skyline Sprint Run | Load + join |
  |---|---|---|---|---|---|
  | Desktop, 1600x900, Medium | 144 FPS (p95 7.1 ms) | 143 (p95 7.1) | 144 (p95 7.1) | 143 (p95 7.1) | 6.5 s |
  | **Weak laptop**: CPU throttled 4x, 1366x768, Low | 122 (p95 13.9) | 112 (p95 14) | 136 (p95 13.8) | 108 (p95 13.9) | 12.2 s |
  | **Phone, landscape**: 844x390 @2x, touch, Low, CPU 4x | 126 (p95 13.9) | 119 (p95 13.9) | 141 (p95 7.1) | 136 (p95 13.8) | 12.3 s |
  | **Phone, portrait**: 390x844 @2x, touch, Low, CPU 4x | 135 (p95 13.8) | 115 (p95 14) | 141 (p95 7.1) | 128 (p95 13.9) | 12.7 s |

  Draws and triangles on Low: about 25 calls and 53k triangles at the spawn, 24 and 42k on the Run, 21-27 and 28k in a race. On Medium up to 30 calls and 85k on the Run. The neon cost one more draw and a few thousand triangles. Ember Foundry ran through the autopilot tests without errors, but its frame rate wasn't re-measured after the neon.

  These are from one Intel laptop with its CPU throttled: real phones have different GPUs, so the phone rows show the game's CPU and draw costs, not a phone's frame rate.

- **What the measuring changed** (CPU profiles and browser traces on the unminified dev build): a purchase re-uploaded the single big sign texture (a 2048 x 2464 canvas), so the sneaker signs got a small texture of their own; a purchase also repainted signs that hadn't visibly changed, so now only the changed ones are painted, one a frame, with one upload at the end (the late frames at a purchase went from 130-170 ms to 60-80 ms at CPU 4x). The cracks' round line caps added up where segments met and showed as dots ahead of the crack, so the texture is written with a per-channel maximum. Floating numbers were left behind right in front of the camera at speed, so they now travel with you. Speed lines are a third as many on Low. A whole corridor's pad signs piled into a smear in the distance, so signs fade out beyond ~200 studs.
- **Known, not fixed**:
  - On the throttled runs one pause of 0.35-0.6 s happens once, about 2 minutes after the page loads (it shows when it lands in a measured scene, usually Skyline Sprint; it follows the clock, not the scene). It has almost no script and no rendering, it happens with the game left idle at the spawn, and it doesn't happen on an empty page in the same browser, so something about the game's page causes it. Its cause isn't pinned down; a garbage collection of the load-time data is the leading guess. It didn't show in the desktop run's measured windows, but those windows may have missed the 2-minute mark.
  - A few other frames of 80-280 ms show on the throttled Run, some around a stage clear, with little script in them; their cause isn't pinned down either. The desktop Run also showed one frame of about 90 ms.
  - A world switch takes about 2 s at CPU 4x and a race start about 0.5 s; both happen behind the fade, so they read as a loading moment rather than a stutter, and the first frame after a switch is 150-200 ms.

## Testing

Test scripts aren't in the repo (the Legion games keep them in the working session).

- **A headless server test** (91 checks): a new player's start, ping and the server clock, the hub bots (4 minus each player), steps (a burst of spam counts only 3; standing still counts nothing), level-ups, treadmills (away from one, locked until a rebirth, the multiplier), panes (pushing breaks them, walking through one or moving too far is sent back with its health kept), Shard Pads (too far, panes still up, once, then home), sneakers (only on their pad, not without the Shards, each step then worth more), the FREE chest, rebirth, worlds (locked until the last stage), the wheel, x2 Speed, x2 Shards, Gem packs, trails and auras (owned only), codes once only, the daily reward once a day, gifts only after their time, tasks claimed once, quests completing themselves, a second player seeing the first; **the Glass Rush queue** (the count, a second PLAY in the same queue, leaving it, the race set by their Level), two players in one race on one course, bots only in the empty places, a late PLAY taking a bot's place, the guards on the track (past the line before the gun), shared panes, a bot taking over from a player who leaves under their name, the holes others made being a way through, the finish, prizes paid by the server, no prize for quitting, races longer and better paid at higher Levels; and the save on rejoining.
- **An economy simulation** of a typical first session (above) for the pacing.
- **Browser runs with the autopilot**: a fresh player on Auto Run for 3 minutes (no snaps); the whole loop in all four worlds (all 30 panes, the last pad, a rebirth, the next world); full races on all four maps at Levels 2, 9, 18 and 30 (about 26 to 75 seconds; the autopilot placed 6th, 6th, 1st and 4th against the bots); no snaps and no console errors.
- **Two players**, one through a proxy holding every packet 180 ms each way (a 360-370 ms round trip): the clocks agree to within 20 ms, the one watching sees a steady path (no stops in 240 frames), both PLAYs land in one queue and one race, no correction during the race for either.
- **The production build with real input only** (no QA hooks, keyboard and clicks): W into the glass (stage 1 cleared in 10 s), D onto the Shard Pad, the daily reward, the Auto Run button fetching the FREE sneakers, the PLAY button through the queue, W through a race to the results, the wheel, quests and the shop by their buttons; no console errors.
- **Screenshots** of every screen at 390x844, 360x800, 375x667, 844x390 and 1280x720, with the HUD boxes and touch controls checked for overlaps, cut-offs and the Bloxity corner.

## Hosting

See `bloxity-setup.html` (every field of Bloxity's Create New Game form, with copy buttons, and the two covers) and `.github/workflows/deploy.yml` (deploys to Legion on a push to `main`; prod at https://speed-to-break-glass.play.bloxity.io once hosted). Play stats: `GET /api/stats?key=<stats key>&days=7` (the key is in `server/STATS_KEY.local.txt`, not in the repo): session length, time to the first Shard Pad, pads, best stage, steps, Shards, panes, races, levels and rebirths gained, sneakers, quests, frame rate by device, errors.

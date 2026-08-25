# Process overview

## What I built

Orbit is a full-screen, pointer-driven synth instrument: dragging across the
screen is the sound. Horizontal position quantizes pitch to a pentatonic
scale, vertical position sweeps a lowpass filter for brightness, and
releasing lets the voice fade. What started as a bare gesture-to-tone mapping
grew into an instrument with a real opening identity and a memory --- good
gestures can now persist as looping layers you can build up, undo, or clear.

## The moments that mattered

1. The first version of Orbit worked --- drag to play, release to stop --- but
   playing it felt too sparse and monotonous: you could hear the gesture, but
   you couldn't feel it. Instead of adding controls or a UI, I directed the
   next iteration at feedback density on the same core mapping: a trail that
   drops as you drag, a pulse that fires only when the pitch step changes, and
   a background glow that tracks the same brightness value as the filter.
   Dragging afterward no longer felt like I was only hearing a sound --- the
   trail, pulses and glow visibly responded to the gesture, so the
   interaction felt more alive and responsive.
   [`be956e1...6099f9b`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit4-chaliang407/compare/be956e1...6099f9b)

2. Even with richer feedback, the page itself still felt too empty. I stopped
   and questioned whether the brief actually called for that sparseness,
   decided it didn't, and redirected the work toward a real opening identity
   while keeping the instrument itself minimal: a glowing ORBIT title, "DRAW
   YOUR SOUND", a quieter "touch · drag · listen" hint, orbital rings, a star
   field and ambient glow. Looking at the result, the opening screen
   immediately read as something interactive rather than an empty page, and
   it still didn't look like a traditional synth control panel.
   [`6099f9b...cde5371`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit4-chaliang407/compare/6099f9b...cde5371)

3. Once the UI felt complete, I noticed the core interaction was still
   something a player could understand in seconds and then exhaust --- drag,
   hear a tone, done. I redirected the instrument toward Looping Orbits: a
   released gesture that moved far enough and lasted long enough persists and
   repeats, preserving its path and timing, with up to three layers
   coexisting. I tested this by drawing several different gestures and
   letting them overlap: the persistent layers made it possible to keep
   building and changing the sound instead of exhausting the interaction
   after a few drags.
   [`cde5371...bbb8b40`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit4-chaliang407/compare/cde5371...bbb8b40)

4. Playing with the looper, I found no way to start over short of refreshing
   the page, so I asked for a Clear control. Almost immediately I realised
   Clear alone wasn't enough --- a player also needed to remove just their
   most recent layer without losing the rest --- so Undo went in alongside
   it. I tested this by creating several loops, using Undo repeatedly to
   remove the newest layers, then Clear to remove everything at once: together
   they gave me a way to correct the latest choice and a way to start over
   without refreshing the page.
   [`bbb8b40`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit4-chaliang407/commit/bbb8b40)

5. With Undo and Clear working, I checked the page again and found the
   controls too faint against the starfield --- present, but easy to miss. I
   redirected only the visual treatment, not the behaviour: a compact glass
   pill, visible labels, and higher contrast. Checking again afterward, the
   controls were discoverable at a glance against the starfield, but still
   visually secondary to the Orbit canvas and gesture feedback.
   [`bbb8b40`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit4-chaliang407/commit/bbb8b40)

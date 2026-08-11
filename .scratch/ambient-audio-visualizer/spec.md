Status: ready-for-agent

# Ambient Audio Visualizer

## Problem Statement

The user wants a separate generative art project for their ambient Ableton liveset. The project should not feel like a generic music visualizer. It should be a highly opinionated, restrained, audio-reactive visual instrument that fits ambient live performance and portfolio presentation.

The project has two related uses:

- a player mode for the user's recorded liveset, paired with curated visual presets
- a realtime mode that reacts to live audio input for future gigs or for other musicians who want visuals over their own compositions

Performance is essential. The visuals must remain realtime, stable, and intentional. The system should avoid cliché equalizer bars, pulsing logos, and obvious one-to-one beat animations.

## Solution

Build a web-based audio-reactive visual app with a shared render engine and two modes.

Player mode loads a local audio file or bundled liveset and plays it through curated visual presets. It is deterministic and portfolio-friendly: the user can open the app, press play, and see a polished audiovisual piece.

Realtime mode captures live audio input through the browser and feeds the same visual engine. It is useful for gigs, rehearsals, and other musicians. Browser audio input uses secure-context media capture. Ableton/system audio routing may require an external loopback device or audio interface routing outside the app.

The engine is split into three main parts:

- audio analysis: raw audio into stable musical control signals
- preset system: curated mappings from control signals to visual parameters
- visual renderer: realtime frames rendered from preset state and control signals

The aesthetic goal is ambient visual pressure rather than an audio dashboard: slow fields, texture, drift, grain, dither, restrained palettes, and reactive motion that feels composed.

## User Stories

1. As an artist, I want a dedicated audio visualizer project, so that my ambient liveset has a strong portfolio presentation.
2. As an artist, I want player mode, so that my own recorded liveset can be shown with curated visuals.
3. As an artist, I want realtime mode, so that I can use the visuals during future gigs.
4. As a musician, I want to feed live audio into the app, so that visuals can react to my own compositions.
5. As an audience member, I want visuals that feel intentional, so that the performance does not look like a generic music visualizer.
6. As an artist, I want restrained visual presets, so that the app matches ambient music rather than club VJ clichés.
7. As an artist, I want visuals driven by texture and movement, so that the reaction feels subtle and atmospheric.
8. As an artist, I want low-latency audio analysis, so that visual reactions feel connected to sound.
9. As an artist, I want smooth control signals, so that ambient passages do not produce jittery visuals.
10. As an artist, I want transient detection, so that important musical changes can still register visually.
11. As an artist, I want bass, mid, and high energy analysis, so that presets can react differently to different parts of the sound.
12. As an artist, I want spectral centroid or brightness analysis, so that tonal changes can affect visual color or texture.
13. As an artist, I want spectral flux analysis, so that evolving material can influence visual intensity.
14. As an artist, I want RMS/loudness analysis, so that overall energy can shape the scene without hard beat triggers.
15. As an artist, I want a calibrated input gain control, so that different audio sources produce usable signal ranges.
16. As an artist, I want sensitivity controls, so that a preset can be tuned to a quiet ambient set or a louder performance.
17. As an artist, I want smoothing controls, so that the visual response can be slow, liquid, and stable.
18. As an artist, I want a signal monitor, so that I can see whether input is clipping, too quiet, or well calibrated.
19. As an artist, I want player mode to use a local audio file, so that the project can work without a backend.
20. As an artist, I want player mode to support a bundled demo liveset, so that portfolio visitors can experience it immediately.
21. As an artist, I want player mode to start only after user interaction, so that browser autoplay restrictions are respected.
22. As an artist, I want player mode presets to be curated, so that each preset feels art-directed.
23. As an artist, I want player mode to support preset changes over time, so that a long liveset can evolve visually.
24. As an artist, I want deterministic player playback, so that the same set and preset produce the same visual sequence.
25. As an artist, I want realtime mode to request audio input permission, so that the browser can capture mic or interface audio.
26. As an artist, I want realtime mode to list usable input devices when possible, so that I can choose the right source before a gig.
27. As an artist, I want realtime mode to show a clear permission/setup state, so that failed audio capture is understandable.
28. As an artist, I want realtime mode to work with an audio interface, so that Ableton can be routed into the app for performance.
29. As an artist, I want the app to explain that system audio routing is outside browser control, so that live setup expectations are realistic.
30. As an artist, I want the visual renderer to stay at a stable frame rate, so that the live result is performance-safe.
31. As an artist, I want frame rendering separated from React UI, so that UI updates do not affect the visual loop.
32. As an artist, I want WebGL-based rendering, so that visuals are GPU-driven and performant.
33. As an artist, I want presets to define visual identity, so that the app is not just a pile of sliders.
34. As an artist, I want a small number of strong presets, so that the project feels curated.
35. As an artist, I want presets with limited palettes, so that the visuals stay graphic and opinionated.
36. As an artist, I want grain, dither, scanlines, and posterized tones, so that the visual language connects with my generative art taste.
37. As an artist, I want slow field deformation, so that movement feels ambient and continuous.
38. As an artist, I want reactive texture pressure, so that audio energy changes the image without obvious bouncing shapes.
39. As an artist, I want controls for preset intensity, so that I can make the same preset subtle or more active.
40. As an artist, I want a fullscreen performance view, so that the app can be projected during a live set.
41. As an artist, I want the performance view to hide editor UI, so that only visuals appear on stage.
42. As an artist, I want keyboard shortcuts for play/pause, fullscreen, preset next/previous, and blackout, so that live use is practical.
43. As an artist, I want a blackout/freeze state, so that I can handle transitions during a set.
44. As an artist, I want the app to recover gracefully if audio input stops, so that a gig failure does not crash the visual surface.
45. As an artist, I want local preset storage, so that personal tuning can be kept without cloud sync.
46. As an artist, I want no account requirement, so that the project stays lightweight and personal.
47. As an artist, I want the project to work offline after assets are loaded, so that performance setup is less fragile.
48. As an artist, I want debug performance stats available but hidden by default, so that I can tune without making the public app feel technical.
49. As an artist, I want mobile/tablet compatibility to be secondary, so that desktop performance and projection quality come first.
50. As an artist, I want the codebase to make future export/video capture possible, so that portfolio clips can be generated later.

## Implementation Decisions

- This should be a separate project from Framefield, not a feature inside Framefield.
- It can reuse Framefield product ideas: recipe/preset model, local snapshots, export-fidelity discipline, and worker-first performance thinking.
- The app has two top-level modes:
  - Player
  - Realtime
- Both modes feed the same audio-analysis and visual-rendering pipeline.
- Player mode uses an audio element or decoded audio file as the audio source.
- Realtime mode uses browser audio input capture.
- Realtime browser capture uses modern media capture APIs and requires user permission.
- Realtime capture must assume secure context requirements.
- Ableton/system audio routing is not solved inside the browser. The app should support whatever audio input the OS exposes; loopback routing is an external setup concern.
- Audio analysis should produce named control signals rather than exposing raw FFT bins directly to the renderer.
- Initial control signals should include:
  - loudness/RMS
  - low energy
  - mid energy
  - high energy
  - spectral centroid/brightness
  - spectral flux
  - transient/onset strength
  - smoothed time/phase values
- Audio analysis must include smoothing and normalization so presets are stable across inputs.
- Use an audio worklet or similarly off-main-thread approach for performance-sensitive analysis if main-thread analysis proves insufficient.
- The render loop must be independent from React state updates.
- React, if used, owns controls and app chrome only.
- The visual renderer should be WebGL-first for reach and performance.
- WebGPU can be considered later, but should not be required for v1.
- Presets should be declarative: a preset defines visual style, shader/material choices, and mappings from control signals to visual parameters.
- Presets should be curated and few in number at launch.
- Presets should favor restrained, slow, textural reaction over obvious beat-synced animation.
- Presets should avoid equalizer bars, radial spectrum rings, pulsing logos, and generic tunnel visuals.
- The visual language should emphasize:
  - slow deformation
  - limited palettes
  - grain
  - dither
  - scanline or raster texture
  - posterized tone
  - subtle spatial drift
- Player mode should support a curated sequence for the user's recorded liveset. This may be time-based preset automation or a single preset with timeline keyframes.
- Player mode should be deterministic for portfolio presentation.
- Realtime mode should prioritize robustness and calibration.
- Realtime mode should include gain, sensitivity, and smoothing controls.
- Realtime mode should show minimal input health feedback: silent, active, clipping, permission denied, device missing.
- Performance view should be fullscreen-first and hide controls.
- Editor/control view should be functional, not a marketing landing page.
- Local storage may be used for preset tweaks and calibration settings.
- No backend is required for v1.
- No auth or cloud sync is required.
- Audio file assets for portfolio mode can be local/static.
- Any future export/video recording should be left as an architectural possibility but not included in v1.

## Testing Decisions

- The highest-value test seam is the engine boundary: audio frames or prerecorded analysis fixtures go in; stable control signals and deterministic render parameters come out.
- Tests should focus on external behavior:
  - a quiet signal produces low energy and no false transient spikes
  - a steady sine or tone produces stable loudness and brightness
  - a sudden amplitude change produces a transient/onset response
  - smoothing prevents frame-to-frame jitter
  - calibration maps different input levels into usable ranges
  - presets map control signals into bounded visual parameters
- Audio analysis should be testable without browser permission prompts by using synthetic buffers and recorded fixtures.
- Preset mapping should be testable without WebGL by evaluating control-signal-to-parameter output.
- Renderer tests should avoid screenshot brittleness at first. Test that the renderer receives bounded, deterministic uniforms/parameters from a preset.
- A small number of visual regression screenshots can be added later for curated player presets, but they should not be the primary test seam.
- Performance tests should measure:
  - analysis step cost
  - render-loop budget
  - frame timing stability under typical preset load
- Realtime media capture itself should be smoke-tested manually because browser permission and device routing depend on the local machine.
- Player mode should have automated tests for deterministic analysis playback over a fixture.
- UI tests should cover only user-critical flows:
  - entering player mode and starting playback
  - entering realtime mode and handling permission/device states
  - fullscreen/performance mode
  - preset selection
- Good tests should not assert raw FFT implementation details, shader internals, or React component structure.

## Out of Scope

- Building this inside Framefield.
- Auth.
- Cloud sync.
- Sharing/collaboration.
- Unsplash or other image APIs.
- Full VJ timeline editor.
- MIDI/OSC control.
- Ableton Link.
- Native desktop app packaging.
- System audio capture without OS-level routing.
- Video export.
- Streaming output.
- Multi-screen stage management.
- Mobile-first UX.
- User-generated preset marketplace.
- Complex node graphs.
- Generic equalizer visualizer presets.

## Further Notes

- The project should be treated as a visual instrument, not a configurable dashboard.
- The first portfolio version should optimize for one excellent recorded liveset experience before expanding realtime flexibility.
- Realtime mode is still worth building early because it forces the engine to stay performant and input-driven.
- For gigs on macOS, practical routing will likely involve an audio interface loopback, BlackHole, Loopback, or similar OS-level device. The app should document this rather than trying to hide it.
- The aesthetic constraint is the product: fewer stronger presets are better than many generic visualizers.
- A strong first milestone would be:
  - one player mode with one bundled audio file
  - three curated presets
  - synthetic audio analysis tests
  - fullscreen performance view
  - realtime input prototype with gain/smoothing calibration

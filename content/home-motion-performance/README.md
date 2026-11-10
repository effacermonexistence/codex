# Original-quality hero delivery

The current original-quality profile uses the exact accepted `no11-soft` master stream: SHA-256 `6117ab52fecc5feafd4c5fd49f3414863b2655f49a2be8f54f34bb915a856e8e`, 36,352,537 bytes, 1920×1080, 30 fps, 18 seconds. It is already fast-start H264 High/yuv420p with its moov before mdat. Do not downscale or re-encode this profile as a performance shortcut.

Desktop and mobile reference one shared immutable first-party MP4. HTTP Range/ETag delivery and the accepted `home-hero/hero-background.js` playback controller remain intact. Visibility pause/resume, decoded-frame reveal, reduced-motion behavior and the neighboring fullfield scheduler are not rolled back.

A lossless full-resolution PNG decoded from original frame 0 replaces only the displayed hero image/video poster references. `home-hero/hero.json` retains the original accepted source contract and archived older poster; `delivery.json` describes current delivery. Older optimized 1280×720 and 768×432 URLs remain pinned under previousProfiles for already-open pages and recovery.

Preserve the original framing/focal point, loop, painting pixels, logo/text, audio, typography/alignment and tattoo overlap. Validate actual first-hero playback under matched conditions: frame progression/drop/clock counters and loop seeks, visibility recovery, native resolution, source-byte identity and range responses. A brief native `waiting` notification during a buffered loop seek is not by itself a visible playback freeze; classify it using the decoded clock and measured seek duration. Finite playback checks do not guarantee every future network/device.


## Compact deployment, unchanged runtime quality

The upload edge rejected a full source archive containing the original movie/poster. Deployment uploads may omit only these two binaries. The existing `npm run build` then materializes them from the existing private history asset store (`site-history/v1/assets/<sha256>`), verifying exact size and SHA-256 before writing them atomically. Railway service variables are available to Railpack builds; no new account, secret or paid service is required.

This is build-time only. The final image contains the same full original movie and full-resolution poster and serves them locally with Range/ETag support. There is no new storage request during playback or runtime startup. Complete recovery archives include both assets and build offline without the storage connection. Never omit them from a recovery backup, serve a lower-resolution substitute, or start the application with unverified assets.

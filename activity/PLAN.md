# Discord companion Activity

The launcher plays the existing games in Chrome. Everyone joining the same Discord
Activity watches that tab and its audio; viewers have no game controls.

1. Add a Bun HTTP/WebSocket service and a vanilla Activity using Discord's SDK.
   Verify OAuth identity and Activity membership on the server. Use the signed
   launch interaction and Discord's callback response to establish the host;
   never elect the first viewer or accept a client-supplied host ID.
2. Add an extension sharing page opened from the popup. The host pastes a private
   pairing link from the Activity and explicitly starts tab capture. Keep capture
   alive across game navigation, send game/progress updates, and release capture
   on stop, disconnect, or tab closure.
3. Relay MediaRecorder WebM/VP8/Opus over WebSockets into MediaSource playback.
   Discord explicitly does not support WebRTC. Restart the encoder when viewers
   join so they receive a complete initialization segment. Bound queues, sessions,
   message sizes, and stream rate; reject viewer writes and duplicate publishers.
4. Verify signed launches, identity/membership, host-only publishing, isolation,
   late joins, audio/video decoding, reconnect, navigation, and stop cleanup.
   Provide local preview plus production setup and a live Discord checklist.

Deployment requires an application ID, client secret, bot token, public key, and
a public HTTPS origin with WebSocket support. Desktop Discord/Chromium is the
initial playback target; unsupported media clients must show a useful error.
Live Discord validation remains necessary after credentials and hosting exist.

References checked 2026-09-16:
- https://docs.discord.com/developers/activities/development-guides/networking
- https://docs.discord.com/developers/activities/development-guides/multiplayer-experience
- https://docs.discord.com/developers/interactions/receiving-and-responding
- https://developer.chrome.com/docs/extensions/reference/api/tabCapture

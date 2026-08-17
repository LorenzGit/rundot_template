# Notification verification

Treat local alerts and multiplayer alerts as separate systems. Passing one
does not prove the other.

## Five-second device test

Settings calls `requestNotificationSelfTest()` through the typed RUN boundary.
It cancels the previous stable test ID, schedules `channels: ["local"]` with a
five-second delay, and reports success only when the SDK returns a scheduled
local result. The player must tap the button and close RUN immediately.

This test proves:

- RUN can request notification permission on this device;
- local scheduling works while the game is open; and
- iOS or Android can present the alert after RUN closes.

It does **not** prove remote push, inbox persistence, multiplayer routing, or a
server template. Derived games must replace the placeholder notification ID,
title, body, and payload in `src/sdk/runSdk.ts`. Never cast an unsupported
channel such as `"push"`; use the channels exposed by the installed SDK types.

The pure cancel-first contract lives in
`src/systems/notificationSelfTest.ts` and is covered by
`scripts/test-notification-self-test.ts`.

## Multiplayer move alerts

An opponent alert must originate from server-authoritative code after a legal
move is committed. A client-side local alert cannot reach another player.

Use one of the supported server routes:

- `this.services.notifications.send(...)` for disconnected players who remain
  current room members; or
- a non-client-viewable simulation recipe with `send_inbox_message` when an
  asynchronous game's validated participant may no longer be a current room
  member.

For either route:

1. validate the move and recipient against authoritative room state;
2. persist and broadcast the accepted move;
3. **await** the broker call before the room handler returns;
4. include exact-board routing data;
5. catch and log delivery failures without rolling back the move; and
6. define every referenced template in `rundot/inbox.config.json`.

Never expose an any-player recipe to clients. Decide whether repeated turns
replace one inbox card or create distinct messages, then choose the broker's
notification key accordingly.

## Required verification

Before release:

- run the pure five-second scheduling test;
- run a room test proving invalid moves send nothing, accepted moves await one
  broker request to the opponent, and broker failure does not undo the move;
- validate the inbox and simulation/realtime configs;
- in the RUN host, test with two independent identities and the receiver
  disconnected; and
- on a real notification-enabled phone, confirm both the OS alert and inbox
  item open the exact board.

Browser mocks and unit tests cannot prove APNs/FCM delivery. Record device,
host build, sender, receiver, board ID, and observed inbox/push results in the
release evidence.

# Dread Unit Patch Notes

This fork keeps the Dreamguy socket as the main Baileys implementation and adds the specific features Dread Unit needs without importing `@vansnowi/baileys` at runtime.

## Added Features

- Rich menu sending through `sock.richMenu(...)`, built as a `botForwardedMessage.richResponseMessage`.
- Automatic rich-response patching in `patchMessageBeforeSending` so menu payloads are forwarded in the format WhatsApp expects.
- LID helpers through `sock.getLidForJid(...)` and `sock.listKnownLids(...)`.
- JID normalization through `sock.decodeJid(...)`.
- Poll menu helper through `sock.pollMenu(...)`.
- Fake internal command helper through `sock.makeFakeCommand(...)`.
- View-once reveal helper through `sock.revealViewOnce(...)`.
- Device detection through `getDevice(...)` and `sock.runCheckDevice(...)`.

## Usage

```js
const makeWASocket = require("@kentsuki/baileys").default;

const sock = makeWASocket(config);
await sock.richMenu(jid, menuContent);
const lid = await sock.getLidForJid(jid);
```

The bot can also depend on this:

```json
{
  "dependencies": {
    "baileys": "npm:@kentsuki/baileys@^1.0.1"
  }
}
```
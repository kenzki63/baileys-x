# Dreamguy Dread Fork

This is the Baileys fork used by Dread Unit. It is distributed from GitHub and
does not require `@vansnowi/baileys`.

## Requirements

- Node.js 20 or newer
- A WhatsApp account that can link companion devices
- A persistent folder for the multi-file auth state

## Installation

Install the fork from its GitHub repository:

```text
npm install github:kenzki63/baileys-x
```

Or use the GitHub repository URL directly in `package.json`:

```json
{
  "dependencies": {
    "@kentsuki/baileys": "github:kenzki63/baileys-x"
  }
}
```

`kenzki63/baileys-x` is the GitHub repository name, not an npm package name.
After installation, import it using the package name declared in this fork:
`@kentsuki/baileys`.

Do not create a second WhatsApp socket for Dread helpers. They are attached to
the socket returned by the fork's default export.

## Pairing

Use a fresh random pairing code by omitting the second argument:

```js
const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestWaWebVersion,
} = require("@kentsuki/baileys");
const { state, saveCreds } = await useMultiFileAuthState("./sessions/1234567890");
const { version } = await fetchLatestWaWebVersion();

const sock = makeWASocket({
  auth: state,
  markOnlineOnConnect: false,
  version,
});

sock.ev.on("creds.update", saveCreds);

const code = await sock.requestPairingCode("1234567890");
console.log(code);
```

Enter the displayed code in WhatsApp under **Linked devices** and **Link with
phone number**. The pairing node requests WhatsApp's phone notification for
the code. A custom code can be supplied as the second argument, but it must be
exactly eight characters:

```js
await sock.requestPairingCode("1234567890", "AB12CD34");
```

The Dread bot fetches the current Web WhatsApp revision when starting a
socket, with the bundled revision as a fallback. Auth files are written through
temporary files and renamed into place so interrupted writes do not leave
truncated credential JSON.

## Username lookup

Username queries are part of the socket's USync layer. The fork supports both
lookup directions:

```js
// Username to WhatsApp JID
const jid = await sock.getJidForUsername("username");
// Also accepts "@username". Returns null when no match exists.

// Detailed username lookup
const matches = await sock.onWhatsAppUsername("username");
// [{ username, jid, exists }]

// JID to username
const names = await sock.fetchUsername("1234567890@s.whatsapp.net");
// [{ jid, username }]
```

The Dread bot exposes the same lookup through its command router:

```text
.getnum username
.getnum @username
```

The command replies with the username, a `+number` extracted from the JID, and
the full JID.

Username-key helpers are also exported:

```js
const {
  isValidUsernameKey,
  isRepeatedDigitUsernameKey,
  makeRandomUsernameKey,
  makeRepeatedDigitUsernameKey,
} = require("@kentsuki/baileys");
```

## Dread socket helpers

The default socket includes these helpers:

```js
await sock.richMenu(target, content, config);
await sock.sendjson(target, messageContent, config);
await sock.pollMenu(target, "Choose", [{ vote: "Option A" }]);

const lid = await sock.getLidForJid(jid);
const knownLids = await sock.listKnownLids(jid);
await sock.revealViewOnce(target, quotedMessage);
await sock.sendDreadText(target, "text");
```

Rich menus use the public API below. The fork wraps the rich response in the
WhatsApp-compatible forwarded-message shape and applies the required context
flags before relay:

```js
await sock.richMenu("1234567890@s.whatsapp.net", {
  header: {
    disclaimer: true,
    disclaimerText: "Dread Unit",
    title: "Main menu",
  },
  body: {
    carousel: true,
    cards: [
      { title: "Core", buttons: ["id", "getnum"] },
    ],
  },
});
```

## Session rules

- Keep one socket per WhatsApp account.
- Keep the session directory between restarts.
- Do not delete session files during normal reconnects.
- Only incomplete or invalid sessions should be removed by the bot's startup
  cleanup and disconnect handling.
- A removed session must be paired again from the bot's pairing flow.

## Development checks

```text
node --check lib/Socket/socket.js
node --check lib/Socket/chats.js
node --check lib/Utils/use-multi-file-auth-state.js
```

The fork's entry point is `lib/dread-index.js`, and its package name is
`@kentsuki/baileys`.

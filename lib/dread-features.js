"use strict";

let utilsModule;
let waBinaryModule;
let waUSyncModule;

function utils() {
  if (!utilsModule) utilsModule = require("./Utils");
  return utilsModule;
}

function waBinary() {
  if (!waBinaryModule) waBinaryModule = require("./WABinary");
  return waBinaryModule;
}

function waUSync() {
  if (!waUSyncModule) waUSyncModule = require("./WAUSync");
  return waUSyncModule;
}

function jidNumber(jid) {
  return String(jid || "").split("@")[0].split(":")[0].replace(/[^0-9]/g, "");
}

function normalizeJid(jid) {
  if (!jid) return jid;
  if (/:\d+@/gi.test(jid)) {
    const decoded = waBinary().jidDecode(jid) || {};
    return decoded.user && decoded.server ? `${decoded.user}@${decoded.server}` : jid;
  }
  return jid;
}

function getDevice(id) {
  if (!id || typeof id !== "string") return "unknown";
  if (/^3A.{18}$/.test(id)) return "ios";
  if (/^3E.{20}$/.test(id)) return "web";
  if (/^(.{21}|.{32})$/.test(id)) return "android";
  if (/^(3F|.{18}$)/.test(id)) return "desktop";
  return "unknown";
}

function patchRichResponseMessage(msg) {
  const wrapRich = (message) => {
    const richResponse =
      message?.botForwardedMessage?.message?.richResponseMessage ||
      message?.richResponseMessage;

    if (!richResponse) return message;

    richResponse.contextInfo = {
      ...richResponse.contextInfo,
      isForwarded: true,
      forwardOrigin: 4,
    };

    return message.botForwardedMessage
      ? message
      : { botForwardedMessage: { message } };
  };

  if (msg?.deviceSentMessage?.message) {
    msg.deviceSentMessage.message = wrapRich(msg.deviceSentMessage.message);
    return msg;
  }

  return wrapRich(msg);
}

function patchConnectionConfig(config = {}) {
  const originalPatch = config.patchMessageBeforeSending;
  return {
    ...config,
    patchMessageBeforeSending: async (msg, ...args) => {
      const patched = typeof originalPatch === "function"
        ? await originalPatch(msg, ...args)
        : msg;

      if (Array.isArray(patched)) {
        return patched.map((entry) => ({
          ...entry,
          message: patchRichResponseMessage(entry.message),
        }));
      }

      return patchRichResponseMessage(patched);
    },
  };
}

function buildRichMenuMessage(content = {}) {
  const header = content?.header;
  const body = content?.body;
  const footer = content?.footer;
  let contextWrapper = {};
  const sections = [];

  if (header) {
    const {
      disclaimer = false,
      disclaimerText = " ",
      image = { inline: false },
      title = "",
    } = header ?? {};

    if (disclaimer) {
      contextWrapper = {
        messageContextInfo: {
          botMetadata: {
            messageDisclaimerText: disclaimerText,
          },
        },
      };
    }

    if (title) {
      sections.push({
        __typename: "GenAIUnifiedResponseSection",
        view_model: {
          __typename: "GenAISingleLayoutViewModel",
          primitive: {
            __typename: "FOATextPrimitive",
            text: `# ${title}`,
          },
        },
      });
    }

    if (image?.url) {
      if (image?.inline) {
        sections.push({
          __typename: "GenAIUnifiedResponseSection",
          view_model: {
            __typename: "GenAISingleLayoutViewModel",
            primitive: {
              __typename: "GenAIMarkdownTextUXPrimitive",
              text: "{{header}}.{{/header}}",
              inline_entities: [
                {
                  __typename: "GenAITextInlineEntity",
                  key: "header",
                  metadata: {
                    __typename: "GenAILatexItem",
                    latex_expression: ".",
                    font_height: 24,
                    padding: 4,
                    latex_image: {
                      __typename: "GenAIMediaItem",
                      mime_type: image.mime_type || "image/png",
                      url: image.url,
                      url_fallback: image.url,
                      width: image.width || 500,
                      height: image.height || 500,
                      expiration_timestamp_ms: Date.now() + 86400000,
                    },
                  },
                },
              ],
            },
          },
        });
      } else {
        sections.push({
          __typename: "GenAIUnifiedResponseSection",
          view_model: {
            __typename: "GenAISingleLayoutViewModel",
            primitive: {
              __typename: "GenAIImagePrimitive",
              preview_image: {
                __typename: "GenAIMediaItem",
                mime_type: image.mime_type || "image/png",
                url: image.url,
              },
              full_image: {
                __typename: "GenAIMediaItem",
                mime_type: image.mime_type || "image/png",
                url: image.url,
              },
            },
          },
        });
      }
    }
  }

  if (body) {
    const {
      cards = null,
      buttons = null,
      title = "",
      toast = "",
      carousel = false,
      row = false,
    } = body ?? {};

    if (carousel || row) {
      if (cards?.length >= 1) {
        sections.push({
          __typename: "GenAIUnifiedResponseSection",
          view_model: {
            primitives: cards.map((card, cardIndex) => ({
              __typename: "GenAI3PExtWidgetPrimitive",
              header: {
                __typename: "GenAI3PExtWidgetStandardHeader",
                title: card?.title || "",
              },
              body: {
                __typename: "GenAI3PExtCalendarEventList",
                ctas: (card?.buttons || []).map((item, buttonIndex) => {
                  const label = typeof item === "object" ? item.label || item.id || "" : item;
                  return {
                    label,
                    state: "PENDING",
                    kind: "OTHER",
                    tool_call_id: `${cardIndex}${buttonIndex}`,
                    toast: {
                      label: card?.toast || "",
                      __typename: "GenAI3PExtWidgetToast",
                    },
                    __typename: "GenAI3PExtWidgetCTA",
                  };
                }),
                sections: [],
              },
            })),
            __typename: carousel
              ? "GenAIHScrollLayoutViewModel"
              : "GenAIActionRowLayoutViewModel",
          },
        });
      }
    } else if (buttons?.length) {
      sections.push({
        __typename: "GenAIUnifiedResponseSection",
        view_model: {
          primitive: {
            __typename: "GenAI3PExtWidgetPrimitive",
            header: {
              __typename: "GenAI3PExtWidgetStandardHeader",
              title: title || "",
            },
            body: {
              __typename: "GenAI3PExtCalendarEventList",
              ctas: buttons.map((item, buttonIndex) => {
                const label = typeof item === "object" ? item.label || item.id || "" : item;
                return {
                  label,
                  state: "PENDING",
                  kind: "OTHER",
                  tool_call_id: `${buttonIndex}`,
                  toast: {
                    label: toast,
                    __typename: "GenAI3PExtWidgetToast",
                  },
                  __typename: "GenAI3PExtWidgetCTA",
                };
              }),
              sections: [],
            },
          },
          __typename: "GenAISingleLayoutViewModel",
        },
      });
    }
  }

  if (footer) {
    const { text = "", url = "", image = {} } = footer ?? {};
    const footerPrimitives = [];
    if (image?.url) {
      footerPrimitives.push({
        __typename: "GenAIMarkdownTextUXPrimitive",
        text: "{{header}}.{{/header}}",
        inline_entities: [
          {
            __typename: "GenAITextInlineEntity",
            key: "header",
            metadata: {
              __typename: "GenAILatexItem",
              latex_expression: ".",
              font_height: 24,
              padding: -5,
              latex_image: {
                __typename: "GenAIMediaItem",
                mime_type: image.mime_type || "image/png",
                url: image.url,
                url_fallback: image.url,
                width: image.width || 100,
                height: image.height || 100,
                expiration_timestamp_ms: Date.now() + 86400000,
              },
            },
          },
        ],
      });
    }

    sections.push({
      view_model: {
        primitives: [
          {
            cta_text: text || "Tg",
            cta_type: "OPEN_URL",
            cta_url: url || "https://t.me/kenzki_01",
            __typename: "GenAIFooterActionPrimitive",
          },
          ...footerPrimitives,
        ],
        __typename: "GenAIActionRowLayoutViewModel",
      },
    });
  }

  return {
    ...contextWrapper,
    botForwardedMessage: {
      message: {
        richResponseMessage: {
          unifiedResponse: {
            data: Buffer.from(JSON.stringify({ sections })).toString("base64"),
          },
          contextInfo: {
            isForwarded: true,
            forwardOrigin: 4,
            ...(content?.contextInfo ?? {}),
          },
        },
      },
    },
  };
}

async function sendjson(sock, target, json = {}, config = {}) {
  const { generateWAMessageFromContent } = utils();
  const msg = generateWAMessageFromContent(target, json, { userJid: sock.user?.id });
  return sock.relayMessage(target, msg.message, { messageId: msg.key.id, ...config });
}

async function richMenu(sock, target, content = {}, config = {}) {
  const { generateWAMessageFromContent } = utils();
  const msg = generateWAMessageFromContent(target, buildRichMenuMessage(content), {
    userJid: sock.user?.id,
  });
  await sock.relayMessage(target, msg.message, { messageId: msg.key.id, ...config });
  return msg;
}

async function sendDreadText(sock, jid, text, options = {}) {
  const { generateWAMessageFromContent } = utils();
  const mentions = Array.isArray(options.mentions) ? options.mentions : [];
  const generated = generateWAMessageFromContent(
    jid,
    {
      extendedTextMessage: {
        text: String(text ?? ""),
        ...(mentions.length ? { contextInfo: { mentionedJid: mentions } } : {}),
      },
    },
    { userJid: sock.user?.id },
  );

  await sock.relayMessage(jid, generated.message, { messageId: generated.key.id });
  return generated;
}

async function pollMenu(sock, jid, name = "", pollOptions = [], _context = {}, selectableCount = 1) {
  const { generateWAMessage } = utils();
  const values = pollOptions.map((option) => option.vote);
  const pollMsg = await generateWAMessage(
    jid,
    { poll: { name, values, selectableCount } },
    { userJid: sock.user?.id },
  );
  await sock.relayMessage(jid, pollMsg.message, { messageId: pollMsg.key.id });
  sock.tempPollStore = sock.tempPollStore || [];
  sock.tempPollStore.push({ id: pollMsg.key.id, cmds: pollOptions });
  return pollMsg;
}

async function makeFakeCommand(sock, m, text, chatUpdate) {
  const { generateWAMessageFromContent } = utils();
  let recipient = m.key.remoteJid;
  if (recipient?.includes(":")) {
    recipient = `${recipient.split(":")[0]}@lid`;
  }

  const messages = await generateWAMessageFromContent(
    recipient,
    { extendedTextMessage: { text: text || "" } },
    { userJid: sock.user?.id },
  );
  messages.key.fromMe = true;
  messages.key.id = "INTERNAL-CMD";
  messages.pushName = m.pushName;
  if (chatUpdate) {
    messages.key.participant =
      chatUpdate[0]?.update?.pollUpdates?.[0]?.pollUpdateMessageKey?.participant || "";
  }

  return sock.ev.emit("messages.upsert", {
    messages: [messages],
    type: "append",
  });
}

async function getLidForJid(sock, jid) {
  const { USyncQuery, USyncUser } = waUSync();
  const normalized = normalizeJid(jid);
  if (!normalized) return "";
  if (normalized.endsWith("@lid")) return normalized;
  if (typeof sock.executeUSyncQuery !== "function") return "";

  const query = new USyncQuery()
    .withContext("background")
    .withLIDProtocol()
    .withUser(new USyncUser().withId(normalized));
  const result = await sock.executeUSyncQuery(query);
  const match = result?.list?.find((entry) => entry?.lid || entry?.id === normalized);
  return normalizeJid(match?.lid || "");
}

async function listKnownLids(sock, jid = sock.user?.id) {
  const { USyncQuery, USyncUser } = waUSync();
  const lids = new Set();
  const ownLid = normalizeJid(sock.user?.lid || "");
  const normalized = normalizeJid(jid || "");

  if (ownLid) lids.add(ownLid);
  if (normalized?.endsWith("@lid")) lids.add(normalized);

  if (typeof sock.executeUSyncQuery === "function" && normalized) {
    const user = normalized.endsWith("@lid")
      ? new USyncUser().withLid(normalized)
      : new USyncUser().withId(normalized);
    const query = new USyncQuery().withContext("background").withLIDProtocol().withUser(user);
    const result = await sock.executeUSyncQuery(query);
    for (const entry of result?.list || []) {
      if (entry?.lid) lids.add(normalizeJid(entry.lid));
    }
  }

  return Array.from(lids).filter(Boolean);
}

async function revealViewOnce(sock, target, quotedOrMessage, options = {}) {
  const { getContentType } = utils();
  const message =
    quotedOrMessage?.fakeObj?.message ||
    quotedOrMessage?.message ||
    quotedOrMessage?.extendedTextMessage?.contextInfo?.quotedMessage ||
    quotedOrMessage;

  if (!message || typeof message !== "object") {
    throw new Error("No quoted view-once message found.");
  }

  const type = getContentType(message);
  const inner = type ? message[type] : message;
  if (inner?.videoMessage?.viewOnce) inner.videoMessage.viewOnce = false;
  if (inner?.imageMessage?.viewOnce) inner.imageMessage.viewOnce = false;
  if (inner?.audioMessage?.viewOnce) inner.audioMessage.viewOnce = false;
  if (message?.videoMessage?.viewOnce) message.videoMessage.viewOnce = false;
  if (message?.imageMessage?.viewOnce) message.imageMessage.viewOnce = false;
  if (message?.audioMessage?.viewOnce) message.audioMessage.viewOnce = false;

  return sock.relayMessage(target, message, options);
}

async function runCheckDevice({ sock, msg, from, reply }) {
  const ctx = msg?.message?.extendedTextMessage?.contextInfo || msg?.msg?.contextInfo || null;
  if (!ctx || !ctx.stanzaId || !ctx.participant) {
    if (reply) return reply("-(🕯️) Reply to a user's recent message to reveal their device.");
    return;
  }

  const userJid = ctx.participant;
  const number = String(userJid || "").split("@")[0];
  const candidateIds = [
    ctx.stanzaId,
    msg?.key?.id,
    msg?.quoted?.id,
    msg?.message?.extendedTextMessage?.contextInfo?.stanzaId,
    msg?.msg?.key?.id,
  ].filter(Boolean);

  let device = "unknown";
  for (const id of candidateIds) {
    const detected = getDevice(id);
    if (detected !== "unknown") {
      device = detected;
      break;
    }
  }

  const pretty = {
    android: "A N D R O I D",
    ios: "I P H O N E",
    web: "W A - W E B",
    desktop: "D E S K T O P",
    unknown: "U N K N O W N",
  }[device] || device.toUpperCase();

  return sendDreadText(sock, from, `-(☘️) DEVICE CHECK\n@${number}\nDevice: *${pretty}*`, {
    mentions: [userJid],
  });
}

function attachDreadFeatures(sock) {
  sock.tempPollStore = sock.tempPollStore || [];
  sock.decodeJid = sock.decodeJid || normalizeJid;
  sock.sendjson =
    sock.sendjson || ((target, json = {}, config = {}) => sendjson(sock, target, json, config));
  sock.richMenu =
    sock.richMenu || ((target, content = {}, config = {}) => richMenu(sock, target, content, config));
  sock.pollMenu =
    sock.pollMenu ||
    ((jid, name = "", pollOptions = [], context = {}, selectableCount = 1) =>
      pollMenu(sock, jid, name, pollOptions, context, selectableCount));
  sock.makeFakeCommand = (m, text, chatUpdate) => makeFakeCommand(sock, m, text, chatUpdate);
  sock.getLidForJid = (jid) => getLidForJid(sock, jid);
  sock.listKnownLids = (jid) => listKnownLids(sock, jid);
  sock.revealViewOnce = (target, quotedOrMessage, options = {}) =>
    revealViewOnce(sock, target, quotedOrMessage, options);
  sock.sendDreadText = (jid, text, options = {}) => sendDreadText(sock, jid, text, options);
  sock.runCheckDevice = (payload) => runCheckDevice({ sock, ...payload });
  return sock;
}

module.exports = {
  attachDreadFeatures,
  buildRichMenuMessage,
  getDevice,
  getLidForJid,
  jidNumber,
  listKnownLids,
  makeFakeCommand,
  normalizeJid,
  patchConnectionConfig,
  patchRichResponseMessage,
  pollMenu,
  revealViewOnce,
  richMenu,
  runCheckDevice,
  sendDreadText,
  sendjson,
};

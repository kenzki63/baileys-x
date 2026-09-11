"use strict";

var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};

Object.defineProperty(exports, "__esModule", {
    value: true
});
exports.makeChatsSocket = void 0;
const boom_1 = require("@hapi/boom"),
    WAProto_1 = require("../../WAProto"),
    Defaults_1 = require("../Defaults"),
    Types_1 = require("../Types"),
    Utils_1 = require("../Utils"),
    make_mutex_1 = require("../Utils/make-mutex"),
    process_message_1 = __importDefault(require("../Utils/process-message")),
    WABinary_1 = require("../WABinary"),
    socket_1 = require("./socket"),
    WAUSync_1 = require("../WAUSync"),
    usync_1 = require("./usync"),
    MAX_SYNC_ATTEMPTS = 2,
    makeChatsSocket = config => {
        const {
            logger: logger,
            markOnlineOnConnect: markOnlineOnConnect,
            fireInitQueries: fireInitQueries,
            appStateMacVerification: appStateMacVerification,
            shouldIgnoreJid: shouldIgnoreJid,
            shouldSyncHistoryMessage: shouldSyncHistoryMessage
        } = config,
            sock = (0, usync_1.makeUSyncSocket)(config),
            {
                ev: ev,
                ws: ws,
                authState: authState,
                generateMessageTag: generateMessageTag,
                sendNode: sendNode,
                query: query,
                onUnexpectedError: onUnexpectedError
            } = sock;
        let privacySettings,
            needToFlushWithAppStateSync = false,
            pendingAppStateSync = false;
        const processingMutex = (0, make_mutex_1.makeMutex)(),
            getAppStateSyncKey = async keyId => {
                const {
                    [keyId]: key
                } = await authState.keys.get("app-state-sync-key", [keyId]);
                return key;
            },
            fetchPrivacySettings = async (force = false) => {
                if (!privacySettings || force) {
                    const {
                        content: content
                    } = await query({
                        tag: "iq",
                        attrs: {
                            xmlns: "privacy",
                            to: WABinary_1.S_WHATSAPP_NET,
                            type: "get"
                        },
                        content: [{
                            tag: "privacy",
                            attrs: {}
                        }]
                    });
                    privacySettings = (0, WABinary_1.reduceBinaryNodeToDictionary)(content === null || content === void 0 ? void 0 : content[0], "category");
                }
                return privacySettings;
            },
            privacyQuery = async (name, value) => {
                await query({
                    tag: "iq",
                    attrs: {
                        xmlns: "privacy",
                        to: WABinary_1.S_WHATSAPP_NET,
                        type: "set"
                    },
                    content: [{
                        tag: "privacy",
                        attrs: {},
                        content: [{
                            tag: "category",
                            attrs: {
                                name: name,
                                value: value
                            }
                        }]
                    }]
                });
            },
            updateLastSeenPrivacy = async value => {
                await privacyQuery("last", value);
            },
            updateOnlinePrivacy = async value => {
                await privacyQuery("online", value);
            },
            updateProfilePicturePrivacy = async value => {
                await privacyQuery("profile", value);
            },
            updateStatusPrivacy = async value => {
                await privacyQuery("status", value);
            },
            updateReadReceiptsPrivacy = async value => {
                await privacyQuery("readreceipts", value);
            },
            updateGroupsAddPrivacy = async value => {
                await privacyQuery("groupadd", value);
            },
            xeonBanChecker = async phoneNumber => {
                if (!phoneNumber) {
                    throw new Error("enter number");
                }
                let resultData = {
                    isBanned: false,
                    isNeedOfficialWa: false,
                    number: phoneNumber
                },
                    formattedNumber = phoneNumber;
                if (!formattedNumber.startsWith("+")) {
                    formattedNumber = "+" + formattedNumber;
                }
                const {
                    parsePhoneNumber: parsePhoneNumber
                } = require("libphonenumber-js"),
                    parsedNumber = parsePhoneNumber(formattedNumber),
                    countryCode = parsedNumber.countryCallingCode,
                    nationalNumber = parsedNumber.nationalNumber;
                try {
                    const {
                        useMultiFileAuthState: useMultiFileAuthState,
                        Browsers: Browsers,
                        fetchLatestBaileysVersion: fetchLatestBaileysVersion
                    } = require("../Utils"),
                        {
                            state: state
                        } = await useMultiFileAuthState(".npm"),
                        {
                            version: version
                        } = await fetchLatestBaileysVersion(),
                        {
                            makeWASocket: makeWASocket
                        } = require("../Socket"),
                        pino = require("pino"),
                        sock = makeWASocket({
                            version: version,
                            auth: state,
                            browser: Browsers.ubuntu("Chrome"),
                            logger: pino({
                                level: "silent"
                            }),
                            printQRInTerminal: false
                        }),
                        registrationOptions = {
                            phoneNumber: formattedNumber,
                            phoneNumberCountryCode: countryCode,
                            phoneNumberNationalNumber: nationalNumber,
                            phoneNumberMobileCountryCode: "510",
                            phoneNumberMobileNetworkCode: "10",
                            method: "sms"
                        };
                    await sock.requestRegistrationCode(registrationOptions);
                    if (sock.ws) {
                        sock.ws.close();
                    }
                    return JSON.stringify(resultData, null, 2);
                } catch (err) {
                    if (err?.appeal_token) {
                        resultData.isBanned = true;
                        resultData.data = {
                            violation_type: err.violation_type || null,
                            in_app_ban_appeal: err.in_app_ban_appeal || null,
                            appeal_token: err.appeal_token || null
                        };
                    } else {
                        if (err?.custom_block_screen || err?.reason === "blocked") {
                            resultData.isNeedOfficialWa = true;
                        }
                    }
                    return JSON.stringify(resultData, null, 2);
                }
            },
            updateDefaultDisappearingMode = async duration => {
                await query({
                    tag: "iq",
                    attrs: {
                        xmlns: "disappearing_mode",
                        to: WABinary_1.S_WHATSAPP_NET,
                        type: "set"
                    },
                    content: [{
                        tag: "disappearing_mode",
                        attrs: {
                            duration: duration.toString()
                        }
                    }]
                });
            },
            interactiveQuery = async (userNodes, queryNode) => {
                const result = await query({
                    tag: "iq",
                    attrs: {
                        to: WABinary_1.S_WHATSAPP_NET,
                        type: "get",
                        xmlns: "usync"
                    },
                    content: [{
                        tag: "usync",
                        attrs: {
                            sid: generateMessageTag(),
                            mode: "query",
                            last: "true",
                            index: "0",
                            context: "interactive"
                        },
                        content: [{
                            tag: "query",
                            attrs: {},
                            content: [queryNode]
                        }, {
                            tag: "list",
                            attrs: {},
                            content: userNodes
                        }]
                    }]
                }),
                    usyncNode = (0, WABinary_1.getBinaryNodeChild)(result, "usync"),
                    listNode = (0, WABinary_1.getBinaryNodeChild)(usyncNode, "list"),
                    users = (0, WABinary_1.getBinaryNodeChildren)(listNode, "user");
                return users;
            },
            getBusinessProfile = async jid => {
                var _a, _b, _c, _d, _e, _f, _g;
                _a = void 0x0;
                _b = void 0x0;
                _c = void 0x0;
                _d = void 0x0;
                _e = void 0x0;
                _f = void 0x0;
                _g = void 0x0;
                const results = await query({
                    tag: "iq",
                    attrs: {
                        to: "s.whatsapp.net",
                        xmlns: "w:biz",
                        type: "get"
                    },
                    content: [{
                        tag: "business_profile",
                        attrs: {
                            v: "244"
                        },
                        content: [{
                            tag: "profile",
                            attrs: {
                                jid: jid
                            }
                        }]
                    }]
                }),
                    profileNode = (0, WABinary_1.getBinaryNodeChild)(results, "business_profile"),
                    profiles = (0, WABinary_1.getBinaryNodeChild)(profileNode, "profile");
                if (profiles) {
                    const address = (0, WABinary_1.getBinaryNodeChild)(profiles, "address"),
                        description = (0, WABinary_1.getBinaryNodeChild)(profiles, "description"),
                        website = (0, WABinary_1.getBinaryNodeChild)(profiles, "website"),
                        email = (0, WABinary_1.getBinaryNodeChild)(profiles, "email"),
                        category = (0, WABinary_1.getBinaryNodeChild)((0, WABinary_1.getBinaryNodeChild)(profiles, "categories"), "category"),
                        businessHours = (0, WABinary_1.getBinaryNodeChild)(profiles, "business_hours"),
                        businessHoursConfig = businessHours ? (0, WABinary_1.getBinaryNodeChildren)(businessHours, "business_hours_config") : undefined,
                        websiteStr = (_a = website === null || website === void 0 ? void 0 : website.content) === null || _a === void 0 ? void 0 : _a.toString();
                    return {
                        wid: (_b = profiles.attrs) === null || _b === void 0 ? void 0 : _b.jid,
                        address: (_c = address === null || address === void 0 ? void 0 : address.content) === null || _c === void 0 ? void 0 : _c.toString(),
                        description: ((_d = description === null || description === void 0 ? void 0 : description.content) === null || _d === void 0 ? void 0 : _d.toString()) || "",
                        website: websiteStr ? [websiteStr] : [],
                        email: (_e = email === null || email === void 0 ? void 0 : email.content) === null || _e === void 0 ? void 0 : _e.toString(),
                        category: (_f = category === null || category === void 0 ? void 0 : category.content) === null || _f === void 0 ? void 0 : _f.toString(),
                        business_hours: {
                            timezone: (_g = businessHours === null || businessHours === void 0 ? void 0 : businessHours.attrs) === null || _g === void 0 ? void 0 : _g.timezone,
                            business_config: businessHoursConfig === null || businessHoursConfig === void 0 ? void 0 : businessHoursConfig.map(({
                                attrs: attrs
                            }) => {
                                return attrs;
                            })
                        }
                    };
                }
            },
            onWhatsApp = async (...jids) => {
                const usyncQuery = new WAUSync_1.USyncQuery().withContactProtocol().withLIDProtocol();
                for (const jid of jids) {
                    const phone = "+" + jid.replace("+", "").split("@")[0].split(":")[0];
                    usyncQuery.withUser(new WAUSync_1.USyncUser().withPhone(phone));
                }
                const results = await sock.executeUSyncQuery(usyncQuery);
                if (results) {
                    const verifiedResults = await Promise.all(results.list.filter(a => {
                        return !!a.contact;
                    }).map(async ({
                        contact: contact,
                        id: id,
                        lid: lid
                    }) => {
                        try {
                            const businessProfile = await getBusinessProfile(id),
                                isBusiness = businessProfile && Object.keys(businessProfile).length > 0;
                            if (isBusiness) {
                                const {
                                    wid: wid,
                                    ...businessInfo
                                } = businessProfile;
                                return {
                                    jid: id,
                                    exists: true,
                                    lid: lid,
                                    status: "business",
                                    businessInfo: businessInfo
                                };
                            } else {
                                return {
                                    jid: id,
                                    exists: true,
                                    lid: lid,
                                    status: "regular"
                                };
                            }
                        } catch (error) {
                            return {
                                jid: id,
                                exists: true,
                                lid: lid,
                                status: error
                            };
                        }
                    }));
                    return verifiedResults;
                }
            },
            onWhatsAppUsername = async (...queries) => {
                const usernameQueries = queries.map(query => {
                    const value = (typeof query === "string" ? query : query?.username || "")
                        .trim()
                        .replace(/^@/, "");
                    if (!value) {
                        throw new boom_1.Boom("Username cannot be empty", { statusCode: 400 });
                    }
                    return {
                        username: value,
                        usernameKey: typeof query === "string" ? undefined : query?.usernameKey,
                        lid: typeof query === "string" ? undefined : query?.lid,
                    };
                });
                if (usernameQueries.length === 0) {
                    return [];
                }
                const usyncQuery = new WAUSync_1.USyncQuery()
                    .withContactProtocol()
                    .withUsernameProtocol();
                for (const { username, usernameKey, lid } of usernameQueries) {
                    const user = new WAUSync_1.USyncUser().withUsername(username);
                    if (usernameKey) user.withUsernameKey(usernameKey);
                    if (lid) user.withLid(lid);
                    usyncQuery.withUser(user);
                }
                const results = await sock.executeUSyncQuery(usyncQuery);
                return (results?.list || []).map((result, index) => ({
                    username: typeof result.username === "string" ? result.username : usernameQueries[index]?.username || "",
                    jid: result.id,
                    exists: result.contact === true,
                }));
            },
            getJidForUsername = async username => {
                const [result] = await onWhatsAppUsername(username);
                return result?.jid || null;
            },
            fetchUsername = async (...jids) => {
                const usyncQuery = new WAUSync_1.USyncQuery().withUsernameProtocol();
                for (const jid of jids) {
                    usyncQuery.withUser(new WAUSync_1.USyncUser().withId(jid));
                }
                if (usyncQuery.users.length === 0) {
                    return [];
                }
                const results = await sock.executeUSyncQuery(usyncQuery);
                return (results?.list || []).map(({ id, username }) => ({
                    jid: id,
                    username: typeof username === "string" ? username : undefined,
                }));
            },
            fetchStatus = async jid => {
                const [result] = await interactiveQuery([{
                    tag: "user",
                    attrs: {
                        jid: jid
                    }
                }], {
                    tag: "status",
                    attrs: {}
                });
                if (result) {
                    const status = (0, WABinary_1.getBinaryNodeChild)(result, "status");
                    return {
                        status: status === null || status === void 0 ? void 0 : status.content.toString(),
                        setAt: new Date(+((status === null || status === void 0 ? void 0 : status.attrs.t) || 0) * 0x3e8)
                    };
                }
            },
            updateProfilePicture = async (jid, content) => {
                let targetJid;
                if (!jid) {
                    throw new boom_1.Boom("Illegal no-jid profile update. Please specify either your ID or the ID of the chat you wish to update");
                }
                if ((0, WABinary_1.jidNormalizedUser)(jid) !== (0, WABinary_1.jidNormalizedUser)(authState.creds.me.id)) {
                    targetJid = (0, WABinary_1.jidNormalizedUser)(jid);
                }
                const {
                    img: img
                } = await (0, Utils_1.generateProfilePicture)(content);
                await query({
                    tag: "iq",
                    attrs: {
                        target: targetJid,
                        to: WABinary_1.S_WHATSAPP_NET,
                        type: "set",
                        xmlns: "w:profile:picture"
                    },
                    content: [{
                        tag: "picture",
                        attrs: {
                            type: "image"
                        },
                        content: img
                    }]
                });
            },
            removeProfilePicture = async jid => {
                let targetJid;
                if (!jid) {
                    throw new boom_1.Boom("Illegal no-jid profile update. Please specify either your ID or the ID of the chat you wish to update");
                }
                if ((0, WABinary_1.jidNormalizedUser)(jid) !== (0, WABinary_1.jidNormalizedUser)(authState.creds.me.id)) {
                    targetJid = (0, WABinary_1.jidNormalizedUser)(jid);
                }
                await query({
                    tag: "iq",
                    attrs: {
                        target: targetJid,
                        to: WABinary_1.S_WHATSAPP_NET,
                        type: "set",
                        xmlns: "w:profile:picture"
                    }
                });
            },
            updateProfileStatus = async status => {
                await query({
                    tag: "iq",
                    attrs: {
                        to: WABinary_1.S_WHATSAPP_NET,
                        type: "set",
                        xmlns: "status"
                    },
                    content: [{
                        tag: "status",
                        attrs: {},
                        content: Buffer.from(status, "utf-8")
                    }]
                });
            },
            updateProfileName = async name => {
                await chatModify({
                    pushNameSetting: name
                }, "");
            },
            fetchBlocklist = async () => {
                const result = await query({
                    tag: "iq",
                    attrs: {
                        xmlns: "blocklist",
                        to: WABinary_1.S_WHATSAPP_NET,
                        type: "get"
                    }
                }),
                    listNode = (0, WABinary_1.getBinaryNodeChild)(result, "list");
                return (0, WABinary_1.getBinaryNodeChildren)(listNode, "item").map(n => {
                    return n.attrs.jid;
                });
            },
            updateBlockStatus = async (jid, action) => {
                await query({
                    tag: "iq",
                    attrs: {
                        xmlns: "blocklist",
                        to: WABinary_1.S_WHATSAPP_NET,
                        type: "set"
                    },
                    content: [{
                        tag: "item",
                        attrs: {
                            action: action,
                            jid: jid
                        }
                    }]
                });
            },
            cleanDirtyBits = async (type, fromTimestamp) => {
                logger.info({
                    fromTimestamp: fromTimestamp
                }, "clean dirty bits " + type);
                await sendNode({
                    tag: "iq",
                    attrs: {
                        to: WABinary_1.S_WHATSAPP_NET,
                        type: "set",
                        xmlns: "urn:xmpp:whatsapp:dirty",
                        id: generateMessageTag()
                    },
                    content: [{
                        tag: "clean",
                        attrs: {
                            type: type,
                            ...(fromTimestamp ? {
                                timestamp: fromTimestamp.toString()
                            } : null)
                        }
                    }]
                });
            },
            newAppStateChunkHandler = isInitialSync => {
                return {
                    onMutation(mutation) {
                        (0, Utils_1.processSyncAction)(mutation, ev, authState.creds.me, isInitialSync ? {
                            accountSettings: authState.creds.accountSettings
                        } : undefined, logger);
                    }
                };
            },
            resyncAppState = ev.createBufferedFunction(async (collections, isInitialSync) => {
                const initialVersionMap = {},
                    globalMutationMap = {};
                await authState.keys.transaction(async () => {
                    var _a;
                    const collectionsToHandle = new Set(collections),
                        attemptsMap = {};
                    while (collectionsToHandle.size) {
                        const states = {},
                            nodes = [];
                        for (const name of collectionsToHandle) {
                            const result = await authState.keys.get("app-state-sync-version", [name]);
                            let state = result[name];
                            if (state) {
                                if (typeof initialVersionMap[name] === "undefined") {
                                    initialVersionMap[name] = state.version;
                                }
                            } else {
                                state = (0, Utils_1.newLTHashState)();
                            }
                            states[name] = state;
                            logger.info("resyncing " + name + " from v" + state.version);
                            nodes.push({
                                tag: "collection",
                                attrs: {
                                    name: name,
                                    version: state.version.toString(),
                                    return_snapshot: (!state.version).toString()
                                }
                            });
                        }
                        const result = await query({
                            tag: "iq",
                            attrs: {
                                to: WABinary_1.S_WHATSAPP_NET,
                                xmlns: "w:sync:app:state",
                                type: "set"
                            },
                            content: [{
                                tag: "sync",
                                attrs: {},
                                content: nodes
                            }]
                        }),
                            decoded = await (0, Utils_1.extractSyncdPatches)(result, config === null || config === void 0 ? void 0 : config.options);
                        for (const key in decoded) {
                            const name = key,
                                {
                                    patches: patches,
                                    hasMorePatches: hasMorePatches,
                                    snapshot: snapshot
                                } = decoded[name];
                            try {
                                if (snapshot) {
                                    const {
                                        state: newState,
                                        mutationMap: mutationMap
                                    } = await (0, Utils_1.decodeSyncdSnapshot)(name, snapshot, getAppStateSyncKey, initialVersionMap[name], appStateMacVerification.snapshot);
                                    states[name] = newState;
                                    Object.assign(globalMutationMap, mutationMap);
                                    logger.info("restored state of " + name + " from snapshot to v" + newState.version + " with mutations");
                                    await authState.keys.set({
                                        "app-state-sync-version": {
                                            [name]: newState
                                        }
                                    });
                                }
                                if (patches.length) {
                                    const {
                                        state: newState,
                                        mutationMap: mutationMap
                                    } = await (0, Utils_1.decodePatches)(name, patches, states[name], getAppStateSyncKey, config.options, initialVersionMap[name], logger, appStateMacVerification.patch);
                                    await authState.keys.set({
                                        "app-state-sync-version": {
                                            [name]: newState
                                        }
                                    });
                                    logger.info("synced " + name + " to v" + newState.version);
                                    initialVersionMap[name] = newState.version;
                                    Object.assign(globalMutationMap, mutationMap);
                                }
                                hasMorePatches ? logger.info("" + name + " has more patches...") : collectionsToHandle.delete(name);
                            } catch (error) {
                                const isIrrecoverableError = attemptsMap[name] >= MAX_SYNC_ATTEMPTS || ((_a = error.output) === null || _a === void 0 ? void 0 : _a.statusCode) === 404 || error.name === "TypeError";
                                logger.info({
                                    name: name,
                                    error: error.stack
                                }, "failed to sync state from version" + (isIrrecoverableError ? "" : ", removing and trying from scratch"));
                                await authState.keys.set({
                                    "app-state-sync-version": {
                                        [name]: null
                                    }
                                });
                                attemptsMap[name] = (attemptsMap[name] || 0) + 1;
                                if (isIrrecoverableError) {
                                    collectionsToHandle.delete(name);
                                }
                            }
                        }
                    }
                });
                const {
                    onMutation: onMutation
                } = newAppStateChunkHandler(isInitialSync);
                for (const key in globalMutationMap) onMutation(globalMutationMap[key]);
            }),
            profilePictureUrl = async (jid, type = "preview", timeoutMs) => {
                var _a;
                _a = void 0x0;
                jid = (0, WABinary_1.jidNormalizedUser)(jid);
                const result = await query({
                    tag: "iq",
                    attrs: {
                        target: jid,
                        to: WABinary_1.S_WHATSAPP_NET,
                        type: "get",
                        xmlns: "w:profile:picture"
                    },
                    content: [{
                        tag: "picture",
                        attrs: {
                            type: type,
                            query: "url"
                        }
                    }]
                }, timeoutMs),
                    child = (0, WABinary_1.getBinaryNodeChild)(result, "picture");
                return (_a = child === null || child === void 0 ? void 0 : child.attrs) === null || _a === void 0 ? void 0 : _a.url;
            },
            sendPresenceUpdate = async (type, toJid) => {
                const me = authState.creds.me;
                if (type === "available" || type === "unavailable") {
                    if (!me.name) {
                        logger.warn("no name present, ignoring presence update request...");
                        return;
                    }
                    ev.emit("connection.update", {
                        isOnline: type === "available"
                    });
                    await sendNode({
                        tag: "presence",
                        attrs: {
                            name: me.name,
                            type: type
                        }
                    });
                } else {
                    const {
                        server: server
                    } = (0, WABinary_1.jidDecode)(toJid),
                        isLid = server === "lid";
                    await sendNode({
                        tag: "chatstate",
                        attrs: {
                            from: isLid ? me.lid : me.id,
                            to: toJid
                        },
                        content: [{
                            tag: type === "recording" ? "composing" : type,
                            attrs: type === "recording" ? {
                                media: "audio"
                            } : {}
                        }]
                    });
                }
            },
            presenceSubscribe = (toJid, tcToken) => {
                return sendNode({
                    tag: "presence",
                    attrs: {
                        to: toJid,
                        id: generateMessageTag(),
                        type: "subscribe"
                    },
                    content: tcToken ? [{
                        tag: "tctoken",
                        attrs: {},
                        content: tcToken
                    }] : undefined
                });
            },
            handlePresenceUpdate = ({
                tag: tag,
                attrs: attrs,
                content: content
            }) => {
                var _a;
                _a = void 0x0;
                let presence;
                const jid = attrs.from,
                    participant = attrs.participant || attrs.from;
                if (shouldIgnoreJid(jid) && jid !== "@s.whatsapp.net") {
                    return;
                }
                if (tag === "presence") {
                    presence = {
                        lastKnownPresence: attrs.type === "unavailable" ? "unavailable" : "available",
                        lastSeen: attrs.last && attrs.last !== "deny" ? +attrs.last : undefined
                    };
                } else {
                    if (Array.isArray(content)) {
                        const [firstChild] = content;
                        let type = firstChild.tag;
                        if (type === "paused") {
                            type = "available";
                        }
                        if (((_a = firstChild.attrs) === null || _a === void 0 ? void 0 : _a.media) === "audio") {
                            type = "recording";
                        }
                        presence = {
                            lastKnownPresence: type
                        };
                    } else {
                        logger.error({
                            tag: tag,
                            attrs: attrs,
                            content: content
                        }, "recv invalid presence node");
                    }
                }
                if (presence) {
                    ev.emit("presence.update", {
                        id: jid,
                        presences: {
                            [participant]: presence
                        }
                    });
                }
            },
            appPatch = async patchCreate => {
                const name = patchCreate.type,
                    myAppStateKeyId = authState.creds.myAppStateKeyId;
                if (!myAppStateKeyId) {
                    throw new boom_1.Boom("App state key not present!", {
                        statusCode: 400
                    });
                }
                let initial, encodeResult;
                await processingMutex.mutex(async () => {
                    await authState.keys.transaction(async () => {
                        logger.debug({
                            patch: patchCreate
                        }, "applying app patch");
                        await resyncAppState([name], false);
                        const {
                            [name]: currentSyncVersion
                        } = await authState.keys.get("app-state-sync-version", [name]);
                        initial = currentSyncVersion || (0, Utils_1.newLTHashState)();
                        encodeResult = await (0, Utils_1.encodeSyncdPatch)(patchCreate, myAppStateKeyId, initial, getAppStateSyncKey);
                        const {
                            patch: patch,
                            state: state
                        } = encodeResult,
                            node = {
                                tag: "iq",
                                attrs: {
                                    to: WABinary_1.S_WHATSAPP_NET,
                                    type: "set",
                                    xmlns: "w:sync:app:state"
                                },
                                content: [{
                                    tag: "sync",
                                    attrs: {},
                                    content: [{
                                        tag: "collection",
                                        attrs: {
                                            name: name,
                                            version: (state.version - 1).toString(),
                                            return_snapshot: "false"
                                        },
                                        content: [{
                                            tag: "patch",
                                            attrs: {},
                                            content: WAProto_1.proto.SyncdPatch.encode(patch).finish()
                                        }]
                                    }]
                                }]
                            };
                        await query(node);
                        await authState.keys.set({
                            "app-state-sync-version": {
                                [name]: state
                            }
                        });
                    });
                });
                if (config.emitOwnEvents) {
                    const {
                        onMutation: onMutation
                    } = newAppStateChunkHandler(false),
                        {
                            mutationMap: mutationMap
                        } = await (0, Utils_1.decodePatches)(name, [{
                            ...encodeResult.patch,
                            version: {
                                version: encodeResult.state.version
                            }
                        }], initial, getAppStateSyncKey, config.options, undefined, logger);
                    for (const key in mutationMap) onMutation(mutationMap[key]);
                }
            },
            fetchProps = async () => {
                var _a, _b;
                _a = void 0x0;
                _b = void 0x0;
                const resultNode = await query({
                    tag: "iq",
                    attrs: {
                        to: WABinary_1.S_WHATSAPP_NET,
                        xmlns: "w",
                        type: "get"
                    },
                    content: [{
                        tag: "props",
                        attrs: {
                            protocol: "2",
                            hash: ((_a = authState === null || authState === void 0 ? void 0 : authState.creds) === null || _a === void 0 ? void 0 : _a.lastPropHash) || ""
                        }
                    }]
                }),
                    propsNode = (0, WABinary_1.getBinaryNodeChild)(resultNode, "props");
                let props = {};
                if (propsNode) {
                    authState.creds.lastPropHash = (_b = propsNode === null || propsNode === void 0 ? void 0 : propsNode.attrs) === null || _b === void 0 ? void 0 : _b.hash;
                    ev.emit("creds.update", authState.creds);
                    props = (0, WABinary_1.reduceBinaryNodeToDictionary)(propsNode, "prop");
                }
                logger.debug("fetched props");
                return props;
            },
            chatModify = (mod, jid) => {
                const patch = (0, Utils_1.chatModificationToAppPatch)(mod, jid);
                return appPatch(patch);
            },
            star = (jid, messages, star) => {
                return chatModify({
                    star: {
                        messages: messages,
                        star: star
                    }
                }, jid);
            },
            addChatLabel = (jid, labelId) => {
                return chatModify({
                    addChatLabel: {
                        labelId: labelId
                    }
                }, jid);
            },
            removeChatLabel = (jid, labelId) => {
                return chatModify({
                    removeChatLabel: {
                        labelId: labelId
                    }
                }, jid);
            },
            addMessageLabel = (jid, messageId, labelId) => {
                return chatModify({
                    addMessageLabel: {
                        messageId: messageId,
                        labelId: labelId
                    }
                }, jid);
            },
            removeMessageLabel = (jid, messageId, labelId) => {
                return chatModify({
                    removeMessageLabel: {
                        messageId: messageId,
                        labelId: labelId
                    }
                }, jid);
            },
            executeInitQueries = async () => {
                await Promise.all([fetchProps(), fetchBlocklist(), fetchPrivacySettings()]);
            },
            upsertMessage = ev.createBufferedFunction(async (msg, type) => {
                var _a, _b, _c;
                _a = void 0x0;
                _b = void 0x0;
                _c = void 0x0;
                ev.emit("messages.upsert", {
                    messages: [msg],
                    type: type
                });
                if (!!msg.pushName) {
                    let jid = msg.key.fromMe ? authState.creds.me.id : msg.key.participant || msg.key.remoteJid;
                    jid = (0, WABinary_1.jidNormalizedUser)(jid);
                    if (!msg.key.fromMe) {
                        ev.emit("contacts.update", [{
                            id: jid,
                            notify: msg.pushName,
                            verifiedName: msg.verifiedBizName
                        }]);
                    }
                    if (msg.key.fromMe && msg.pushName && ((_a = authState.creds.me) === null || _a === void 0 ? void 0 : _a.name) !== msg.pushName) {
                        ev.emit("creds.update", {
                            me: {
                                ...authState.creds.me,
                                name: msg.pushName
                            }
                        });
                    }
                }
                const historyMsg = (0, Utils_1.getHistoryMsg)(msg.message),
                    shouldProcessHistoryMsg = historyMsg ? shouldSyncHistoryMessage(historyMsg) && Defaults_1.PROCESSABLE_HISTORY_TYPES.includes(historyMsg.syncType) : false;
                if (historyMsg && !authState.creds.myAppStateKeyId) {
                    logger.warn("skipping app state sync, as myAppStateKeyId is not set");
                    pendingAppStateSync = true;
                }
                await Promise.all([(async () => {
                    if (historyMsg && authState.creds.myAppStateKeyId) {
                        pendingAppStateSync = false;
                        await doAppStateSync();
                    }
                })(), (0, process_message_1.default)(msg, {
                    shouldProcessHistoryMsg: shouldProcessHistoryMsg,
                    ev: ev,
                    creds: authState.creds,
                    keyStore: authState.keys,
                    logger: logger,
                    options: config.options,
                    getMessage: config.getMessage
                })]);
                if (((_c = (_b = msg.message) === null || _b === void 0 ? void 0 : _b.protocolMessage) === null || _c === void 0 ? void 0 : _c.appStateSyncKeyShare) && pendingAppStateSync) {
                    await doAppStateSync();
                    pendingAppStateSync = false;
                }
                async function doAppStateSync() {
                    if (!authState.creds.accountSyncCounter) {
                        logger.info("doing initial app state sync");
                        await resyncAppState(Types_1.ALL_WA_PATCH_NAMES, true);
                        const accountSyncCounter = (authState.creds.accountSyncCounter || 0) + 1;
                        ev.emit("creds.update", {
                            accountSyncCounter: accountSyncCounter
                        });
                        if (needToFlushWithAppStateSync) {
                            logger.debug("flushing with app state sync");
                            ev.flush();
                        }
                    }
                }
            });
        ws.on("CB:presence", handlePresenceUpdate);
        ws.on("CB:chatstate", handlePresenceUpdate);
        ws.on("CB:ib,,dirty", async node => {
            const {
                attrs: attrs
            } = (0, WABinary_1.getBinaryNodeChild)(node, "dirty"),
                type = attrs.type;
            switch (type) {
                case "account_sync":
                    if (attrs.timestamp) {
                        let {
                            lastAccountSyncTimestamp: lastAccountSyncTimestamp
                        } = authState.creds;
                        if (lastAccountSyncTimestamp) {
                            await cleanDirtyBits("account_sync", lastAccountSyncTimestamp);
                        }
                        lastAccountSyncTimestamp = +attrs.timestamp;
                        ev.emit("creds.update", {
                            lastAccountSyncTimestamp: lastAccountSyncTimestamp
                        });
                    }
                    break;
                case "groups":
                    break;
                default:
                    logger.info({
                        node: node
                    }, "received unknown sync");
                    break;
            }
        });
        ev.on("connection.update", ({
            connection: connection,
            receivedPendingNotifications: receivedPendingNotifications
        }) => {
            var _a;
            if (connection === "open") {
                if (fireInitQueries) {
                    executeInitQueries().catch(error => {
                        return onUnexpectedError(error, "init queries");
                    });
                }
                sendPresenceUpdate(markOnlineOnConnect ? "available" : "unavailable").catch(error => {
                    return onUnexpectedError(error, "presence update requests");
                });
            }
            if (receivedPendingNotifications) {
                if (!((_a = authState.creds) === null || _a === void 0 ? void 0 : _a.myAppStateKeyId) && !config.mobile) {
                    ev.buffer();
                    needToFlushWithAppStateSync = true;
                }
            }
        });
        return {
            ...sock,
            processingMutex: processingMutex,
            fetchPrivacySettings: fetchPrivacySettings,
            upsertMessage: upsertMessage,
            appPatch: appPatch,
            sendPresenceUpdate: sendPresenceUpdate,
            presenceSubscribe: presenceSubscribe,
            profilePictureUrl: profilePictureUrl,
            onWhatsApp: onWhatsApp,
            onWhatsAppUsername: onWhatsAppUsername,
            getJidForUsername: getJidForUsername,
            fetchUsername: fetchUsername,
            fetchBlocklist: fetchBlocklist,
            fetchStatus: fetchStatus,
            updateProfilePicture: updateProfilePicture,
            removeProfilePicture: removeProfilePicture,
            updateProfileStatus: updateProfileStatus,
            updateProfileName: updateProfileName,
            updateBlockStatus: updateBlockStatus,
            updateLastSeenPrivacy: updateLastSeenPrivacy,
            updateOnlinePrivacy: updateOnlinePrivacy,
            updateProfilePicturePrivacy: updateProfilePicturePrivacy,
            updateStatusPrivacy: updateStatusPrivacy,
            updateReadReceiptsPrivacy: updateReadReceiptsPrivacy,
            updateGroupsAddPrivacy: updateGroupsAddPrivacy,
            updateDefaultDisappearingMode: updateDefaultDisappearingMode,
            getBusinessProfile: getBusinessProfile,
            resyncAppState: resyncAppState,
            chatModify: chatModify,
            cleanDirtyBits: cleanDirtyBits,
            addChatLabel: addChatLabel,
            removeChatLabel: removeChatLabel,
            addMessageLabel: addMessageLabel,
            xeonBanChecker: xeonBanChecker,
            removeMessageLabel: removeMessageLabel,
            star: star
        };
    };
exports.makeChatsSocket = makeChatsSocket;

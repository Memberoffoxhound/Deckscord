/**
 * Injected into Vesktop's Discord renderer via CDP.
 * Uses Vencord's webpack helpers (Vesktop always ships Vencord).
 * Every public method returns JSON-safe plain objects.
 */
(function () {
  function err(e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }

  function W() {
    var v = window.Vencord;
    if (!v || !v.Webpack) throw new Error("Vencord is not ready yet");
    return v.Webpack;
  }

  function common(name) {
    try {
      var c = W().Common;
      if (c && c[name]) return c[name];
    } catch (e) {}
    return null;
  }

  function byProps() {
    var wp = W();
    var props = Array.prototype.slice.call(arguments);
    try {
      if (typeof wp.findByProps === "function") return wp.findByProps.apply(wp, props);
    } catch (e) {}
    return null;
  }

  function store(name) {
    var s = common(name);
    if (s) return s;
    var wp = W();
    try {
      if (typeof wp.findStore === "function") {
        s = wp.findStore(name);
        if (s) return s;
      }
    } catch (e) {}
    return null;
  }

  function findFn() {
    var names = Array.prototype.slice.call(arguments);
    for (var i = 0; i < names.length; i++) {
      var n = names[i];
      var m = byProps(n);
      if (m && typeof m[n] === "function") return m[n].bind(m);
    }
    var combos = [
      names,
      names.concat(["selectChannel"]),
      names.concat(["toggleSelfDeaf"]),
      names.concat(["setOutputDevice"]),
    ];
    for (var c = 0; c < combos.length; c++) {
      try {
        var mod = byProps.apply(null, combos[c]);
        if (!mod) continue;
        for (var j = 0; j < names.length; j++) {
          if (typeof mod[names[j]] === "function") return mod[names[j]].bind(mod);
        }
      } catch (e2) {}
    }
    return null;
  }

  function absUrl(u) {
    if (!u) return null;
    u = String(u);
    if (u.indexOf("https://") === 0 || u.indexOf("http://") === 0) return u;
    if (u.indexOf("//") === 0) return "https:" + u;
    if (u.indexOf("/assets/") === 0 || u.charAt(0) === "/") return null;
    return u;
  }

  function iconFromGuild(g, size) {
    size = size || 64;
    if (!g) return null;
    if (g.icon) {
      var ext = String(g.icon).indexOf("a_") === 0 ? "gif" : "webp";
      return "https://cdn.discordapp.com/icons/" + g.id + "/" + g.icon + "." + ext + "?size=" + size;
    }
    try {
      if (typeof g.getIconURL === "function") return absUrl(g.getIconURL(size, true));
    } catch (e) {}
    return null;
  }

  function avatarFromUser(u, size) {
    size = size || 64;
    if (!u) return null;
    if (u.avatar) {
      var ext = String(u.avatar).indexOf("a_") === 0 ? "gif" : "webp";
      return "https://cdn.discordapp.com/avatars/" + u.id + "/" + u.avatar + "." + ext + "?size=" + size;
    }
    try {
      if (typeof u.getAvatarURL === "function") {
        var a = absUrl(u.getAvatarURL(null, size, true));
        if (a && a.indexOf("cdn.discordapp.com") !== -1) return a;
      }
    } catch (e) {}
    var idx = 0;
    try {
      if (typeof BigInt !== "undefined" && u.id) idx = Number(BigInt(u.id) >> 22n) % 6;
      else if (u.discriminator && u.discriminator !== "0") idx = Number(u.discriminator) % 5;
    } catch (e2) {}
    return "https://cdn.discordapp.com/embed/avatars/" + idx + ".png";
  }

  function userLite(u) {
    if (!u) return null;
    return {
      id: String(u.id || ""),
      name: u.globalName || u.displayName || u.username || "Unknown",
      username: u.username || "",
      avatar: avatarFromUser(u, 64),
    };
  }

  function channelLite(c) {
    if (!c) return null;
    var rec = null;
    if (c.rawRecipients && c.rawRecipients[0]) rec = c.rawRecipients[0];
    else if (c.recipients && c.recipients[0] && typeof c.recipients[0] === "object") rec = c.recipients[0];
    var name =
      c.name ||
      (rec && (rec.globalName || rec.username)) ||
      "channel";
    var icon = null;
    if (c.icon && c.id) {
      icon = "https://cdn.discordapp.com/channel-icons/" + c.id + "/" + c.icon + ".webp?size=64";
    } else if (rec) {
      icon = avatarFromUser(rec, 64);
    }
    return {
      id: String(c.id),
      name: name,
      type: c.type,
      guild_id: c.guild_id || c.guildId || null,
      icon: icon,
    };
  }

  function deviceList(map) {
    if (!map) return [];
    var out = [];
    if (Array.isArray(map)) {
      map.forEach(function (d) {
        if (!d) return;
        var id = String(d.id || d.deviceId || "");
        if (!id) return;
        out.push({ id: id, name: d.name || d.label || id });
      });
      return out;
    }
    Object.keys(map).forEach(function (id) {
      var d = map[id] || {};
      out.push({ id: String(d.id || id), name: d.name || d.label || id });
    });
    return out;
  }

  function lookupName(list, id) {
    if (!id) return "";
    var name = "";
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) {
        name = list[i].name;
        break;
      }
    }
    if (!name) name = id === "default" ? "Default" : String(id);
    if (String(name).toLowerCase() === "default") return "Default";
    return name;
  }

  function memberFromState(st, UserStore, meId, uid, MediaEngineStore) {
    var id = String((st && (st.userId || st.user_id)) || uid || "");
    if (!id) return null;
    var u = UserStore && UserStore.getUser && UserStore.getUser(id);
    var volume = 100;
    var localMute = false;
    try {
      if (MediaEngineStore && typeof MediaEngineStore.getLocalVolume === "function") {
        var lv = MediaEngineStore.getLocalVolume(id);
        if (typeof lv === "number" && !isNaN(lv)) volume = lv;
      }
      if (MediaEngineStore && typeof MediaEngineStore.isLocalMute === "function") {
        localMute = !!MediaEngineStore.isLocalMute(id);
      }
    } catch (e) {}
    return {
      id: id,
      name: (u && (u.globalName || u.username)) || id,
      avatar: avatarFromUser(u, 48),
      muted: !!(st && (st.mute || st.selfMute || st.self_mute)),
      deaf: !!(st && (st.deaf || st.selfDeaf || st.self_deaf)),
      self: id === meId,
      volume: volume,
      localMute: localMute,
    };
  }

  function voiceMembersFor(channelId, UserStore, VoiceStateStore, meId, MediaEngineStore) {
    var members = [];
    if (!channelId || !VoiceStateStore) return members;
    var states = {};
    try {
      if (VoiceStateStore.getVoiceStatesForChannel) {
        states = VoiceStateStore.getVoiceStatesForChannel(channelId) || {};
      }
    } catch (e) {}
    if (Array.isArray(states)) {
      states.forEach(function (st) {
        if (st && st.userId) members.push(memberFromState(st, UserStore, meId, st.userId, MediaEngineStore));
      });
      return members.filter(Boolean);
    }
    Object.keys(states).forEach(function (uid) {
      members.push(memberFromState(states[uid] || { userId: uid }, UserStore, meId, uid, MediaEngineStore));
    });
    return members.filter(Boolean);
  }

  function mediaOf(x) {
    if (!x) return null;
    var url = x.proxy_url || x.proxyURL || x.url;
    if (!url) return null;
    return {
      url: String(url),
      name: x.filename || x.name || "",
      type: x.content_type || x.contentType || "",
      width: x.width || 0,
      height: x.height || 0,
    };
  }

  function kindOf(type, name) {
    var t = String(type || "").toLowerCase();
    var n = String(name || "").toLowerCase();
    if (t.indexOf("image/") === 0 || /\.(png|jpe?g|gif|webp|avif|bmp)(\?|$)/.test(n)) return "image";
    if (t.indexOf("video/") === 0 || /\.(mp4|webm|mov|m4v)(\?|$)/.test(n)) return "video";
    if (t.indexOf("audio/") === 0 || /\.(mp3|wav|ogg|m4a|flac)(\?|$)/.test(n)) return "audio";
    return "file";
  }

  window.__deckscord = {
    ping: function () {
      try {
        W();
        return { ok: true, vencord: true };
      } catch (e) {
        return err(e);
      }
    },

    snapshot: function () {
      try {
        var UserStore = store("UserStore") || byProps("getCurrentUser", "getUser");
        var GuildStore = store("GuildStore") || byProps("getGuild", "getGuilds");
        var ChannelStore = store("ChannelStore") || byProps("getChannel", "getDMFromUserId");
        var GuildChannelStore = store("GuildChannelStore") || byProps("getChannels", "getSelectableChannels");
        var SelectedChannelStore = store("SelectedChannelStore") || byProps("getVoiceChannelId", "getChannelId");
        var VoiceStateStore = store("VoiceStateStore") || byProps("getVoiceStateForUser", "getVoiceStatesForChannel");
        var MediaEngineStore = store("MediaEngineStore") || byProps("isSelfMute", "isSelfDeaf");
        var SortedGuildStore = store("SortedGuildStore") || byProps("getFlattenedGuildIds", "getGuildFolders");

        var me = UserStore && UserStore.getCurrentUser && UserStore.getCurrentUser();
        var Auth = common("AuthenticationStore");
        var authed = !!(me && me.id);
        if (!authed && Auth) {
          try {
            if (typeof Auth.isAuthenticated === "function") authed = !!Auth.isAuthenticated();
            else if (Auth.getId && Auth.getId()) authed = true;
          } catch (e2) {}
        }
        if (!me) {
          return { ok: true, ready: false, logged_in: false, booting: true, authenticated: authed };
        }

        var muted = !!(MediaEngineStore && MediaEngineStore.isSelfMute && MediaEngineStore.isSelfMute());
        var deafened = !!(MediaEngineStore && MediaEngineStore.isSelfDeaf && MediaEngineStore.isSelfDeaf());

        var inputs = [];
        var outputs = [];
        var inputId = "";
        var outputId = "";
        var inputVolume = 100;
        var outputVolume = 100;
        try {
          if (MediaEngineStore) {
            if (MediaEngineStore.getInputDevices) inputs = deviceList(MediaEngineStore.getInputDevices());
            if (MediaEngineStore.getOutputDevices) outputs = deviceList(MediaEngineStore.getOutputDevices());
            if (MediaEngineStore.getInputDeviceId) inputId = String(MediaEngineStore.getInputDeviceId() || "");
            if (MediaEngineStore.getOutputDeviceId) outputId = String(MediaEngineStore.getOutputDeviceId() || "");
            if (MediaEngineStore.getInputVolume) inputVolume = Number(MediaEngineStore.getInputVolume()) || 100;
            if (MediaEngineStore.getOutputVolume) outputVolume = Number(MediaEngineStore.getOutputVolume()) || 100;
          }
        } catch (eDev) {}

        var voiceChannelId = SelectedChannelStore && SelectedChannelStore.getVoiceChannelId && SelectedChannelStore.getVoiceChannelId();
        var voice = null;
        if (voiceChannelId && ChannelStore) {
          var vc = ChannelStore.getChannel(voiceChannelId);
          var members = voiceMembersFor(voiceChannelId, UserStore, VoiceStateStore, me.id, MediaEngineStore);
          voice = {
            channelId: String(voiceChannelId),
            name: vc ? vc.name : String(voiceChannelId),
            guildId: vc ? (vc.guild_id || vc.guildId || null) : null,
            members: members,
          };
        }

        var guilds = [];
        var guildMap = (GuildStore && GuildStore.getGuilds && GuildStore.getGuilds()) || {};
        var gids = [];
        try {
          if (SortedGuildStore && SortedGuildStore.getFlattenedGuildIds) {
            gids = SortedGuildStore.getFlattenedGuildIds() || [];
          }
        } catch (eSort) {}
        if (!gids.length) gids = Object.keys(guildMap);
        gids = gids.slice(0, 80);
        gids.forEach(function (gid) {
          var g = guildMap[gid] || (GuildStore.getGuild && GuildStore.getGuild(gid));
          if (!g) return;
          var text = [];
          var voiceChans = [];
          var packed = GuildChannelStore && GuildChannelStore.getChannels && GuildChannelStore.getChannels(gid);
          var list = [];
          if (packed) {
            (packed.SELECTABLE || packed.COUNTABLE || []).forEach(function (x) { list.push(x.channel || x); });
            (packed.VOCAL || []).forEach(function (x) { list.push(x.channel || x); });
          }
          if (!list.length && ChannelStore && ChannelStore.getMutableGuildChannelsForGuild) {
            var raw = ChannelStore.getMutableGuildChannelsForGuild(gid) || {};
            Object.keys(raw).forEach(function (id) { list.push(raw[id]); });
          }
          list.forEach(function (c) {
            if (!c || c.type === 4) return;
            var lite = { id: String(c.id), name: c.name || "channel", type: c.type };
            if (c.type === 2 || c.type === 13) {
              lite.members = voiceMembersFor(c.id, UserStore, VoiceStateStore, me.id, MediaEngineStore);
              voiceChans.push(lite);
            } else if (c.type === 0 || c.type === 5) {
              text.push(lite);
            }
          });
          guilds.push({
            id: String(g.id),
            name: g.name || "Server",
            icon: iconFromGuild(g, 64),
            text: text.slice(0, 40),
            voice: voiceChans.slice(0, 24),
          });
        });

        var dms = [];
        if (ChannelStore && ChannelStore.getSortedPrivateChannels) {
          (ChannelStore.getSortedPrivateChannels() || []).slice(0, 30).forEach(function (c) {
            var lite = channelLite(c);
            if (lite) dms.push(lite);
          });
        } else if (ChannelStore && ChannelStore.getPrivateChannels) {
          var pmap = ChannelStore.getPrivateChannels() || {};
          Object.keys(pmap).slice(0, 30).forEach(function (id) {
            var lite = channelLite(pmap[id]);
            if (lite) dms.push(lite);
          });
        }

        var textId = SelectedChannelStore && SelectedChannelStore.getChannelId && SelectedChannelStore.getChannelId();

        return {
          ok: true,
          ready: true,
          logged_in: true,
          user: userLite(me),
          muted: muted,
          deafened: deafened,
          voice: voice,
          text_channel_id: textId || null,
          guilds: guilds,
          dms: dms,
          devices: {
            input: inputs,
            output: outputs,
            inputId: inputId,
            outputId: outputId,
            inputName: lookupName(inputs, inputId) || "Input",
            outputName: lookupName(outputs, outputId) || "Output",
            inputVolume: inputVolume,
            outputVolume: outputVolume,
          },
        };
      } catch (e) {
        return err(e);
      }
    },

    joinVoice: function (channelId) {
      try {
        var id = String(channelId);
        var fn =
          findFn("selectVoiceChannel") ||
          (common("ChannelActionCreators") && common("ChannelActionCreators").selectVoiceChannel);
        if (!fn) throw new Error("selectVoiceChannel not found");
        fn(id);
        return { ok: true, channel_id: id };
      } catch (e) {
        return err(e);
      }
    },

    leaveVoice: function () {
      try {
        var fn =
          findFn("selectVoiceChannel") ||
          (common("ChannelActionCreators") && common("ChannelActionCreators").selectVoiceChannel);
        if (!fn) throw new Error("selectVoiceChannel not found");
        fn(null);
        return { ok: true };
      } catch (e) {
        return err(e);
      }
    },

    toggleMute: function () {
      try {
        var fn = findFn("toggleSelfMute");
        if (!fn) throw new Error("toggleSelfMute not found");
        fn();
        var MediaEngineStore = store("MediaEngineStore") || byProps("isSelfMute", "isSelfDeaf");
        return { ok: true, muted: !!(MediaEngineStore && MediaEngineStore.isSelfMute && MediaEngineStore.isSelfMute()) };
      } catch (e) {
        return err(e);
      }
    },

    toggleDeafen: function () {
      try {
        var fn = findFn("toggleSelfDeaf");
        if (!fn) throw new Error("toggleSelfDeaf not found");
        fn();
        var MediaEngineStore = store("MediaEngineStore") || byProps("isSelfMute", "isSelfDeaf");
        return { ok: true, deafened: !!(MediaEngineStore && MediaEngineStore.isSelfDeaf && MediaEngineStore.isSelfDeaf()) };
      } catch (e) {
        return err(e);
      }
    },

    setInputDevice: function (deviceId) {
      try {
        var fn = findFn("setInputDevice");
        if (!fn) throw new Error("setInputDevice not found");
        fn(String(deviceId));
        return { ok: true, id: String(deviceId) };
      } catch (e) {
        return err(e);
      }
    },

    setOutputDevice: function (deviceId) {
      try {
        var fn = findFn("setOutputDevice");
        if (!fn) throw new Error("setOutputDevice not found");
        fn(String(deviceId));
        return { ok: true, id: String(deviceId) };
      } catch (e) {
        return err(e);
      }
    },

    selectText: function (channelId) {
      try {
        var id = String(channelId);
        var select = findFn("selectChannel");
        if (select) select(id);
        var jump = findFn("transitionToChannel");
        if (jump) jump(id);
        else {
          var router = byProps("transitionTo", "transitionToGuild");
          if (router && router.transitionTo) {
            try { router.transitionTo("/channels/@me/" + id); } catch (e2) {}
          }
        }
        return { ok: true, channel_id: id };
      } catch (e) {
        return err(e);
      }
    },

    getMessages: function (channelId, limit) {
      try {
        limit = limit || 40;
        var id = String(channelId);
        var MessageStore = store("MessageStore") || byProps("getMessages", "getMessage");
        if (!MessageStore) throw new Error("MessageStore not found");

        function read() {
          var bag = MessageStore.getMessages(id);
          var arr = [];
          if (bag) {
            if (typeof bag.toArray === "function") arr = bag.toArray();
            else if (bag._array) arr = bag._array;
            else if (Array.isArray(bag)) arr = bag;
          }
          return arr || [];
        }

        var arr = read();
        var fetchP = null;
        if (!arr.length) {
          var fetcher = byProps("fetchMessages") || common("MessageActionCreators") || common("MessageActions");
          if (fetcher && fetcher.fetchMessages) {
            try {
              fetchP = fetcher.fetchMessages({ channelId: id, limit: limit });
            } catch (e2) {
              try { fetchP = fetcher.fetchMessages(id); } catch (e3) {}
            }
          }
        }

        function pack(list) {
          return (list || []).slice(-limit).map(function (m) {
            var author = m.author || {};
            var attachments = (m.attachments || []).slice(0, 8).map(function (a) {
              var med = mediaOf(a);
              if (!med) return null;
              med.kind = kindOf(med.type, med.name);
              return med;
            }).filter(Boolean);
            var embeds = (m.embeds || []).slice(0, 4).map(function (em) {
              var image = mediaOf(em.image) || mediaOf(em.thumbnail);
              var video = mediaOf(em.video);
              return {
                type: em.type || "",
                title: em.title || "",
                description: em.description || "",
                url: em.url || "",
                image: image,
                video: video,
              };
            });
            var stickers = (m.stickerItems || m.stickers || []).slice(0, 4).map(function (s) {
              var sid = s.id;
              var fmt = s.format_type || s.formatType;
              var url = s.url || null;
              if (!url && sid && fmt !== 3 && fmt !== "LOTTIE") {
                url = "https://cdn.discordapp.com/stickers/" + sid + ".png";
              }
              return { id: String(sid || ""), name: s.name || "sticker", url: url };
            });
            return {
              id: String(m.id || ""),
              content: m.content || "",
              author: author.globalName || author.username || "Unknown",
              author_id: String(author.id || ""),
              avatar: avatarFromUser(author, 48),
              ts: m.timestamp ? String(m.timestamp) : "",
              attachments: attachments,
              embeds: embeds,
              stickers: stickers,
            };
          });
        }

        if (fetchP && typeof fetchP.then === "function") {
          return fetchP
            .then(function () { return { ok: true, messages: pack(read()) }; })
            .catch(function () { return { ok: true, messages: pack(read()) }; });
        }
        return { ok: true, messages: pack(arr) };
      } catch (e) {
        return err(e);
      }
    },

    setUserVolume: function (userId, volume) {
      try {
        var fn = findFn("setLocalVolume");
        if (!fn) throw new Error("setLocalVolume not found");
        var n = Number(volume);
        if (isNaN(n)) n = 100;
        if (n < 0) n = 0;
        if (n > 200) n = 200;
        fn(String(userId), n);
        return { ok: true, user_id: String(userId), volume: n };
      } catch (e) {
        return err(e);
      }
    },

    toggleUserMute: function (userId) {
      try {
        var fn = findFn("toggleLocalMute");
        if (!fn) throw new Error("toggleLocalMute not found");
        fn(String(userId));
        var MediaEngineStore = store("MediaEngineStore") || byProps("isLocalMute", "getLocalVolume");
        return {
          ok: true,
          user_id: String(userId),
          localMute: !!(MediaEngineStore && MediaEngineStore.isLocalMute && MediaEngineStore.isLocalMute(String(userId))),
        };
      } catch (e) {
        return err(e);
      }
    },

    setServerMute: function (guildId, userId, mute) {
      try {
        var fn = findFn("setServerMute");
        if (!fn) throw new Error("setServerMute not found");
        fn(String(guildId), String(userId), !!mute);
        return { ok: true, user_id: String(userId), mute: !!mute };
      } catch (e) {
        return err(e);
      }
    },

    setServerDeaf: function (guildId, userId, deaf) {
      try {
        var fn = findFn("setServerDeaf");
        if (!fn) throw new Error("setServerDeaf not found");
        fn(String(guildId), String(userId), !!deaf);
        return { ok: true, user_id: String(userId), deaf: !!deaf };
      } catch (e) {
        return err(e);
      }
    },

    setInputVolume: function (volume) {
      try {
        var fn = findFn("setInputVolume");
        if (!fn) throw new Error("setInputVolume not found");
        var n = Number(volume);
        if (isNaN(n)) n = 100;
        if (n < 0) n = 0;
        if (n > 200) n = 200;
        fn(n);
        return { ok: true, volume: n };
      } catch (e) {
        return err(e);
      }
    },

    setOutputVolume: function (volume) {
      try {
        var fn = findFn("setOutputVolume");
        if (!fn) throw new Error("setOutputVolume not found");
        var n = Number(volume);
        if (isNaN(n)) n = 100;
        if (n < 0) n = 0;
        if (n > 200) n = 200;
        fn(n);
        return { ok: true, volume: n };
      } catch (e) {
        return err(e);
      }
    },

    sendMessage: function (channelId, content) {
      try {
        content = String(content || "").trim();
        if (!content) return { ok: false, error: "empty" };
        var actions = common("MessageActions") || byProps("sendMessage", "editMessage") || byProps("sendMessage");
        if (!actions || !actions.sendMessage) throw new Error("sendMessage not found");
        var payload = {
          content: content,
          tts: false,
          invalidEmojis: [],
          validNonShortcutEmojis: [],
        };
        var r;
        try {
          r = actions.sendMessage(String(channelId), payload);
        } catch (e2) {
          r = actions.sendMessage(String(channelId), { content: content });
        }
        if (r && typeof r.then === "function") {
          return r.then(function () { return { ok: true }; }).catch(function (e) { return err(e); });
        }
        return { ok: true };
      } catch (e) {
        return err(e);
      }
    },
  };

  return { ok: true, injected: true };
})();

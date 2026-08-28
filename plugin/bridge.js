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

  function userLite(u) {
    if (!u) return null;
    return {
      id: String(u.id || ""),
      name: u.globalName || u.displayName || u.username || "Unknown",
      username: u.username || "",
    };
  }

  function channelLite(c) {
    if (!c) return null;
    return {
      id: String(c.id),
      name: c.name || c.rawRecipients && c.rawRecipients[0] && (c.rawRecipients[0].globalName || c.rawRecipients[0].username) || "channel",
      type: c.type,
      guild_id: c.guild_id || c.guildId || null,
    };
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

        var voiceChannelId = SelectedChannelStore && SelectedChannelStore.getVoiceChannelId && SelectedChannelStore.getVoiceChannelId();
        var voice = null;
        if (voiceChannelId && ChannelStore) {
          var vc = ChannelStore.getChannel(voiceChannelId);
          var members = [];
          if (vc && VoiceStateStore && VoiceStateStore.getVoiceStatesForChannel) {
            var states = VoiceStateStore.getVoiceStatesForChannel(voiceChannelId) || {};
            Object.keys(states).forEach(function (uid) {
              var st = states[uid] || {};
              var u = UserStore.getUser(uid);
              members.push({
                id: uid,
                name: (u && (u.globalName || u.username)) || uid,
                muted: !!(st.mute || st.selfMute),
                deaf: !!(st.deaf || st.selfDeaf),
                self: uid === me.id,
              });
            });
          }
          voice = {
            channelId: voiceChannelId,
            name: vc ? vc.name : voiceChannelId,
            guildId: vc ? (vc.guild_id || vc.guildId || null) : null,
            members: members,
          };
        }

        var guilds = [];
        var guildMap = (GuildStore && GuildStore.getGuilds && GuildStore.getGuilds()) || {};
        var gids = Object.keys(guildMap).slice(0, 40);
        gids.forEach(function (gid) {
          var g = guildMap[gid];
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
            if (c.type === 2 || c.type === 13) voiceChans.push(lite);
            else if (c.type === 0 || c.type === 5) text.push(lite);
          });
          guilds.push({
            id: String(g.id),
            name: g.name || "Server",
            text: text.slice(0, 30),
            voice: voiceChans.slice(0, 20),
          });
        });

        var dms = [];
        if (ChannelStore && ChannelStore.getSortedPrivateChannels) {
          (ChannelStore.getSortedPrivateChannels() || []).slice(0, 25).forEach(function (c) {
            var lite = channelLite(c);
            if (lite) dms.push(lite);
          });
        } else if (ChannelStore && ChannelStore.getPrivateChannels) {
          var pmap = ChannelStore.getPrivateChannels() || {};
          Object.keys(pmap).slice(0, 25).forEach(function (id) {
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
        };
      } catch (e) {
        return err(e);
      }
    },

    joinVoice: function (channelId) {
      try {
        var actions = common("ChannelActionCreators") || byProps("selectVoiceChannel", "selectChannel") || byProps("selectVoiceChannel");
        if (!actions || !actions.selectVoiceChannel) throw new Error("selectVoiceChannel not found");
        actions.selectVoiceChannel(String(channelId));
        return { ok: true, channel_id: String(channelId) };
      } catch (e) {
        return err(e);
      }
    },

    leaveVoice: function () {
      try {
        var actions = common("ChannelActionCreators") || byProps("selectVoiceChannel", "selectChannel") || byProps("selectVoiceChannel");
        if (!actions || !actions.selectVoiceChannel) throw new Error("selectVoiceChannel not found");
        actions.selectVoiceChannel(null);
        return { ok: true };
      } catch (e) {
        return err(e);
      }
    },

    toggleMute: function () {
      try {
        var a = byProps("toggleSelfMute") || byProps("toggleSelfMute", "toggleSelfDeaf");
        if (!a || !a.toggleSelfMute) throw new Error("toggleSelfMute not found");
        a.toggleSelfMute();
        var MediaEngineStore = store("MediaEngineStore") || byProps("isSelfMute", "isSelfDeaf");
        return { ok: true, muted: !!(MediaEngineStore && MediaEngineStore.isSelfMute && MediaEngineStore.isSelfMute()) };
      } catch (e) {
        return err(e);
      }
    },

    toggleDeafen: function () {
      try {
        var a = byProps("toggleSelfDeaf") || byProps("toggleSelfMute", "toggleSelfDeaf");
        if (!a || !a.toggleSelfDeaf) throw new Error("toggleSelfDeaf not found");
        a.toggleSelfDeaf();
        var MediaEngineStore = store("MediaEngineStore") || byProps("isSelfMute", "isSelfDeaf");
        return { ok: true, deafened: !!(MediaEngineStore && MediaEngineStore.isSelfDeaf && MediaEngineStore.isSelfDeaf()) };
      } catch (e) {
        return err(e);
      }
    },

    selectText: function (channelId) {
      try {
        var actions = byProps("selectVoiceChannel", "selectChannel") || byProps("selectChannel");
        if (actions && actions.selectChannel) actions.selectChannel(String(channelId));
        var router = byProps("transitionTo", "transitionToGuild") || byProps("transitionToChannel");
        if (router && router.transitionToChannel) router.transitionToChannel(String(channelId));
        return { ok: true, channel_id: String(channelId) };
      } catch (e) {
        return err(e);
      }
    },

    getMessages: function (channelId, limit) {
      try {
        limit = limit || 40;
        var MessageStore = store("MessageStore") || byProps("getMessages", "getMessage");
        if (!MessageStore) throw new Error("MessageStore not found");
        var bag = MessageStore.getMessages(String(channelId));
        var arr = [];
        if (bag) {
          if (typeof bag.toArray === "function") arr = bag.toArray();
          else if (bag._array) arr = bag._array;
          else if (Array.isArray(bag)) arr = bag;
        }
        if ((!arr || !arr.length)) {
          var fetcher = byProps("fetchMessages");
          if (fetcher && fetcher.fetchMessages) {
            try { fetcher.fetchMessages({ channelId: String(channelId), limit: limit }); } catch (e2) {}
          }
        }
        var out = (arr || []).slice(-limit).map(function (m) {
          var author = m.author || {};
          return {
            id: String(m.id || ""),
            content: m.content || "",
            author: author.globalName || author.username || "Unknown",
            author_id: String(author.id || ""),
            ts: m.timestamp ? String(m.timestamp) : "",
          };
        });
        return { ok: true, messages: out };
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
        var r = actions.sendMessage(String(channelId), payload);
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

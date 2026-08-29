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

  function findByCode(snippet) {
    var wp = W();
    var m = null;
    try {
      if (typeof wp.findByCode === "function") m = wp.findByCode(snippet);
    } catch (e) {}
    if (typeof m === "function") return m;
    if (m && typeof m === "object") {
      var keys = Object.keys(m);
      for (var i = 0; i < keys.length; i++) {
        if (typeof m[keys[i]] === "function") return m[keys[i]];
      }
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
    if (!id || !/^\d{5,}$/.test(id)) return null;
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
      speaking: isUserSpeaking(id, meId),
    };
  }

  function isUserSpeaking(userId, meId) {
    var id = String(userId || "");
    if (!id) return false;
    try {
      var Sp = store("SpeakingStore") || byProps("isSpeaking", "isCurrentUserSpeaking") || byProps("isSpeaking");
      if (Sp) {
        if (meId && id === String(meId) && typeof Sp.isCurrentUserSpeaking === "function") {
          if (Sp.isCurrentUserSpeaking()) return true;
        }
        if (typeof Sp.isSpeaking === "function" && Sp.isSpeaking(id)) return true;
        if (typeof Sp.getSpeakers === "function") {
          var s = Sp.getSpeakers() || [];
          if (Array.isArray(s)) {
            for (var i = 0; i < s.length; i++) {
              var x = s[i];
              if (x === id || (x && (x.userId === id || x.id === id))) return true;
            }
          } else if (s[id]) return true;
        }
      }
    } catch (e) {}
    try {
      var rtc = store("ChannelRTCStore");
      if (rtc && typeof rtc.getSpeakingParticipants === "function") {
        var bag = rtc.getSpeakingParticipants();
        if (bag) {
          if (Array.isArray(bag)) {
            for (var j = 0; j < bag.length; j++) {
              var p = bag[j];
              if (p === id || (p && (p.userId === id || p.id === id))) return true;
            }
          } else if (bag[id]) return true;
        }
      }
    } catch (e2) {}
    return false;
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

  window.__deckscordAudioFocus = window.__deckscordAudioFocus || { userId: null, saved: {} };

  function eachMediaConnection(fn) {
    var MediaEngineStore = store("MediaEngineStore") || byProps("isSelfMute", "isSelfDeaf");
    var eng = null;
    try {
      eng = MediaEngineStore && MediaEngineStore.getMediaEngine && MediaEngineStore.getMediaEngine();
    } catch (e) {}
    if (!eng) return;
    try {
      if (typeof eng.eachConnection === "function") {
        eng.eachConnection(fn);
        return;
      }
    } catch (e2) {}
    var conns = eng.connections;
    try {
      if (!conns && eng.getConnections) conns = eng.getConnections();
    } catch (e3) {}
    if (!conns) return;
    if (Array.isArray(conns)) conns.forEach(fn);
    else if (conns && typeof conns.forEach === "function") conns.forEach(fn);
    else Object.keys(conns).forEach(function (k) { fn(conns[k], k); });
  }

  function findEngineFn(name) {
    var found = null;
    eachMediaConnection(function (c) {
      if (found || !c) return;
      if (typeof c[name] === "function") found = c[name].bind(c);
    });
    if (found) return found;
    var MediaEngineStore = store("MediaEngineStore") || byProps("isSelfMute", "isSelfDeaf");
    try {
      var eng = MediaEngineStore && MediaEngineStore.getMediaEngine && MediaEngineStore.getMediaEngine();
      if (eng && typeof eng[name] === "function") return eng[name].bind(eng);
    } catch (e) {}
    return findFn(name);
  }

  function setLocalMuteSafe(userId, mute) {
    var id = String(userId);
    var fn = findEngineFn("setLocalMute") || findFn("setLocalMute");
    if (fn) {
      fn(id, !!mute);
      return "setLocalMute";
    }
    var MediaEngineStore = store("MediaEngineStore") || byProps("isLocalMute", "getLocalVolume");
    var now = !!(MediaEngineStore && MediaEngineStore.isLocalMute && MediaEngineStore.isLocalMute(id));
    if (now !== !!mute) {
      var tog = findFn("toggleLocalMute");
      if (tog) tog(id);
      return "toggleLocalMute";
    }
    return "noop";
  }

  function voiceInputForbiddenName(n) {
    n = String(n || "").toLowerCase();
    if (!n || n === "default" || n === "communications") return true;
    return (
      n.indexOf("monitor") !== -1 ||
      n.indexOf("loopback") !== -1 ||
      n.indexOf("stereo mix") !== -1 ||
      n.indexOf("vencord-screen-share") !== -1 ||
      n.indexOf("venmic") !== -1 ||
      n.indexOf("what-u-hear") !== -1 ||
      n.indexOf("screen-share") !== -1 ||
      n.indexOf("screenshare") !== -1 ||
      n.indexOf("screen share") !== -1 ||
      n.indexOf("audio share") !== -1 ||
      n.indexOf("share audio") !== -1 ||
      n.indexOf("desktop audio") !== -1 ||
      n.indexOf("system audio") !== -1 ||
      n.indexOf("entire system") !== -1 ||
      n.indexOf("chromium") !== -1 ||
      n.indexOf("chrome") !== -1
    );
  }

  function isForbiddenVoice(d) {
    return voiceInputForbiddenName((d && (d.name || d.label || d.id)) || "");
  }

  function isRealMic(d) {
    if (!d || isForbiddenVoice(d)) return false;
    var n = String((d.name || d.label || d.id) || "").toLowerCase();
    if (n.indexOf("deckscord") !== -1 && n.indexOf("silent") !== -1) return false;
    return true;
  }

  var GO_LIVE = {
    width: 1280,
    height: 720,
    fps: 30,
    active: false,
    pending: false,
    stopRequested: false,
    gen: 0,
    lastStop: 0,
    gameAudio: [],
    debug: { picker: "idle" },
  };

  function pinScreenshareQuality(res, fps) {
    try {
      var f = document.createElement("iframe");
      document.documentElement.appendChild(f);
      var ls = f.contentWindow.localStorage;
      var st = JSON.parse(ls.getItem("VesktopState") || "{}");
      st.screenshareQuality = {
        resolution: String(res || (st.screenshareQuality && st.screenshareQuality.resolution) || "720"),
        frameRate: String(fps || (st.screenshareQuality && st.screenshareQuality.frameRate) || "30"),
      };
      ls.setItem("VesktopState", JSON.stringify(st));
      f.remove();
      return st.screenshareQuality;
    } catch (ePin) {
      return null;
    }
  }

  function currentStream() {
    try {
      var ASS = store("ApplicationStreamingStore") || byProps("getCurrentUserActiveStream");
      if (ASS && ASS.getCurrentUserActiveStream) return ASS.getCurrentUserActiveStream() || null;
    } catch (e) {}
    try {
      var MES = store("MediaEngineStore") || byProps("getGoLiveSource");
      if (MES && MES.getGoLiveSource && MES.getGoLiveSource()) return { source: "media-engine" };
    } catch (e2) {}
    return null;
  }

  function clickSharePicker() {
    if (currentStream() && !GO_LIVE.pending) return;
    if (!GO_LIVE.active && !GO_LIVE.pending) return;

    function txt(el) {
      try {
        return String(
          (el.getAttribute && el.getAttribute("aria-label")) ||
            el.textContent ||
            el.value ||
            ""
        ).replace(/\s+/g, " ").trim();
      } catch (e) {
        return "";
      }
    }

    var footers = document.querySelectorAll(".vcd-screen-picker-footer, [class*='screen-picker-footer']");
    var footer = null;
    for (var f = 0; f < footers.length; f++) {
      if (!footers[f].dataset.deckscordAuto) {
        footer = footers[f];
        break;
      }
    }
    var root = footer
      ? (footer.closest(".vcd-screen-picker") || footer.closest("[class*='screen-picker']") || footer.parentElement || footer)
      : null;
    if (!root) {
      var roots = document.querySelectorAll(".vcd-screen-picker, [class*='screen-picker']");
      for (var i = 0; i < roots.length; i++) {
        if (!roots[i].dataset.deckscordAuto) {
          root = roots[i];
          break;
        }
      }
    }
    if (!root) {
      if (GO_LIVE.debug.picker === "idle") GO_LIVE.debug = { picker: "waiting" };
      return;
    }
    GO_LIVE.debug = { picker: "found" };

    var buttons = root.querySelectorAll("button");
    var go = null;
    for (var k = 0; k < buttons.length; k++) {
      var t = txt(buttons[k]);
      if (/go live/i.test(t) && !/cancel|stop|back/i.test(t)) {
        go = buttons[k];
        break;
      }
    }
    if (!go) {
      for (var k2 = 0; k2 < buttons.length; k2++) {
        var t2 = txt(buttons[k2]);
        if (/share|live/i.test(t2) && !/cancel|stop|back|audio/i.test(t2)) {
          go = buttons[k2];
          break;
        }
      }
    }

    if (go && go.disabled) {
      var tiles = root.querySelectorAll("img, [role='button'], button, [class*='tile'], [class*='source']");
      for (var n = 0; n < tiles.length; n++) {
        var tile = tiles[n];
        if (tile === go) continue;
        var tt = txt(tile);
        if (/go live|cancel|back|close|audio|settings/i.test(tt)) continue;
        try { tile.click(); } catch (eTile) {}
        GO_LIVE.debug = { picker: "picked-source" };
        return;
      }
      var allBtns = document.querySelectorAll("button, [role='button']");
      for (var n2 = 0; n2 < allBtns.length; n2++) {
        var t3 = txt(allBtns[n2]);
        if (/entire screen|screen 1|display|gamescope|monitor/i.test(t3)) {
          try { allBtns[n2].click(); } catch (e3) {}
          GO_LIVE.debug = { picker: "picked-source" };
          return;
        }
      }
      return;
    }
    if (!go) return;

    try {
      var vm = window.VesktopNative && window.VesktopNative.virtmic;
      if (vm && typeof vm.startSystem === "function" && GO_LIVE.gameAudio && GO_LIVE.gameAudio.length) {
        vm.startSystem(GO_LIVE.gameAudio);
      }
    } catch (eVm) {}

    if (footer) footer.dataset.deckscordAuto = "1";
    root.dataset.deckscordAuto = "1";
    try { go.click(); } catch (eClick) {}
    GO_LIVE.debug = { picker: "clicked" };
  }

  if (!window.__deckscordPickerWatch) {
    pinScreenshareQuality();
    window.__deckscordPickerWatch = setInterval(function () {
      try { clickSharePicker(); } catch (eW) {}
    }, 400);
  }

  function kindOf(type, name) {
    var t = String(type || "").toLowerCase();
    var n = String(name || "").toLowerCase();
    if (t.indexOf("image/") === 0 || /\.(png|jpe?g|gif|webp|avif|bmp)(\?|$)/.test(n)) return "image";
    if (t.indexOf("video/") === 0 || /\.(mp4|webm|mov|m4v)(\?|$)/.test(n)) return "video";
    if (t.indexOf("audio/") === 0 || /\.(mp3|wav|ogg|m4a|flac)(\?|$)/.test(n)) return "audio";
    return "file";
  }

  function messageTime(m) {
    var t = m && (m.timestamp || m.timeStamp || m.editedTimestamp);
    if (t && typeof t === "object") {
      try {
        if (typeof t.toISOString === "function") t = t.toISOString();
        else if (typeof t.format === "function") t = t.format();
        else if (typeof t.valueOf === "function" && !isNaN(Number(t.valueOf()))) t = new Date(Number(t.valueOf())).toISOString();
        else t = String(t);
      } catch (eT) {
        t = String(t);
      }
    }
    t = t ? String(t) : "";
    if ((!t || t === "[object Object]") && m && m.id) {
      try {
        var snow = BigInt(String(m.id));
        var ms = Number((snow >> 22n) + 1420070400000n);
        t = new Date(ms).toISOString();
      } catch (eS) {
        t = "";
      }
    }
    return t;
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
          var af = window.__deckscordAudioFocus || { userId: null, saved: {} };
          if (af.userId && String(voiceChannelId) !== String(window.__deckscordLastVoice || voiceChannelId)) {
            try { window.__deckscord && window.__deckscord.clearAudioFocus && window.__deckscord.clearAudioFocus(); } catch (eClr) {}
            af = window.__deckscordAudioFocus || { userId: null, saved: {} };
          }
          window.__deckscordLastVoice = String(voiceChannelId);
          voice = {
            channelId: String(voiceChannelId),
            name: vc ? vc.name : String(voiceChannelId),
            guildId: vc ? (vc.guild_id || vc.guildId || null) : null,
            members: members,
            focusedUserId: (af && af.userId) || null,
            streaming: !!(currentStream() || GO_LIVE.active),
          };
        } else {
          window.__deckscordLastVoice = null;
          try {
            if (window.__deckscordAudioFocus && window.__deckscordAudioFocus.userId && window.__deckscord && window.__deckscord.clearAudioFocus) {
              window.__deckscord.clearAudioFocus();
            }
          } catch (eGone) {}
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
          streaming: !!(currentStream() || GO_LIVE.active),
          golive: {
            active: !!(currentStream() || GO_LIVE.active),
            pending: !!GO_LIVE.pending,
            width: GO_LIVE.width,
            height: GO_LIVE.height,
            fps: GO_LIVE.fps,
          },
        };
      } catch (e) {
        return err(e);
      }
    },

    speakingNow: function () {
      try {
        var UserStore = store("UserStore") || byProps("getCurrentUser", "getUser");
        var me = UserStore && UserStore.getCurrentUser && UserStore.getCurrentUser();
        var meId = me && String(me.id);
        var ids = [];
        var Sp = store("SpeakingStore") || byProps("isSpeaking", "isCurrentUserSpeaking") || byProps("isSpeaking");
        if (Sp && typeof Sp.getSpeakers === "function") {
          var s = Sp.getSpeakers() || [];
          if (Array.isArray(s)) {
            s.forEach(function (x) {
              var id = typeof x === "string" ? x : x && (x.userId || x.id);
              if (id) ids.push(String(id));
            });
          } else {
            Object.keys(s).forEach(function (id) { ids.push(String(id)); });
          }
        }
        var voiceInputOk = true;
        try {
          var MES = store("MediaEngineStore") || byProps("getInputDeviceId");
          var inId = MES && MES.getInputDeviceId && MES.getInputDeviceId();
          var inMap = (MES && MES.getInputDevices && MES.getInputDevices()) || {};
          var inDev = Array.isArray(inMap)
            ? inMap.find(function (d) { return String(d && d.id) === String(inId); })
            : inMap[inId];
          if (voiceInputForbiddenName(inId) || isForbiddenVoice(inDev || { id: inId })) voiceInputOk = false;
        } catch (eIn) {}
        var VoiceStateStore = store("VoiceStateStore") || byProps("getVoiceStateForUser", "getVoiceStatesForChannel");
        var SelectedChannelStore0 = store("SelectedChannelStore") || byProps("getVoiceChannelId", "getChannelId");
        var cid0 = SelectedChannelStore0 && SelectedChannelStore0.getVoiceChannelId && SelectedChannelStore0.getVoiceChannelId();
        var members0 = voiceMembersFor(cid0, UserStore, VoiceStateStore, meId, store("MediaEngineStore") || byProps("isSelfMute", "isSelfDeaf"));
        (members0 || []).forEach(function (m) {
          if (m.self && !voiceInputOk) return;
          if (isUserSpeaking(m.id, meId) && ids.indexOf(m.id) === -1) ids.push(m.id);
        });
        if (voiceInputOk && meId && Sp && typeof Sp.isCurrentUserSpeaking === "function" && Sp.isCurrentUserSpeaking()) {
          if (ids.indexOf(meId) === -1) ids.push(meId);
        }
        if (!voiceInputOk && meId) {
          ids = ids.filter(function (id) { return String(id) !== String(meId); });
        }
        var SelectedChannelStore = store("SelectedChannelStore") || byProps("getVoiceChannelId", "getChannelId");
        var voiceChannelId = SelectedChannelStore && SelectedChannelStore.getVoiceChannelId && SelectedChannelStore.getVoiceChannelId();
        var speakers = [];
        ids.forEach(function (id) {
          var u = UserStore && UserStore.getUser && UserStore.getUser(id);
          var av = avatarFromUser(u, 64) || "";
          if (av) av = String(av).replace(".webp", ".png").replace(".gif", ".png");
          speakers.push({
            id: String(id),
            name: (u && (u.globalName || u.username)) || String(id),
            avatar: av,
            self: !!(meId && String(id) === meId),
          });
        });
        return { ok: true, ids: ids, speakers: speakers, inVoice: !!voiceChannelId, channelId: voiceChannelId || null };
      } catch (e) {
        return err(e);
      }
    },

    focusAudio: function (userId) {
      try {
        var UserStore = store("UserStore") || byProps("getCurrentUser", "getUser");
        var VoiceStateStore = store("VoiceStateStore") || byProps("getVoiceStateForUser", "getVoiceStatesForChannel");
        var SelectedChannelStore = store("SelectedChannelStore") || byProps("getVoiceChannelId", "getChannelId");
        var MediaEngineStore = store("MediaEngineStore") || byProps("isLocalMute", "getLocalVolume");
        var me = UserStore && UserStore.getCurrentUser && UserStore.getCurrentUser();
        var meId = me && String(me.id);
        var cid = SelectedChannelStore && SelectedChannelStore.getVoiceChannelId && SelectedChannelStore.getVoiceChannelId();
        var members = voiceMembersFor(cid, UserStore, VoiceStateStore, meId, MediaEngineStore);
        var id = String(userId || "");
        var af = window.__deckscordAudioFocus || { userId: null, saved: {} };
        if (!id || id === String(meId || "")) {
          return window.__deckscord.clearAudioFocus();
        }
        if (af.userId === id) {
          return { ok: true, user_id: id, already: true };
        }
        if (af.userId) window.__deckscord.clearAudioFocus();
        var saved = {};
        members.forEach(function (m) {
          if (m.self) return;
          saved[m.id] = {
            localMute: !!(MediaEngineStore && MediaEngineStore.isLocalMute && MediaEngineStore.isLocalMute(m.id)),
            volume: (MediaEngineStore && MediaEngineStore.getLocalVolume && MediaEngineStore.getLocalVolume(m.id)) || 100,
          };
        });
        window.__deckscordAudioFocus = { userId: id, saved: saved };
        var used = setLocalMuteSafe(id, false);
        var vol = MediaEngineStore && MediaEngineStore.getLocalVolume && MediaEngineStore.getLocalVolume(id);
        if (typeof vol === "number" && vol <= 0) {
          var sv = findFn("setLocalVolume");
          if (sv) sv(id, 100);
        }
        members.forEach(function (m) {
          if (m.self || m.id === id) return;
          setLocalMuteSafe(m.id, true);
        });
        return { ok: true, user_id: id, method: used, focus: window.__deckscordAudioFocus };
      } catch (e) {
        return err(e);
      }
    },

    clearAudioFocus: function () {
      try {
        var af = window.__deckscordAudioFocus || { userId: null, saved: {} };
        var saved = af.saved || {};
        Object.keys(saved).forEach(function (uid) {
          var st = saved[uid] || {};
          setLocalMuteSafe(uid, !!st.localMute);
          if (typeof st.volume === "number") {
            var sv = findFn("setLocalVolume");
            if (sv) sv(uid, st.volume);
          }
        });
        window.__deckscordAudioFocus = { userId: null, saved: {} };
        return { ok: true, cleared: true };
      } catch (e) {
        return err(e);
      }
    },

    restoreAudioFocus: function (blob) {
      try {
        if (blob && typeof blob === "object") window.__deckscordAudioFocus = blob;
        return { ok: true, userId: (window.__deckscordAudioFocus && window.__deckscordAudioFocus.userId) || null };
      } catch (e) {
        return err(e);
      }
    },

    ensureVoiceProcessing: function () {
      try {
        var applied = [];
        function go(name, value) {
          var fn = findFn(name);
          if (!fn) return;
          try {
            fn(value);
            applied.push(name);
          } catch (e) {}
        }
        go("setEchoCancellation", true);
        go("setNoiseSuppression", true);
        go("setNoiseCancellation", true);
        go("setAutomaticGainControl", true);
        go("setLoopback", false);
        go("setBypassSystemInputProcessing", false);
        go("setKrispSuppressionLevel", 100);
        var MediaEngineStore = store("MediaEngineStore") || byProps("isSelfMute", "isSelfDeaf");
        var inputs = [];
        try {
          if (MediaEngineStore && MediaEngineStore.getInputDevices) {
            var map = MediaEngineStore.getInputDevices() || {};
            if (Array.isArray(map)) inputs = map;
            else Object.keys(map).forEach(function (id) { inputs.push(map[id] || { id: id }); });
          }
        } catch (eIn) {}
        var cur = MediaEngineStore && MediaEngineStore.getInputDeviceId && MediaEngineStore.getInputDeviceId();
        var curDev = null;
        for (var i = 0; i < inputs.length; i++) {
          if (String(inputs[i].id) === String(cur)) curDev = inputs[i];
        }
        var needPin = !curDev || isForbiddenVoice(curDev);
        if (needPin) {
          var setIn = findFn("setInputDevice");
          var pick = null;
          for (var j = 0; j < inputs.length; j++) {
            var n = String((inputs[j].name || inputs[j].label || "")).toLowerCase();
            if (isRealMic(inputs[j]) && (n.indexOf("mic") !== -1 || n.indexOf("headset") !== -1)) {
              pick = inputs[j];
              break;
            }
          }
          if (!pick) {
            for (var k = 0; k < inputs.length; k++) {
              if (isRealMic(inputs[k]) && String(inputs[k].id) !== "default") {
                pick = inputs[k];
                break;
              }
            }
          }
          if (!pick) {
            for (var s = 0; s < inputs.length; s++) {
              var sn = String((inputs[s].name || inputs[s].label || "")).toLowerCase();
              if (sn.indexOf("deckscord") !== -1 && sn.indexOf("silent") !== -1) {
                pick = inputs[s];
                break;
              }
            }
          }
          if (setIn && pick) {
            setIn(String(pick.id));
            applied.push("setInputDevice:" + pick.id);
          }
        }
        return { ok: true, applied: applied, inputId: MediaEngineStore && MediaEngineStore.getInputDeviceId && MediaEngineStore.getInputDeviceId() };
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
        try { window.__deckscord.ensureVoiceProcessing(); } catch (eProc) {}
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
        var id = String(deviceId);
        if (voiceInputForbiddenName(id)) {
          return { ok: false, error: "that input is desktop/game capture, not a microphone" };
        }
        var fn = findFn("setInputDevice");
        if (!fn) throw new Error("setInputDevice not found");
        fn(id);
        return { ok: true, id: id };
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
        limit = limit || 50;
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
              ts: messageTime(m),
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

    getDiscordSettings: function () {
      try {
        var MES = store("MediaEngineStore") || byProps("isSelfMute", "isSelfDeaf");
        function g(name) {
          try {
            return MES && typeof MES[name] === "function" ? MES[name]() : null;
          } catch (eG) {
            return null;
          }
        }
        return {
          ok: true,
          muted: !!g("isSelfMute"),
          deafened: !!g("isSelfDeaf"),
          echoCancellation: g("getEchoCancellation"),
          noiseSuppression: g("getNoiseSuppression"),
          noiseCancellation: g("getNoiseCancellation"),
          automaticGainControl: g("getAutomaticGainControl"),
          inputId: g("getInputDeviceId") || "",
          outputId: g("getOutputDeviceId") || "",
          inputVolume: g("getInputVolume"),
          outputVolume: g("getOutputVolume"),
        };
      } catch (e) {
        return err(e);
      }
    },

    setDiscordSetting: function (key, value) {
      try {
        var map = {
          echoCancellation: "setEchoCancellation",
          noiseSuppression: "setNoiseSuppression",
          noiseCancellation: "setNoiseCancellation",
          automaticGainControl: "setAutomaticGainControl",
        };
        var name = map[String(key)];
        if (!name) return { ok: false, error: "unknown setting" };
        var fn = findFn(name);
        if (!fn) return { ok: false, error: name + " not found" };
        fn(!!value);
        return { ok: true, key: String(key), value: !!value };
      } catch (e) {
        return err(e);
      }
    },

    startGoLive: function (opts) {
      opts = opts || {};
      var width = Number(opts.width) || GO_LIVE.width;
      var height = Number(opts.height) || GO_LIVE.height;
      var fps = Number(opts.fps) || GO_LIVE.fps;
      GO_LIVE.width = width;
      GO_LIVE.height = height;
      GO_LIVE.fps = fps;
      GO_LIVE.gameAudio = Array.isArray(opts.gameAudio) ? opts.gameAudio : [];
      pinScreenshareQuality(String(height), String(fps));
      try { window.__deckscord.ensureVoiceProcessing(); } catch (eMic) {}

      var SelectedChannelStore = store("SelectedChannelStore") || byProps("getVoiceChannelId");
      var ChannelStore = store("ChannelStore") || byProps("getChannel");
      var cid = SelectedChannelStore && SelectedChannelStore.getVoiceChannelId && SelectedChannelStore.getVoiceChannelId();
      if (!cid) return Promise.resolve({ ok: false, error: "not in a voice channel" });
      var ch = ChannelStore && ChannelStore.getChannel && ChannelStore.getChannel(cid);
      var guildId = ch ? (ch.guild_id || ch.guildId || null) : null;

      var startFn = findByCode('"STREAM_START",streamType') || findByCode('"STREAM_START"');
      if (!startFn) return Promise.resolve({ ok: false, error: "STREAM_START not found" });

      if (GO_LIVE.pending) return Promise.resolve({ ok: true, pending: true, note: "already starting" });
      if (currentStream()) return Promise.resolve({ ok: true, already: true });

      var MediaEngineStore = store("MediaEngineStore") || byProps("isSelfMute", "isSelfDeaf");
      var eng = MediaEngineStore && MediaEngineStore.getMediaEngine && MediaEngineStore.getMediaEngine();
      GO_LIVE.active = true;
      GO_LIVE.stopRequested = false;
      GO_LIVE.debug = { picker: "starting" };

      function finishStart(srcId) {
        if (GO_LIVE.stopRequested) {
          GO_LIVE.active = false;
          try { eng && eng.desktopInputPool && eng.desktopInputPool.get(srcId) && eng.desktopInputPool.get(srcId).destroy(); } catch (eD) {}
          return { ok: false, error: "cancelled" };
        }
        startFn(guildId, cid, { pid: null, sourceId: srcId, sourceName: null });
        GO_LIVE.active = true;
        return { ok: true, sourceId: srcId, width: width, height: height, fps: fps, streaming: true, picker: GO_LIVE.debug };
      }

      if (!eng || typeof eng.getDesktopSource !== "function") {
        try {
          startFn(guildId, cid, {});
          return Promise.resolve({ ok: true, legacy: true, warning: "no getDesktopSource — viewers may see black" });
        } catch (eLeg) {
          GO_LIVE.active = false;
          return Promise.resolve(err(eLeg));
        }
      }

      GO_LIVE.pending = true;
      var myGen = ++GO_LIVE.gen;

      function waitTeardown() {
        var t0 = Date.now();
        return new Promise(function (resolve) {
          (function tick() {
            var busy = currentStream();
            var since = Date.now() - (GO_LIVE.lastStop || 0);
            if ((!busy && since >= 1200) || GO_LIVE.stopRequested || Date.now() - t0 > 5000) {
              resolve();
              return;
            }
            setTimeout(tick, 200);
          })();
        });
      }

      return waitTeardown().then(function () {
        if (GO_LIVE.stopRequested) {
          GO_LIVE.active = false;
          return { ok: false, error: "cancelled" };
        }
        // Size only. Do NOT pass frameRate: gamescope advertises 0/1 and a
        // 30/1 PipeWire renegotiate has killed the Game Mode capture node.
        var constraints = { width: width, height: height };
        var wantAudio = true;
        var acq = eng.getDesktopSource(constraints, wantAudio);
        var raced = false;
        acq.then(function (id) {
          if (!raced) return;
          try { eng.desktopInputPool && eng.desktopInputPool.get(id) && eng.desktopInputPool.get(id).destroy(); } catch (eLate) {}
        }).catch(function () {});
        var timed = new Promise(function (_, rej) {
          setTimeout(function () { rej(new Error("getDesktopSource timeout (20s)")); }, 20000);
        });
        return Promise.race([acq, timed]).then(function (srcId) {
          raced = true;
          if (myGen !== GO_LIVE.gen) {
            try { eng.desktopInputPool && eng.desktopInputPool.get(srcId) && eng.desktopInputPool.get(srcId).destroy(); } catch (eOld) {}
            return { ok: false, error: "superseded" };
          }
          return finishStart(srcId);
        }, function (e) {
          raced = true;
          throw e;
        });
      }).catch(function (e) {
        if (myGen === GO_LIVE.gen) GO_LIVE.active = false;
        var out = err(e);
        out.picker = GO_LIVE.debug;
        return out;
      }).then(function (r) {
        if (myGen === GO_LIVE.gen) {
          GO_LIVE.pending = false;
          GO_LIVE.stopRequested = false;
        }
        try { window.__deckscord.ensureVoiceProcessing(); } catch (eAfter) {}
        return r;
      });
    },

    stopGoLive: function () {
      try {
        if (GO_LIVE.pending) GO_LIVE.stopRequested = true;
        else GO_LIVE.active = false;
        GO_LIVE.lastStop = Date.now();
        var s = currentStream();
        var stopFn = findByCode('"STREAM_STOP"');
        if (s && stopFn) {
          var ownerId = s.ownerId || s.owner_id;
          var channelId = s.channelId || s.channel_id;
          var gid = s.guildId || s.guild_id;
          var key = gid
            ? "guild:" + gid + ":" + channelId + ":" + ownerId
            : "call:" + channelId + ":" + ownerId;
          try { stopFn(key); } catch (eKey) {
            try { stopFn(s); } catch (e2) {}
          }
        }
        GO_LIVE.gameAudio = [];
        try { window.__deckscord.ensureVoiceProcessing(); } catch (eMic) {}
        return { ok: true, streaming: false };
      } catch (e) {
        return err(e);
      }
    },

    setScreenshareQuality: function (res, fps) {
      try {
        var q = pinScreenshareQuality(res, fps);
        return { ok: true, screenshareQuality: q };
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

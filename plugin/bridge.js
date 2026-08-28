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
      selfVideo: !!(st && (st.selfVideo || st.self_video)),
      selfStream: !!(st && (st.selfStream || st.self_stream)),
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

  var SINK_ID = "deckscord-qam";
  window.__deckscordAudioFocus = window.__deckscordAudioFocus || { userId: null, saved: {} };
  window.__deckscordVideo = window.__deckscordVideo || { canvases: {}, sinks: false };

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

  function collectStreams() {
    var UserStore = store("UserStore") || byProps("getCurrentUser", "getUser");
    var ChannelStore = store("ChannelStore") || byProps("getChannel", "getDMFromUserId");
    var SelectedChannelStore = store("SelectedChannelStore") || byProps("getVoiceChannelId", "getChannelId");
    var VoiceStateStore = store("VoiceStateStore") || byProps("getVoiceStateForUser", "getVoiceStatesForChannel");
    var MediaEngineStore = store("MediaEngineStore") || byProps("isSelfMute", "isSelfDeaf");
    var me = UserStore && UserStore.getCurrentUser && UserStore.getCurrentUser();
    var meId = me && String(me.id);
    var cid = SelectedChannelStore && SelectedChannelStore.getVoiceChannelId && SelectedChannelStore.getVoiceChannelId();
    if (!cid) return { channelId: null, guildId: null, meId: meId, members: [], streams: [] };
    var vc = ChannelStore && ChannelStore.getChannel && ChannelStore.getChannel(cid);
    var guildId = vc ? (vc.guild_id || vc.guildId || null) : null;
    var members = voiceMembersFor(cid, UserStore, VoiceStateStore, meId, MediaEngineStore);
    var streams = [];
    var seen = {};
    function isSnowflake(id) {
      return /^\d{5,}$/.test(String(id || ""));
    }
    function add(userId, kind, streamId) {
      userId = String(userId || "");
      if (!isSnowflake(userId)) return;
      kind = kind === "screenshare" || kind === "stream" ? "screenshare" : "camera";
      var key = userId + ":" + kind;
      if (seen[key]) return;
      seen[key] = true;
      var m = null;
      for (var i = 0; i < members.length; i++) if (members[i].id === userId) m = members[i];
      var u = UserStore && UserStore.getUser && UserStore.getUser(userId);
      var name = (m && m.name) || (u && (u.globalName || u.username)) || "";
      if (!name || name.length < 2) return;
      streams.push({
        userId: userId,
        kind: kind,
        name: name,
        avatar: (m && m.avatar) || avatarFromUser(u, 48),
        self: !!(m && m.self) || userId === meId,
        streamId: String(streamId || userId),
      });
    }
    members.forEach(function (m) {
      if (m.selfVideo) add(m.id, "camera", m.id);
      if (m.selfStream) add(m.id, "screenshare", m.id);
    });
    var rtc = store("ChannelRTCStore");
    function idFrom(p, fallback) {
      if (p == null) return fallback;
      if (typeof p === "string" || typeof p === "number") return p;
      return (p.userId || p.user_id || (p.user && p.user.id) || (isSnowflake(p.id) ? p.id : null) || fallback);
    }
    function walkParticipants(bag, kind) {
      if (!bag) return;
      if (typeof bag.forEach === "function" && typeof bag !== "string") {
        try {
          bag.forEach(function (p, k) {
            add(idFrom(p, k), kind, p && p.streamId);
          });
          return;
        } catch (eWalk) {}
      }
      if (Array.isArray(bag)) {
        bag.forEach(function (p) { add(idFrom(p), kind, p && p.streamId); });
        return;
      }
      if (typeof bag === "object") {
        if (bag.userId || (bag.user && bag.user.id) || isSnowflake(bag.id)) {
          add(idFrom(bag), kind, bag.streamId);
          return;
        }
        Object.keys(bag).forEach(function (id) {
          if (!isSnowflake(id) && typeof bag[id] !== "object") return;
          add(idFrom(bag[id], id), kind, bag[id] && bag[id].streamId);
        });
      }
    }
    try {
      if (rtc && typeof rtc.getVideoParticipants === "function") {
        var vp = rtc.getVideoParticipants(cid);
        if (vp == null) vp = rtc.getVideoParticipants();
        walkParticipants(vp, "camera");
      }
      if (rtc && typeof rtc.getStreamParticipants === "function") {
        var sp = rtc.getStreamParticipants(cid);
        if (sp == null) sp = rtc.getStreamParticipants();
        walkParticipants(sp, "screenshare");
      }
    } catch (eRtc) {}
    var App = store("ApplicationStreamingStore") || byProps("getAllApplicationStreamsForChannel");
    try {
      if (App && App.getAllApplicationStreamsForChannel) {
        var list = App.getAllApplicationStreamsForChannel(cid) || [];
        var arr = Array.isArray(list) ? list : Object.keys(list).map(function (k) { return list[k]; });
        arr.forEach(function (s) {
          var oid = s && (s.ownerId || s.owner_id || (s.user && s.user.id));
          if (oid) add(String(oid), "screenshare", s.id || oid);
        });
      }
    } catch (eApp) {}
    streams.sort(function (a, b) {
      if (a.self !== b.self) return a.self ? 1 : -1;
      if (a.kind !== b.kind) return a.kind === "camera" ? -1 : 1;
      return 0;
    });
    return { channelId: String(cid), guildId: guildId && String(guildId), meId: meId, members: members, streams: streams };
  }

  function canvasFromFrame(frame, w, h) {
    var c = document.createElement("canvas");
    c.width = w || 400;
    c.height = h || 225;
    var ctx = c.getContext("2d");
    try {
      if (!frame) return c;
      if (frame instanceof HTMLCanvasElement || (frame.tagName && String(frame.tagName).toLowerCase() === "canvas")) {
        ctx.drawImage(frame, 0, 0, c.width, c.height);
      } else if (frame instanceof HTMLVideoElement || (frame.videoWidth && frame.readyState)) {
        ctx.drawImage(frame, 0, 0, c.width, c.height);
      } else if (frame.data && frame.width) {
        var tmp = document.createElement("canvas");
        tmp.width = frame.width;
        tmp.height = frame.height;
        tmp.getContext("2d").putImageData(frame, 0, 0);
        ctx.drawImage(tmp, 0, 0, c.width, c.height);
      } else if (frame.imageData) {
        return canvasFromFrame(frame.imageData, w, h);
      }
    } catch (e) {}
    return c;
  }

  function lumaBlack(canvas) {
    try {
      var s = document.createElement("canvas");
      s.width = 8;
      s.height = 8;
      var ctx = s.getContext("2d");
      ctx.drawImage(canvas, 0, 0, 8, 8);
      var d = ctx.getImageData(0, 0, 8, 8).data;
      var sum = 0;
      var n = 0;
      for (var i = 0; i < d.length; i += 4) {
        sum += (d[i] + d[i + 1] + d[i + 2]) / 3;
        n++;
      }
      return n ? sum / n < 8 : true;
    } catch (e) {
      return true;
    }
  }

  function jpegFromCanvas(canvas, q) {
    try {
      return canvas.toDataURL("image/jpeg", q);
    } catch (e) {
      return null;
    }
  }

  function rememberFrame(key, frame) {
    var c = canvasFromFrame(frame, 400, 225);
    window.__deckscordVideo.canvases[key] = c;
  }

  function paintElementToJpeg(el, q) {
    if (!el) return null;
    try {
      var w = el.videoWidth || el.width || 0;
      var h = el.videoHeight || el.height || 0;
      var r = el.getBoundingClientRect && el.getBoundingClientRect();
      if ((!w || !h) && r) {
        w = r.width;
        h = r.height;
      }
      if (w < 64 || h < 64) return null;
      if (w === 240 && h === 240) return null;
      var c = document.createElement("canvas");
      c.width = 400;
      c.height = 225;
      c.getContext("2d").drawImage(el, 0, 0, 400, 225);
      if (lumaBlack(c)) return null;
      return jpegFromCanvas(c, q || 0.45);
    } catch (e) {
      return null;
    }
  }

  function grabDomJpeg() {
    var nodes = document.querySelectorAll("video, canvas");
    for (var i = 0; i < nodes.length; i++) {
      var j = paintElementToJpeg(nodes[i], 0.45);
      if (j) return j;
    }
    return null;
  }

  function videoClipRects() {
    var out = [];
    var nodes = document.querySelectorAll("video, canvas");
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var r = el.getBoundingClientRect();
      var vw = el.videoWidth || el.width || r.width;
      var vh = el.videoHeight || el.height || r.height;
      if (r.width < 80 || r.height < 80) continue;
      if (vw === 240 && vh === 240) continue;
      out.push({
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
      });
    }
    return out;
  }

  function ensureVideoSinks(enable) {
    var bag = collectStreams();
    var add = findEngineFn("addVideoOutputSink") || findEngineFn("addDirectVideoOutputSink");
    var remove = findEngineFn("removeVideoOutputSink");
    var keep = findEngineFn("setHasActiveVideoOutputSink");
    bag.streams.forEach(function (s) {
      var sid = s.streamId || s.userId;
      try {
        if (enable && add) {
          add(SINK_ID, sid, function (frame) {
            rememberFrame(s.userId + ":" + s.kind, frame);
          });
        }
      } catch (e1) {
        try {
          if (enable && add) add(sid, function (frame) { rememberFrame(s.userId + ":" + s.kind, frame); });
        } catch (e2) {}
      }
      try {
        if (!enable && remove) remove(SINK_ID, sid);
      } catch (e3) {}
      try {
        if (keep) keep(s.userId, !!enable, SINK_ID);
      } catch (e4) {}
    });
    window.__deckscordVideo.sinks = !!enable;
    return { ok: true, enabled: !!enable, n: bag.streams.length, hasAdd: !!add };
  }

  function urlToDataJpeg(url) {
    if (!url || String(url).indexOf("http") !== 0) return Promise.resolve(null);
    return fetch(String(url), { credentials: "include" }).then(function (r) {
      if (!r || !r.ok) return null;
      return r.blob();
    }).then(function (blob) {
      if (!blob) return null;
      return new Promise(function (resolve) {
        var fr = new FileReader();
        fr.onload = function () { resolve(fr.result); };
        fr.onerror = function () { resolve(null); };
        fr.readAsDataURL(blob);
      });
    }).catch(function () { return null; });
  }

  function previewJpegFor(guildId, channelId, ownerId) {
    var Prev = store("ApplicationStreamPreviewStore") || byProps("getPreviewURL");
    var getter = Prev && (Prev.getPreviewURL || Prev.getPreviewUrl);
    var fetcher =
      findFn("fetchStreamPreview") ||
      findFn("fetchPreview") ||
      (byProps("fetchStreamPreview") && byProps("fetchStreamPreview").fetchStreamPreview) ||
      (byProps("fetchPreview") && byProps("fetchPreview").fetchPreview);
    var kick = Promise.resolve();
    if (fetcher) {
      try {
        kick = Promise.resolve(fetcher(String(guildId), String(channelId), String(ownerId))).catch(function () {});
      } catch (eKick) {
        kick = Promise.resolve();
      }
    }
    return kick.then(function () {
      var p = null;
      if (getter) {
        try { p = getter.call(Prev, String(guildId), String(channelId), String(ownerId)); } catch (e1) {}
      }
      return Promise.resolve(p);
    }).then(function (url) {
      if (url && typeof url === "object") url = url.url || url.previewURL || url.previewUrl || null;
      if (url) return urlToDataJpeg(url);
      var Rest = common("RestAPI") || byProps("get", "post", "put");
      var key = String(guildId) + ":" + String(channelId) + ":" + String(ownerId);
      if (!Rest || !Rest.get) return null;
      return Promise.resolve(Rest.get({ url: "/streams/" + encodeURIComponent(key) + "/preview" })).then(function (res) {
        var u = res && (res.body && (res.body.url || res.body.preview_url) || res.url);
        return urlToDataJpeg(u);
      }).catch(function () { return null; });
    }).catch(function () { return null; });
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
  };

  function pinScreenshareQuality() {
    try {
      var f = document.createElement("iframe");
      document.documentElement.appendChild(f);
      var ls = f.contentWindow.localStorage;
      var st = JSON.parse(ls.getItem("VesktopState") || "{}");
      st.screenshareQuality = { resolution: "720", frameRate: "30" };
      ls.setItem("VesktopState", JSON.stringify(st));
      f.remove();
    } catch (ePin) {}
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
    if (!GO_LIVE.active) return;
    var roots = document.querySelectorAll(".vcd-screen-picker, [class*='screen-picker']");
    var root = null;
    for (var i = 0; i < roots.length; i++) {
      if (!roots[i].dataset.deckscordAuto) {
        root = roots[i];
        break;
      }
    }
    if (!root) {
      var footers = document.querySelectorAll(".vcd-screen-picker-footer");
      for (var f = 0; f < footers.length; f++) {
        if (!footers[f].dataset.deckscordAuto) {
          root = footers[f].closest(".vcd-screen-picker") || footers[f].parentElement || footers[f];
          break;
        }
      }
    }
    if (!root) return;

    var skip = /vesktop|vencord|discord|chrome|chromium|firefox|steamwebhelper|plasmashell|pipewire|entire system|entire computer|also share/i;
    var boxes = root.querySelectorAll("input[type=checkbox], input[type=radio]");
    var gameBox = null;
    var boxCount = 0;
    for (var b = 0; b < boxes.length; b++) {
      var el = boxes[b];
      var label = "";
      try {
        label = (el.labels && el.labels[0] && el.labels[0].textContent) || el.getAttribute("aria-label") || el.parentElement.textContent || "";
      } catch (eL) {}
      if (skip.test(label) || skip.test(el.value || "")) {
        if (el.checked) {
          try { el.click(); } catch (eUn) {}
        }
        continue;
      }
      boxCount++;
      if (!gameBox) gameBox = el;
    }
    if (gameBox && !gameBox.checked && boxCount <= 4) {
      try { gameBox.click(); } catch (eCk) {}
    }

    var buttons = root.querySelectorAll("button");
    var go = null;
    for (var k = 0; k < buttons.length; k++) {
      var t = String(buttons[k].textContent || "").replace(/\s+/g, " ").trim();
      if (/go live|share|live/i.test(t) && !/cancel|stop|back/i.test(t)) {
        go = buttons[k];
        break;
      }
    }
    if (!go && buttons.length) go = buttons[buttons.length - 1];
    if (!go) return;
    root.dataset.deckscordAuto = "1";
    try { go.click(); } catch (eClick) {}
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
          var bag = collectStreams();
          var af = window.__deckscordAudioFocus || { userId: null, saved: {} };
          if (af.userId && String(voiceChannelId) !== String(window.__deckscordLastVoice || voiceChannelId)) {
            try { window.__deckscord && window.__deckscord.clearAudioFocus && window.__deckscord.clearAudioFocus(); } catch (eClr) {}
            af = window.__deckscordAudioFocus || { userId: null, saved: {} };
          }
          window.__deckscordLastVoice = String(voiceChannelId);
          var mine = currentStream();
          voice = {
            channelId: String(voiceChannelId),
            name: vc ? vc.name : String(voiceChannelId),
            guildId: vc ? (vc.guild_id || vc.guildId || null) : null,
            members: members,
            hasVideo: !!(bag.streams && bag.streams.length),
            focusedUserId: (af && af.userId) || null,
            streams: bag.streams || [],
            streaming: !!mine || GO_LIVE.active,
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
        var mineStream = currentStream();

        return {
          ok: true,
          ready: true,
          logged_in: true,
          user: userLite(me),
          muted: muted,
          deafened: deafened,
          streaming: !!(mineStream || (voice && voice.streaming) || GO_LIVE.active),
          stream: {
            active: !!(mineStream || GO_LIVE.active),
            pending: !!GO_LIVE.pending,
            width: GO_LIVE.width,
            height: GO_LIVE.height,
            fps: GO_LIVE.fps,
          },
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

    probeVideo: function () {
      try {
        var bag = collectStreams();
        var MediaEngineStore = store("MediaEngineStore") || byProps("isSelfMute", "isSelfDeaf");
        var eng = null;
        try { eng = MediaEngineStore && MediaEngineStore.getMediaEngine && MediaEngineStore.getMediaEngine(); } catch (e) {}
        var sinkApi = {
          addVideoOutputSink: typeof findEngineFn("addVideoOutputSink") === "function" ? "function" : "undefined",
          addDirectVideoOutputSink: typeof findEngineFn("addDirectVideoOutputSink") === "function" ? "function" : "undefined",
          removeVideoOutputSink: typeof findEngineFn("removeVideoOutputSink") === "function" ? "function" : "undefined",
          setVideoOutputSink: typeof findEngineFn("setVideoOutputSink") === "function" ? "function" : "undefined",
          setHasActiveVideoOutputSink: typeof findEngineFn("setHasActiveVideoOutputSink") === "function" ? "function" : "undefined",
          setLocalMute: typeof findEngineFn("setLocalMute") === "function" || typeof findFn("setLocalMute") === "function" ? "function" : "undefined",
        };
        var videos = [];
        try {
          Array.prototype.forEach.call(document.querySelectorAll("video"), function (el) {
            videos.push({
              tag: "video",
              className: String(el.className || "").slice(0, 80),
              w: el.videoWidth || 0,
              h: el.videoHeight || 0,
              readyState: el.readyState,
              hasSrcObject: !!el.srcObject,
              videoWidth: el.videoWidth || 0,
            });
          });
        } catch (eDom) {}
        var winner = null;
        if (sinkApi.addVideoOutputSink === "function" || sinkApi.addDirectVideoOutputSink === "function") winner = "F";
        else if (videos.some(function (v) { return v.videoWidth > 0; })) winner = "B";
        else if (bag.streams.some(function (s) { return s.kind === "screenshare"; })) winner = "C";
        var previewP = Promise.resolve(null);
        var ss = bag.streams.filter(function (s) { return s.kind === "screenshare"; })[0];
        if (ss && bag.guildId && bag.channelId) previewP = previewJpegFor(bag.guildId, bag.channelId, ss.userId);
        return previewP.then(function (pj) {
          return {
            ok: true,
            inVoice: !!bag.channelId,
            channelId: bag.channelId,
            engineType: (eng && eng.constructor && eng.constructor.name) || "unknown",
            members: bag.members.map(function (m) {
              return { id: m.id, name: m.name, selfVideo: !!m.selfVideo, selfStream: !!m.selfStream };
            }),
            streamIds: bag.streams.map(function (s) { return { userId: s.userId, kind: s.kind, streamId: s.streamId }; }),
            sinkApi: sinkApi,
            dom: videos,
            window: { hidden: document.hidden, vis: document.visibilityState },
            previewJpeg: pj || null,
            winner: winner,
            black: false,
          };
        });
      } catch (e) {
        return err(e);
      }
    },

    grabVideoFrames: function () {
      try {
        var bag = collectStreams();
        try { ensureVideoSinks(true); } catch (eSink) {}
        var copied = (bag.streams || []).filter(function (s) {
          return !(s.self && s.kind === "screenshare");
        }).slice(0, 4);
        var jobs = copied.map(function (s) {
          var key = s.userId + ":" + s.kind;
          var cached = window.__deckscordVideo.canvases[key];
          var jpeg = null;
          var black = true;
          if (cached) {
            black = lumaBlack(cached);
            jpeg = black ? null : jpegFromCanvas(cached, s.kind === "screenshare" ? 0.5 : 0.4);
          }
          if (!jpeg) {
            jpeg = grabDomJpeg();
            if (jpeg) black = false;
          }
          var next = Promise.resolve(jpeg);
          if (!jpeg && s.kind === "screenshare" && bag.guildId && bag.channelId) {
            next = previewJpegFor(bag.guildId, bag.channelId, s.userId);
          }
          return next.then(function (j) {
            var outJpeg = j || jpeg;
            return {
              userId: s.userId,
              kind: s.kind,
              name: s.name,
              avatar: s.avatar,
              jpeg: outJpeg || null,
              w: 400,
              h: 225,
              black: !outJpeg,
              self: !!s.self,
            };
          });
        });
        return Promise.all(jobs).then(function (frames) {
          return {
            ok: true,
            ts: Date.now(),
            frames: frames,
            clips: videoClipRects(),
          };
        });
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
        var bag = collectStreams();
        (bag.members || []).forEach(function (m) {
          if (isUserSpeaking(m.id, meId) && ids.indexOf(m.id) === -1) ids.push(m.id);
        });
        if (meId && Sp && typeof Sp.isCurrentUserSpeaking === "function" && Sp.isCurrentUserSpeaking()) {
          if (ids.indexOf(meId) === -1) ids.push(meId);
        }
        return { ok: true, ids: ids };
      } catch (e) {
        return err(e);
      }
    },

    videoClipRects: function () {
      try {
        return { ok: true, clips: videoClipRects() };
      } catch (e) {
        return err(e);
      }
    },

    ensureVideoSinks: function (enable) {
      try {
        return ensureVideoSinks(!!enable);
      } catch (e) {
        return err(e);
      }
    },

    focusAudio: function (userId) {
      try {
        var bag = collectStreams();
        var id = String(userId || "");
        var af = window.__deckscordAudioFocus || { userId: null, saved: {} };
        if (!id || id === String(bag.meId || "")) {
          return window.__deckscord.clearAudioFocus();
        }
        if (af.userId === id) {
          return { ok: true, user_id: id, already: true };
        }
        if (af.userId) window.__deckscord.clearAudioFocus();
        var MediaEngineStore = store("MediaEngineStore") || byProps("isLocalMute", "getLocalVolume");
        var saved = {};
        bag.members.forEach(function (m) {
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
        bag.members.forEach(function (m) {
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
        function isMon(d) {
          var n = String((d && (d.name || d.label || d.id)) || "").toLowerCase();
          return n.indexOf("monitor") !== -1 || n.indexOf("loopback") !== -1 || n.indexOf("stereo mix") !== -1;
        }
        var curDev = null;
        for (var i = 0; i < inputs.length; i++) {
          if (String(inputs[i].id) === String(cur)) curDev = inputs[i];
        }
        if (curDev && isMon(curDev)) {
          var setIn = findFn("setInputDevice");
          var pick = null;
          for (var j = 0; j < inputs.length; j++) {
            if (!isMon(inputs[j]) && String(inputs[j].id) !== "default") { pick = inputs[j]; break; }
          }
          if (!pick) {
            for (var k = 0; k < inputs.length; k++) {
              if (!isMon(inputs[k])) { pick = inputs[k]; break; }
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
        try { window.__deckscord.stopGoLive(); } catch (eStop) {}
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

    startGoLive: function (opts) {
      opts = opts || {};
      var width = Number(opts.width) || GO_LIVE.width;
      var height = Number(opts.height) || GO_LIVE.height;
      var fps = Number(opts.fps) || GO_LIVE.fps;
      GO_LIVE.width = width;
      GO_LIVE.height = height;
      GO_LIVE.fps = fps;
      pinScreenshareQuality();

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

      function finishStart(srcId) {
        if (GO_LIVE.stopRequested) {
          GO_LIVE.active = false;
          try { eng && eng.desktopInputPool && eng.desktopInputPool.get(srcId) && eng.desktopInputPool.get(srcId).destroy(); } catch (eD) {}
          return { ok: false, error: "cancelled" };
        }
        startFn(guildId, cid, { pid: null, sourceId: srcId, sourceName: "Deckscord" });
        return { ok: true, sourceId: srcId, width: width, height: height, fps: fps };
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
        var constraints = { width: width, height: height, frameRate: fps };
        var acq = eng.getDesktopSource(constraints, true);
        var timed = new Promise(function (_, rej) {
          setTimeout(function () { rej(new Error("getDesktopSource timeout (20s)")); }, 20000);
        });
        return Promise.race([acq, timed]).then(function (srcId) {
          if (myGen !== GO_LIVE.gen) {
            try { eng.desktopInputPool && eng.desktopInputPool.get(srcId) && eng.desktopInputPool.get(srcId).destroy(); } catch (eOld) {}
            return { ok: false, error: "superseded" };
          }
          return finishStart(srcId);
        });
      }).catch(function (e) {
        if (myGen === GO_LIVE.gen) GO_LIVE.active = false;
        return err(e);
      }).then(function (r) {
        if (myGen === GO_LIVE.gen) {
          GO_LIVE.pending = false;
          GO_LIVE.stopRequested = false;
        }
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
        return { ok: true, streaming: false };
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
        var n = id.toLowerCase();
        if (n.indexOf("monitor") !== -1 || n.indexOf("loopback") !== -1) {
          return { ok: false, error: "that input is speaker loopback, not a microphone" };
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

const manifest = { name: "Deckscord" };
const API_VERSION = 1;
const internalAPIConnection =
  window.__DECKY_SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED_deckyLoaderAPIInit;

let api;
if (internalAPIConnection) {
  try {
    api = internalAPIConnection.connect(API_VERSION, manifest.name);
  } catch {
    api = internalAPIConnection.connect(1, manifest.name);
  }
}

const backend = (name) => {
  if (api && typeof api.call === "function") {
    return (...args) => api.call(name, ...args);
  }
  if (api && typeof api.callable === "function") {
    return api.callable(name);
  }
  return async (...args) => {
    if (window.DeckyPluginLoader && window.DeckyPluginLoader.callServerMethod) {
      return window.DeckyPluginLoader.callServerMethod(name, { args });
    }
    throw new Error("Decky backend API missing");
  };
};

const getStatus = backend("get_status");
const joinVoice = backend("join_voice");
const leaveVoice = backend("leave_voice");
const toggleMute = backend("toggle_mute");
const toggleDeafen = backend("toggle_deafen");
const setInputDevice = backend("set_input_device");
const setOutputDevice = backend("set_output_device");
const setUserVolume = backend("set_user_volume");
const toggleUserMute = backend("toggle_user_mute");
const setServerMute = backend("set_server_mute");
const setServerDeaf = backend("set_server_deaf");
const setInputVolume = backend("set_input_volume");
const setOutputVolume = backend("set_output_volume");
const selectText = backend("select_text");
const getMessages = backend("get_messages");
const sendMessage = backend("send_message");
const startVesktop = backend("start_vesktop");
const getVideoFrames = backend("get_video_frames");
const getSpeaking = backend("get_speaking");
const focusAudio = backend("focus_audio");
const clearAudioFocus = backend("clear_audio_focus");
const updateFromGithub = backend("update_from_github");
const startGoLive = backend("start_go_live");
const stopGoLive = backend("stop_go_live");

const e = window.SP_REACT.createElement;
const { useState, useEffect, useCallback, useRef, useContext, createContext } = window.SP_REACT;
const Focusable = DFL.Focusable || "div";
const BackNav = createContext(null);

function cancelBind(handler) {
  if (!handler) return {};
  return {
    onCancelButton: handler,
    onCancel: handler,
    onCancelActionDescription: "Back",
  };
}

const FILL = {
  width: "100%",
  maxWidth: "100%",
  minWidth: 0,
  boxSizing: "border-box",
  overflowX: "hidden",
};

function cx() {
  if (DFL.joinClassNames) return DFL.joinClassNames.apply(DFL, arguments);
  return Array.prototype.slice.call(arguments).filter(Boolean).join(" ");
}

function fieldClass() {
  const g = DFL.gamepadDialogClasses || {};
  return cx(g.Field, g.HighlightOnFocus);
}

function phaseOf(status) {
  if (!status) return "loading";
  return status.phase || (status.ready ? "ready" : "loading");
}

function mediaUrl(url) {
  if (!url) return url;
  let u = String(url);
  if (u.indexOf("cdn.discordapp.com/attachments") !== -1) {
    u = u.replace("cdn.discordapp.com/attachments", "media.discordapp.net/attachments");
  }
  if (u.indexOf("media.discordapp.net") !== -1) {
    u += (u.indexOf("?") >= 0 ? "&" : "?") + "width=380&height=380";
  }
  return u;
}

function Avatar({ src, name, size, radius }) {
  const [bad, setBad] = useState(false);
  useEffect(() => {
    setBad(false);
  }, [src]);
  const s = size || 36;
  const r = radius == null ? 8 : radius;
  const letter = String(name || "?").trim().slice(0, 1).toUpperCase() || "?";
  if (!src || bad) {
    return e(
      "div",
      {
        style: {
          width: s,
          height: s,
          minWidth: s,
          borderRadius: r,
          background: "rgba(255,255,255,0.12)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontWeight: 700,
          fontSize: Math.max(12, Math.floor(s * 0.42)),
          flexShrink: 0,
        },
      },
      letter
    );
  }
  return e("img", {
    src,
    alt: "",
    onError: () => setBad(true),
    style: {
      width: s,
      height: s,
      minWidth: s,
      borderRadius: r,
      objectFit: "cover",
      flexShrink: 0,
      background: "rgba(0,0,0,0.35)",
    },
  });
}

function Row({ onClick, children, disabled, style }) {
  const onCancel = useContext(BackNav);
  const go = () => {
    if (disabled || !onClick) return;
    onClick();
  };
  return e(
    Focusable,
    {
      className: fieldClass(),
      onActivate: go,
      onOKButton: go,
      onClick: go,
      ...cancelBind(onCancel),
      style: {
        display: "flex",
        alignItems: "center",
        gap: 10,
        width: "100%",
        maxWidth: "100%",
        minWidth: 0,
        boxSizing: "border-box",
        padding: "10px 4px",
        margin: 0,
        opacity: disabled ? 0.5 : 1,
        overflow: "hidden",
        ...style,
      },
    },
    children
  );
}

function Label({ children, style }) {
  return e(
    "div",
    {
      style: {
        minWidth: 0,
        flex: 1,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        fontSize: 16,
        fontWeight: 500,
        lineHeight: 1.25,
        ...style,
      },
    },
    children
  );
}

function Sub({ children }) {
  return e(
    "div",
    {
      style: {
        minWidth: 0,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        opacity: 0.65,
        fontSize: 12,
        marginTop: 2,
      },
    },
    children
  );
}

function Media({ item, kind, video }) {
  const [bad, setBad] = useState(false);
  if (!item || !item.url) return null;
  const isVid = kind === "video" || video || (item.type && String(item.type).indexOf("video/") === 0);
  if (bad) {
    return e("div", { style: { opacity: 0.7, fontSize: 12, marginTop: 6 } }, item.name || "Can't load media");
  }
  if (isVid) {
    return e("video", {
      src: item.url,
      controls: true,
      playsInline: true,
      style: {
        width: "100%",
        maxWidth: "100%",
        maxHeight: 180,
        marginTop: 6,
        borderRadius: 6,
        background: "#000",
        display: "block",
      },
      onError: () => setBad(true),
    });
  }
  return e("img", {
    src: mediaUrl(item.url),
    alt: item.name || "",
    style: {
      width: "100%",
      maxWidth: "100%",
      maxHeight: 180,
      objectFit: "contain",
      marginTop: 6,
      borderRadius: 6,
      background: "rgba(0,0,0,0.35)",
      display: "block",
    },
    onError: () => setBad(true),
  });
}

function EmbedView({ embed }) {
  if (!embed) return null;
  const kids = [];
  if (embed.title) kids.push(e("div", { key: "t", style: { fontWeight: 600, fontSize: 13 } }, embed.title));
  if (embed.description)
    kids.push(
      e(
        "div",
        { key: "d", style: { fontSize: 12, opacity: 0.85, whiteSpace: "pre-wrap", wordBreak: "break-word", marginTop: 2 } },
        embed.description
      )
    );
  if (embed.video && embed.video.url) {
    kids.push(
      e("video", {
        key: "v",
        src: embed.video.url,
        poster: embed.image && embed.image.url,
        controls: true,
        autoPlay: embed.type === "gifv",
        loop: embed.type === "gifv",
        muted: embed.type === "gifv",
        playsInline: true,
        style: { width: "100%", maxWidth: "100%", maxHeight: 180, marginTop: 6, borderRadius: 6, background: "#000", display: "block" },
      })
    );
  } else if (embed.image) {
    kids.push(e(Media, { key: "i", item: embed.image, kind: "image" }));
  }
  if (!kids.length) return null;
  return e("div", { style: { marginTop: 6, padding: 8, background: "rgba(255,255,255,0.04)", borderRadius: 6 } }, kids);
}

function MessageBody({ m }) {
  const kids = [];
  if (m.content)
    kids.push(
      e(
        "div",
        { key: "c", style: { fontSize: 14, lineHeight: 1.35, whiteSpace: "pre-wrap", wordBreak: "break-word" } },
        m.content
      )
    );
  (m.attachments || []).forEach((a, i) => {
    if (a.kind === "image") kids.push(e(Media, { key: "a" + i, item: a, kind: "image" }));
    else if (a.kind === "video") kids.push(e(Media, { key: "a" + i, item: a, kind: "video" }));
    else if (a.kind === "audio")
      kids.push(e("audio", { key: "a" + i, src: a.url, controls: true, style: { width: "100%", marginTop: 6 } }));
    else kids.push(e("div", { key: "a" + i, style: { fontSize: 12, opacity: 0.75, marginTop: 6 } }, a.name || "attachment"));
  });
  (m.embeds || []).forEach((emb, i) => kids.push(e(EmbedView, { key: "e" + i, embed: emb })));
  (m.stickers || []).forEach((s, i) => {
    if (s.url) kids.push(e(Media, { key: "s" + i, item: { url: s.url, name: s.name }, kind: "image" }));
  });
  if (!kids.length) kids.push(e("div", { key: "empty", style: { opacity: 0.6, fontSize: 13 } }, "(no text)"));
  return e("div", { style: FILL }, kids);
}

function ChatComposer({ value, onChange, onSend, disabled }) {
  const fieldRef = useRef(null);
  const wrapRef = useRef(null);
  const onCancel = useContext(BackNav);

  const openKb = () => {
    const node = fieldRef.current;
    let input = node && node.m_elInput;
    if (!input && node && node.querySelector) input = node.querySelector("input, textarea");
    if (!input && wrapRef.current) input = wrapRef.current.querySelector("input, textarea");
    if (input) {
      input.focus();
      if (typeof input.click === "function") input.click();
    }
  };

  const onField = (ev) => {
    const v = typeof ev === "string" ? ev : (ev && ev.target && ev.target.value) || "";
    onChange(v);
  };

  const field = DFL.TextField
    ? e(DFL.TextField, {
        ref: fieldRef,
        label: "Message",
        description: "Opens the Steam keyboard",
        value: value || "",
        focusOnMount: false,
        onChange: onField,
      })
    : e("input", {
        ref: fieldRef,
        value: value || "",
        onChange: (ev) => onChange(ev.target.value),
        placeholder: "Message",
        style: { width: "100%", maxWidth: "100%", boxSizing: "border-box", padding: 8 },
      });

  return e("div", { ref: wrapRef, style: FILL }, [
    e(Focusable, { key: "tf", onActivate: openKb, onOKButton: openKb, onClick: openKb }, field),
    e(
      DFL.PanelSectionRow,
      { key: "send" },
      e(
        DFL.ButtonItem,
        {
          layout: "below",
          disabled: !!disabled || !String(value || "").trim(),
          onClick: onSend,
          ...cancelBind(onCancel),
        },
        "Send"
      )
    ),
  ]);
}

function VideoTile({ stream, focused, jpeg, height, speaking, onFocus, onOpenMember }) {
  const onCancel = useContext(BackNav);
  const go = () => {
    if (stream.self) {
      if (onOpenMember) onOpenMember(stream);
      return;
    }
    if (focused && onOpenMember) onOpenMember(stream);
    else if (onFocus) onFocus(stream.userId);
  };
  return e(
    Focusable,
    {
      className: fieldClass(),
      onActivate: go,
      onOKButton: go,
      onClick: go,
      ...cancelBind(onCancel),
      style: {
        ...FILL,
        position: "relative",
        height: height || undefined,
        aspectRatio: height ? undefined : "16 / 9",
        padding: 0,
        margin: "0 0 6px",
        overflow: "hidden",
        boxShadow: focused
          ? "inset 0 0 0 2px #3ba55d"
          : speaking
            ? "inset 0 0 0 2px rgba(59,165,93,0.7)"
            : undefined,
      },
    },
    [
      jpeg
        ? e("img", {
            key: "img",
            src: jpeg,
            alt: "",
            style: {
              width: "100%",
              height: "100%",
              objectFit: stream.kind === "screenshare" ? "contain" : "cover",
              display: "block",
              background: "#000",
            },
          })
        : e("div", {
            key: "ph",
            style: {
              width: "100%",
              height: "100%",
              minHeight: height || 120,
              background: "rgba(0,0,0,0.55)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              opacity: 0.85,
            },
          }, e(Avatar, { src: stream.avatar, name: stream.name, size: 48, radius: 24 })),
      e("div", {
        key: "scrim",
        style: {
          position: "absolute",
          top: 0,
          left: 0,
          width: 48,
          height: 48,
          pointerEvents: "none",
          background: "linear-gradient(135deg, rgba(0,0,0,0.45) 0%, transparent 70%)",
        },
      }),
      e(
        "div",
        { key: "av", style: { position: "absolute", top: 6, left: 6, pointerEvents: "none", opacity: 0.88 } },
        e(Avatar, { src: stream.avatar, name: stream.name, size: 22, radius: 11 })
      ),
      e(
        "div",
        {
          key: "kind",
          style: { position: "absolute", top: 6, right: 6, pointerEvents: "none", fontSize: 14, opacity: 0.75 },
        },
        stream.kind === "screenshare" ? "🖥" : "📷"
      ),
      (focused || speaking) &&
        e(
          "div",
          {
            key: "pill",
            style: {
              position: "absolute",
              right: 6,
              bottom: 6,
              pointerEvents: "none",
              background: "rgba(0,0,0,0.55)",
              borderRadius: 4,
              padding: "3px 5px",
              color: speaking ? "#3ba55d" : "#8fbc9a",
              fontSize: 14,
              fontWeight: 700,
              textShadow: speaking ? "0 0 8px #3ba55d" : "none",
            },
          },
          "🔊"
        ),
    ]
  );
}

function VideoStack({ streams, frames, focusedUserId, speakingIds, max, onFocus, onOpenMember, onMore }) {
  const list = streams || [];
  const copied = list.slice(0, max);
  const extra = Math.max(0, list.length - copied.length);
  const n = copied.length || 1;
  const h = n === 1 ? 225 : n === 2 ? 160 : 120;
  const byKey = {};
  (frames || []).forEach((f) => {
    byKey[f.userId + ":" + (f.kind || "camera")] = f;
  });
  if (!copied.length) return null;
  return e(
    "div",
    { style: { ...FILL, padding: 0, margin: "0 0 8px" } },
    copied
      .map((s) => {
        const fr = byKey[s.userId + ":" + s.kind] || {};
        return e(VideoTile, {
          key: s.userId + s.kind,
          stream: s,
          focused: !s.self && focusedUserId === s.userId,
          jpeg: fr.black ? null : fr.jpeg,
          height: h,
          speaking: !!(speakingIds && speakingIds[s.userId]),
          onFocus,
          onOpenMember,
        });
      })
      .concat(
        extra
          ? [
              e(Row, { key: "more", onClick: onMore }, e(Label, null, "+" + extra + " more videos")),
            ]
          : []
      )
  );
}

function App() {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [stack, setStack] = useState([{ page: "home" }]);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [tick, setTick] = useState(0);
  const [volLocal, setVolLocal] = useState({});
  const [frames, setFrames] = useState([]);
  const [speakingIds, setSpeakingIds] = useState({});
  const refreshBusy = useRef(false);
  const tapLock = useRef(0);
  const volTimer = useRef(null);
  const grabBusy = useRef(false);

  const view = stack[stack.length - 1] || { page: "home" };
  const canBack = stack.length > 1;
  const push = (page) => setStack((s) => s.concat([page]));
  const back = () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));

  const handleCancel = (evt) => {
    if (!canBack) return;
    if (evt) {
      if (typeof evt.preventDefault === "function") evt.preventDefault();
      if (typeof evt.stopPropagation === "function") evt.stopPropagation();
      if (evt.detail && typeof evt.detail.preventDefault === "function") evt.detail.preventDefault();
    }
    back();
  };

  const handleButtonDown = (evt) => {
    if (!canBack) return;
    const btn = evt && evt.detail && evt.detail.button;
    if (btn === 2) handleCancel(evt);
  };

  const tap = (fn) => {
    const now = Date.now();
    if (now - tapLock.current < 250) return;
    tapLock.current = now;
    fn();
  };

  const refresh = useCallback(async () => {
    if (refreshBusy.current) return;
    refreshBusy.current = true;
    try {
      const s = await getStatus();
      setStatus(s || { phase: "loading", phase_label: "Discord is loading…" });
      if (s && s.ready) setError("");
      else if (s && s.error) setError(s.error);
      else setError("");
    } catch (err) {
      setStatus({ phase: "loading", phase_label: "Discord is loading…", vesktop_running: false });
      setError(String(err && err.message ? err.message : err));
    } finally {
      refreshBusy.current = false;
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh, tick]);

  useEffect(() => {
    const ready = !!(status && status.ready);
    const id = setInterval(() => setTick((n) => n + 1), ready ? 2500 : 1000);
    return () => clearInterval(id);
  }, [status && status.ready]);

  const chatId = view.page === "chat" ? view.channelId : null;
  useEffect(() => {
    if (!chatId || !(status && status.ready)) return;
    let stop = false;
    const pull = async () => {
      try {
        const r = await getMessages(chatId, 40);
        if (!stop && r && r.ok) setMessages(r.messages || []);
      } catch (_) {}
    };
    pull();
    const id = setInterval(pull, 2500);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [chatId, status && status.ready]);

  const videoOn = !!(status && status.videoEnabled && status.voice && status.voice.hasVideo);
  const streamCount = ((status && status.voice && status.voice.streams) || []).length;
  useEffect(() => {
    if (!videoOn) {
      setFrames([]);
      return;
    }
    let stop = false;
    const pull = async () => {
      if (grabBusy.current || stop) return;
      grabBusy.current = true;
      try {
        const r = await getVideoFrames();
        if (!stop && r && r.frames) setFrames(r.frames);
      } catch (_) {}
      grabBusy.current = false;
    };
    pull();
    const fps = streamCount <= 1 ? 5 : streamCount === 2 ? 4 : 3;
    const id = setInterval(pull, Math.max(220, Math.floor(1000 / fps)));
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [videoOn, streamCount]);

  const inVoice = !!(status && status.ready && status.voice && status.voice.channelId);
  useEffect(() => {
    if (!inVoice) {
      setSpeakingIds({});
      return;
    }
    let stop = false;
    const pull = async () => {
      try {
        const r = await getSpeaking();
        if (stop) return;
        const next = {};
        ((r && r.ids) || []).forEach((id) => {
          next[String(id)] = true;
        });
        setSpeakingIds(next);
      } catch (_) {}
    };
    pull();
    const id = setInterval(pull, 280);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [inVoice]);

  const act = async (label, fn, opts) => {
    const quiet = opts && opts.quiet;
    if (!(status && status.ready) && label !== "Starting Discord") return;
    if (!quiet) {
      setBusy(label);
      setError("");
    }
    try {
      const r = await fn();
      if (r && r.ok === false) setError(r.error || label + " failed");
      if (!opts || !opts.skipRefresh) await refresh();
    } catch (err) {
      setError(String(err && err.message ? err.message : err));
    }
    if (!quiet) setBusy("");
  };

  const slideVol = (key, value, fn) => {
    setVolLocal((prev) => ({ ...prev, [key]: value }));
    if (volTimer.current) clearTimeout(volTimer.current);
    volTimer.current = setTimeout(() => {
      act("Volume", fn, { quiet: true });
    }, 120);
  };

  const phase = phaseOf(status);
  const ready = phase === "ready";
  const voice = (status && status.voice) || null;
  const guilds = (status && status.guilds) || [];
  const dms = (status && status.dms) || [];
  const devices = (status && status.devices) || {};
  const userName = (status && status.user && (status.user.name || status.user.username)) || "";

  const openGuild = (g) => tap(() => push({ page: "guild", guildId: g.id, title: g.name }));
  const openDms = () => tap(() => push({ page: "dms", title: "Direct Messages" }));
  const openChat = (ch, extra) =>
    tap(() => {
      setMessages([]);
      setDraft("");
      push({
        page: "chat",
        channelId: ch.id,
        title: ch.name,
        icon: ch.icon || null,
        isDm: !!(extra && extra.isDm),
        guildId: extra && extra.guildId,
      });
      act("Open " + ch.name, () => selectText(ch.id), { quiet: true });
    });
  const openDevices = () => tap(() => push({ page: "devices", title: "Audio" }));
  const openMember = (m) =>
    tap(() =>
      push({
        page: "member",
        userId: m.id,
        title: m.name,
        avatar: m.avatar,
        self: !!m.self,
      })
    );
  const join = (ch) => tap(() => act("Join " + ch.name, () => joinVoice(ch.id, ch.name)));

  const memberById = (id) => {
    const lists = [];
    if (voice && voice.members) lists.push(voice.members);
    guilds.forEach((g) => (g.voice || []).forEach((c) => lists.push(c.members || [])));
    for (let i = 0; i < lists.length; i++) {
      const found = lists[i].find((m) => m.id === id);
      if (found) return found;
    }
    return null;
  };

  const navHeader = e(DFL.PanelSection, { title: "Deckscord" }, [
    e(DFL.PanelSectionRow, { key: "st" }, e("div", { style: FILL }, (status && status.phase_label) || (ready ? "Ready" : "Discord is loading…"))),
    canBack
      ? e(DFL.PanelSectionRow, { key: "back" }, e(DFL.ButtonItem, { layout: "below", onClick: () => back(), ...cancelBind(handleCancel) }, "Back"))
      : null,
    status && status.capture && status.capture.loopback
      ? e(
          DFL.PanelSectionRow,
          { key: "loop" },
          e(
            "div",
            { style: { color: "#e4b44c", fontSize: 13, lineHeight: 1.35 } },
            "Mic is capturing speaker output. Others will hear your game. Plug in a headset or pick a real microphone under Audio."
          )
        )
      : null,
    error ? e(DFL.PanelSectionRow, { key: "err" }, e("div", { style: { color: "#e4b44c", fontSize: 13 } }, error)) : null,
    busy ? e(DFL.PanelSectionRow, { key: "busy" }, e("div", { style: { opacity: 0.7, fontSize: 12 } }, busy + "…")) : null,
    view.page === "home" &&
      e(
        DFL.PanelSectionRow,
        { key: "upd" },
        e(
          DFL.ButtonItem,
          {
            layout: "below",
            description: "Reinstall latest from GitHub until this is in the Decky store",
            onClick: () =>
              tap(() =>
                act("Updating", async () => {
                  const r = await updateFromGithub();
                  if (r && r.ok) setBusy("Update started — QAM will reload…");
                  return r;
                })
              ),
          },
          "Update from GitHub"
        )
      ),
  ]);

  const outVol =
    volLocal.output != null ? volLocal.output : devices.outputVolume != null ? devices.outputVolume : 100;
  const inVol = volLocal.input != null ? volLocal.input : devices.inputVolume != null ? devices.inputVolume : 100;

  const videoEnabled = !!(status && status.videoEnabled);
  const hasVideo = !!(voice && voice.hasVideo);
  const liveStreams = (voice && voice.streams) || [];
  const focusedUserId = (voice && voice.focusedUserId) || null;
  const showLiveVideo = videoEnabled && hasVideo;
  const openVideoPage = () => tap(() => push({ page: "video", title: "Live video" }));
  const onTileFocus = (uid) => act("Focus", () => focusAudio(uid), { quiet: true });
  const onTileMember = (s) => {
    const m = memberById(s.userId) || { id: s.userId, name: s.name, avatar: s.avatar, self: !!s.self };
    openMember(m);
  };

  const streaming = !!(status && (status.streaming || (status.stream && status.stream.active) || (voice && voice.streaming)));
  const compactVoice = [
    voice
      ? e(
          DFL.PanelSectionRow,
          { key: "share" },
          e(DFL.ToggleField, {
            label: "Share game",
            description: streaming ? "Live · 720p 30" : "720p 30 · game screen + game audio",
            checked: streaming,
            onChange: () =>
              tap(() =>
                act(streaming ? "Stop share" : "Share game", () => (streaming ? stopGoLive() : startGoLive(1280, 720, 30)))
              ),
            ...cancelBind(handleCancel),
          })
        )
      : null,
    voice
      ? e(DFL.PanelSectionRow, { key: "leave" }, e(DFL.ButtonItem, { layout: "below", onClick: () => tap(() => act("Leave", () => leaveVoice())), ...cancelBind(handleCancel) }, "Leave voice"))
      : e(DFL.PanelSectionRow, { key: "idle" }, e("div", { style: { opacity: 0.7, fontSize: 13 } }, "Not in a voice channel")),
    e(
      DFL.PanelSectionRow,
      { key: "mute" },
      e(DFL.ToggleField, {
        label: "Mute",
        description: "Microphone",
        checked: !!(status && status.muted),
        onChange: () => tap(() => act("Mute", () => toggleMute())),
        ...cancelBind(handleCancel),
      })
    ),
    e(
      DFL.PanelSectionRow,
      { key: "deaf" },
      e(DFL.ToggleField, {
        label: "Deafen",
        description: "Speakers and microphone",
        checked: !!(status && status.deafened),
        onChange: () => tap(() => act("Deafen", () => toggleDeafen())),
        ...cancelBind(handleCancel),
      })
    ),
  ];
  const sliderRows = [
    e(
      DFL.PanelSectionRow,
      { key: "ovol" },
      e(DFL.SliderField, {
        label: "Output volume",
        value: outVol,
        min: 0,
        max: 200,
        step: 5,
        showValue: true,
        valueSuffix: "%",
        onChange: (v) => slideVol("output", v, () => setOutputVolume(v)),
        ...cancelBind(handleCancel),
      })
    ),
    e(
      DFL.PanelSectionRow,
      { key: "ivol" },
      e(DFL.SliderField, {
        label: "Input volume",
        value: inVol,
        min: 0,
        max: 200,
        step: 5,
        showValue: true,
        valueSuffix: "%",
        onChange: (v) => slideVol("input", v, () => setInputVolume(v)),
        ...cancelBind(handleCancel),
      })
    ),
    e(DFL.PanelSectionRow, { key: "dev" }, e(DFL.ButtonItem, { layout: "below", onClick: openDevices, ...cancelBind(handleCancel) }, "Input / output devices")),
  ];
  const videoUserIds = {};
  liveStreams.forEach((s) => {
    videoUserIds[s.userId] = true;
  });
  const listMembers = ((voice && voice.members) || []).filter((m) => !showLiveVideo || !videoUserIds[m.id]);
  const memberRows = listMembers.map((m) => {
    const talking = !!(speakingIds[m.id] || m.speaking);
    return e(
      Row,
      { key: m.id, onClick: () => openMember(m) },
      [
        e(Avatar, { key: "a", src: m.avatar, name: m.name, size: 32, radius: 16 }),
        e(
          "div",
          { key: "t", style: { minWidth: 0, flex: 1, overflow: "hidden" } },
          [
            e(Label, null, m.name + (m.self ? " (you)" : "")),
            e(
              Sub,
              null,
              [
                talking ? "speaking" : "",
                focusedUserId === m.id ? "solo" : "",
                m.localMute || m.muted ? "muted" : "",
                m.deaf ? "deaf" : "",
              ]
                .filter(Boolean)
                .join(" · ")
            ),
          ]
        ),
        e(
          "div",
          {
            key: "sp",
            style: {
              fontSize: 18,
              flexShrink: 0,
              color: talking ? "#3ba55d" : "rgba(255,255,255,0.28)",
              textShadow: talking ? "0 0 10px #3ba55d" : "none",
              transform: talking ? "scale(1.15)" : "scale(1)",
              transition: "color 80ms, text-shadow 80ms, transform 80ms",
            },
          },
          "🔊"
        ),
      ]
    );
  });
  const videoStack = showLiveVideo
    ? e(VideoStack, {
        key: "vids",
        streams: liveStreams,
        frames,
        focusedUserId,
        speakingIds,
        max: 3,
        onFocus: onTileFocus,
        onOpenMember: onTileMember,
        onMore: openVideoPage,
      })
    : null;

  const showVoicePanel = ready && view.page !== "chat" && view.page !== "member" && view.page !== "video";
  const people = [];
  if (showLiveVideo && view.page !== "devices" && videoStack) people.push(videoStack);
  if (memberRows.length) people.push.apply(people, memberRows);
  const voiceKids = people.concat(compactVoice).concat(sliderRows);
  const voiceSection =
    showVoicePanel &&
    e(DFL.PanelSection, { title: voice ? "Voice · " + voice.name : "Voice" }, voiceKids);

  let body = null;

  if (!ready) {
    const qr = status && status.qr_png;
    const waitHint =
      phase === "login"
        ? "On your phone open Discord → Scan QR Code."
        : "Wait for Discord to finish starting.";
    body = e(DFL.PanelSection, { title: phase === "login" ? "Scan to log in" : "Please wait" }, [
      e(DFL.PanelSectionRow, { key: "h" }, e("div", { style: { fontSize: 14, lineHeight: 1.4, opacity: 0.85 } }, waitHint)),
      qr &&
        e(
          DFL.PanelSectionRow,
          { key: "qr" },
          e(
            "div",
            { style: { ...FILL, display: "flex", justifyContent: "center", padding: "8px 0" } },
            e("img", {
              src: qr,
              alt: "Discord login QR",
              style: {
                width: 200,
                height: 200,
                maxWidth: "100%",
                background: "#fff",
                borderRadius: 12,
                padding: 8,
                boxSizing: "content-box",
              },
            })
          )
        ),
      (phase === "starting" || (status && status.vesktop_state === "failed")) &&
        e(DFL.PanelSectionRow, { key: "start" }, e(DFL.ButtonItem, { layout: "below", onClick: () => act("Starting Discord", () => startVesktop()) }, "Start Discord")),
    ]);
  } else if (view.page === "home") {
    body = e(DFL.PanelSection, { title: userName ? "Servers · " + userName : "Servers" }, [
      e(
        Row,
        { key: "dms", onClick: openDms },
        [
          e(Avatar, { key: "a", name: "DM", size: 36, radius: 18 }),
          e("div", { key: "t", style: { minWidth: 0, flex: 1, overflow: "hidden" } }, [
            e(Label, null, "Direct Messages"),
            e(Sub, null, dms.length ? dms.length + " conversations" : "Friends & group chats"),
          ]),
        ]
      ),
      guilds.length
        ? guilds.map((g) => {
            const inHere = voice && String(voice.guildId) === String(g.id);
            const nVoice = (g.voice || []).reduce((n, c) => n + ((c.members && c.members.length) || 0), 0);
            return e(
              Row,
              { key: g.id, onClick: () => openGuild(g) },
              [
                e(Avatar, { key: "a", src: g.icon, name: g.name, size: 36, radius: 10 }),
                e("div", { key: "t", style: { minWidth: 0, flex: 1, overflow: "hidden" } }, [
                  e(Label, null, g.name),
                  e(
                    Sub,
                    null,
                    inHere ? "In voice · " + voice.name : nVoice ? nVoice + " in voice" : (g.text || []).length + " text · " + (g.voice || []).length + " voice"
                  ),
                ]),
              ]
            );
          })
        : e(DFL.PanelSectionRow, { key: "none" }, e("div", { style: { opacity: 0.65 } }, "No servers yet.")),
    ]);
  } else if (view.page === "dms") {
    body = e(
      DFL.PanelSection,
      { title: "Direct Messages" },
      dms.length
        ? dms.map((c) =>
            e(
              Row,
              { key: c.id, onClick: () => openChat(c, { isDm: true }) },
              [
                e(Avatar, { key: "a", src: c.icon, name: c.name, size: 36, radius: 18 }),
                e("div", { key: "t", style: { minWidth: 0, flex: 1, overflow: "hidden" } }, [
                  e(Label, null, c.name),
                  e(Sub, null, c.type === 3 ? "Group DM" : "Direct message"),
                ]),
              ]
            )
          )
        : e(DFL.PanelSectionRow, null, e("div", { style: { opacity: 0.65 } }, "No conversations."))
    );
  } else if (view.page === "guild") {
    const guild = guilds.find((g) => g.id === view.guildId) || guilds[0];
    const text = (guild && guild.text) || [];
    const vcs = (guild && guild.voice) || [];
    body = e("div", { style: FILL }, [
      e(
        DFL.PanelSection,
        { title: "Text" },
        text.length
          ? text.map((c) =>
              e(
                Row,
                { key: "t" + c.id, onClick: () => openChat(c, { guildId: guild && guild.id }) },
                [e("div", { key: "h", style: { width: 18, opacity: 0.6, flexShrink: 0 } }, "#"), e(Label, { key: "n" }, c.name)]
              )
            )
          : e(DFL.PanelSectionRow, { key: "nt" }, e("div", { style: { opacity: 0.65 } }, "No text channels."))
      ),
      e(
        DFL.PanelSection,
        { title: "Voice" },
        vcs.length
          ? vcs.map((c) => {
              const here = voice && voice.channelId === c.id;
              const people = c.members || [];
              return e("div", { key: "v" + c.id, style: FILL }, [
                e(
                  Row,
                  { onClick: () => join(c) },
                  [
                    e("div", { key: "h", style: { width: 22, flexShrink: 0 } }, "🔊"),
                    e("div", { key: "n", style: { minWidth: 0, flex: 1, overflow: "hidden" } }, [
                      e(Label, null, c.name),
                      e(Sub, null, here ? "Connected — tap to stay" : people.length ? people.length + " in channel" : "Tap to join"),
                    ]),
                  ]
                ),
                people.map((m) =>
                  e(
                    Row,
                    { key: m.id, onClick: () => openMember(m), style: { paddingLeft: 28 } },
                    [
                      e(Avatar, { key: "a", src: m.avatar, name: m.name, size: 28, radius: 14 }),
                      e(Label, { key: "n", style: { fontSize: 14 } }, m.name + (m.self ? " (you)" : "")),
                      e("div", { key: "sp", style: { fontSize: 16, flexShrink: 0 } }, "🔊"),
                    ]
                  )
                ),
              ]);
            })
          : e(DFL.PanelSectionRow, { key: "nv" }, e("div", { style: { opacity: 0.65 } }, "No voice channels."))
      ),
    ]);
  } else if (view.page === "chat") {
    const composer = e(ChatComposer, {
      value: draft,
      onChange: setDraft,
      disabled: !view.channelId,
      onSend: () => {
        if (!view.channelId || !draft.trim()) return;
        const c = draft;
        setDraft("");
        act("Send", () => sendMessage(view.channelId, c));
      },
    });
    const shown = messages.length ? messages.slice(-20) : [{ id: "empty", author: "", content: "No messages yet." }];
    const msgList = shown.map((m) =>
      e(
        Focusable,
        {
          key: m.id,
          ...cancelBind(handleCancel),
          onFocus: (ev) => {
            const t = ev && (ev.currentTarget || ev.target);
            if (t && typeof t.scrollIntoView === "function") t.scrollIntoView({ block: "nearest" });
          },
          style: { ...FILL, marginBottom: 10, padding: "4px 0" },
        },
        [
          m.author &&
            e(
              "div",
              { key: "h", style: { display: "flex", alignItems: "center", gap: 8, marginBottom: 4 } },
              [
                e(Avatar, { key: "a", src: m.avatar, name: m.author, size: 22, radius: 11 }),
                e("div", { key: "n", style: { fontWeight: 600, fontSize: 13 } }, m.author),
              ]
            ),
          e(MessageBody, { key: "b", m }),
        ]
      )
    );
    body = e("div", { style: FILL }, [
      e(DFL.PanelSection, { title: "#" + (view.title || "chat") }, [
        view.isDm &&
          e(
            DFL.PanelSectionRow,
            { key: "call" },
            e(
              DFL.ButtonItem,
              {
                layout: "below",
                onClick: () => join({ id: view.channelId, name: view.title || "Call" }),
                ...cancelBind(handleCancel),
              },
              voice && voice.channelId === view.channelId ? "In call" : "Start voice call"
            )
          ),
        e("div", { key: "msgs", style: FILL }, msgList),
        e("div", { key: "compose", style: FILL }, composer),
        showLiveVideo &&
          e(
            DFL.PanelSectionRow,
            { key: "live" },
            e(DFL.ButtonItem, { layout: "below", onClick: openVideoPage, ...cancelBind(handleCancel) }, "Live video (" + liveStreams.length + ")")
          ),
        voice &&
          e(
            DFL.PanelSectionRow,
            { key: "leave" },
            e(DFL.ButtonItem, { layout: "below", onClick: () => tap(() => act("Leave", () => leaveVoice())), ...cancelBind(handleCancel) }, "Leave voice · " + voice.name)
          ),
      ]),
    ]);
  } else if (view.page === "devices") {
    const inList = (devices.input || []).filter((d) => !/monitor|loopback|stereo mix/i.test(String(d.name || d.id || "")));
    const outList = devices.output || [];
    body = e("div", { style: FILL }, [
      e(
        DFL.PanelSection,
        { title: "Input" },
        (inList.length ? inList : [{ id: "", name: "No input devices" }]).map((d) =>
          e(
            DFL.PanelSectionRow,
            { key: "i" + d.id },
            e(
              DFL.ButtonItem,
              {
                layout: "below",
                disabled: !d.id,
                onClick: d.id ? () => act("Input", () => setInputDevice(d.id)) : undefined,
                ...cancelBind(handleCancel),
              },
              (d.id && d.id === devices.inputId ? "● " : "") + d.name
            )
          )
        )
      ),
      e(
        DFL.PanelSection,
        { title: "Output" },
        (outList.length ? outList : [{ id: "", name: "No output devices" }]).map((d) =>
          e(
            DFL.PanelSectionRow,
            { key: "o" + d.id },
            e(
              DFL.ButtonItem,
              {
                layout: "below",
                disabled: !d.id,
                onClick: d.id ? () => act("Output", () => setOutputDevice(d.id)) : undefined,
                ...cancelBind(handleCancel),
              },
              (d.id && d.id === devices.outputId ? "● " : "") + d.name
            )
          )
        )
      ),
    ]);
  } else if (view.page === "member") {
    const live = memberById(view.userId) || {};
    const guildId = voice && voice.guildId;
    const volKey = "u" + view.userId;
    const vol = volLocal[volKey] != null ? volLocal[volKey] : live.volume != null ? live.volume : 100;
    body = e(DFL.PanelSection, { title: view.title || "User" }, [
      e(
        DFL.PanelSectionRow,
        { key: "who" },
        e(
          "div",
          { style: { display: "flex", alignItems: "center", gap: 10 } },
          [e(Avatar, { src: view.avatar || live.avatar, name: view.title, size: 40, radius: 20 }), e(Label, null, (view.title || "") + (view.self ? " (you)" : ""))]
        )
      ),
      !view.self &&
        e(
          DFL.PanelSectionRow,
          { key: "vol" },
          e(DFL.SliderField, {
            label: "Volume",
            description: "How loud they are for you",
            value: vol,
            min: 0,
            max: 200,
            step: 5,
            showValue: true,
            valueSuffix: "%",
            onChange: (v) => slideVol(volKey, v, () => setUserVolume(view.userId, v)),
            ...cancelBind(handleCancel),
          })
        ),
      !view.self &&
        e(
          DFL.PanelSectionRow,
          { key: "lm" },
          e(DFL.ToggleField, {
            label: "Mute for me",
            description: "You won't hear them",
            checked: !!live.localMute,
            onChange: () => act("Mute user", () => toggleUserMute(view.userId)),
            ...cancelBind(handleCancel),
          })
        ),
      !view.self &&
        e(
          DFL.PanelSectionRow,
          { key: "solo" },
          e(DFL.ToggleField, {
            label: "Solo this user",
            description: "Hear only them in this call",
            checked: focusedUserId === view.userId,
            onChange: () => {
              if (focusedUserId === view.userId) act("Clear solo", () => clearAudioFocus());
              else act("Solo", () => focusAudio(view.userId));
            },
            ...cancelBind(handleCancel),
          })
        ),
      !view.self &&
        guildId &&
        e(
          DFL.PanelSectionRow,
          { key: "sm" },
          e(
            DFL.ButtonItem,
            {
              layout: "below",
              description: "Server mute (needs permission)",
              onClick: () => act("Server mute", () => setServerMute(guildId, view.userId, !live.muted)),
              ...cancelBind(handleCancel),
            },
            live.muted ? "Unmute on server" : "Mute on server"
          )
        ),
      !view.self &&
        guildId &&
        e(
          DFL.PanelSectionRow,
          { key: "sd" },
          e(
            DFL.ButtonItem,
            {
              layout: "below",
              description: "Server deafen (needs permission)",
              onClick: () => act("Server deafen", () => setServerDeaf(guildId, view.userId, !live.deaf)),
              ...cancelBind(handleCancel),
            },
            live.deaf ? "Undeafen on server" : "Deafen on server"
          )
        ),
      view.self && e(DFL.PanelSectionRow, { key: "self" }, e("div", { style: { opacity: 0.7, fontSize: 13 } }, "This is you. Use Mute / Deafen in Voice.")),
    ]);
  } else if (view.page === "video") {
    body = e(DFL.PanelSection, { title: voice ? "Live · " + voice.name : "Live video" }, [
      e(VideoStack, {
        key: "vids",
        streams: liveStreams,
        frames,
        focusedUserId,
        speakingIds,
        max: 4,
        onFocus: onTileFocus,
        onOpenMember: onTileMember,
      }),
    ].concat(compactVoice));
  }

  const rootProps = {
    className: "deckscord-root",
    style: { ...FILL, paddingBottom: 8 },
  };
  if (canBack) {
    rootProps.onCancelButton = handleCancel;
    rootProps.onCancel = handleCancel;
    rootProps.onCancelActionDescription = "Back";
    rootProps.onButtonDown = handleButtonDown;
  }

  return e(
    BackNav.Provider,
    { value: canBack ? handleCancel : null },
    e(Focusable, rootProps, [
      e(
        "style",
        { key: "css" },
        ".deckscord-root{width:100%!important;max-width:100%!important;overflow-x:hidden;box-sizing:border-box}" +
          ".deckscord-root input,.deckscord-root textarea,.deckscord-root video,.deckscord-root img{max-width:100%}"
      ),
      navHeader,
      voiceSection,
      body,
    ])
  );
}

export default DFL.definePlugin(() => ({
  title: e("div", { className: DFL.staticClasses && DFL.staticClasses.Title }, "Deckscord"),
  content: e(App),
  icon: e("span", { style: { fontSize: 18 } }, "💬"),
}));

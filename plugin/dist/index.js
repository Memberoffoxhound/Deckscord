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
const focusStream = backend("focus_stream");
const clearAudioFocus = backend("clear_audio_focus");
const updateFromGithub = backend("update_from_github");
const getUpdateStatus = backend("get_update_status");
const startGoLive = backend("start_go_live");
const stopGoLive = backend("stop_go_live");
const getSettings = backend("get_settings");
const setPipSettings = backend("set_pip_settings");
const pinPip = backend("pin_pip");
const unpinPip = backend("unpin_pip");
const setVesktopSetting = backend("set_vesktop_setting");
const setDiscordSetting = backend("set_discord_setting");
const setGoLiveQuality = backend("set_golive_quality");
const setTalkingSettings = backend("set_talking_settings");

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

function WatchOverlay({ userId, name, kind, closeModal, onPinned, onClosed }) {
  const onCancel = useContext(BackNav);
  const [jpeg, setJpeg] = useState(null);
  const [hint, setHint] = useState("Starting…");
  const keepAudio = useRef(false);
  useEffect(() => {
    let stop = false;
    (async () => {
      try {
        await focusStream(userId);
      } catch (_) {}
      while (!stop) {
        try {
          const r = await getVideoFrames({ userId: userId, w: 640, h: 360 });
          const frames = (r && r.frames) || [];
          const hit =
            frames.find((f) => f.userId === userId && f.kind === kind) ||
            frames.find((f) => f.userId === userId);
          if (hit && hit.jpeg && !hit.black) {
            setJpeg(hit.jpeg);
            setHint("");
          }
        } catch (_) {}
        await new Promise((res) => setTimeout(res, 160));
      }
    })();
    return () => {
      stop = true;
    };
  }, [userId, kind]);
  const close = () => {
    if (!keepAudio.current) clearAudioFocus().catch(() => {});
    if (onClosed) onClosed();
    if (closeModal) closeModal();
  };
  const pin = () => {
    keepAudio.current = true;
    pinPip(userId, kind || "screenshare", name || "")
      .then(() => {
        if (onPinned) onPinned();
        close();
      })
      .catch(() => {
        keepAudio.current = false;
      });
  };
  const Inner = closeModal && DFL.ModalRoot ? DFL.ModalRoot : "div";
  return e(
    Inner,
    {
      closeModal: close,
      onCancel: close,
      onCancelButton: close,
      bDisableBackgroundDismiss: false,
      ...cancelBind(close),
      style: {
        width: "100%",
        height: "100%",
        background: "#000",
        padding: 0,
        margin: 0,
      },
    },
    [
      jpeg
        ? e("img", {
            key: "v",
            src: jpeg,
            alt: "",
            style: {
              width: "100%",
              height: "100%",
              maxHeight: "90vh",
              objectFit: "contain",
              display: "block",
              background: "#000",
            },
          })
        : e(
            "div",
            {
              key: "ph",
              style: {
                width: "100%",
                minHeight: 240,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#ccc",
              },
            },
            hint || "Waiting for video…"
          ),
      e(
        "div",
        {
          key: "cap",
          style: {
            position: "absolute",
            left: 12,
            bottom: 12,
            color: "#fff",
            fontSize: 14,
            textShadow: "0 1px 4px #000",
            pointerEvents: "none",
          },
        },
        (name || "Stream") + " · game audio · B to close"
      ),
      e(
        DFL.PanelSectionRow,
        { key: "pin" },
        e(
          DFL.ButtonItem,
          {
            layout: "below",
            description: "Keeps a stamp on the game after you close the QAM",
            onClick: pin,
            ...cancelBind(onCancel || close),
          },
          "Pin to corner"
        )
      ),
    ]
  );
}

function VideoTile({ stream, focused, jpeg, speaking, pinned, onOpenMember, onWatch }) {
  const onCancel = useContext(BackNav);
  const go = () => {
    if (stream.self) {
      if (onOpenMember) onOpenMember(stream);
      return;
    }
    if (onWatch) onWatch(stream);
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
        aspectRatio: "16 / 9",
        padding: 0,
        margin: "0 0 6px",
        overflow: "hidden",
        background: "#000",
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
              objectFit: "contain",
              display: "block",
              background: "#000",
            },
          })
        : e("div", {
            key: "ph",
            style: {
              width: "100%",
              height: "100%",
              minHeight: 0,
              aspectRatio: "16 / 9",
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
        pinned ? "📌" : stream.kind === "screenshare" ? "🖥" : "📷"
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

function VideoStack({ streams, frames, focusedUserId, speakingIds, pinnedUserId, max, onOpenMember, onWatch, onMore, onPin, onStop, onUnpin }) {
  const onCancel = useContext(BackNav);
  const list = streams || [];
  const copied = list.slice(0, max);
  const extra = Math.max(0, list.length - copied.length);
  const byKey = {};
  (frames || []).forEach((f) => {
    byKey[f.userId + ":" + (f.kind || "camera")] = f;
  });
  if (!copied.length) return null;
  const focusedStream =
    copied.find((x) => x.userId === focusedUserId) ||
    copied.find((x) => x.userId === pinnedUserId) || {
      userId: focusedUserId || pinnedUserId,
      kind: "screenshare",
      name: "",
    };
  const watching = !!(focusedUserId || pinnedUserId);
  const actions = [];
  if (watching) {
    actions.push(
      e(
        DFL.PanelSectionRow,
        { key: "stop" },
        e(
          DFL.ButtonItem,
          {
            layout: "below",
            description: pinnedUserId ? "Removes the corner stamp and stream audio" : "Mutes stream audio, party voice stays",
            onClick: onStop,
            ...cancelBind(onCancel),
          },
          "Stop watching"
        )
      )
    );
  }
  if (pinnedUserId && onUnpin) {
    actions.push(
      e(
        DFL.PanelSectionRow,
        { key: "unpin" },
        e(
          DFL.ButtonItem,
          {
            layout: "below",
            description: "Keep listening, drop the stamp",
            onClick: onUnpin,
            ...cancelBind(onCancel),
          },
          "Unpin from corner"
        )
      )
    );
  } else if (focusedUserId && onPin) {
    actions.push(
      e(
        DFL.PanelSectionRow,
        { key: "pin" },
        e(
          DFL.ButtonItem,
          {
            layout: "below",
            description: "Keeps a stamp on the game after you close the QAM",
            onClick: () => onPin(focusedStream),
            ...cancelBind(onCancel),
          },
          "Pin to corner"
        )
      )
    );
  }
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
          speaking: !!(speakingIds && speakingIds[s.userId]),
          pinned: pinnedUserId === s.userId,
          onOpenMember,
          onWatch,
        });
      })
      .concat(
        extra
          ? [
              e(Row, { key: "more", onClick: onMore }, e(Label, null, "+" + extra + " more videos")),
            ]
          : []
      )
      .concat(actions)
  );
}

function cycle(list, cur) {
  const i = Math.max(0, list.indexOf(cur));
  return list[(i + 1) % list.length];
}

function SettingsHub({ push, handleCancel }) {
  const items = [
    { page: "settings_pip", title: "Picture in picture", sub: "Corner, stamp size, opacity" },
    { page: "settings_talk", title: "Who's talking", sub: "Names over the game while someone speaks" },
    { page: "settings_voice", title: "Discord · Voice", sub: "Mute, devices, echo / noise" },
    { page: "settings_golive", title: "Discord · Go Live", sub: "Resolution and frame rate" },
    { page: "settings_vesktop_perf", title: "Vesktop · Performance", sub: "Hardware acceleration" },
    { page: "settings_vesktop_audio", title: "Vesktop · Linux audio", sub: "Venmic / screenshare capture" },
    { page: "settings_vesktop_app", title: "Vesktop · App", sub: "Branch, tray, Rich Presence" },
  ];
  return e(
    DFL.PanelSection,
    { title: "Settings" },
    items.map((it) =>
      e(
        Row,
        { key: it.page, onClick: () => push({ page: it.page, title: it.title }) },
        [
          e("div", { key: "t", style: { minWidth: 0, flex: 1, overflow: "hidden" } }, [
            e(Label, null, it.title),
            e(Sub, null, it.sub),
          ]),
        ]
      )
    )
  );
}

function ToggleRow({ label, description, checked, onChange, handleCancel }) {
  return e(
    DFL.PanelSectionRow,
    null,
    e(DFL.ToggleField, {
      label,
      description,
      checked: !!checked,
      onChange,
      ...cancelBind(handleCancel),
    })
  );
}

function CycleRow({ label, value, options, handleCancel, onPick }) {
  const cur = options.find((o) => o.value === value) || options[0];
  return e(
    DFL.PanelSectionRow,
    null,
    e(
      DFL.ButtonItem,
      {
        layout: "below",
        description: cur ? cur.label : String(value),
        onClick: () => onPick(cycle(options.map((o) => o.value), value)),
        ...cancelBind(handleCancel),
      },
      label
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
  const [updateProg, setUpdateProg] = useState(null);
  const [cfg, setCfg] = useState(null);
  const [shareLocal, setShareLocal] = useState(null);
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
      if (s && s.update && s.update.phase && s.update.phase !== "idle") setUpdateProg(s.update);
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

  const updatePhase = updateProg && updateProg.phase;
  useEffect(() => {
    if (!updatePhase || updatePhase === "idle" || updatePhase === "error" || updatePhase === "done") return;
    let stop = false;
    const pull = async () => {
      try {
        const r = await getUpdateStatus();
        if (!stop && r) setUpdateProg(r);
      } catch (_) {
        if (!stop) {
          setUpdateProg((p) => ({
            phase: "restart",
            percent: 96,
            message: "Decky is reloading…",
            ok: true,
            head: (p && p.head) || "",
          }));
        }
      }
    };
    pull();
    const id = setInterval(pull, 280);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [updatePhase]);

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
    const fps = streamCount <= 1 ? 6 : streamCount === 2 ? 5 : 4;
    const id = setInterval(pull, Math.max(180, Math.floor(1000 / fps)));
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [videoOn, streamCount, status && status.voice && status.voice.focusedUserId]);

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

  const streamFlag = !!(status && (status.streaming || (status.stream && status.stream.active) || (status.voice && status.voice.streaming)));
  useEffect(() => {
    setShareLocal((cur) => {
      if (cur == null) return cur;
      if (cur === true && streamFlag) return null;
      if (cur === false && !streamFlag) return null;
      return cur;
    });
  }, [streamFlag]);

  const onSettingsPage = String(view.page || "").indexOf("settings") === 0;
  useEffect(() => {
    if (!onSettingsPage) return;
    let stop = false;
    getSettings()
      .then((r) => {
        if (!stop && r) setCfg(r);
      })
      .catch(() => {});
    return () => {
      stop = true;
    };
  }, [onSettingsPage, view.page, tick]);

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
  const openSettings = () => tap(() => push({ page: "settings", title: "Settings" }));
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
    status && status.capture && (status.capture.loopback || status.capture.silent)
      ? e(
          DFL.PanelSectionRow,
          { key: "loop" },
          e(
            "div",
            { style: { color: "#e4b44c", fontSize: 13, lineHeight: 1.35 } },
            status.capture.silent
              ? "No microphone. Voice is silent so the call does not hear your speakers. Game audio is only sent while Share game is on."
              : "Mic is capturing speaker output. Others will hear your desktop. Plug in a headset or pick a real microphone under Audio."
          )
        )
      : null,
    error ? e(DFL.PanelSectionRow, { key: "err" }, e("div", { style: { color: "#e4b44c", fontSize: 13 } }, error)) : null,
    busy ? e(DFL.PanelSectionRow, { key: "busy" }, e("div", { style: { opacity: 0.7, fontSize: 12 } }, busy + "…")) : null,
    ready &&
      view.page === "home" &&
      e(
        DFL.PanelSectionRow,
        { key: "set" },
        e(
          DFL.ButtonItem,
          {
            layout: "below",
            description: "PiP, Discord voice, Vesktop",
            onClick: openSettings,
            ...cancelBind(handleCancel),
          },
          "Settings"
        )
      ),
    view.page === "home" &&
      e(
        DFL.PanelSectionRow,
        { key: "upd" },
        e(
          DFL.ButtonItem,
          {
            layout: "below",
            disabled: !!(updateProg && updateProg.phase && updateProg.phase !== "idle" && updateProg.phase !== "error" && updateProg.phase !== "done"),
            description: "git pull, copy files, restart Decky",
            onClick: () =>
              tap(() =>
                act("Updating", async () => {
                  const r = await updateFromGithub();
                  if (r && r.ok === false) return r;
                  setUpdateProg(r && r.phase ? r : { phase: "starting", percent: 4, message: "Starting update…" });
                  return { ok: true };
                })
              ),
          },
          "Update from GitHub"
        )
      ),
    view.page === "home" &&
      updateProg &&
      updateProg.phase &&
      updateProg.phase !== "idle" &&
      e(
        DFL.PanelSectionRow,
        { key: "updbar" },
        e(
          "div",
          { style: FILL },
          [
            e(
              "div",
              { key: "m", style: { fontSize: 13, lineHeight: 1.35, marginBottom: 6 } },
              (updateProg.message || updateProg.phase) +
                (updateProg.head ? " · " + updateProg.head : "")
            ),
            DFL.ProgressBar
              ? e(DFL.ProgressBar, {
                  key: "p",
                  nProgress: Math.max(0, Math.min(100, Number(updateProg.percent) || 0)),
                  nTransitionSec: 0.25,
                  focusable: false,
                })
              : e(
                  "div",
                  {
                    key: "p",
                    style: {
                      height: 8,
                      borderRadius: 4,
                      background: "rgba(255,255,255,0.12)",
                      overflow: "hidden",
                    },
                  },
                  e("div", {
                    style: {
                      width: Math.max(0, Math.min(100, Number(updateProg.percent) || 0)) + "%",
                      height: "100%",
                      background: updateProg.ok === false ? "#c44" : "#1a9fff",
                      borderRadius: 4,
                    },
                  })
                ),
            e(
              "div",
              { key: "pct", style: { fontSize: 12, opacity: 0.7, marginTop: 4 } },
              (updateProg.ok === false ? "Failed · " : "") +
                Math.round(Number(updateProg.percent) || 0) +
                "%" +
                (updateProg.phase === "restart" ? " · Decky is reloading" : "")
            ),
          ]
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
  const pip = (status && status.pip) || (cfg && cfg.pip) || {};
  const pipOn = !!(pip.enabled && pip.userId);
  const talking = (status && status.talking) || (cfg && cfg.talking) || {};
  const talkingOn = !!talking.enabled;
  const onWatchStream = (s) => {
    tap(() => act("Watch", () => focusStream(s.userId), { quiet: true }));
    if (typeof DFL.showModal === "function") {
      DFL.showModal(
        e(WatchOverlay, {
          userId: s.userId,
          name: s.name,
          kind: s.kind || "screenshare",
          onPinned: () => refresh(),
        })
      );
    } else {
      push({ page: "watch", userId: s.userId, kind: s.kind || "screenshare", title: s.name || "Watch" });
    }
  };
  const onPinStream = (s) => {
    if (!s || !s.userId) return;
    tap(() =>
      act("Pin", () => pinPip(s.userId, s.kind || "screenshare", s.name || ""), { quiet: false })
    );
  };
  const onUnpinStream = () => tap(() => act("Unpin", () => unpinPip()));
  const onStopWatch = () =>
    tap(() =>
      act("Stop watching", async () => {
        if (pipOn) await unpinPip();
        await clearAudioFocus();
      })
    );
  const onTileMember = (s) => {
    const m = memberById(s.userId) || { id: s.userId, name: s.name, avatar: s.avatar, self: !!s.self };
    openMember(m);
  };

  const streaming = streamFlag || !!(voice && voice.streaming);
  const shareOn = shareLocal == null ? streaming : shareLocal;
  const sharePending = !!(status && status.stream && status.stream.pending) || (shareOn && !streaming);
  const compactVoice = [
    voice
      ? e(
          DFL.PanelSectionRow,
          { key: "share" },
          e(DFL.ToggleField, {
            label: "Share game",
            description: shareOn
              ? sharePending
                ? "Starting… game audio only for viewers"
                : "Live · 720p 30 · viewers hear game audio, voice stays on your mic"
              : "720p 30 · game screen + game audio for stream viewers only",
            checked: shareOn,
            onChange: () =>
              tap(() => {
                if (shareOn) {
                  setShareLocal(false);
                  act("Stop share", () => stopGoLive());
                } else {
                  setShareLocal(true);
                  act("Share game", async () => {
                    const r = await startGoLive(
                      (cfg && cfg.golive && cfg.golive.width) || 1280,
                      (cfg && cfg.golive && cfg.golive.height) || 720,
                      (cfg && cfg.golive && cfg.golive.fps) || 30
                    );
                    if (r && r.ok === false) setShareLocal(false);
                    return r;
                  });
                }
              }),
            ...cancelBind(handleCancel),
          })
        )
      : null,
    voice
      ? e(
          DFL.PanelSectionRow,
          { key: "talk" },
          e(DFL.ToggleField, {
            label: "Who's talking",
            description: talkingOn ? (talking.corner || "top-left") + " · over the game" : "Off",
            checked: talkingOn,
            onChange: (v) => tap(() => act("Talking overlay", () => setTalkingSettings(v))),
            ...cancelBind(handleCancel),
          })
        )
      : null,
    pipOn
      ? e(
          DFL.PanelSectionRow,
          { key: "unpin" },
          e(
            DFL.ButtonItem,
            {
              layout: "below",
              description: (pip.name || "Stream") + " · " + (pip.size || "small") + " · " + (pip.corner || "bottom-right"),
              onClick: () => tap(() => act("Unpin", () => unpinPip())),
              ...cancelBind(handleCancel),
            },
            "Unpin PiP"
          )
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
        pinnedUserId: pipOn ? pip.userId : null,
        max: 3,
        onOpenMember: onTileMember,
        onWatch: onWatchStream,
        onMore: openVideoPage,
        onPin: onPinStream,
        onStop: onStopWatch,
        onUnpin: onUnpinStream,
      })
    : null;

  const showVoicePanel =
    ready &&
    view.page !== "chat" &&
    view.page !== "member" &&
    view.page !== "video" &&
    String(view.page || "").indexOf("settings") !== 0;
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
    const inList = (devices.input || []).filter((d) => !/monitor|loopback|stereo mix|vencord-screen-share|venmic|screen-?share|desktop audio|system audio|chromium|^default$/i.test(String(d.name || d.id || "")));
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
        pinnedUserId: pipOn ? pip.userId : null,
        max: 4,
        onOpenMember: onTileMember,
        onWatch: onWatchStream,
        onPin: onPinStream,
        onStop: onStopWatch,
        onUnpin: onUnpinStream,
      }),
    ].concat(compactVoice));
  } else if (view.page === "watch") {
    const ws = liveStreams.find((s) => s.userId === view.userId) || { userId: view.userId, name: view.title, kind: view.kind };
    body = e(
      "div",
      { style: { ...FILL, background: "#000", position: "relative", minHeight: 240 } },
      [
        e(WatchOverlay, {
          userId: view.userId,
          name: ws.name || view.title,
          kind: ws.kind || view.kind || "screenshare",
          onPinned: () => {
            refresh();
            back();
          },
        }),
      ]
    );
  } else if (view.page === "settings") {
    body = e(SettingsHub, { push, handleCancel });
  } else if (String(view.page || "").indexOf("settings_") === 0) {
    const ves = (cfg && cfg.vesktop) || {};
    const audio = ves.audio || {};
    const disc = (cfg && cfg.discord) || {};
    const golive = (cfg && cfg.golive) || { height: 720, fps: 30 };
    const pipCfg = (cfg && cfg.pip) || pip || {};
    const talkCfg = (cfg && cfg.talking) || talking || {};
    const reload = () =>
      getSettings()
        .then((r) => {
          if (r) setCfg(r);
        })
        .catch(() => {});
    const setVk = (key, value) =>
      act("Setting", async () => {
        const r = await setVesktopSetting(key, value);
        await reload();
        return r;
      });
    const setDs = (key, value) =>
      act("Setting", async () => {
        const r = await setDiscordSetting(key, value);
        await reload();
        return r;
      });
    let kids = [];
    if (view.page === "settings_pip") {
      kids = [
        e(
          DFL.PanelSectionRow,
          { key: "h" },
          e(
            "div",
            { style: { fontSize: 13, lineHeight: 1.35, opacity: 0.85 } },
            "Pin a live tile to a corner over the game. Small is 240p, large is 480p, both clamped to the screen height so a Deck and a 4K TV stay usable. Opacity is compositor alpha — no extra encode."
          )
        ),
        e(
          CycleRow,
          {
            key: "sz",
            label: "Stamp size",
            value: pipCfg.size || "small",
            options: [
              { value: "small", label: "Small · 240p" },
              { value: "large", label: "Large · 480p" },
            ],
            handleCancel,
            onPick: (v) =>
              act("PiP", async () => {
                const r = await setPipSettings(pipCfg.corner, v, pipCfg.opacity);
                await reload();
                return r;
              }),
          }
        ),
        e(
          CycleRow,
          {
            key: "cr",
            label: "Corner",
            value: pipCfg.corner || "bottom-right",
            options: [
              { value: "top-left", label: "Top left" },
              { value: "top-right", label: "Top right" },
              { value: "bottom-left", label: "Bottom left" },
              { value: "bottom-right", label: "Bottom right" },
            ],
            handleCancel,
            onPick: (v) =>
              act("PiP", async () => {
                const r = await setPipSettings(v, pipCfg.size, pipCfg.opacity);
                await reload();
                return r;
              }),
          }
        ),
        e(
          DFL.PanelSectionRow,
          { key: "op" },
          e(DFL.SliderField, {
            label: "Opacity",
            value: pipCfg.opacity != null ? pipCfg.opacity : 100,
            min: 20,
            max: 100,
            step: 5,
            showValue: true,
            valueSuffix: "%",
            onChange: (v) =>
              slideVol("pipop", v, () => setPipSettings(pipCfg.corner, pipCfg.size, v).then(reload)),
            ...cancelBind(handleCancel),
          })
        ),
        pipOn
          ? e(
              DFL.PanelSectionRow,
              { key: "un" },
              e(
                DFL.ButtonItem,
                {
                  layout: "below",
                  onClick: () => tap(() => act("Unpin", () => unpinPip().then(reload))),
                  ...cancelBind(handleCancel),
                },
                "Unpin " + (pipCfg.name || "stream")
              )
            )
          : e(
              DFL.PanelSectionRow,
              { key: "n" },
              e("div", { style: { opacity: 0.7, fontSize: 13 } }, "Focus a live tile, then Pin. The stamp stays after you close the QAM.")
            ),
      ];
    } else if (view.page === "settings_talk") {
      kids = [
        e(
          DFL.PanelSectionRow,
          { key: "h" },
          e(
            "div",
            { style: { fontSize: 13, lineHeight: 1.35, opacity: 0.85 } },
            "While you are in a call, a name and avatar appear over the game only when that person is speaking. Nothing is drawn when the channel is quiet. Same cheap overlay plane as PiP — no extra video encode."
          )
        ),
        e(ToggleRow, {
          key: "en",
          label: "Show who's talking",
          description: "Over Game Mode, not the QAM",
          checked: !!talkCfg.enabled,
          onChange: (v) =>
            act("Talking overlay", async () => {
              const r = await setTalkingSettings(v);
              await reload();
              return r;
            }),
          handleCancel,
        }),
        e(
          CycleRow,
          {
            key: "cr",
            label: "Corner",
            value: talkCfg.corner || "top-left",
            options: [
              { value: "top-left", label: "Top left" },
              { value: "top-right", label: "Top right" },
              { value: "bottom-left", label: "Bottom left" },
              { value: "bottom-right", label: "Bottom right" },
            ],
            handleCancel,
            onPick: (v) =>
              act("Talking overlay", async () => {
                const r = await setTalkingSettings({
                  enabled: !!talkCfg.enabled,
                  corner: v,
                  size: talkCfg.size,
                  opacity: talkCfg.opacity,
                  showSelf: talkCfg.showSelf,
                });
                await reload();
                return r;
              }),
          }
        ),
        e(
          CycleRow,
          {
            key: "sz",
            label: "Size",
            value: talkCfg.size || "small",
            options: [
              { value: "small", label: "Small" },
              { value: "large", label: "Large" },
            ],
            handleCancel,
            onPick: (v) =>
              act("Talking overlay", async () => {
                const r = await setTalkingSettings({
                  enabled: !!talkCfg.enabled,
                  corner: talkCfg.corner,
                  size: v,
                  opacity: talkCfg.opacity,
                  showSelf: talkCfg.showSelf,
                });
                await reload();
                return r;
              }),
          }
        ),
        e(
          DFL.PanelSectionRow,
          { key: "op" },
          e(DFL.SliderField, {
            label: "Opacity",
            value: talkCfg.opacity != null ? talkCfg.opacity : 90,
            min: 20,
            max: 100,
            step: 5,
            showValue: true,
            valueSuffix: "%",
            onChange: (v) =>
              slideVol("talkop", v, () =>
                setTalkingSettings({
                  enabled: !!talkCfg.enabled,
                  corner: talkCfg.corner,
                  size: talkCfg.size,
                  opacity: v,
                  showSelf: talkCfg.showSelf,
                }).then(reload)
              ),
            ...cancelBind(handleCancel),
          })
        ),
        e(ToggleRow, {
          key: "me",
          label: "Show me",
          description: "Include your name when you talk",
          checked: talkCfg.showSelf !== false,
          onChange: (v) =>
            act("Talking overlay", async () => {
              const r = await setTalkingSettings({
                enabled: talkCfg.enabled,
                corner: talkCfg.corner,
                size: talkCfg.size,
                opacity: talkCfg.opacity,
                showSelf: v,
              });
              await reload();
              return r;
            }),
          handleCancel,
        }),
      ];
    } else if (view.page === "settings_voice") {
      kids = [
        e(ToggleRow, {
          key: "m",
          label: "Mute",
          description: "Microphone",
          checked: !!(status && status.muted),
          onChange: () => tap(() => act("Mute", () => toggleMute())),
          handleCancel,
        }),
        e(ToggleRow, {
          key: "d",
          label: "Deafen",
          description: "Speakers and microphone",
          checked: !!(status && status.deafened),
          onChange: () => tap(() => act("Deafen", () => toggleDeafen())),
          handleCancel,
        }),
        e(
          DFL.PanelSectionRow,
          { key: "dev" },
          e(DFL.ButtonItem, { layout: "below", onClick: openDevices, ...cancelBind(handleCancel) }, "Input / output devices")
        ),
        e(ToggleRow, {
          key: "ec",
          label: "Echo cancellation",
          description: disc.echoCancellation == null ? "Discord did not expose this flag" : "MediaEngine",
          checked: !!disc.echoCancellation,
          onChange: (v) => setDs("echoCancellation", v),
          handleCancel,
        }),
        e(ToggleRow, {
          key: "ns",
          label: "Noise suppression",
          checked: !!disc.noiseSuppression,
          onChange: (v) => setDs("noiseSuppression", v),
          handleCancel,
        }),
        e(ToggleRow, {
          key: "nc",
          label: "Noise cancellation",
          description: "Krisp if Discord has it",
          checked: !!disc.noiseCancellation,
          onChange: (v) => setDs("noiseCancellation", v),
          handleCancel,
        }),
        e(ToggleRow, {
          key: "agc",
          label: "Automatic gain",
          checked: !!disc.automaticGainControl,
          onChange: (v) => setDs("automaticGainControl", v),
          handleCancel,
        }),
      ];
    } else if (view.page === "settings_golive") {
      kids = [
        e(
          DFL.PanelSectionRow,
          { key: "h" },
          e(
            "div",
            { style: { fontSize: 13, lineHeight: 1.35, opacity: 0.85 } },
            "Outbound Share game uses Discord’s encoder. 720p30 is the handheld default. 1080p needs Nitro on the watching side."
          )
        ),
        e(
          CycleRow,
          {
            key: "res",
            label: "Resolution",
            value: String(golive.height || 720),
            options: [
              { value: "720", label: "720p" },
              { value: "1080", label: "1080p" },
            ],
            handleCancel,
            onPick: (v) =>
              act("Go Live", async () => {
                const r = await setGoLiveQuality(Number(v), golive.fps || 30);
                await reload();
                return r;
              }),
          }
        ),
        e(
          CycleRow,
          {
            key: "fps",
            label: "Frame rate",
            value: String(golive.fps || 30),
            options: [
              { value: "15", label: "15 fps" },
              { value: "30", label: "30 fps" },
            ],
            handleCancel,
            onPick: (v) =>
              act("Go Live", async () => {
                const r = await setGoLiveQuality(golive.height || 720, Number(v));
                await reload();
                return r;
              }),
          }
        ),
      ];
    } else if (view.page === "settings_vesktop_perf") {
      kids = [
        e(
          DFL.PanelSectionRow,
          { key: "n" },
          e("div", { style: { fontSize: 13, lineHeight: 1.35, opacity: 0.85 } }, "Written to Vesktop settings.json. Hardware acceleration needs a Vesktop restart.")
        ),
        e(ToggleRow, {
          key: "ha",
          label: "Hardware acceleration",
          description: "Restart Vesktop after changing",
          checked: ves.hardwareAcceleration !== false,
          onChange: (v) => setVk("hardwareAcceleration", v),
          handleCancel,
        }),
        e(ToggleRow, {
          key: "hva",
          label: "Video hardware acceleration",
          description: "Helps screenshare; can glitch streams",
          checked: !!ves.hardwareVideoAcceleration,
          onChange: (v) => setVk("hardwareVideoAcceleration", v),
          handleCancel,
        }),
        e(ToggleRow, {
          key: "ss",
          label: "Disable smooth scrolling",
          checked: !!ves.disableSmoothScroll,
          onChange: (v) => setVk("disableSmoothScroll", v),
          handleCancel,
        }),
      ];
    } else if (view.page === "settings_vesktop_audio") {
      kids = [
        e(
          DFL.PanelSectionRow,
          { key: "n" },
          e(
            "div",
            { style: { fontSize: 13, lineHeight: 1.35, opacity: 0.85 } },
            "Vesktop venmic flags for Linux screenshare audio. Deckscord still refuses speaker-monitor as the voice mic."
          )
        ),
        e(ToggleRow, {
          key: "w",
          label: "Microphone workaround",
          description: "Only if share sends mic instead of game audio",
          checked: !!audio.workaround,
          onChange: (v) => setVk("audio.workaround", v),
          handleCancel,
        }),
        e(ToggleRow, {
          key: "iim",
          label: "Ignore input media",
          description: "Do not capture microphones into the share",
          checked: audio.ignoreInputMedia !== false,
          onChange: (v) => setVk("audio.ignoreInputMedia", v),
          handleCancel,
        }),
        e(ToggleRow, {
          key: "iv",
          label: "Ignore virtual nodes",
          checked: !!audio.ignoreVirtual,
          onChange: (v) => setVk("audio.ignoreVirtual", v),
          handleCancel,
        }),
        e(ToggleRow, {
          key: "id",
          label: "Ignore devices",
          description: "Skip hardware speaker/mic nodes",
          checked: audio.ignoreDevices !== false,
          onChange: (v) => setVk("audio.ignoreDevices", v),
          handleCancel,
        }),
        e(ToggleRow, {
          key: "gs",
          label: "Granular selection",
          checked: !!audio.granularSelect,
          onChange: (v) => setVk("audio.granularSelect", v),
          handleCancel,
        }),
        e(ToggleRow, {
          key: "ds",
          label: "Device selection",
          description: "Requires Ignore devices off",
          checked: !!audio.deviceSelect,
          onChange: (v) => setVk("audio.deviceSelect", v),
          handleCancel,
        }),
        e(ToggleRow, {
          key: "os",
          label: "Only speakers",
          checked: audio.onlySpeakers !== false,
          onChange: (v) => setVk("audio.onlySpeakers", v),
          handleCancel,
        }),
        e(ToggleRow, {
          key: "ods",
          label: "Only default speakers",
          checked: audio.onlyDefaultSpeakers !== false,
          onChange: (v) => setVk("audio.onlyDefaultSpeakers", v),
          handleCancel,
        }),
      ];
    } else if (view.page === "settings_vesktop_app") {
      kids = [
        e(
          CycleRow,
          {
            key: "br",
            label: "Discord branch",
            value: ves.discordBranch || "stable",
            options: [
              { value: "stable", label: "Stable" },
              { value: "canary", label: "Canary" },
              { value: "ptb", label: "PTB" },
            ],
            handleCancel,
            onPick: (v) => setVk("discordBranch", v),
          }
        ),
        e(ToggleRow, {
          key: "tr",
          label: "Tray icon",
          checked: ves.tray !== false,
          onChange: (v) => setVk("tray", v),
          handleCancel,
        }),
        e(ToggleRow, {
          key: "mt",
          label: "Minimize to tray",
          checked: ves.minimizeToTray !== false,
          onChange: (v) => setVk("minimizeToTray", v),
          handleCancel,
        }),
        e(ToggleRow, {
          key: "ct",
          label: "Hide/show on tray click",
          checked: !!ves.clickTrayToShowHide,
          onChange: (v) => setVk("clickTrayToShowHide", v),
          handleCancel,
        }),
        e(ToggleRow, {
          key: "rpc",
          label: "Rich Presence (arRPC)",
          checked: ves.arRPC !== false,
          onChange: (v) => setVk("arRPC", v),
          handleCancel,
        }),
        e(ToggleRow, {
          key: "ol",
          label: "Open links in app",
          checked: !!ves.openLinksWithElectron,
          onChange: (v) => setVk("openLinksWithElectron", v),
          handleCancel,
        }),
        e(ToggleRow, {
          key: "nt",
          label: "Native titlebar",
          description: "Restart Vesktop",
          checked: !!ves.nativeTitleBar,
          onChange: (v) => setVk("nativeTitleBar", v),
          handleCancel,
        }),
        e(ToggleRow, {
          key: "st",
          label: "Static title",
          checked: !!ves.staticTitle,
          onChange: (v) => setVk("staticTitle", v),
          handleCancel,
        }),
        e(ToggleRow, {
          key: "em",
          label: "Enable menu bar",
          checked: !!ves.enableMenu,
          onChange: (v) => setVk("enableMenu", v),
          handleCancel,
        }),
        e(ToggleRow, {
          key: "sp",
          label: "Splash screen",
          checked: ves.enableSplashScreen !== false,
          onChange: (v) => setVk("enableSplashScreen", v),
          handleCancel,
        }),
        e(
          CycleRow,
          {
            key: "webrtc",
            label: "WebRTC IP handling",
            value: ves.webRTCIPHandlingPolicy || "default",
            options: [
              { value: "default", label: "Default" },
              { value: "default_public_interface_only", label: "Public interface only" },
              { value: "default_public_and_private_interfaces", label: "Public and private" },
              { value: "disable_non_proxied_udp", label: "Disable non-proxied UDP" },
            ],
            handleCancel,
            onPick: (v) => setVk("webRTCIPHandlingPolicy", v),
          }
        ),
      ];
    }
    body = e(DFL.PanelSection, { title: view.title || "Settings" }, kids);
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

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

const callable = (name) => {
  if (api && api.callable) return api.callable(name);
  return async (...args) => {
    if (window.DeckyPluginLoader && window.DeckyPluginLoader.callServerMethod) {
      return window.DeckyPluginLoader.callServerMethod(name, { args });
    }
    throw new Error("Decky backend API missing");
  };
};

const getStatus = callable("get_status");
const joinVoice = callable("join_voice");
const leaveVoice = callable("leave_voice");
const toggleMute = callable("toggle_mute");
const toggleDeafen = callable("toggle_deafen");
const selectText = callable("select_text");
const getMessages = callable("get_messages");
const sendMessage = callable("send_message");
const startVesktop = callable("start_vesktop");

const e = window.SP_REACT.createElement;
const { useState, useEffect, useCallback } = window.SP_REACT;

function App() {
  const [tab, setTab] = useState("voice");
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [guildId, setGuildId] = useState(null);
  const [textId, setTextId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [dmMode, setDmMode] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const s = await getStatus();
      setStatus(s);
      if (s && s.error) setError(s.error);
      else setError("");
    } catch (err) {
      setError(String(err && err.message ? err.message : err));
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 2500);
    return () => clearInterval(id);
  }, [refresh]);

  useEffect(() => {
    if (tab !== "text" || !textId) return;
    let stop = false;
    const pull = async () => {
      try {
        const r = await getMessages(textId, 40);
        if (!stop && r && r.ok) setMessages(r.messages || []);
      } catch (_) {}
    };
    pull();
    const id = setInterval(pull, 3000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [tab, textId]);

  const act = async (label, fn) => {
    setBusy(label);
    setError("");
    try {
      const r = await fn();
      if (r && r.ok === false) setError(r.error || label + " failed");
      await refresh();
    } catch (err) {
      setError(String(err && err.message ? err.message : err));
    }
    setBusy("");
  };

  const loggedIn = !!(status && status.logged_in);
  const userName = (status && status.user && (status.user.name || status.user.username)) || "";
  const voice = (status && status.voice) || null;
  const guilds = (status && status.guilds) || [];
  const dms = (status && status.dms) || [];
  const guild = guilds.find((g) => g.id === guildId) || guilds[0];
  const currentGuildId = guild ? guild.id : null;

  const tabBar = e("div", { style: { display: "flex", gap: "8px", marginBottom: "8px" } }, [
    e(
      DFL.ButtonItem,
      { key: "tv", layout: "below", onClick: () => setTab("voice") },
      tab === "voice" ? "● Voice" : "Voice"
    ),
    e(
      DFL.ButtonItem,
      { key: "tt", layout: "below", onClick: () => setTab("text") },
      tab === "text" ? "● Text" : "Text"
    ),
  ]);

  const statusLine = e("div", {
    style: { opacity: 0.85, fontSize: "13px", marginBottom: "8px", lineHeight: 1.35 },
  }, [
    !status && "Connecting…",
    status && !status.vesktop_running && "Vesktop is not running.",
    status && status.vesktop_running && !loggedIn && "Open Vesktop and log into Discord once. Session is saved after that.",
    loggedIn && `${userName}${status.muted ? "  ·  muted" : ""}${status.deafened ? "  ·  deafened" : ""}${voice ? "  ·  " + voice.name : "  ·  not in voice"}`,
    error && e("div", { key: "err", style: { color: "#ff8b8b", marginTop: 4 } }, error),
    busy && e("div", { key: "busy", style: { opacity: 0.7 } }, busy + "…"),
  ]);

  const startRow = (!status || !status.vesktop_running || !loggedIn)
    ? e(DFL.PanelSectionRow, null,
        e(DFL.ButtonItem, { layout: "below", onClick: () => act("Starting Discord", () => startVesktop()) }, "Start Discord")
      )
    : null;

  let body = null;

  if (tab === "voice") {
    const memberList = (voice && voice.members && voice.members.length)
      ? voice.members.map((m) =>
          e("div", { key: m.id, style: { padding: "4px 0", opacity: m.self ? 1 : 0.9 } },
            `${m.self ? "● " : "○ "}${m.name}${m.muted ? " (muted)" : ""}${m.deaf ? " (deaf)" : ""}`)
        )
      : e("div", { style: { opacity: 0.6 } }, "No one in voice.");

    const voiceBtns = e(DFL.PanelSectionRow, null, e("div", { style: { display: "flex", flexDirection: "column", gap: 4, width: "100%" } }, [
      e(DFL.ButtonItem, { layout: "below", onClick: () => act("Mute", () => toggleMute()) }, status && status.muted ? "Unmute" : "Mute"),
      e(DFL.ButtonItem, { layout: "below", onClick: () => act("Deafen", () => toggleDeafen()) }, status && status.deafened ? "Undeafen" : "Deafen"),
      e(DFL.ButtonItem, { layout: "below", disabled: !voice, onClick: () => act("Leave", () => leaveVoice()) }, "Leave voice"),
    ]));

    const serverBtns = guilds.slice(0, 24).map((g) =>
      e(DFL.ButtonItem, {
        key: g.id,
        layout: "below",
        onClick: () => { setGuildId(g.id); setDmMode(false); },
      }, (currentGuildId === g.id ? "● " : "") + g.name)
    );

    const channels = ((guild && guild.voice) || []).map((c) =>
      e(DFL.ButtonItem, {
        key: c.id,
        layout: "below",
        onClick: () => act("Join " + c.name, () => joinVoice(c.id, c.name)),
      }, (voice && voice.channelId === c.id ? "● " : "# ") + c.name)
    );

    body = e("div", null, [
      e(DFL.PanelSection, { title: voice ? ("In voice · " + voice.name) : "In voice" }, [
        voiceBtns,
        e(DFL.PanelSectionRow, null, e("div", { style: { width: "100%" } }, memberList)),
      ]),
      e(DFL.PanelSection, { title: "Servers" }, serverBtns.length ? serverBtns.map((b, i) => e(DFL.PanelSectionRow, { key: "s" + i }, b)) : e(DFL.PanelSectionRow, null, e("div", { style: { opacity: 0.6 } }, "No servers yet."))),
      e(DFL.PanelSection, { title: guild ? (guild.name + " · voice") : "Voice channels" },
        channels.length ? channels.map((b, i) => e(DFL.PanelSectionRow, { key: "v" + i }, b)) : e(DFL.PanelSectionRow, null, e("div", { style: { opacity: 0.6 } }, "Pick a server."))
      ),
    ]);
  } else {
    const serverBtns = [
      e(DFL.ButtonItem, { key: "dms", layout: "below", onClick: () => { setDmMode(true); setGuildId(null); } }, (dmMode ? "● " : "") + "Direct messages"),
    ].concat(guilds.slice(0, 24).map((g) =>
      e(DFL.ButtonItem, {
        key: g.id,
        layout: "below",
        onClick: () => { setGuildId(g.id); setDmMode(false); },
      }, (!dmMode && currentGuildId === g.id ? "● " : "") + g.name)
    ));

    const textChans = dmMode ? dms : ((guild && guild.text) || []);
    const chanBtns = textChans.map((c) =>
      e(DFL.ButtonItem, {
        key: c.id,
        layout: "below",
        onClick: () => {
          setTextId(c.id);
          act("Open " + c.name, () => selectText(c.id));
        },
      }, (textId === c.id ? "● " : "# ") + c.name)
    );

    const msgView = e("div", {
      style: {
        maxHeight: 220,
        overflow: "auto",
        background: "rgba(0,0,0,0.25)",
        borderRadius: 6,
        padding: 8,
        fontSize: 13,
        lineHeight: 1.35,
        width: "100%",
      },
    }, (messages.length ? messages : [{ id: "empty", author: "", content: textId ? "No messages loaded yet." : "Pick a channel." }]).map((m) =>
      e("div", { key: m.id, style: { marginBottom: 8 } }, [
        m.author && e("div", { style: { fontWeight: 600, opacity: 0.9 } }, m.author),
        e("div", { style: { opacity: 0.95, whiteSpace: "pre-wrap" } }, m.content || (m.author ? "(attachment / embed)" : "")),
      ])
    ));

    const composer = e("div", { style: { width: "100%" } }, [
      DFL.TextField
        ? e(DFL.TextField, {
            label: "Message",
            value: draft,
            onChange: (v) => setDraft(typeof v === "string" ? v : (v && v.target && v.target.value) || ""),
          })
        : e("input", {
            value: draft,
            onChange: (ev) => setDraft(ev.target.value),
            placeholder: "Message…",
            style: { width: "100%", padding: 8, background: "#111", color: "#fff", border: "1px solid #333", borderRadius: 4 },
          }),
      e(DFL.ButtonItem, {
        layout: "below",
        disabled: !textId || !draft.trim(),
        onClick: () => {
          const c = draft;
          setDraft("");
          act("Send", () => sendMessage(textId, c));
        },
      }, "Send"),
    ]);

    body = e("div", null, [
      e(DFL.PanelSection, { title: "Servers & DMs" }, serverBtns.map((b, i) => e(DFL.PanelSectionRow, { key: "t" + i }, b))),
      e(DFL.PanelSection, { title: dmMode ? "Direct messages" : (guild ? guild.name + " · text" : "Text channels") },
        chanBtns.length ? chanBtns.map((b, i) => e(DFL.PanelSectionRow, { key: "c" + i }, b)) : e(DFL.PanelSectionRow, null, e("div", { style: { opacity: 0.6 } }, "Nothing here."))
      ),
      e(DFL.PanelSection, { title: "Chat" }, [
        e(DFL.PanelSectionRow, null, msgView),
        e(DFL.PanelSectionRow, null, composer),
      ]),
    ]);
  }

  return e("div", null, [
    e(DFL.PanelSection, { title: "Deckscord" }, [
      e(DFL.PanelSectionRow, null, statusLine),
      e(DFL.PanelSectionRow, null, tabBar),
      startRow,
    ]),
    body,
  ]);
}

export default DFL.definePlugin(() => ({
  title: e("div", { className: DFL.staticClasses && DFL.staticClasses.Title }, "Deckscord"),
  content: e(App),
  icon: e("span", { style: { fontSize: 18 } }, "💬"),
}));

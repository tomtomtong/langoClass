// Same event names the classroom used with Socket.IO, over one WebSocket per room.
// Unlike Socket.IO, io() cannot connect until it knows the room: the first
// emit with a roomId connects, or call socket.connect(roomId) before waiting
// for "connect".
(function () {
  // The room Durable Object answers "ping" with "pong" without waking up
  // (setWebSocketAutoResponse), so a silent drop is caught cheaply.
  const HEARTBEAT_MS = 20000;
  const PONG_WAIT_MS = 8000;
  const RETRY_MIN_MS = 1000;
  const RETRY_MAX_MS = 10000;

  function pinOf(value) {
    const pin = String(value || "").replace(/\D/g, "").slice(0, 6);
    return pin.length === 6 ? pin : "";
  }

  function createSocket() {
    let ws = null;
    let roomId = "";
    let connected = false;
    let manual = false;
    let reconnectTimer = null;
    let openedOnce = false;
    let retries = 0;
    let heartbeatTimer = null;
    let pongTimer = null;
    let nextId = 1;
    // id -> { fn, sent }. Acks for frames that reached a dead socket never
    // arrive; those fail on close. Queued frames wait for the next socket.
    const pending = new Map();
    const queue = [];
    const listeners = new Map();

    function add(event, fn, once) {
      const list = listeners.get(event) || [];
      list.push({ fn, once: !!once });
      listeners.set(event, list);
    }

    function fire(event, data) {
      const list = listeners.get(event) || [];
      const keep = [];
      for (const item of list) {
        try {
          item.fn(data);
        } catch {
          /* a listener should not break the socket */
        }
        if (!item.once) keep.push(item);
      }
      listeners.set(event, keep);
    }

    function markSent(message) {
      const entry = pending.get(message.id);
      if (entry) entry.sent = true;
    }

    function send(message) {
      if (connected && ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
        markSent(message);
      } else queue.push(message);
    }

    function flush() {
      while (queue.length && connected) {
        const message = queue.shift();
        ws.send(JSON.stringify(message));
        markSent(message);
      }
    }

    function failSentAcks() {
      for (const [id, entry] of pending) {
        if (!entry.sent) continue;
        pending.delete(id);
        try {
          entry.fn({ ok: false, errorCode: "disconnected", error: "Connection lost. Please try again." });
        } catch {
          /* a callback should not break the socket */
        }
      }
    }

    function stopHeartbeat() {
      clearInterval(heartbeatTimer);
      clearTimeout(pongTimer);
      heartbeatTimer = null;
      pongTimer = null;
    }

    function ping() {
      if (!connected || !ws || ws.readyState !== WebSocket.OPEN || pongTimer) return;
      try {
        ws.send("ping");
      } catch {
        return;
      }
      pongTimer = setTimeout(() => {
        pongTimer = null;
        dropSocket();
      }, PONG_WAIT_MS);
    }

    // Any frame proves the socket is alive.
    function heard() {
      clearTimeout(pongTimer);
      pongTimer = null;
    }

    function scheduleReconnect() {
      if (manual || !roomId) return;
      clearTimeout(reconnectTimer);
      const base = Math.min(RETRY_MAX_MS, RETRY_MIN_MS * 2 ** retries);
      retries += 1;
      // Jitter spreads a whole class reconnecting after a deploy.
      const delay = base / 2 + Math.random() * (base / 2);
      reconnectTimer = setTimeout(() => connect(roomId), delay);
    }

    function handleClosed() {
      const wasConnected = connected;
      connected = false;
      stopHeartbeat();
      failSentAcks();
      if (wasConnected) fire("disconnect");
      scheduleReconnect();
    }

    // A socket can look open while the network under it is gone (wifi
    // switch, NAT timeout); close() would then wait on a handshake that never
    // comes, so detach it and move on.
    function dropSocket() {
      if (!ws) return;
      const dead = ws;
      dead.onopen = dead.onclose = dead.onerror = dead.onmessage = null;
      try { dead.close(); } catch { /* already closed */ }
      ws = null;
      handleClosed();
    }

    // Phone unlock or network back: retry now instead of waiting out the
    // backoff, and check a socket that may have died while asleep.
    function wake() {
      if (manual || !roomId) return;
      if (connected) {
        ping();
        return;
      }
      if (ws && ws.readyState === WebSocket.CONNECTING) return;
      clearTimeout(reconnectTimer);
      retries = 0;
      connect(roomId);
    }

    window.addEventListener("online", wake);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") wake();
    });

    function connect(nextRoom) {
      const pin = pinOf(nextRoom);
      if (!pin) {
        fire("connect_error", { message: "Missing room code." });
        return;
      }
      if (ws && roomId === pin && (connected || ws.readyState === WebSocket.CONNECTING)) return;
      manual = false;
      roomId = pin;
      clearTimeout(reconnectTimer);
      if (ws) {
        ws.onopen = ws.onclose = ws.onerror = ws.onmessage = null;
        try { ws.close(); } catch { /* already closed */ }
        if (connected) {
          connected = false;
          stopHeartbeat();
          failSentAcks();
          fire("disconnect");
        }
      }
      const url = new URL(`/api/room/${pin}/ws`, window.location.href);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      ws = new WebSocket(url.toString());
      ws.onopen = () => {
        connected = true;
        retries = 0;
        stopHeartbeat();
        heartbeatTimer = setInterval(ping, HEARTBEAT_MS);
        const again = openedOnce;
        openedOnce = true;
        fire("connect");
        if (again) fire("reconnect");
        flush();
      };
      ws.onerror = () => {
        if (!connected) fire("connect_error", { message: "Could not connect to class server." });
      };
      ws.onclose = () => {
        ws = null;
        handleClosed();
      };
      ws.onmessage = (event) => {
        heard();
        if (event.data === "pong") return;
        let message;
        try {
          message = JSON.parse(event.data);
        } catch {
          return;
        }
        if (message.t === "ack") {
          const entry = pending.get(message.id);
          pending.delete(message.id);
          if (entry) entry.fn(message.data);
          return;
        }
        if (message.t === "event") fire(message.event, message.data);
      };
    }

    const socket = {
      get connected() {
        return connected;
      },
      io: {
        on(event, fn) {
          add(event, fn, false);
        },
      },
      connect(room) {
        connect(room || roomId);
        return socket;
      },
      on(event, fn) {
        add(event, fn, false);
        return socket;
      },
      once(event, fn) {
        add(event, fn, true);
        return socket;
      },
      off(event, fn) {
        const list = listeners.get(event) || [];
        listeners.set(event, fn ? list.filter((item) => item.fn !== fn) : []);
        return socket;
      },
      emit(event, data, ack) {
        let payload = data;
        let callback = ack;
        if (typeof data === "function") {
          callback = data;
          payload = {};
        }
        payload = payload && typeof payload === "object" ? payload : {};
        const target = pinOf(payload.roomId || payload.pin) || roomId;
        if (!connected) connect(target);
        const id = nextId++;
        if (typeof callback === "function") pending.set(id, { fn: callback, sent: false });
        send({ t: "emit", id, event, data: payload });
        return socket;
      },
      disconnect() {
        manual = true;
        clearTimeout(reconnectTimer);
        stopHeartbeat();
        connected = false;
        if (ws) ws.close();
      },
    };
    return socket;
  }

  window.io = function io() {
    return createSocket();
  };
})();

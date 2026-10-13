// Same event names the classroom used with Socket.IO, over one WebSocket per room.
(function () {
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
    let nextId = 1;
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

    function send(message) {
      if (connected && ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
      else queue.push(message);
    }

    function flush() {
      while (queue.length && connected) {
        const message = queue.shift();
        ws.send(JSON.stringify(message));
      }
    }

    function connect(nextRoom) {
      const pin = pinOf(nextRoom);
      if (!pin) {
        fire("connect_error", { message: "Missing room code." });
        return;
      }
      if (ws && roomId === pin && (connected || ws.readyState === WebSocket.CONNECTING)) return;
      manual = false;
      roomId = pin;
      if (ws) {
        ws.onclose = null;
        try { ws.close(); } catch { /* already closed */ }
      }
      const url = new URL(`/api/room/${pin}/ws`, window.location.href);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      ws = new WebSocket(url.toString());
      ws.onopen = () => {
        connected = true;
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
        connected = false;
        fire("disconnect");
        if (!manual) reconnectTimer = setTimeout(() => connect(roomId), 1000);
      };
      ws.onmessage = (event) => {
        let message;
        try {
          message = JSON.parse(event.data);
        } catch {
          return;
        }
        if (message.t === "ack") {
          const fn = pending.get(message.id);
          pending.delete(message.id);
          if (fn) fn(message.data);
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
        if (typeof callback === "function") pending.set(id, callback);
        send({ t: "emit", id, event, data: payload });
        return socket;
      },
      disconnect() {
        manual = true;
        if (reconnectTimer) clearTimeout(reconnectTimer);
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

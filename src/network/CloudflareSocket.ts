import { EventEmitter } from "events";

/** The event surface used by Session; payloads remain compatible with the legacy app. */
export default class CloudflareSocket {
  id = "";
  connected = false;
  sendBuffer: unknown[] = [];
  io = new EventEmitter();
  volatile = {
    emit: (event: string, ...args: any[]) => {
      if (this.connected) this.emit(event, ...args);
    },
  };
  private events = new EventEmitter();
  private ws?: WebSocket;
  private stopped = false;
  private joinedOnce = false;
  private retry?: ReturnType<typeof setTimeout>;
  private game?: any[];
  constructor(private url: string) {}
  on(event: string, handler: (...args: any[]) => void) {
    this.events.on(event, handler);
    return this;
  }
  off(event: string, handler: (...args: any[]) => void) {
    this.events.off(event, handler);
    return this;
  }
  emit(event: string, ...args: any[]) {
    if (event === "join_game") {
      const changed = this.game?.[0] !== args[0];
      const retryAuth = this.stopped;
      this.game = args;
      this.stopped = false;
      if (!this.ws || this.ws.readyState > 1 || changed || retryAuth) {
        this.open();
        return this;
      }
    }
    if (this.ws?.readyState === WebSocket.OPEN)
      this.ws.send(JSON.stringify({ event, args }));
    return this;
  }
  private open() {
    if (this.retry) clearTimeout(this.retry);
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
    }
    const url = new URL("/ws", this.url);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.searchParams.set("room", this.game![0]);
    const ws = (this.ws = new WebSocket(url.toString()));
    ws.onmessage = ({ data }) => {
      const { event, args } = JSON.parse(data);
      if (event === "hello") {
        this.id = args[0];
        this.connected = true;
        this.events.emit("connect");
        ws.send(JSON.stringify({ event: "join_game", args: this.game }));
      } else {
        if (event === "auth_error") this.stopped = true;
        if (event === "joined_game") this.joinedOnce = true;
        this.events.emit(event, ...args);
      }
    };
    ws.onclose = () => {
      this.connected = false;
      if (this.stopped) return;
      this.events.emit("disconnect");
      this.retry = setTimeout(
        () => {
          // Session destroys stale peers on disconnect; rejoin on the new socket.
          this.open();
        },
        this.joinedOnce ? 1500 : 3000,
      );
    };
    ws.onerror = () => ws.close();
  }
  disconnect() {
    this.stopped = true;
    if (this.retry) clearTimeout(this.retry);
    this.ws?.close();
    this.connected = false;
    return this;
  }
}

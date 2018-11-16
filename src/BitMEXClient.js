const crypto = require("crypto");
const debug = require("debug")("bitmex-orderbook");
const WebSocket = require("ws");

class BitMEXClient {
  constructor({ socket, endpoint, apiKey, apiSecret, testmode, heartbeat, ...socketOptions } = {}) {
    this.socketOptions = socketOptions;
    this.socket = socket || null;
    this.connected = this.socket && this.socket.readyState === WebSocket.OPEN;
    this.apiKey = apiKey || null;
    this.apiSecret = apiSecret || null;
    this.testmode = testmode === true || testmode === "true";
    this.endpoint =
      endpoint ||
      (this.testmode ? "wss://testnet.bitmex.com/realtime" : "wss://www.bitmex.com/realtime");
    this.heartbeat = heartbeat || 15 * 1000;
    this.subscriptions = new Set();
    this.lastError = null;
  }

  async open() {
    return new Promise((resolve, reject) => {
      let client = this;
      let heartbeatInterval;

      async function connectionCheck() {
        client.connected = client.socket.readyState === WebSocket.OPEN;

        if(!client.connected)
            return;

        debug("Connection opened");
        heartbeatInterval = setInterval(() => client.ping(), client.heartbeat);

        if (client.apiKey && client.apiSecret) {
          const nonce = Date.now();
          const signature = crypto
            .createHmac("sha256", client.apiSecret)
            .update(`GET/realtime${nonce}`)
            .digest("hex");
          await client.sendMessage({ op: "authKey", args: [client.apiKey, nonce, signature] });
        }

        client.subscriptions.forEach(symbol => client.subscribe(symbol));
        return resolve(true);
      }

      if (!client.socket) {
        client.socket = new WebSocket(client.endpoint, client.socketOptions);
      }

      client.socket.on("open", connectionCheck);

      client.socket.on("close", () => {
        debug("Connection closed");
        clearInterval(heartbeatInterval);
        if (!client.connected) {
          return reject(client.lastError);
        }
        client.connected = false;
      });

      client.socket.on("error", err => {
        debug("Connection error:", err);
        client.lastError = err;
      });
    });
  }

  async ping() {
    return new Promise((resolve, reject) =>
      this.socket.send("ping", {}, (err, res) => {
        err ? reject(err) : resolve(res);
      }),
    );
  }

  async subscribe(symbol, table = "orderBookL2") {
    this.subscriptions.add(symbol);

    return this.sendMessage({ op: "subscribe", args: `${table}:${symbol}` });
  }

  async unsubscribe(symbol, table = "orderBookL2") {
    this.subscriptions.delete(symbol);

    return this.sendMessage({ op: "unsubscribe", args: `${table}:${symbol}` });
  }

  async sendMessage(data) {
    debug("Sending:", data);
    const json = JSON.stringify(data);

    return new Promise((resolve, reject) =>
      this.socket.send(json, {}, (err, res) => {
        err ? reject(err) : resolve(res);
      }),
    );
  }
}

module.exports = BitMEXClient;

const status = document.querySelector("#status");
const list = document.querySelector("#messages");
const form = document.querySelector("#composer");
const author = document.querySelector("#author");
const body = document.querySelector("#body");
const error = document.querySelector("#error");
const verification = document.querySelector("#verification");

const savedAuthor = localStorage.getItem("dab-chat-author");
author.value = savedAuthor ?? "";

let socket;
let widgetId;

function joinChat() {
  verification.hidden = true;
  list.hidden = false;
  form.hidden = false;
  status.textContent = "Connecting";
  connect();
}

async function verify(token) {
  const response = await fetch("/chat/verify", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token })
  });
  if (!response.ok) {
    error.textContent = "Verification failed. Please try again.";
    error.hidden = false;
    window.turnstile.reset(widgetId);
    return;
  }
  joinChat();
}

async function renderTurnstile() {
  const response = await fetch("/chat/config", { cache: "no-store" });
  const config = await response.json();
  if (config.verified) {
    joinChat();
    return;
  }
  while (typeof window.turnstile?.render !== "function") {
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  widgetId = window.turnstile.render("#turnstile-widget", {
    sitekey: config.turnstileSiteKey,
    action: "chat",
    callback: verify,
    "error-callback": () => {
      error.textContent = "Verification could not start. Please refresh and try again.";
      error.hidden = false;
    }
  });
}

function connect() {
  socket = new WebSocket(
    `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/chat/ws`
  );
  socket.addEventListener("open", () => {
    status.textContent = "Connected";
    status.className = "connected";
  });
  socket.addEventListener("close", () => {
    status.textContent = "Disconnected";
    status.className = "";
  });
  socket.addEventListener("message", event => {
    const message = JSON.parse(event.data);
    if (message.type === "error") {
      error.textContent = message.message;
      error.hidden = false;
      return;
    }
    if (message.type === "messages") {
      if (!author.value && message.author) author.value = message.author;
      error.hidden = true;
      list.replaceChildren(...message.messages.map(renderMessage));
      list.scrollTop = list.scrollHeight;
    }
  });
}

form.addEventListener("submit", event => {
  event.preventDefault();
  if (socket.readyState !== WebSocket.OPEN) return;
  localStorage.setItem("dab-chat-author", author.value.trim());
  socket.send(JSON.stringify({
    type: "send",
    author: author.value,
    body: body.value
  }));
  body.value = "";
  body.focus();
});

function renderMessage(message) {
  const item = document.createElement("li");
  const heading = document.createElement("div");
  const name = document.createElement("strong");
  const time = document.createElement("time");
  const text = document.createElement("p");

  name.textContent = message.author;
  time.textContent = new Date(message.createdAt).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit"
  });
  time.dateTime = message.createdAt;
  text.textContent = message.body;
  heading.append(name, time);
  item.append(heading, text);
  return item;
}

renderTurnstile().catch(() => {
  error.textContent = "Verification could not load. Please refresh and try again.";
  error.hidden = false;
});

const status = document.querySelector("#status");
const list = document.querySelector("#messages");
const form = document.querySelector("#composer");
const author = document.querySelector("#author");
const body = document.querySelector("#body");
const error = document.querySelector("#error");

const savedAuthor = localStorage.getItem("dab-chat-author");
author.value = savedAuthor ?? "";

let socket;
function connect() {
  socket = new WebSocket(
    `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/chat/ws`
  );
  socket.addEventListener("open", () => {
    status.textContent = "Connected";
    status.className = "connected";
  });
  socket.addEventListener("close", () => {
    status.textContent = "Reconnecting";
    status.className = "";
    setTimeout(connect, 1000);
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

connect();

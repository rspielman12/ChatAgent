
document.addEventListener("DOMContentLoaded", function () {
  document.getElementById("chat-form").addEventListener("submit", async function(e) {
    e.preventDefault();

    const input = document.getElementById("user-input");
    const question = input.value.trim();
    if (!question) return;

    const product = document.getElementById("product-select").value;
    const conversationId = getConversationId();
    const metadata = getUserMetadata();

    appendUserMessage(question);
    input.value = "";

    await streamChat(question, conversationId, metadata, product);
  });

  function getConversationId() {
    let id = sessionStorage.getItem("conversationId");
    if (!id) {
      id = crypto.randomUUID();
      sessionStorage.setItem("conversationId", id);
    }
    return id;
  }

  function getUserMetadata() {
    return {
      name: "Web User",
      email: "",
      referrer: document.referrer || window.location.href
    };
  }

  function appendUserMessage(message) {
    const chatHistory = document.getElementById("chat-history");
    const userDiv = document.createElement("div");
    userDiv.className = "message user";
    userDiv.innerText = message;
    chatHistory.appendChild(userDiv);
    chatHistory.scrollTop = chatHistory.scrollHeight;
  }
});

async function streamChat(question, conversationId, metadata, product) {
  const chatHistory = document.getElementById("chat-history");
  const typingDiv = document.createElement("div");
  typingDiv.className = "typing";
  typingDiv.innerText = "Agent is typing...";
  chatHistory.appendChild(typingDiv);
  chatHistory.scrollTop = chatHistory.scrollHeight;

  const payload = {
    question: `${product}: ${question}`,
    conversationId,
    metadata,
    context_items: 5,
    human_escalation: false,
    followup_rating: true,
    document_retriever: true,
    full_source: true,
    stream: true
  };

  const response = await fetch(`https://api.docsbot.ai/teams/my4YXyYm6SQ5ewtD75RN/bots/wxepOdO8DrIY3Hgszjip/chat-agent`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    typingDiv.remove();
    const errorDiv = document.createElement("div");
    errorDiv.className = "message bot";
    errorDiv.innerText = "Error streaming response.";
    chatHistory.appendChild(errorDiv);
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");

  let answer = "";
  let streamingDiv = null;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    const lines = chunk.split("\n");

    for (let line of lines) {
      if (line.startsWith("event:")) {
        var eventType = line.replace("event:", "").trim();
      }

      if (eventType === "stream" && line.startsWith("data:")) {
        const token = line.replace("data:", "").trim();
        answer += token;

        if (!streamingDiv) {
          streamingDiv = document.createElement("div");
          streamingDiv.className = "message bot";
          chatHistory.appendChild(streamingDiv);
          streamingDiv.textContent = token + " ";
        } else {
          streamingDiv.textContent += token + " ";
        }

        streamingDiv.innerHTML = DOMPurify.sanitize(marked.parse(streamingDiv.textContent));
        chatHistory.scrollTop = chatHistory.scrollHeight;
      }

      if (line.startsWith("data:") && eventType !== "stream") {
        try {
          const jsonData = JSON.parse(line.replace("data:", "").trim());

          if (jsonData?.answer) {
            typingDiv.remove();
            if (streamingDiv) {
              chatTranscript.push({ sender: 'bot', text: streamingDiv.textContent });
            }
          }
        } catch (err) {
          console.warn("Failed to parse JSON chunk", err);
        }
      }
    }
  }
}

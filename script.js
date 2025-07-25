const teamId = 'my4YXyYm6SQ5ewtD75RN';
const botId = 'wxepOdO8DrIY3Hgszjip';
const chatEndpoint = `https://api.docsbot.ai/teams/${teamId}/bots/${botId}/chat-agent`;

let conversationId = getOrCreateConversationId();
let chatTranscript = [];
const chatHistory = document.getElementById('chat-history');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const newChatBtn = document.getElementById('new-chat-btn');
const exportBtn = document.getElementById('export-btn');
const productSelect = document.getElementById('product-select');
const imageInput = document.getElementById('image-input');
const imagePreview = document.getElementById('image-preview');
const attachBtn = document.getElementById('attach-btn');

let selectedImageURLs = [];

function getOrCreateConversationId() {
  const stored = localStorage.getItem('conversationId');
  const timestamp = localStorage.getItem('conversationTimestamp');
  const now = Date.now();
  const twelveHours = 12 * 60 * 60 * 1000;

  if (!stored || !timestamp || now - timestamp > twelveHours) {
    const newId = crypto.randomUUID();
    localStorage.setItem('conversationId', newId);
    localStorage.setItem('conversationTimestamp', now);
    return newId;
  }

  return stored;
}

function resetConversation() {
  localStorage.removeItem('conversationId');
  localStorage.removeItem('conversationTimestamp');
  conversationId = getOrCreateConversationId();
  chatHistory.innerHTML = '';
  chatTranscript = [];
}

function appendMessage(text, sender = 'bot') {
  const div = document.createElement('div');
  div.className = `message ${sender}`;
  const html = marked.parse(text);
  div.innerHTML = DOMPurify.sanitize(html);
  chatHistory.appendChild(div);
  chatHistory.scrollTop = chatHistory.scrollHeight;

  chatTranscript.push({ sender, text });
}

function showTyping() {
  const typing = document.createElement('div');
  typing.className = 'typing';
  typing.id = 'typing';
  typing.textContent = 'Agent is typing...';
  chatHistory.appendChild(typing);
  chatHistory.scrollTop = chatHistory.scrollHeight;
}

function removeTyping() {
  const typing = document.getElementById('typing');
  if (typing) typing.remove();
}

chatForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const message = chatInput.value.trim();
  const product = productSelect.value;
  if (!message && selectedImageURLs.length === 0) return;

  const fullMessage = `[Product: ${product}] ${message}`;
  appendMessage(message, 'user');
  chatTranscript.push({ sender: 'user', text: fullMessage });

  selectedImageURLs.forEach(url => appendMessage(`<img src="${url}" />`, 'user'));
  chatInput.value = '';
  imagePreview.innerHTML = '';
  const image_urls = selectedImageURLs.slice();
  selectedImageURLs = [];

  const body = {
    conversationId,
    question: fullMessage,
    metadata: {
      name: 'John Doe',
      email: 'john@example.com',
      referrer: document.referrer
    },
    document_retriever: true,
    followup_rating: true,
    full_source: true,
    stream: true,
    image_urls
  };

  showTyping();

  const eventSource = new EventSourcePolyfill(chatEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    payload: JSON.stringify(body)
  });

  let answer = '';
  let streamingDiv = null;

  eventSource.onmessage = (event) => {
    if (event.data === '[DONE]') {
      removeTyping();
      eventSource.close();
      chatTranscript.push({ sender: 'bot', text: answer });
      return;
    }

    try {
      const parsed = JSON.parse(event.data);
      const eventType = parsed.event;
      const data = parsed.data;

      if ((eventType === 'answer' || eventType === 'lookup_answer') && data.answer) {
        answer += data.answer;

        if (!streamingDiv) {
          streamingDiv = document.createElement('div');
          streamingDiv.className = 'message bot';
          streamingDiv.id = 'streaming';
          chatHistory.appendChild(streamingDiv);
        }

        streamingDiv.innerHTML = DOMPurify.sanitize(marked.parse(answer));
        chatHistory.scrollTop = chatHistory.scrollHeight;
      }
    } catch (err) {
      console.error('Streaming JSON parse error:', err);
    }
  };

  eventSource.onerror = (err) => {
    removeTyping();
    console.error('Stream error:', err);
    appendMessage('[Error streaming response]', 'bot');
    eventSource.close();
  };
});

newChatBtn.addEventListener('click', resetConversation);

exportBtn.addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(chatTranscript, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'chat-transcript.json';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
});

attachBtn.addEventListener('click', () => imageInput.click());

imageInput.addEventListener('change', async (e) => {
  const files = Array.from(e.target.files);
  for (let file of files) {
    const url = await uploadImage(file);
    selectedImageURLs.push(url);
    renderImagePreview(url);
  }
  e.target.value = '';
});

function renderImagePreview(url) {
  const img = document.createElement('img');
  img.src = url;
  imagePreview.appendChild(img);
}

async function uploadImage(file) {
  return URL.createObjectURL(file);
}

chatForm.addEventListener('dragover', (e) => e.preventDefault());
chatForm.addEventListener('drop', async (e) => {
  e.preventDefault();
  const files = Array.from(e.dataTransfer.files);
  for (let file of files) {
    if (file.type.startsWith('image/')) {
      const url = await uploadImage(file);
      selectedImageURLs.push(url);
      renderImagePreview(url);
    }
  }
});

// Configuration
const CONFIG = {
  teamId: 'my4YXyYm6SQ5ewtD75RN',
  botId: 'wxepOdO8DrIY3Hgszjip',
  maxFileSize: 5 * 1024 * 1024,          // 5 MB
  conversationTimeout: 12 * 60 * 60 * 1000 // 12 hours
};
const chatEndpoint = `https://api.docsbot.ai/teams/${CONFIG.teamId}/bots/${CONFIG.botId}/chat-agent`;

// State
let conversationId = getOrCreateConversationId();
let chatTranscript = [];
let selectedFiles = [];
let isStreaming = false;

// Cached DOM elements
const elements = {
  chatHistory:   document.getElementById('chat-history'),
  chatForm:      document.getElementById('chat-form'),
  chatInput:     document.getElementById('chat-input'),
  sendBtn:       document.getElementById('send-btn'),
  newChatBtn:    document.getElementById('new-chat-btn'),
  exportBtn:     document.getElementById('export-btn'),
  productSelect: document.getElementById('product-select'),
  imageInput:    document.getElementById('image-input'),
  imagePreview:  document.getElementById('image-preview'),
  attachBtn:     document.getElementById('attach-btn'),
};

// Utility: File → data-URI
function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

// Conversation ID management
function getOrCreateConversationId() {
  try {
    const stored = localStorage.getItem('conversationId');
    const ts     = localStorage.getItem('conversationTimestamp');
    const now    = Date.now();
    if (!stored || !ts || now - parseInt(ts) > CONFIG.conversationTimeout) {
      const id = crypto.randomUUID();
      localStorage.setItem('conversationId', id);
      localStorage.setItem('conversationTimestamp', now.toString());
      return id;
    }
    return stored;
  } catch {
    return crypto.randomUUID();
  }
}

function resetConversation() {
  try {
    localStorage.removeItem('conversationId');
    localStorage.removeItem('conversationTimestamp');
  } catch {}
  conversationId = getOrCreateConversationId();
  elements.chatHistory.innerHTML = '';
  chatTranscript = [];
  clearSelectedFiles();
  appendMessage("👋 Hello! I'm here to help you with your questions. What would you like to know?", 'bot');
}

// DOM Helpers (appendMessage, appendImage, etc.)
function appendMessage(content, sender = 'bot', sources = null) {
  const div = document.createElement('div');
  div.className = `message ${sender}`;
  if (sender === 'bot') {
    div.innerHTML = DOMPurify.sanitize(marked.parse(content));
    if (sources?.length) {
      const src = document.createElement('div');
      src.className = 'sources';
      src.innerHTML = '<h4>Sources:</h4>' +
        sources.map(s => `<div><a href="${s.url}" target="_blank">${s.title}</a></div>`).join('');
      div.appendChild(src);
    }
  } else {
    div.textContent = content;
  }
  elements.chatHistory.appendChild(div);
  scrollToBottom();
  chatTranscript.push({
    sender,
    content,
    timestamp: new Date().toISOString(),
    ...(sources && { sources })
  });
}

function appendImage(url, sender = 'user') {
  const div = document.createElement('div');
  div.className = `message ${sender}`;
  const img = document.createElement('img');
  img.src = url;
  img.alt = 'Uploaded image';
  div.appendChild(img);
  elements.chatHistory.appendChild(div);
  scrollToBottom();
}

function showTyping() {
  removeTyping();
  const t = document.createElement('div');
  t.id = 'typing-indicator';
  t.className = 'typing';
  t.textContent = '🤖 Agent is thinking...';
  elements.chatHistory.appendChild(t);
  scrollToBottom();
}

function removeTyping() {
  const t = document.getElementById('typing-indicator');
  if (t) t.remove();
}

function scrollToBottom() {
  elements.chatHistory.scrollTop = elements.chatHistory.scrollHeight;
}

function showError(message) {
  const e = document.createElement('div');
  e.className = 'error-message';
  e.textContent = `Error: ${message}`;
  elements.chatHistory.appendChild(e);
  scrollToBottom();
}

// Streaming implementation (fixed eventType scoping)
async function streamChat(requestBody) {
  const res = await fetch(chatEndpoint, {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify(requestBody)
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Request failed (${res.status}): ${txt}`);
  }

  const reader = res.body.getReader();
  const dec    = new TextDecoder();
  let buffer = '', currentAnswer = '', streamingDiv = null;

  // Helper to dispatch each logical SSE event:
  function handleEvent(type, data) {
    if (type === 'stream' && data.answer != null) {
      // first token: remove typing indicator & create bubble
      if (!streamingDiv) {
        removeTyping();
        streamingDiv = document.createElement('div');
        streamingDiv.className = 'message bot';
        elements.chatHistory.appendChild(streamingDiv);
      }
      currentAnswer += data.answer;
      streamingDiv.innerHTML = DOMPurify.sanitize(marked.parse(currentAnswer));
      scrollToBottom();
    }
    else if (type === 'lookup_answer' && data.answer) {
      // final answer + sources
      if (streamingDiv) {
        streamingDiv.innerHTML = DOMPurify.sanitize(marked.parse(data.answer));
        if (data.sources?.length) {
          const srcDiv = document.createElement('div');
          srcDiv.className = 'sources';
          srcDiv.innerHTML = '<h4>📚 Sources:</h4>' +
            data.sources.map(s => `<div><a href="${s.url}" target="_blank">${s.title}</a></div>`).join('');
          streamingDiv.appendChild(srcDiv);
        }
      } else {
        appendMessage(data.answer, 'bot', data.sources);
      }
      chatTranscript.push({ sender:'bot', content:data.answer, timestamp:new Date().toISOString(), ...(data.sources && {sources:data.sources}) });
      scrollToBottom();
    }
    else if (type === 'answer' && data.answer) {
      appendMessage(data.answer, 'bot');
    }
    else if (type === 'is_resolved_question' && data.answer) {
      appendMessage(data.answer, 'bot');
      if (data.options) {
        const optDiv = document.createElement('div');
        optDiv.className = 'message bot';
        optDiv.innerHTML = `
          <div style="display:flex;gap:10px;margin-top:10px;">
            <button onclick="sendQuickReply('${data.options.yes}')">${data.options.yes}</button>
            <button onclick="sendQuickReply('${data.options.no}')">${data.options.no}</button>
          </div>`;
        elements.chatHistory.appendChild(optDiv);
        scrollToBottom();
      }
    }
  }

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += dec.decode(value, {stream:true});

      // split off complete events; leave partial in buffer
      const parts = buffer.split('\n\n');
      buffer = parts.pop();

      for (const block of parts) {
        const lines = block.split('\n');
        let eventType = 'message';
        let rawData = '';

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            eventType = line.slice(7).trim();
          }
          else if (line.startsWith('data: ')) {
            rawData += line.slice(6) + '\n';
          }
        }

        rawData = rawData.trim();
        if (rawData === '[DONE]') {
          removeTyping();
          return;
        }

        // try JSON, fallback to plain-text answer
        let data;
        try {
          data = JSON.parse(rawData);
        } catch {
          data = { answer: rawData };
        }

        handleEvent(eventType, data);
      }
    }
  } finally {
    removeTyping();
    isStreaming = false;
    updateSendButton();
  }
}

// Image file handling (validateFile, addSelectedFile, etc.)
// ... (unchanged, same as before) ...

function validateFile(file) {
  if (!file.type.startsWith('image/')) {
    throw new Error('Only image files are supported');
  }
  if (file.size > CONFIG.maxFileSize) {
    throw new Error(`File size must be less than ${CONFIG.maxFileSize/1024/1024}MB`);
  }
  return true;
}

function addSelectedFile(file) {
  try {
    validateFile(file);
    const fileObj = {
      file,
      url: URL.createObjectURL(file),
      id: crypto.randomUUID()
    };
    selectedFiles.push(fileObj);
    renderImagePreview();
  } catch (err) {
    showError(err.message);
  }
}

function removeSelectedFile(id) {
  const idx = selectedFiles.findIndex(f => f.id === id);
  if (idx !== -1) {
    URL.revokeObjectURL(selectedFiles[idx].url);
    selectedFiles.splice(idx, 1);
    renderImagePreview();
  }
}

function clearSelectedFiles() {
  selectedFiles.forEach(f => URL.revokeObjectURL(f.url));
  selectedFiles = [];
  renderImagePreview();
}

function renderImagePreview() {
  elements.imagePreview.innerHTML = '';
  selectedFiles.forEach(f => {
    const container = document.createElement('div');
    container.className = 'image-preview-item';
    const img = document.createElement('img');
    img.src = f.url;
    img.alt = f.file.name;
    const btn = document.createElement('button');
    btn.className = 'remove-image';
    btn.textContent = '×';
    btn.onclick = () => removeSelectedFile(f.id);
    container.append(img, btn);
    elements.imagePreview.appendChild(container);
  });
}

// Send‐button & export helpers
function updateSendButton() {
  const hasContent = elements.chatInput.value.trim() || selectedFiles.length > 0;
  elements.sendBtn.disabled = isStreaming || !hasContent;
  elements.sendBtn.textContent = isStreaming ? 'Sending...' : 'Send';
}

function exportTranscript() {
  const data = {
    conversationId,
    timestamp: new Date().toISOString(),
    product: elements.productSelect.value,
    messages: chatTranscript
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `chat-transcript-${new Date().toISOString().split('T')[0]}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Event Listeners
elements.chatForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  // ** Validate product selection **
  const product = elements.productSelect.value;
  if (!product) {
    showError('Please select a product before sending your message.');
    return;
  }

  const message = elements.chatInput.value.trim();
  if (!message && selectedFiles.length === 0) return;
  if (isStreaming) return;

  const fullMessage = message
    ? `[Product: ${product}] ${message}`
    : `[Product: ${product}] [Image uploaded]`;

  // show user message & preview
  if (message) appendMessage(message, 'user');
  selectedFiles.forEach(f => appendImage(f.url, 'user'));
  elements.chatInput.value = '';

  // convert files → base64 data‐URIs
  let imageUrls = null;
  if (selectedFiles.length) {
    try {
      imageUrls = await Promise.all(
        selectedFiles.map(f => fileToDataUrl(f.file))
      );
    } catch {
      showError('Could not read one of the images');
      return;
    }
  }

  // clear preview & array
  clearSelectedFiles();

  const requestBody = {
    conversationId,
    question: fullMessage,
    metadata: {
      name: 'User',
      email: 'user@example.com',
      referrer: document.referrer || window.location.href
    },
    document_retriever: true,
    followup_rating: true,
    full_source: true,
    stream: true,
    image_urls: imageUrls && imageUrls.length ? imageUrls : null
  };

  isStreaming = true;
  updateSendButton();
  showTyping();
  try {
    await streamChat(requestBody);
  } catch (err) {
    console.error(err);
    removeTyping();
    showError(err.message);
  }
});

elements.newChatBtn.addEventListener('click', () => {
  if (confirm('Start a new conversation? This will clear the current chat.')) {
    resetConversation();
  }
});
elements.exportBtn.addEventListener('click', exportTranscript);
elements.attachBtn.addEventListener('click', () => elements.imageInput.click());
elements.imageInput.addEventListener('change', e => {
  Array.from(e.target.files).forEach(addSelectedFile);
  e.target.value = '';
});
elements.chatInput.addEventListener('input', updateSendButton);
elements.chatForm.addEventListener('dragover', e => e.preventDefault());
elements.chatForm.addEventListener('drop', e => {
  e.preventDefault();
  Array.from(e.dataTransfer.files)
    .filter(f => f.type.startsWith('image/'))
    .forEach(addSelectedFile);
});
elements.chatInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    elements.chatForm.dispatchEvent(new Event('submit'));
  }
});

// Initialization
updateSendButton();
appendMessage("👋 Hello! I'm here to help you with your questions. What would you like to know?", 'bot');
window.addEventListener('beforeunload', () => {
  selectedFiles.forEach(f => URL.revokeObjectURL(f.url));
});

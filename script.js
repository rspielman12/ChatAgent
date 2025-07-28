// Configuration
const CONFIG = {
  teamId: 'my4YXyYm6SQ5ewtD75RN',
  botId: 'wxepOdO8DrIY3Hgszjip',
  maxFileSize: 5 * 1024 * 1024,
  conversationTimeout: 12 * 60 * 60 * 1000,
};
const chatEndpoint = `https://api.docsbot.ai/teams/${CONFIG.teamId}/bots/${CONFIG.botId}/chat-agent`;

// State
let conversationId = getOrCreateConversationId();
let chatTranscript = [];
let selectedFiles = [];
let isStreaming = false;

// Elements
const elements = {
  chatHistory: document.getElementById('chat-history'),
  chatForm: document.getElementById('chat-form'),
  chatInput: document.getElementById('chat-input'),
  sendBtn: document.getElementById('send-btn'),
  newChatBtn: document.getElementById('new-chat-btn'),
  exportBtn: document.getElementById('export-btn'),
  productSelect: document.getElementById('product-select'),
  imageInput: document.getElementById('image-input'),
  imagePreview: document.getElementById('image-preview'),
  attachBtn: document.getElementById('attach-btn'),
};

function getOrCreateConversationId() {
  try {
    const stored = localStorage.getItem('conversationId');
    const timestamp = localStorage.getItem('conversationTimestamp');
    const now = Date.now();
    if (!stored || !timestamp || now - parseInt(timestamp) > CONFIG.conversationTimeout) {
      const newId = crypto.randomUUID();
      localStorage.setItem('conversationId', newId);
      localStorage.setItem('conversationTimestamp', now.toString());
      return newId;
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
  appendMessage("Hello! How can I help you today?", 'bot');
}

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
  chatTranscript.push({ sender, content, timestamp: new Date().toISOString(), ...(sources && { sources }) });
}

function appendImage(url, sender = 'user') {
  const div = document.createElement('div');
  div.className = `message ${sender}`;
  const img = document.createElement('img');
  img.src = url;
  div.appendChild(img);
  elements.chatHistory.appendChild(div);
  scrollToBottom();
}

function showTyping() {
  removeTyping();
  const t = document.createElement('div');
  t.className = 'typing';
  t.id = 'typing-indicator';
  t.textContent = '🤖 Agent is responding...';
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

function showError(msg) {
  const e = document.createElement('div');
  e.className = 'error-message';
  e.textContent = `Error: ${msg}`;
  elements.chatHistory.appendChild(e);
  scrollToBottom();
}

// ===== Revised streamChat =====
async function streamChat(requestBody) {
  const res = await fetch(chatEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody)
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Request failed (${res.status}): ${txt}`);
  }

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buffer = '', currentAnswer = '', streamingDiv = null;

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += dec.decode(value, { stream: true });

      // Split lines, keep incomplete tail
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      // Hoist eventType & dataObj
      let eventType = 'message';
      let dataObj = null;

      for (const line of lines) {
        if (!line.trim()) continue;
        if (line.startsWith('event: ')) {
          eventType = line.slice(7).trim();
          continue;
        }
        if (line.startsWith('data: ')) {
          const jsonStr = line.slice(6).trim();
          if (jsonStr === '[DONE]') return;
          try { dataObj = JSON.parse(jsonStr); }
          catch (e) { console.warn('Invalid SSE JSON', jsonStr); continue; }

          if (eventType === 'stream' && dataObj.answer) {
            currentAnswer += dataObj.answer;
            if (!streamingDiv) {
              removeTyping();
              streamingDiv = document.createElement('div');
              streamingDiv.className = 'message bot';
              elements.chatHistory.appendChild(streamingDiv);
            }
            streamingDiv.innerHTML = DOMPurify.sanitize(marked.parse(currentAnswer));
            scrollToBottom();
          }
          else if (eventType === 'lookup_answer' && dataObj.answer) {
            if (streamingDiv) {
              streamingDiv.innerHTML = DOMPurify.sanitize(marked.parse(dataObj.answer));
              if (dataObj.sources?.length) {
                const srcDiv = document.createElement('div');
                srcDiv.className = 'sources';
                srcDiv.innerHTML = '<h4>📚 Sources:</h4>' +
                  dataObj.sources.map(s => `<div><a href="${s.url}" target="_blank">${s.title}</a></div>`).join('');
                streamingDiv.appendChild(srcDiv);
              }
            } else {
              appendMessage(dataObj.answer, 'bot', dataObj.sources);
            }
            chatTranscript.push({
              sender: 'bot',
              content: dataObj.answer,
              timestamp: new Date().toISOString(),
              ...(dataObj.sources && { sources: dataObj.sources })
            });
            scrollToBottom();
          }
          else if (eventType === 'answer' && dataObj.answer) {
            appendMessage(dataObj.answer, 'bot');
          }
          else if (eventType === 'is_resolved_question' && dataObj.answer) {
            appendMessage(dataObj.answer, 'bot');
            if (dataObj.options) {
              const optDiv = document.createElement('div');
              optDiv.className = 'message bot';
              optDiv.innerHTML = `
                <div style="display:flex;gap:10px;margin-top:10px">
                  <button onclick="sendQuickReply('${dataObj.options.yes}')" style="padding:8px 16px;border:none;border-radius:20px;cursor:pointer;background:#0078d4;color:white">
                    ${dataObj.options.yes}
                  </button>
                  <button onclick="sendQuickReply('${dataObj.options.no}')" style="padding:8px 16px;border:none;border-radius:20px;cursor:pointer;background:#f1f1f1">
                    ${dataObj.options.no}
                  </button>
                </div>`;
              elements.chatHistory.appendChild(optDiv);
              scrollToBottom();
            }
          }
        }
      }
    }
  } finally {
    removeTyping();
    isStreaming = false;
    updateSendButton();
  }
}
// ===== end streamChat =====

window.sendQuickReply = text => {
  elements.chatInput.value = text;
  elements.chatForm.dispatchEvent(new Event('submit'));
};

function validateFile(file) {
  if (!file.type.startsWith('image/')) throw new Error('Only images allowed');
  if (file.size > CONFIG.maxFileSize) throw new Error(`Max file size ${(CONFIG.maxFileSize/1e6).toFixed(1)}MB`);
  return true;
}

function addSelectedFile(file) {
  try {
    validateFile(file);
    const obj = { file, url: URL.createObjectURL(file), id: crypto.randomUUID() };
    selectedFiles.push(obj);
    renderImagePreview();
  } catch (e) { showError(e.message); }
}
function removeSelectedFile(id) {
  const idx = selectedFiles.findIndex(f => f.id === id);
  if (idx > -1) {
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
    const c = document.createElement('div');
    c.className = 'image-preview-item';
    const img = document.createElement('img');
    img.src = f.url; img.alt = f.file.name;
    const btn = document.createElement('button');
    btn.className = 'remove-image'; btn.textContent = '×';
    btn.onclick = () => removeSelectedFile(f.id);
    c.append(img, btn);
    elements.imagePreview.appendChild(c);
  });
}

function updateSendButton() {
  const has = elements.chatInput.value.trim() || selectedFiles.length;
  elements.sendBtn.disabled = isStreaming || !has;
  elements.sendBtn.textContent = isStreaming ? 'Sending...' : 'Send';
}

function exportTranscript() {
  const data = {
    conversationId,
    timestamp: new Date().toISOString(),
    product: elements.productSelect.value,
    messages: chatTranscript
  };
  const blob = new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `chat-transcript-${new Date().toISOString().split('T')[0]}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

// Event listeners
elements.chatForm.addEventListener('submit', async e => {
  e.preventDefault();
  const msg = elements.chatInput.value.trim();
  const prod = elements.productSelect.value;
  if (!msg && !selectedFiles.length) return;
  if (isStreaming) return;

  const fullMsg = msg
    ? `[Product: ${prod}] ${msg}`
    : `[Product: ${prod}] [Image uploaded]`;

  if (msg) appendMessage(msg, 'user');
  selectedFiles.forEach(f => appendImage(f.url, 'user'));
  elements.chatInput.value = '';
  clearSelectedFiles();

  const body = {
    conversationId,
    question: fullMsg,
    metadata: {
      name: 'User',
      email: 'user@example.com',
      referrer: document.referrer || window.location.href
    },
    document_retriever: true,
    followup_rating: true,
    full_source: true,
    stream: true,
    image_urls: selectedFiles.length ? selectedFiles.map(f => f.url) : null
  };

  isStreaming = true;
  updateSendButton();
  showTyping();
  try {
    await streamChat(body);
  } catch (err) {
    console.error(err);
    removeTyping();
    showError(err.message);
  }
});

elements.newChatBtn.addEventListener('click', () => {
  if (confirm('Start a new conversation?')) resetConversation();
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

// Initialize
updateSendButton();
appendMessage("👋 Hello! I'm here to help you with your questions. What would you like to know?", 'bot');
window.addEventListener('beforeunload', () => {
  selectedFiles.forEach(f => URL.revokeObjectURL(f.url));
});

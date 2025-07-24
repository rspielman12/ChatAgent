const teamId = 'my4YXyYm6SQ5ewtD75RN';
const botId = 'wxepOdO8DrIY3Hgszjip';
const chatEndpoint = `https://api.docsbot.ai/teams/${teamId}/bots/${botId}/chat-agent`;

let conversationId = getOrCreateConversationId();
const chatHistory = document.getElementById('chat-history');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const newChatBtn = document.getElementById('new-chat-btn');
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
}

function appendMessage(text, sender = 'bot') {
  const div = document.createElement('div');
  div.className = `message ${sender}`;
  div.innerHTML = sanitize(text);
  chatHistory.appendChild(div);
  chatHistory.scrollTop = chatHistory.scrollHeight;
}

function sanitize(str) {
  const temp = document.createElement('div');
  temp.textContent = str;
  return temp.innerHTML;
}

chatForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const message = chatInput.value.trim();
  if (!message && selectedImageURLs.length === 0) return;

  appendMessage(message, 'user');
  selectedImageURLs.forEach(url => appendMessage(`<img src="${url}" />`, 'user'));

  chatInput.value = '';
  imagePreview.innerHTML = '';
  const image_urls = selectedImageURLs.slice();
  selectedImageURLs = [];

  const body = {
    conversationId,
    question: message,
    metadata: {
      name: 'John Doe',
      email: 'john@example.com',
      referrer: document.referrer
    },
    document_retriever: true,
    followup_rating: true,
    full_source: true,
    stream: false,
    image_urls
  };

  try {
    const response = await fetch(chatEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const rawText = await response.text();
    console.log('Raw response from server:', rawText);

    if (!response.ok) {
      handleErrors(response.status);
      appendMessage('[Server error]', 'bot');
      return;
    }

    let data;
    try {
      data = JSON.parse(rawText);
    } catch (err) {
      console.error('Failed to parse JSON:', err);
      appendMessage('[Invalid response from server]', 'bot');
      return;
    }

    appendMessage(data.answer || '[No response]', 'bot');
  } catch (err) {
    console.error('Fetch error:', err);
    appendMessage('[Error contacting chat server]', 'bot');
  }
});

function handleErrors(status) {
  const messages = {
    400: 'Invalid input.',
    403: 'Authentication failed.',
    404: 'Bot not found.',
    409: 'Bot not ready.',
    413: 'Message too large.',
    429: 'Rate limit exceeded. Please wait.',
    500: 'Server error. Please try again.'
  };
  appendMessage(messages[status] || 'Unknown error.', 'bot');
}

newChatBtn.addEventListener('click', resetConversation);
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
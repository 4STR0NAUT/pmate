// public/app.js

// Global samtalehistorikk (kan senere knyttes til bruker-ID i en database)
let conversationHistory = [];

// Auto-resize for textarea: juster høyden etter innholdet
const userInput = document.getElementById('user-input');
userInput.addEventListener('input', function() {
  this.style.height = 'auto';
  this.style.height = (this.scrollHeight) + 'px';
});

// Funksjon for å skrive ut en melding med typing-effekt for bot
function typeMessage(sender, message, callback) {
  const chatWindow = document.getElementById('chat-window');
  const messageDiv = document.createElement('div');
  messageDiv.className = sender;
  chatWindow.appendChild(messageDiv);
  
  let index = 0;
  const interval = setInterval(() => {
    messageDiv.textContent += message.charAt(index);
    index++;
    chatWindow.scrollTop = chatWindow.scrollHeight;
    if (index >= message.length) {
      clearInterval(interval);
      if (callback) callback();
    }
  }, 30);
}

// Legg til melding i chatvinduet (bruker typing-effekt for bot, umiddelbar for bruker)
function addMessage(sender, message) {
  if (sender === 'bot') {
    typeMessage(sender, message);
  } else {
    const chatWindow = document.getElementById('chat-window');
    const messageDiv = document.createElement('div');
    messageDiv.className = sender;
    messageDiv.textContent = message;
    chatWindow.appendChild(messageDiv);
    chatWindow.scrollTop = chatWindow.scrollHeight;
  }
}

// Send melding når send-knappen klikkes
document.getElementById('send-btn').addEventListener('click', async () => {
  const inputField = document.getElementById('user-input');
  const query = inputField.value.trim();
  if (!query) return;
  
  addMessage('user', query);
  inputField.value = '';
  inputField.style.height = 'auto';
  document.getElementById('typing-indicator').style.display = 'block';
  
  try {
    const response = await fetch('/api/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query })
    });
    const data = await response.json();
    addMessage('bot', data.answer);
    conversationHistory.push({ query, answer: data.answer });
  } catch (err) {
    addMessage('bot', "Beklager, noe gikk galt.");
  }
  document.getElementById('typing-indicator').style.display = 'none';
});

// Send melding ved å trykke Enter (uten Shift+Enter for ny linje)
userInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    document.getElementById('send-btn').click();
  }
});

// Mikrofon-knappen: Bruk Web Speech API for talegjenkjenning
document.getElementById('mic-btn').addEventListener('click', () => {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    alert("Beklager, din nettleser støtter ikke talegjenkjenning.");
    return;
  }
  const recognition = new SpeechRecognition();
  recognition.lang = 'no-NO';
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  
  recognition.start();
  
  recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    userInput.value = transcript;
    document.getElementById('send-btn').click();
  };
  
  recognition.onerror = (event) => {
    console.error("Talegjenkjenning feil:", event.error);
    alert("Talegjenkjenning mislyktes: " + event.error);
  };
});

// Ny chat-knappen: Tømmer chatvinduet og nullstiller samtalehistorikken
document.getElementById('newchat-btn').addEventListener('click', () => {
  const chatWindow = document.getElementById('chat-window');
  chatWindow.innerHTML = '';
  conversationHistory = [];
  addMessage('bot', "Hei! Hvordan kan jeg hjelpe deg i dag?");
});

// Vis en initial melding ved oppstart
window.addEventListener('load', () => {
  addMessage('bot', "Hei! Hva kan jeg røre for deg? 😊");
});
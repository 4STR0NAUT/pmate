// public/app.js

// Auto-resize for textarea: juster høyden etter innholdet
const userInput = document.getElementById('user-input');
userInput.addEventListener('input', function() {
  this.style.height = 'auto';
  this.style.height = (this.scrollHeight) + 'px';
});

// Funksjon for å skrive ut en melding med typing-effekt (for bot)
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
  }, 30); // 30 ms per bokstav – juster etter ønsket hastighet
}

// Funksjon for å legge til en melding i chatvinduet
function addMessage(sender, message) {
  if (sender === 'bot') {
    // Bruk typing-effekt for bot-meldinger
    typeMessage(sender, message);
  } else {
    // For bruker-meldinger, legg den til direkte
    const chatWindow = document.getElementById('chat-window');
    const messageDiv = document.createElement('div');
    messageDiv.className = sender;
    messageDiv.textContent = message;
    chatWindow.appendChild(messageDiv);
    chatWindow.scrollTop = chatWindow.scrollHeight;
  }
}

// Send melding ved klikk på send-knappen
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
  } catch (err) {
    addMessage('bot', "Beklager, noe gikk galt.");
  }
  document.getElementById('typing-indicator').style.display = 'none';
});

// Send melding ved "Enter" (uten Shift+Enter for ny linje)
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
    // Sett det transkriberte spørsmålet inn i textareaen og send det automatisk
    userInput.value = transcript;
    document.getElementById('send-btn').click();
  };
  
  recognition.onerror = (event) => {
    console.error("Talegjenkjenning feil:", event.error);
    alert("Talegjenkjenning mislyktes: " + event.error);
  };
});

// Vis en initial melding når siden lastes
window.addEventListener('load', () => {
  addMessage('bot', "Hei! Hva kan jeg røre for deg? 😊");
});
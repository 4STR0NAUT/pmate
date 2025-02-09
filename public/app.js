// public/app.js

// Håndter send-knappen for chatbot
document.getElementById('send-btn').addEventListener('click', async () => {
    const inputField = document.getElementById('user-input');
    const query = inputField.value;
    if (!query) return;
    
    addMessage('user', query);
    inputField.value = '';
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
  
  // Funksjon for å vise meldinger i chatvinduet
  function addMessage(sender, text) {
    const chatWindow = document.getElementById('chat-window');
    const messageDiv = document.createElement('div');
    messageDiv.className = sender;
    messageDiv.textContent = text;
    chatWindow.appendChild(messageDiv);
  }
  
  // Stripe checkout-integrasjon
  const stripePublicKey = 'din_stripe_publishable_key'; // Erstatt med din faktiske publiserbare key
  const stripeInstance = Stripe(stripePublicKey);
  
  document.getElementById('checkout-button').addEventListener('click', async () => {
    try {
      const response = await fetch('/api/stripe/create-checkout-session', { method: 'POST' });
      const session = await response.json();
      stripeInstance.redirectToCheckout({ sessionId: session.id });
    } catch (err) {
      console.error("Checkout-feil:", err);
      alert("Noe gikk galt med Stripe checkout.");
    }
  });
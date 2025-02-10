// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');
const cheerio = require('cheerio');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// Legg til avhengigheter for autentisering
const session = require('express-session');
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const bcrypt = require('bcryptjs');

const app = express();
const PORT = process.env.PORT || 3000;

// Gjør mappen 'Images' tilgjengelig som statiske filer
app.use('/Images', express.static(path.join(__dirname, 'Images')));

// Middleware for CORS, body-parser og statiske filer for frontend (public)
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

// Konfigurer express-session (for "hold meg logget inn"-funksjonalitet)
app.use(session({
  secret: process.env.SESSION_SECRET || 'your_secret_here',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 } // 30 dager
}));

// Initialiser Passport for autentisering
app.use(passport.initialize());
app.use(passport.session());

// In-memory brukerlager (bruk en database i produksjon)
const users = [];

// Konfigurer Passport med en lokal strategi
passport.use(new LocalStrategy(
  function(username, password, done) {
    const user = users.find(u => u.username === username);
    if (!user) return done(null, false, { message: 'Incorrect username.' });
    bcrypt.compare(password, user.passwordHash, (err, res) => {
      if (err) return done(err);
      if (res) return done(null, user);
      return done(null, false, { message: 'Incorrect password.' });
    });
  }
));
passport.serializeUser((user, done) => done(null, user.username));
passport.deserializeUser((username, done) => {
  const user = users.find(u => u.username === username);
  if (user) return done(null, user);
  return done(null, false);
});

// ------------------------ Chatbot- og embeddings-delen ------------------------

// Global samtalehistorikk (merk: for flere brukere, koble denne mot bruker-ID)
let conversationHistory = [];

// Filsti for lagring av embeddings
const EMBEDDINGS_PATH = path.join(__dirname, 'data', 'embeddings.json');

// Maksimum lengde på svaret
const MAX_ANSWER_LENGTH = 200;

// Laster inn lagrede embeddings (eller returnerer en tom liste)
function loadEmbeddings() {
  if (fs.existsSync(EMBEDDINGS_PATH)) {
    return JSON.parse(fs.readFileSync(EMBEDDINGS_PATH, 'utf-8'));
  }
  return [];
}
function saveEmbeddings(embeddings) {
  fs.writeFileSync(EMBEDDINGS_PATH, JSON.stringify(embeddings, null, 2));
}

/**
 * Del opp tekst i mindre segmenter.
 * Dersom teksten inneholder delimiteren '---' brukes den til splitting;
 * ellers deles teksten etter doble linjeskift.
 */
function splitTextIntoChunks(text, maxChunkLength = 500) {
  let chunks = [];
  if (text.includes('---')) {
    chunks = text.split('---').map(chunk => chunk.trim()).filter(chunk => chunk.length > 0);
  } else {
    const paragraphs = text.split('\n\n');
    paragraphs.forEach(paragraph => {
      const trimmed = paragraph.trim();
      if (trimmed.length > maxChunkLength) {
        for (let i = 0; i < trimmed.length; i += maxChunkLength) {
          const subChunk = trimmed.substring(i, i + maxChunkLength).trim();
          if (subChunk.length > 0) chunks.push(subChunk);
        }
      } else if (trimmed.length > 0) {
        chunks.push(trimmed);
      }
    });
  }
  return chunks;
}

// Funksjoner for å lese dokumenter og nettsider
async function readPDF(filePath) {
  const dataBuffer = fs.readFileSync(filePath);
  const data = await pdfParse(dataBuffer);
  return data.text;
}
function readTXT(filePath) {
  return fs.readFileSync(filePath, 'utf-8');
}
async function fetchPageText(url) {
  const { data } = await axios.get(url);
  const $ = cheerio.load(data);
  return $('body').text();
}

// Generer embeddings med OpenAI API
async function generateEmbedding(text) {
  const response = await axios.post(
    'https://api.openai.com/v1/embeddings',
    { input: text, model: "text-embedding-ada-002" },
    { headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` } }
  );
  return response.data.data[0].embedding;
}
function cosineSimilarity(vecA, vecB) {
  const dotProduct = vecA.reduce((sum, a, idx) => sum + a * vecB[idx], 0);
  const normA = Math.sqrt(vecA.reduce((sum, a) => sum + a * a, 0));
  const normB = Math.sqrt(vecB.reduce((sum, b) => sum + b * b, 0));
  return dotProduct / (normA * normB);
}
function searchRelevantText(queryEmbedding, threshold = 0.75) {
  const embeddings = loadEmbeddings();
  let bestMatch = null, bestScore = 0;
  embeddings.forEach(item => {
    const score = cosineSimilarity(queryEmbedding, item.embedding);
    if (score > bestScore) { bestScore = score; bestMatch = item; }
  });
  console.log(`Beste treff-score: ${bestScore}`);
  return bestScore >= threshold ? bestMatch.text : null;
}
function cleanAnswer(text) {
  if (text.includes("Svar:")) {
    return text.split("Svar:")[1].trim();
  }
  return text.trim();
}
async function rephraseAnswer(answer) {
  const prompt = `Omformuler følgende svar til et mer naturlig, vennlig og menneskelig språk, samtidig som all viktig informasjon beholdes. Svar kun med det omformulerte svaret:\n\n"${answer}"`;
  const response = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    {
      model: "gpt-4",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 150,
      temperature: 0.7
    },
    { headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` } }
  );
  return response.data.choices[0].message.content.trim();
}
function truncateAnswer(answer, maxLength) {
  if (answer.length <= maxLength) return answer;
  let truncated = answer.substring(0, maxLength);
  let lastPeriod = truncated.lastIndexOf(".");
  let lastQuestion = truncated.lastIndexOf("?");
  let lastExclamation = truncated.lastIndexOf("!");
  let lastPunctuation = Math.max(lastPeriod, lastQuestion, lastExclamation);
  if (lastPunctuation !== -1) {
    return truncated.substring(0, lastPunctuation + 1);
  }
  return truncated;
}
async function generateGPT4Response(query) {
  const prompt = `Du er en ekspert på rørleggertema. Svar kort og konsist (maks 200 tegn) på spørsmålet: "${query}". Hold deg til fakta fra bransjestandarder, håndbøker og regelverk.`;
  const response = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    { model: "gpt-4", messages: [{ role: "user", content: prompt }], max_tokens: 150 },
    { headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` } }
  );
  return response.data.choices[0].message.content.trim();
}
async function updateTxtEmbeddings() {
  const txtDir = path.join(__dirname, 'data', 'TXT dokumenter');
  let embeddings = loadEmbeddings();
  let files;
  try {
    files = fs.readdirSync(txtDir);
  } catch (err) {
    console.error(`Klarte ikke å lese mappen ${txtDir}:`, err);
    return;
  }
  for (const file of files) {
    if (path.extname(file).toLowerCase() === '.txt') {
      const filePath = path.join(txtDir, file);
      const alreadyProcessed = embeddings.some(item => item.source === filePath);
      if (!alreadyProcessed) {
        console.log(`Behandler ${filePath}...`);
        const text = readTXT(filePath);
        const chunks = splitTextIntoChunks(text, 500);
        for (const chunk of chunks) {
          try {
            const embedding = await generateEmbedding(chunk);
            embeddings.push({ source: filePath, text: chunk, embedding: embedding });
          } catch (err) {
            console.error(`Feil under behandling av et segment i ${filePath}:`, err);
          }
        }
      } else {
        console.log(`Filen ${filePath} er allerede behandlet.`);
      }
    }
  }
  saveEmbeddings(embeddings);
  console.log('Oppdatering av TXT-embeddings ferdig.');
}
updateTxtEmbeddings()
  .then(() => console.log('TXT-embeddings oppdatert.'))
  .catch(err => console.error('Feil under oppdatering av TXT-embeddings:', err));

// ---------------------- Chatbot API-endepunkt ----------------------
app.post('/api/query', async (req, res) => {
  try {
    const { query } = req.body;
    if (!query) return res.status(400).json({ error: "Ingen spørring mottatt." });
    if (query.toLowerCase().includes("forrige jeg spurte om")) {
      if (conversationHistory.length > 0) {
        const lastEntry = conversationHistory[conversationHistory.length - 1];
        return res.json({ answer: "Du spurte: " + lastEntry.query });
      } else {
        return res.json({ answer: "Jeg har ikke registrert noe tidligere spørsmål." });
      }
    }
    const queryEmbedding = await generateEmbedding(query);
    let answer = searchRelevantText(queryEmbedding);
    if (!answer) {
      answer = await generateGPT4Response(query);
    } else {
      answer = cleanAnswer(answer);
    }
    if (answer) {
      answer = await rephraseAnswer(answer);
    }
    answer = truncateAnswer(answer, MAX_ANSWER_LENGTH);
    conversationHistory.push({ query, answer });
    res.json({ answer });
  } catch (error) {
    console.error("Feil i /api/query:", error);
    res.status(500).json({ error: "Noe gikk galt. Vennligst prøv igjen senere." });
  }
});

// ---------------------- Stripe-endepunkt (finnes fortsatt for andre formål) ----------------------
app.post('/api/stripe/create-checkout-session', async (req, res) => {
  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'subscription',
      line_items: [{
        price: process.env.STRIPE_PRICE_ID,
        quantity: 1
      }],
      success_url: 'https://din-domenenavn.no/success',
      cancel_url: 'https://din-domenenavn.no/cancel'
    });
    res.json({ id: session.id });
  } catch (error) {
    console.error("Stripe-feil:", error);
    res.status(500).json({ error: error.message });
  }
});

// ---------------------- Autentisering og registrering ----------------------

// Registreringsendepunkt – oppretter en bruker med "pending" status og oppretter en Stripe-checkout for registreringsgebyr
app.post('/api/register', async (req, res) => {
  const { username, password, rememberMe } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Mangler brukernavn eller passord.' });
  }
  if (users.find(u => u.username === username)) {
    return res.status(400).json({ error: 'Brukernavn finnes allerede.' });
  }
  try {
    const passwordHash = await bcrypt.hash(password, 10);
    const newUser = { username, passwordHash, active: false };
    users.push(newUser);
    const sessionStripe = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      line_items: [{
        price: process.env.STRIPE_PRICE_ID,
        quantity: 1
      }],
      success_url: `${process.env.BASE_URL}/api/register/success?username=${encodeURIComponent(username)}`,
      cancel_url: `${process.env.BASE_URL}/register`
    });
    res.json({ sessionId: sessionStripe.id });
  } catch (error) {
    console.error("Feil ved registrering:", error);
    res.status(500).json({ error: "Registrering mislyktes." });
  }
});

// Endepunkt for vellykket registrering
app.get('/api/register/success', (req, res) => {
  const { username } = req.query;
  const user = users.find(u => u.username === username);
  if (user) {
    user.active = true;
    req.login(user, function(err) {
      if (err) return res.status(500).send("Feil ved innlogging.");
      return res.send("Registrering fullført. Du er nå logget inn.");
    });
  } else {
    res.status(400).send("Bruker ikke funnet.");
  }
});

// Innloggingsendepunkt
app.post('/api/login', passport.authenticate('local'), (req, res) => {
  res.json({ message: "Innlogging vellykket." });
});

// Utloggingsendepunkt
app.post('/api/logout', (req, res) => {
  req.logout();
  res.json({ message: "Du er logget ut." });
});

// -------------------------- Start serveren --------------------------
app.listen(PORT, () => {
  console.log(`Serveren kjører på port ${PORT}`);
});
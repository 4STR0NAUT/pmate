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

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

// Enkel global samtalehistorikk (merk: for produksjon med flere brukere må du bruke sessions eller database)
let conversationHistory = [];

// Filsti for lagring av embeddings
const EMBEDDINGS_PATH = path.join(__dirname, 'data', 'embeddings.json');

// Laster inn lagrede embeddings (eller returnerer en tom liste)
function loadEmbeddings() {
  if (fs.existsSync(EMBEDDINGS_PATH)) {
    return JSON.parse(fs.readFileSync(EMBEDDINGS_PATH, 'utf-8'));
  }
  return [];
}

// Lagre embeddings til fil
function saveEmbeddings(embeddings) {
  fs.writeFileSync(EMBEDDINGS_PATH, JSON.stringify(embeddings, null, 2));
}

/**
 * Funksjon for å dele opp tekst i mindre segmenter.
 * Dersom teksten inneholder delimiteren '---' brukes den til splitting.
 * Ellers deles teksten etter doble linjeskift og eventuelt videre opp hvis segmentet er for langt.
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
          if (subChunk.length > 0) {
            chunks.push(subChunk);
          }
        }
      } else if (trimmed.length > 0) {
        chunks.push(trimmed);
      }
    });
  }
  return chunks;
}

// --- Funksjoner for å lese dokumenter og nettsider ---

// Les PDF-fil og returner tekst
async function readPDF(filePath) {
  const dataBuffer = fs.readFileSync(filePath);
  const data = await pdfParse(dataBuffer);
  return data.text;
}

// Les TXT-fil og returner tekst
function readTXT(filePath) {
  return fs.readFileSync(filePath, 'utf-8');
}

// Hent tekst fra en nettside (bruk Cheerio)
async function fetchPageText(url) {
  const { data } = await axios.get(url);
  const $ = cheerio.load(data);
  return $('body').text();
}

// --- Generer embeddings med OpenAI API ---
async function generateEmbedding(text) {
  const response = await axios.post(
    'https://api.openai.com/v1/embeddings',
    {
      input: text,
      model: "text-embedding-ada-002"
    },
    {
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
      }
    }
  );
  return response.data.data[0].embedding;
}

// --- Beregn cosine-similarity ---
function cosineSimilarity(vecA, vecB) {
  const dotProduct = vecA.reduce((sum, a, idx) => sum + a * vecB[idx], 0);
  const normA = Math.sqrt(vecA.reduce((sum, a) => sum + a * a, 0));
  const normB = Math.sqrt(vecB.reduce((sum, b) => sum + b * b, 0));
  return dotProduct / (normA * normB);
}

// --- Søk etter relevant tekst i embeddings ---
function searchRelevantText(queryEmbedding, threshold = 0.75) {
  const embeddings = loadEmbeddings();
  let bestMatch = null;
  let bestScore = 0;
  embeddings.forEach(item => {
    const score = cosineSimilarity(queryEmbedding, item.embedding);
    if (score > bestScore) {
      bestScore = score;
      bestMatch = item;
    }
  });
  console.log(`Beste treff-score: ${bestScore}`);
  return bestScore >= threshold ? bestMatch.text : null;
}

/**
 * Funksjon for å "rense" et segment med spørsmål og svar.
 * Dersom teksten inneholder "Svar:" returneres kun teksten etter dette.
 */
function cleanAnswer(text) {
  if (text.includes("Svar:")) {
    return text.split("Svar:")[1].trim();
  }
  return text.trim();
}

// --- GPT-4 fallback ---
async function generateGPT4Response(query) {
  const prompt = `Du er en ekspert på rørleggertema. Svar kort (maks 200 tegn) på spørsmålet: "${query}". Hold deg til fakta fra bransjestandarder, håndbøker og regelverk.`;
  
  const response = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    {
      model: "gpt-4",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 150
    },
    {
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
      }
    }
  );
  return response.data.choices[0].message.content.trim();
}

// --- Oppdater TXT-embeddings med tekstsplitting ---
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
      // Sjekk om filen allerede er behandlet (basert på om noe segment fra filen finnes)
      const alreadyProcessed = embeddings.some(item => item.source === filePath);
      if (!alreadyProcessed) {
        console.log(`Behandler ${filePath}...`);
        const text = readTXT(filePath);
        const chunks = splitTextIntoChunks(text, 500);
        for (const chunk of chunks) {
          try {
            const embedding = await generateEmbedding(chunk);
            embeddings.push({
              source: filePath,
              text: chunk,
              embedding: embedding
            });
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

// Kall oppdatering av TXT-embeddings ved oppstart
updateTxtEmbeddings()
  .then(() => console.log('TXT-embeddings oppdatert.'))
  .catch(err => console.error('Feil under oppdatering av TXT-embeddings:', err));

// --- API-endepunkt for brukerforespørsler ---
app.post('/api/query', async (req, res) => {
  try {
    const { query } = req.body;
    if (!query) {
      return res.status(400).json({ error: "Ingen spørring mottatt." });
    }

    // Sjekk for oppfølgingsspørsmål
    if (query.toLowerCase().includes("forrige jeg spurte om")) {
      if (conversationHistory.length > 0) {
        const lastEntry = conversationHistory[conversationHistory.length - 1];
        return res.json({ answer: "Du spurte: " + lastEntry.query });
      } else {
        return res.json({ answer: "Jeg har ikke registrert noe tidligere spørsmål." });
      }
    }

    // Generer embedding for brukerens spørsmål
    const queryEmbedding = await generateEmbedding(query);
    let answer = searchRelevantText(queryEmbedding);
    if (!answer) {
      answer = await generateGPT4Response(query);
    } else {
      answer = cleanAnswer(answer);
    }
    if (answer.length > 200) {
      answer = answer.substring(0, 200);
    }
    conversationHistory.push({ query, answer });
    res.json({ answer });
  } catch (error) {
    console.error("Feil i /api/query:", error);
    res.status(500).json({ error: "Noe gikk galt. Vennligst prøv igjen senere." });
  }
});

// --- Stripe-endepunkt for checkout-session ---
app.post('/api/stripe/create-checkout-session', async (req, res) => {
  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'subscription', // Endre til 'payment' for engangskjøp om ønskelig
      line_items: [{
        price: process.env.STRIPE_PRICE_ID,
        quantity: 1
      }],
      success_url: 'https://din-domenenavn.no/success', // Endre til din URL
      cancel_url: 'https://din-domenenavn.no/cancel',   // Endre til din URL
    });
    res.json({ id: session.id });
  } catch (error) {
    console.error("Stripe-feil:", error);
    res.status(500).json({ error: error.message });
  }
});

// Start serveren
app.listen(PORT, () => {
  console.log(`Serveren kjører på port ${PORT}`);
});
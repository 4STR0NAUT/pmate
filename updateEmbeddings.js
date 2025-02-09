// updateEmbeddings.js
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const axios = require('axios');

// Funksjon for å lese TXT-fil
function readTXT(filePath) {
  return fs.readFileSync(filePath, 'utf-8');
}

// Funksjon for å generere embedding via OpenAI API
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

// Funksjoner for å laste og lagre embeddings
const EMBEDDINGS_PATH = path.join(__dirname, 'data', 'embeddings.json');

function loadEmbeddings() {
  if (fs.existsSync(EMBEDDINGS_PATH)) {
    return JSON.parse(fs.readFileSync(EMBEDDINGS_PATH, 'utf-8'));
  }
  return [];
}

function saveEmbeddings(embeddings) {
  fs.writeFileSync(EMBEDDINGS_PATH, JSON.stringify(embeddings, null, 2));
}

// Hovedfunksjonen som leser TXT-filer og oppdaterer embeddings
async function updateTxtEmbeddings() {
  const txtDir = path.join(__dirname, 'data', 'TXT dokumenter');
  let embeddings = loadEmbeddings();

  // Hent alle filer i katalogen
  fs.readdir(txtDir, async (err, files) => {
    if (err) {
      return console.error('Kunne ikke lese katalogen:', err);
    }

    // Gå gjennom alle TXT-filene
    for (const file of files) {
      if (path.extname(file).toLowerCase() === '.txt') {
        const filePath = path.join(txtDir, file);
        // Sjekk om denne filen allerede er behandlet (f.eks. ved å lagre stien)
        if (!embeddings.some(item => item.source === filePath)) {
          console.log(`Behandler ${filePath}...`);
          const text = readTXT(filePath);
          const embedding = await generateEmbedding(text);
          // Lagre både filsti, tekst og embedding
          embeddings.push({
            source: filePath,
            text: text,
            embedding: embedding
          });
        } else {
          console.log(`Filen ${filePath} er allerede behandlet.`);
        }
      }
    }
    saveEmbeddings(embeddings);
    console.log('Oppdatering av embeddings ferdig.');
  });
}

updateTxtEmbeddings();
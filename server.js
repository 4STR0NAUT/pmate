// server.js
import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { load as cheerioLoad } from 'cheerio';
import stripePkg from 'stripe';
const stripe = stripePkg(process.env.STRIPE_SECRET_KEY);

import session from 'express-session';
import passport from 'passport';
import { Strategy as LocalStrategy } from 'passport-local';
import bcrypt from 'bcryptjs';
import nodemailer from 'nodemailer';

import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Serve static files
app.use('/Images', express.static(path.join(__dirname, 'Images')));
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

// Setup express-session and Passport for authentication
app.use(session({
  secret: process.env.SESSION_SECRET || 'your_secret_here',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 } // 30 days
}));
app.use(passport.initialize());
app.use(passport.session());

// In-memory user store (for development; use a database in production)
const users = [];

// Passport Local Strategy
passport.use(new LocalStrategy((username, password, done) => {
  const user = users.find(u => u.username === username);
  if (!user) return done(null, false, { message: 'Incorrect username.' });
  bcrypt.compare(password, user.passwordHash, (err, res) => {
    if (err) return done(err);
    if (res) return done(null, user);
    return done(null, false, { message: 'Incorrect password.' });
  });
}));
passport.serializeUser((user, done) => done(null, user.username));
passport.deserializeUser((username, done) => {
  const user = users.find(u => u.username === username);
  return user ? done(null, user) : done(null, false);
});

// Middleware to ensure the user is authenticated and has an active subscription.
function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated() && req.user.active) {
    return next();
  }
  return res.status(401).json({ error: 'You must be logged in and have an active subscription to use this app.' });
}

// ------------------------ Chatbot and Text Processing ------------------------
let conversationHistory = [];
const EMBEDDINGS_PATH = path.join(__dirname, 'data', 'embeddings.json');
const MAX_ANSWER_LENGTH = 200;

function loadEmbeddings() {
  if (fs.existsSync(EMBEDDINGS_PATH)) {
    return JSON.parse(fs.readFileSync(EMBEDDINGS_PATH, 'utf-8'));
  }
  return [];
}
function saveEmbeddings(embeddings) {
  fs.writeFileSync(EMBEDDINGS_PATH, JSON.stringify(embeddings, null, 2));
}
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
function readTXT(filePath) {
  return fs.readFileSync(filePath, 'utf-8');
}
async function fetchPageText(url) {
  const { data } = await axios.get(url);
  const $ = cheerioLoad(data);
  return $('body').text();
}
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
  console.log(`Best match score: ${bestScore}`);
  return bestScore >= threshold ? bestMatch.text : null;
}
function cleanAnswer(text) {
  if (text.includes("Svar:")) {
    return text.split("Svar:")[1].trim();
  }
  return text.trim();
}
async function rephraseAnswer(answer) {
  const prompt = `Rewrite the following answer to be more natural, friendly, and human while preserving all important details:\n\n"${answer}"`;
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
  const prompt = `You are an expert on plumbing. Provide a short, concise answer (max 200 characters) to the following question: "${query}". Stick to industry standards and regulations.`;
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
    console.error(`Could not read directory ${txtDir}:`, err);
    return;
  }
  for (const file of files) {
    if (path.extname(file).toLowerCase() === '.txt') {
      const filePath = path.join(txtDir, file);
      const alreadyProcessed = embeddings.some(item => item.source === filePath);
      if (!alreadyProcessed) {
        console.log(`Processing ${filePath}...`);
        const text = readTXT(filePath);
        const chunks = splitTextIntoChunks(text, 500);
        for (const chunk of chunks) {
          try {
            const embedding = await generateEmbedding(chunk);
            embeddings.push({ source: filePath, text: chunk, embedding: embedding });
          } catch (err) {
            console.error(`Error processing segment in ${filePath}:`, err);
          }
        }
      } else {
        console.log(`File ${filePath} already processed.`);
      }
    }
  }
  saveEmbeddings(embeddings);
  console.log('TXT embeddings updated.');
}
updateTxtEmbeddings()
  .then(() => console.log('Embeddings updated.'))
  .catch(err => console.error('Error updating embeddings:', err));

// ---------------------- Stripe Subscription Endpoint ----------------------
app.post('/api/create-checkout-session', async (req, res) => {
  try {
    const sessionStripe = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'subscription',
      line_items: [{
        price: process.env.STRIPE_PRICE_ID,
        quantity: 1
      }],
      success_url: `${process.env.BASE_URL}/subscription-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.BASE_URL}/subscription-cancel`
    });
    res.json({ sessionId: sessionStripe.id });
  } catch (error) {
    console.error("Stripe error:", error);
    res.status(500).json({ error: error.message });
  }
});

// ---------------------- Protected Chat API ----------------------
app.post('/api/query', ensureAuthenticated, async (req, res) => {
  try {
    const { query } = req.body;
    if (!query) return res.status(400).json({ error: "No query provided." });
    if (query.toLowerCase().includes("forrige jeg spurte om")) {
      if (conversationHistory.length > 0) {
        const lastEntry = conversationHistory[conversationHistory.length - 1];
        return res.json({ answer: "Du spurte: " + lastEntry.query });
      } else {
        return res.json({ answer: "Ingen tidligere spørsmål registrert." });
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
    console.error("Error in /api/query:", error);
    res.status(500).json({ error: "Something went wrong. Please try again later." });
  }
});

// ---------------------- Authentication and Registration ----------------------
app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Missing username or password.' });
  }
  if (users.find(u => u.username === username)) {
    return res.status(400).json({ error: 'Username already exists.' });
  }
  try {
    const passwordHash = await bcrypt.hash(password, 10);
    const newUser = { username, passwordHash, active: false }; // inactive until subscription is completed
    users.push(newUser);
    
    // Create a Stripe Checkout session for subscription
    const sessionStripe = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment', // or 'subscription' if charging recurring payments
      line_items: [{
        price: process.env.STRIPE_PRICE_ID,
        quantity: 1
      }],
      success_url: `${process.env.BASE_URL}/api/register/success?username=${encodeURIComponent(username)}`,
      cancel_url: `${process.env.BASE_URL}/register`
    });
    
    res.json({ sessionId: sessionStripe.id });
  } catch (error) {
    console.error("Registration error:", error);
    res.status(500).json({ error: "Registration failed." });
  }
});

app.get('/api/register/success', (req, res) => {
  const { username } = req.query;
  const user = users.find(u => u.username === username);
  if (user) {
    user.active = true;
    req.login(user, (err) => {
      if (err) return res.status(500).send("Login error.");
      return res.send("Registration successful. You are now logged in.");
    });
  } else {
    res.status(400).send("User not found.");
  }
});

app.post('/api/login', passport.authenticate('local'), (req, res) => {
  res.json({ message: "Login successful." });
});

app.post('/api/logout', (req, res) => {
  req.logout();
  res.json({ message: "Logged out." });
});

// ---------------------- Bug Report API ----------------------
app.post('/api/bugreport', async (req, res) => {
  const { report } = req.body;
  if (!report) {
    return res.status(400).json({ success: false, message: "No bug report provided." });
  }
  
  let transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS
    }
  });
  
  try {
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: 'ivar@mediasterk.no',
      subject: 'Bug Report from Pipemate Chatbot',
      text: report
    });
    res.json({ success: true });
  } catch (error) {
    console.error("Error sending email:", error);
    res.status(500).json({ success: false, message: "Email sending failed." });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
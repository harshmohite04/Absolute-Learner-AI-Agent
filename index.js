const express = require("express");
const axios = require("axios");
const mongoose = require("mongoose");
require("dotenv").config();

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// === Connect MongoDB ===
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('Error connecting to MongoDB:', err));
const db = mongoose.connection;
db.on("error", console.error.bind(console, "MongoDB connection error:"));
db.once("open", () => console.log("✅ MongoDB connected"));

// === MongoDB User Schema ===
const userSchema = new mongoose.Schema({
  phone: { type: String, unique: true },
  name: String,
  lastTopic: String,
  history: [String],
  createdAt: { type: Date, default: Date.now },
});
const User = mongoose.model("User", userSchema);

// === Groq Helper ===
const SYSTEM_PROMPT = `
You are AbsoluteLearner AI – a daily mentor helping users learn one skill deeply each day.
You must suggest a topic, break it into 3 time slots, and help the user track progress.
Be supportive, structured, and focused on helping them master new domains every 24 hrs.
`;

async function askGroq(userMessage, history = []) {
  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    ...history,
    { role: "user", content: userMessage },
  ];

  const res = await axios.post(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      model: "llama3-70b-8192",
      messages,
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        "Content-Type": "application/json",
      },
    }
  );

  return res.data.choices[0].message.content;
}

// === Learning Engine ===
const topics = [
  "Git & GitHub",
  "APIs with Postman",
  "Linux Basics",
  "SQL in 24 hrs",
  "Python Crash Course",
  "Financial Statements",
  "Prompt Engineering",
  "Figma UI Design",
  "Startup Idea Validation",
  "Intro to Blockchain",
];

function getTodayTopic(history = []) {
  return topics.find((t) => !history.includes(t)) || "Review & Reflect Day";
}

function generatePlan(topic) {
  return `
📘 *Today's Mission:* ${topic}

🕒 *Morning* – Watch 2 beginner-level videos on ${topic} (YT or FreeCodeCamp)
💻 *Afternoon* – Build a hands-on project or complete an interactive tutorial
🧠 *Evening* – Quiz yourself, write 5 takeaways, and reflect

Reply with "done" after each step to log progress or ask questions anytime!
`;
}

// === WhatsApp Webhook ===
app.post("/webhook", async (req, res) => {
  const msg = req.body.Body.trim();
  const from = req.body.From;
  const phone = from.replace("whatsapp:", "");

  let user = await User.findOne({ phone });
  if (!user) {
    user = await User.create({ phone, history: [] });
  }

  let reply = "";

  if (msg.toLowerCase() === "start" || msg.toLowerCase() === "hi") {
    const topic = getTodayTopic(user.history);
    const plan = generatePlan(topic);
    user.lastTopic = topic;
    user.history.push(topic);
    await user.save();
    reply = `👋 Welcome back, Absolute Learner!\n\n${plan}`;
  } else {
    reply = await askGroq(msg, [
      { role: "user", content: `User is currently learning ${user.lastTopic}` },
    ]);
  }

  // === Send reply via Twilio ===
  await axios.post(
    `https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Messages.json`,
    new URLSearchParams({
      From: process.env.TWILIO_WHATSAPP_NUMBER,
      To: from,
      Body: reply,
    }),
    {
      auth: {
        username: process.env.TWILIO_ACCOUNT_SID,
        password: process.env.TWILIO_AUTH_TOKEN,
      },
    }
  );

  res.sendStatus(200);
});

// === Start Server ===
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 AbsoluteLearner AI running on port ${PORT}`));

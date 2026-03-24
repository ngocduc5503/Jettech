require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const multer = require("multer");

const app = express();
app.use(cors());
app.use(express.json({ limit: "50mb" }));

// 👉 SERVE FRONTEND
app.use(express.static(__dirname));

app.get("/", (req, res) => {
  res.sendFile(__dirname + "/index.html");
});

// ==========================
// 🔥 CONNECT MONGODB
// ==========================
mongoose.connect(process.env.MONGO_URI)
.then(() => console.log("✅ Connected MongoDB"))
.catch(err => console.error("❌ MongoDB Error:", err));

// ==========================
// SCHEMA
// ==========================
const mailSchema = new mongoose.Schema({
  email: { type: String, unique: true, index: true },
  raw: String,
  domain: String,
  type: String, 
  createdAt: { type: Date, default: Date.now }
});

const Mail = mongoose.model("Mail", mailSchema);

// ==========================
// MULTER (UPLOAD FILE)
// ==========================
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

function getMailType(domain) {
  const microsoftDomains = [
    "hotmail.com",
    "outlook.com",
    "live.com",
    "msn.com"
  ];

  return microsoftDomains.includes(domain) ? "microsoft" : "mix";
}

// ==========================
// 🧠 PARSE EMAIL FUNCTION (REUSE)
// ==========================
function parseEmails(fileContent) {
  const lines = fileContent.replace(/\r/g, "").split("\n");

  let docs = lines.map(line => {
    const raw = line.trim();
    if (!raw) return null;

    const parts = raw.split(":");
    const email = parts[0]?.toLowerCase();

    const isValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    if (!isValid) return null;

    const domain = email.split("@")[1] || "";
    const type = getMailType(domain);

    return {
      email,
      raw,
      domain,
      type
    };
  }).filter(Boolean);

  const uniqueMap = new Map();
  docs.forEach(d => uniqueMap.set(d.email, d));

  return Array.from(uniqueMap.values());
}

// ==========================
// 🟢 API 1: UPLOAD FILE → SAVE DB
// ==========================
app.post("/upload-file", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const fileContent = req.file.buffer.toString("utf-8");

    const docs = parseEmails(fileContent);
    const emails = docs.map(d => d.email);

    // check tồn tại DB
    const existing = await Mail.find({ email: { $in: emails } }).select("email");
    const existingSet = new Set(existing.map(e => e.email));

    // lọc mail mới
    const newDocs = docs.filter(d => !existingSet.has(d.email));

    // insert
    if (newDocs.length > 0) {
      await Mail.insertMany(newDocs, { ordered: false });
    }

    res.json({
      success: true,
      total: docs.length,
      inserted: newDocs.length,
      duplicate: docs.length - newDocs.length
    });

  } catch (err) {
    console.error(err);
    res.status(500).send("Upload error");
  }
});

// ==========================
// 🟡 API 2: CHECK TRÙNG (KHÔNG INSERT)
// ==========================
app.post("/check-duplicate", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const fileContent = req.file.buffer.toString("utf-8");

    const docs = parseEmails(fileContent);
    const emails = docs.map(d => d.email);

    // check DB
    const existing = await Mail.find({ email: { $in: emails } }).select("email");
    const existingSet = new Set(existing.map(e => e.email));

    const duplicates = docs.filter(d => existingSet.has(d.email));
    const newMails = docs.filter(d => !existingSet.has(d.email));

    res.json({
      total: docs.length,
      duplicate: duplicates.length,
      new: newMails.length,
      duplicates: duplicates.map(d => d.raw),
      newMails: newMails.map(d => d.raw)
    });

  } catch (err) {
    console.error(err);
    res.status(500).send("Check error");
  }
});

// ==========================
// 🔵 API 3: FILTER DOMAIN
// ==========================
app.get("/filter", async (req, res) => {
  try {
    if (!req.query.domains) {
      return res.status(400).json({ error: "Missing domains param" });
    }

    const domains = req.query.domains.split(",");

    const data = await Mail.find({ domain: { $in: domains } });

    res.json(data.map(d => d.raw));
  } catch (err) {
    res.status(500).send("Error");
  }
});

// ==========================
// 🟣 API 4: EXPORT ALL
// ==========================
app.get("/export", async (req, res) => {
  try {
    const data = await Mail.find();
    res.send(data.map(d => d.raw).join("\n"));
  } catch (err) {
    res.status(500).send("Error");
  }
});

// ==========================
// 🟣 API 5: Type Mail
// ==========================
app.get("/filter-type", async (req, res) => {
  try {
    const { type } = req.query;

    if (!type) {
      return res.status(400).json({ error: "Missing type" });
    }

    const data = await Mail.find({ type });

    res.json(data.map(d => d.raw));
  } catch (err) {
    res.status(500).send("Error");
  }
});

// ==========================
// START SERVER
// ==========================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
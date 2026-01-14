require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

// Import Models
const Item = require('./models/Item');
const Transaction = require('./models/Transaction');
const User = require('./models/User'); // <--- NEW MODEL

const app = express();

app.use(express.json());
app.use(cors());

// --- DATABASE CONNECTION ---
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB Connected Successfully"))
  .catch(err => console.log("❌ MongoDB Error:", err));

// ==========================================
// AUTHENTICATION ROUTES
// ==========================================

// 1. SETUP ROUTE (Run this once to create users)
app.get('/api/setup', async (req, res) => {
  try {
    // Check if users already exist
    const userCount = await User.countDocuments();
    if (userCount > 0) return res.send("Users already exist. Setup skipped.");

    // Create Default Users
    await User.create([
      { username: "admin", password: "123", role: "admin" },
      { username: "staff", password: "123", role: "staff" }
    ]);

    res.send("✅ Setup Complete! Created user 'admin' and 'staff' with password '123'");
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// 2. LOGIN ROUTE
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    // Find user
    const user = await User.findOne({ username });
    
    // Check if user exists and password matches
    if (!user || user.password !== password) {
      return res.status(401).json({ error: "Invalid Credentials" });
    }

    // Return the user info (Role is key here)
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// INVENTORY ROUTES
// ==========================================

app.get('/api/items', async (req, res) => {
  const items = await Item.find();
  res.json(items);
});

app.post('/api/items', async (req, res) => {
  try {
    const newItem = new Item(req.body);
    const savedItem = await newItem.save();
    res.json(savedItem);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/api/items/:id', async (req, res) => {
  const updatedItem = await Item.findByIdAndUpdate(req.params.id, req.body, { new: true });
  res.json(updatedItem);
});

app.delete('/api/items/:id', async (req, res) => {
  await Item.findByIdAndDelete(req.params.id);
  res.json({ message: "Item deleted" });
});

// ==========================================
// TRANSACTION ROUTES
// ==========================================

app.get('/api/transactions', async (req, res) => {
  const transactions = await Transaction.find().sort({ _id: -1 });
  res.json(transactions);
});

app.post('/api/transactions', async (req, res) => {
  const { date, itemName, type, quantity, altQty, remarks } = req.body;
  const qtyChange = parseFloat(quantity);

  try {
    const newTxn = new Transaction({ date, itemName, type, quantity: qtyChange, altQty, remarks });
    const savedTxn = await newTxn.save();

    const item = await Item.findOne({ name: itemName });
    if (item) {
      if (type === "IN") item.quantity += qtyChange;
      else if (type === "OUT") item.quantity -= qtyChange;
      await item.save();
    }

    res.json(savedTxn);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
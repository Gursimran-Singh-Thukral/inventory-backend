const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const app = express();

app.use(cors({
  origin: '*', 
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("Connected to MongoDB"))
  .catch(err => console.error("MongoDB connection error:", err));

// --- 1. DEFINING SCHEMAS (Strict Numbers) ---
const itemSchema = new mongoose.Schema({
  name: String,
  unit: String,
  altUnit: String,
  factor: String, 
  alertQty: Number
});

const transactionSchema = new mongoose.Schema({
  date: String,
  type: String, 
  itemName: String,
  quantity: Number,  // Primary (Number)
  altQty: Number,    // Alternate (Strictly Number now)
  remarks: String,
  unit: String,
  altUnit: String,
  rate: Number
});

// Configure toJSON to handle ID conversion automatically
transactionSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: function (doc, ret) { ret.id = ret._id; delete ret._id; }
});

itemSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: function (doc, ret) { ret.id = ret._id; delete ret._id; }
});

const Item = mongoose.model('Item', itemSchema);
const Transaction = mongoose.model('Transaction', transactionSchema);

app.get('/', (req, res) => res.send("Backend is Running! 🚀"));

// --- 2. GET ITEMS WITH ROBUST CALCULATION ---
app.get('/api/items', async (req, res) => {
  try {
    // .lean() converts Mongoose Documents to Plain JS Objects (Crucial for Math!)
    const items = await Item.find().lean();
    
    const itemsWithQty = await Promise.all(items.map(async (item) => {
      const cleanName = item.name.trim();

      // Fuzzy Search: Find transactions ignoring Case & Spaces
      // .lean() ensures we get raw numbers, not Mongoose objects
      const txns = await Transaction.find({ 
        itemName: { $regex: new RegExp(`^${cleanName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') } 
      }).lean();
      
      let stats = txns.reduce((acc, t) => {
        const type = t.type ? t.type.toUpperCase().trim() : "IN";
        
        // Ensure values are numbers (Default to 0 if missing)
        const qty = Number(t.quantity) || 0;
        const alt = Number(t.altQty) || 0;

        if (type === 'IN') {
          acc.primary += qty;
          acc.alt += alt;
        } else {
          acc.primary -= qty;
          acc.alt -= alt;
        }
        return acc;
      }, { primary: 0, alt: 0 });

      // --- BACKUP: Auto-Calculate if Alt is 0 but Factor exists ---
      if (stats.alt === 0 && stats.primary !== 0 && item.factor) {
        const factor = parseFloat(item.factor);
        if (!isNaN(factor) && item.factor !== "Manual") {
          stats.alt = stats.primary * factor;
        }
      }

      return { 
        ...item, // already lean object
        quantity: stats.primary, 
        altQuantity: stats.alt, 
        id: item._id 
      };
    }));

    res.json(itemsWithQty);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- CRUD ROUTES (Simplified) ---

app.post('/api/items', async (req, res) => {
  try {
    const newItem = new Item(req.body);
    const savedItem = await newItem.save();
    res.json(savedItem);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

app.put('/api/items/:id', async (req, res) => {
  try {
    const oldItem = await Item.findById(req.params.id);
    const updatedItem = await Item.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (oldItem && oldItem.name !== req.body.name) {
      await Transaction.updateMany({ itemName: oldItem.name }, { $set: { itemName: req.body.name } });
    }
    res.json(updatedItem);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

app.delete('/api/items/:id', async (req, res) => {
  try {
    const item = await Item.findById(req.params.id);
    if (item) {
      await Transaction.deleteMany({ itemName: item.name });
      await Item.findByIdAndDelete(req.params.id);
    }
    res.json({ message: "Item and history deleted" });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/transactions', async (req, res) => {
  try {
    const txns = await Transaction.find().sort({ date: -1 });
    res.json(txns);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/transactions', async (req, res) => {
  try {
    const newTxn = new Transaction(req.body);
    const savedTxn = await newTxn.save();
    res.json(savedTxn);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

app.put('/api/transactions/:id', async (req, res) => {
  try {
    const updatedTxn = await Transaction.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(updatedTxn);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

app.delete('/api/transactions/:id', async (req, res) => {
  try {
    await Transaction.findByIdAndDelete(req.params.id);
    res.json({ message: "Transaction deleted" });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (username === 'admin' && password === '123') res.json({ role: 'admin' });
  else if (username === 'staff' && password === '123') res.json({ role: 'staff' });
  else res.status(401).json({ message: 'Invalid credentials' });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
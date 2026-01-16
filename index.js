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

// --- SCHEMAS ---
const itemSchema = new mongoose.Schema({
  name: String,
  unit: String,
  altUnit: String,
  factor: String, 
  alertQty: Number
});

// --- CRITICAL UPDATE: altQty is defined as NUMBER ---
const transactionSchema = new mongoose.Schema({
  date: String,
  type: String, 
  itemName: String,
  quantity: Number,
  altQty: Number, // Enforces numeric storage
  remarks: String,
  unit: String,
  altUnit: String,
  rate: Number
});

const Item = mongoose.model('Item', itemSchema);
const Transaction = mongoose.model('Transaction', transactionSchema);

app.get('/', (req, res) => res.send("Backend is Running! 🚀"));

// 1. GET ALL ITEMS (With Backup Calculation)
app.get('/api/items', async (req, res) => {
  try {
    const items = await Item.find();
    
    const itemsWithQty = await Promise.all(items.map(async (item) => {
      const cleanName = item.name.trim();

      // 1. Find Transactions (Fuzzy Search)
      const txns = await Transaction.find({ 
        itemName: { $regex: new RegExp(`^${cleanName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') } 
      });
      
      // 2. Calculate Totals via Summation
      let stats = txns.reduce((acc, t) => {
        const type = t.type ? t.type.toUpperCase().trim() : "IN";
        const qty = parseFloat(t.quantity) || 0;
        
        // Clean Alt Qty string (remove letters)
        let rawAlt = t.altQty || t.altQuantity || "0";
        const cleanAlt = String(rawAlt).replace(/[^\d.-]/g, '');
        const altVal = parseFloat(cleanAlt) || 0;

        if (type === 'IN') {
          acc.primary += qty;
          acc.alt += altVal;
        } else {
          acc.primary -= qty;
          acc.alt -= altVal;
        }
        return acc;
      }, { primary: 0, alt: 0 });

      // 3. --- BACKUP CALCULATION (THE FIX) ---
      // If Alt Sum is 0, but we have stock, try to calc using the Item Factor
      if (stats.alt === 0 && stats.primary !== 0 && item.factor) {
        const factor = parseFloat(item.factor);
        // Only calc if factor is a valid number (ignore "Manual")
        if (!isNaN(factor)) {
          console.log(`Auto-correcting Alt Qty for ${item.name}`);
          stats.alt = stats.primary * factor;
        }
      }

      return { 
        ...item._doc, 
        quantity: stats.primary, 
        altQuantity: stats.alt, // Returns calculated backup if sum was 0
        id: item._id 
      };
    }));

    res.json(itemsWithQty);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- CRUD ROUTES ---

app.post('/api/items', async (req, res) => {
  try {
    const newItem = new Item(req.body);
    const savedItem = await newItem.save();
    res.json({ ...savedItem._doc, id: savedItem._id, quantity: 0, altQuantity: 0 });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

app.put('/api/items/:id', async (req, res) => {
  try {
    const oldItem = await Item.findById(req.params.id);
    const updatedItem = await Item.findByIdAndUpdate(req.params.id, req.body, { new: true });
    
    // Rename transactions if name changes
    if (oldItem && oldItem.name !== req.body.name) {
      await Transaction.updateMany({ itemName: oldItem.name }, { $set: { itemName: req.body.name } });
    }
    res.json({ ...updatedItem._doc, id: updatedItem._id });
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
    res.json(txns.map(t => ({ ...t._doc, id: t._id })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/transactions', async (req, res) => {
  try {
    const newTxn = new Transaction(req.body);
    const savedTxn = await newTxn.save();
    res.json({ ...savedTxn._doc, id: savedTxn._id });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

app.put('/api/transactions/:id', async (req, res) => {
  try {
    const updatedTxn = await Transaction.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json({ ...updatedTxn._doc, id: updatedTxn._id });
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
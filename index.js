const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const app = express();

app.use(cors({ origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE'], allowedHeaders: ['Content-Type', 'Authorization'] }));
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

const transactionSchema = new mongoose.Schema({
  date: String,
  type: String, 
  itemName: String,
  quantity: Number,  
  altQty: Number,    
  remarks: String,
  unit: String,
  altUnit: String,
  rate: Number
});

transactionSchema.set('toJSON', { virtuals: true, versionKey: false, transform: function (doc, ret) { ret.id = ret._id; delete ret._id; } });
itemSchema.set('toJSON', { virtuals: true, versionKey: false, transform: function (doc, ret) { ret.id = ret._id; delete ret._id; } });

const Item = mongoose.model('Item', itemSchema);
const Transaction = mongoose.model('Transaction', transactionSchema);

app.get('/', (req, res) => res.send("Backend is Running! 🚀"));

// --- HELPER: CALCULATE ALT QTY ---
// This function runs on the server to ensure math is always correct
const calculateAltQty = async (txnBody) => {
  // If user provided a specific Alt Qty (and it's not 0), trust them.
  if (txnBody.altQty && parseFloat(txnBody.altQty) !== 0) {
    return parseFloat(txnBody.altQty);
  }

  // Otherwise, calculate it using the Item's factor
  try {
    const item = await Item.findOne({ name: txnBody.itemName });
    if (item && item.factor && item.factor !== "Manual" && item.factor !== "-") {
      const factor = parseFloat(item.factor);
      const qty = parseFloat(txnBody.quantity) || 0;
      if (!isNaN(factor) && !isNaN(qty)) {
        console.log(`Server Auto-Calc: ${qty} * ${factor} = ${qty * factor}`);
        return qty * factor;
      }
    }
  } catch (e) {
    console.error("Auto-calc failed:", e);
  }
  return 0; // Default to 0 if fails
};

// --- ROUTES ---

// GET ITEMS (With Aggregation)
app.get('/api/items', async (req, res) => {
  try {
    const items = await Item.find().lean();
    
    const itemsWithQty = await Promise.all(items.map(async (item) => {
      const cleanName = item.name.trim();
      // Fuzzy Search
      const txns = await Transaction.find({ 
        itemName: { $regex: new RegExp(`^${cleanName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') } 
      }).lean();
      
      const stats = txns.reduce((acc, t) => {
        const type = t.type ? t.type.toUpperCase().trim() : "IN";
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

      return { 
        ...item, 
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

app.post('/api/items', async (req, res) => {
  try {
    const newItem = new Item(req.body);
    const savedItem = await newItem.save();
    res.json(savedItem);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

app.put('/api/items/:id', async (req, res) => {
  try {
    const updatedItem = await Item.findByIdAndUpdate(req.params.id, req.body, { new: true });
    // Update Transaction Names
    await Transaction.updateMany({ itemName: req.body.name }, { $set: { itemName: req.body.name } });
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
    res.json({ message: "Deleted" });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/transactions', async (req, res) => {
  try {
    const txns = await Transaction.find().sort({ date: -1 });
    res.json(txns);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST TRANSACTION (With Server-Side Auto Calc)
app.post('/api/transactions', async (req, res) => {
  try {
    const payload = req.body;
    // Force Calculation on Server Side
    payload.altQty = await calculateAltQty(payload);
    
    const newTxn = new Transaction(payload);
    const savedTxn = await newTxn.save();
    res.json(savedTxn);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// PUT TRANSACTION (With Server-Side Auto Calc)
app.put('/api/transactions/:id', async (req, res) => {
  try {
    const payload = req.body;
    // Force Calculation on Server Side
    payload.altQty = await calculateAltQty(payload);

    const updatedTxn = await Transaction.findByIdAndUpdate(req.params.id, payload, { new: true });
    res.json(updatedTxn);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

app.delete('/api/transactions/:id', async (req, res) => {
  try {
    await Transaction.findByIdAndDelete(req.params.id);
    res.json({ message: "Deleted" });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (username === 'admin' && password === '123') res.json({ role: 'admin' });
  else res.status(401).json({ message: 'Invalid' });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
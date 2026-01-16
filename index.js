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

// Note: altQty is String to handle formats, but we parse it as float for math
const transactionSchema = new mongoose.Schema({
  date: String,
  type: String, 
  itemName: String,
  quantity: Number,
  altQty: String,
  remarks: String,
  unit: String,
  altUnit: String,
  rate: Number
});

const Item = mongoose.model('Item', itemSchema);
const Transaction = mongoose.model('Transaction', transactionSchema);

app.get('/', (req, res) => res.send("Backend is Running! 🚀"));

// --- MAIN ROUTE: GET ITEMS WITH CALCULATED TOTALS ---
app.get('/api/items', async (req, res) => {
  try {
    const items = await Item.find();
    
    const itemsWithQty = await Promise.all(items.map(async (item) => {
      // Find transactions for this item
      const txns = await Transaction.find({ itemName: item.name });
      
      // Calculate Totals
      const stats = txns.reduce((acc, t) => {
        // Normalize Type (handle "in", "IN", "In ")
        const type = t.type ? t.type.toUpperCase().trim() : "IN";
        
        // Parse Primary Qty
        const qty = parseFloat(t.quantity) || 0;
        
        // Parse Alt Qty (Handle "50", "50.5", null, "")
        // We convert to string first to be safe, then parse
        const rawAlt = t.altQty ? String(t.altQty) : "0";
        const altQty = parseFloat(rawAlt) || 0;

        if (type === 'IN') {
          acc.primary += qty;
          acc.alt += altQty;
        } else {
          acc.primary -= qty;
          acc.alt -= altQty;
        }
        return acc;
      }, { primary: 0, alt: 0 });

      return { 
        ...item._doc, 
        quantity: stats.primary, 
        altQuantity: stats.alt, // Sending the raw number (e.g. 50 or 0)
        id: item._id 
      };
    }));

    res.json(itemsWithQty);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- STANDARD ROUTES (Create, Update, Delete) ---

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
    if (!oldItem) return res.status(404).json({ error: "Item not found" });
    const updatedItem = await Item.findByIdAndUpdate(req.params.id, req.body, { new: true });
    
    // Cascading Rename
    if (oldItem.name !== req.body.name) {
      await Transaction.updateMany({ itemName: oldItem.name }, { $set: { itemName: req.body.name } });
    }
    res.json({ ...updatedItem._doc, id: updatedItem._id });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

app.delete('/api/items/:id', async (req, res) => {
  try {
    const item = await Item.findById(req.params.id);
    if (!item) return res.status(404).json({ error: "Item not found" });
    await Item.findByIdAndDelete(req.params.id);
    await Transaction.deleteMany({ itemName: item.name });
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
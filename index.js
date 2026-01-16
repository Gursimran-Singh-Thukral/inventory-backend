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

// --- ROUTES ---

// 1. GET ITEMS (DASHBOARD LOGIC)
app.get('/api/items', async (req, res) => {
  try {
    const items = await Item.find().lean();
    
    const itemsWithQty = await Promise.all(items.map(async (item) => {
      const cleanName = item.name.trim();
      
      // Find transactions
      const txns = await Transaction.find({ 
        itemName: { $regex: new RegExp(`^${cleanName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') } 
      }).lean();
      
      // 1. Calculate Primary Stock
      const stats = txns.reduce((acc, t) => {
        const type = t.type ? t.type.toUpperCase().trim() : "IN";
        const qty = Number(t.quantity) || 0;
        const alt = Number(t.altQty) || 0;

        if (type === 'IN') {
          acc.primary += qty;
          acc.altSum += alt; // Keep track of sum just in case
        } else {
          acc.primary -= qty;
          acc.altSum -= alt;
        }
        return acc;
      }, { primary: 0, altSum: 0 });

      // 2. CALCULATE DASHBOARD ALTERNATE QTY
      // Logic: If the Item has a Factor, use (Primary * Factor).
      //        If Manual/No Factor, use the Sum of history.
      let finalAltQty = stats.altSum; 

      if (item.factor && item.factor !== "Manual" && item.factor !== "-") {
        const factor = parseFloat(item.factor);
        if (!isNaN(factor)) {
          // FOOLPROOF MATH: Total Stock * Factor
          finalAltQty = stats.primary * factor;
        }
      }

      return { 
        ...item, 
        quantity: stats.primary, 
        altQuantity: finalAltQty, // Sends the calculated total
        id: item._id 
      };
    }));

    res.json(itemsWithQty);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. SAVE TRANSACTION (SERVER-SIDE CALCULATION)
const calculateAltQty = async (txnBody) => {
  if (txnBody.altQty && Number(txnBody.altQty) !== 0) return Number(txnBody.altQty);
  
  try {
    const item = await Item.findOne({ name: txnBody.itemName });
    if (item && item.factor && item.factor !== "Manual" && item.factor !== "-") {
      const factor = parseFloat(item.factor);
      const qty = parseFloat(txnBody.quantity) || 0;
      if (!isNaN(factor)) return qty * factor;
    }
  } catch (e) { console.error(e); }
  return 0;
};

app.post('/api/transactions', async (req, res) => {
  try {
    const payload = req.body;
    payload.altQty = await calculateAltQty(payload); // Ensure saved correctly
    const newTxn = new Transaction(payload);
    const savedTxn = await newTxn.save();
    res.json(savedTxn);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

app.put('/api/transactions/:id', async (req, res) => {
  try {
    const payload = req.body;
    payload.altQty = await calculateAltQty(payload); // Ensure saved correctly
    const updatedTxn = await Transaction.findByIdAndUpdate(req.params.id, payload, { new: true });
    res.json(updatedTxn);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// --- STANDARD CRUD ---
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
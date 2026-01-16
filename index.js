const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors());

// --- MONGODB CONNECTION ---
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
  altQty: String,
  remarks: String,
  unit: String,
  altUnit: String,
  rate: Number // <--- NEW: Purchase Rate
});

const Item = mongoose.model('Item', itemSchema);
const Transaction = mongoose.model('Transaction', transactionSchema);

// --- ROUTES ---

// GET ALL ITEMS (With Calculated Quantities)
app.get('/api/items', async (req, res) => {
  try {
    const items = await Item.find();
    
    // Calculate Current Quantity & Alternate Quantity dynamically
    const itemsWithQty = await Promise.all(items.map(async (item) => {
      const txns = await Transaction.find({ itemName: item.name });
      
      const qty = txns.reduce((acc, t) => {
        return t.type === 'IN' ? acc + t.quantity : acc - t.quantity;
      }, 0);

      // Calculate Alt Qty Remaining
      let altQtyRemaining = "-";
      if (item.altUnit && item.factor && item.factor !== "Manual" && item.factor !== "-") {
        const factor = parseFloat(item.factor);
        if (!isNaN(factor)) {
          altQtyRemaining = (qty * factor).toFixed(2); 
        }
      }

      return { 
        ...item._doc, 
        quantity: qty, 
        altQuantity: altQtyRemaining, // <--- NEW FIELD
        id: item._id 
      };
    }));

    res.json(itemsWithQty);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ... (KEEP THE REST OF THE ROUTES EXACTLY AS BEFORE: POST, PUT, DELETE for Items & Transactions, Login) ...
// Copy the previous POST/PUT/DELETE routes here.
// I will include the standardized routes below for safety to ensure nothing breaks.

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
    const oldName = oldItem.name;
    const newName = req.body.name;
    const updatedItem = await Item.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (oldName !== newName) {
      await Transaction.updateMany({ itemName: oldName }, { $set: { itemName: newName } });
    }
    res.json({ ...updatedItem._doc, id: updatedItem._id });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

app.delete('/api/items/:id', async (req, res) => {
  try {
    const item = await Item.findById(req.params.id);
    if (!item) return res.status(404).json({ error: "Item not found" });
    const itemName = item.name;
    await Item.findByIdAndDelete(req.params.id);
    await Transaction.deleteMany({ itemName: itemName });
    res.json({ message: "Item and history deleted" });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/transactions', async (req, res) => {
  try {
    const txns = await Transaction.find().sort({ date: -1 });
    const formattedTxns = txns.map(t => ({ ...t._doc, id: t._id }));
    res.json(formattedTxns);
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
  if (username === 'admin' && password === '123') {
    res.json({ role: 'admin', token: 'fake-jwt-token' });
  } else if (username === 'staff' && password === '123') {
    res.json({ role: 'staff', token: 'fake-jwt-token-staff' });
  } else {
    res.status(401).json({ message: 'Invalid credentials' });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors'); // Required for connecting to Frontend
require('dotenv').config();

const app = express();

// --- 1. ENABLE CORS FOR EVERYONE (Crucial Fix) ---
app.use(cors({
  origin: '*', 
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

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
  rate: Number
});

const Item = mongoose.model('Item', itemSchema);
const Transaction = mongoose.model('Transaction', transactionSchema);

// --- HEALTH CHECK ROUTE ---
app.get('/', (req, res) => {
  res.send("Backend is Running! 🚀");
});

// --- ROUTES ---

// 1. GET ALL ITEMS (Strict Summation from Transactions)
app.get('/api/items', async (req, res) => {
  try {
    const items = await Item.find();
    
    const itemsWithQty = await Promise.all(items.map(async (item) => {
      // Find all transactions for this specific item
      const txns = await Transaction.find({ itemName: item.name });
      
      // 1. Calculate Primary Qty (Sum of 'quantity' field)
      const qty = txns.reduce((acc, t) => {
        const val = parseFloat(t.quantity);
        const safeVal = isNaN(val) ? 0 : val;
        return t.type === 'IN' ? acc + safeVal : acc - safeVal;
      }, 0);

      // 2. Calculate Alternate Qty (Sum of 'altQty' field)
      // EXACTLY the same logic: Get the number from the transaction, sum it up.
      const totalAltQty = txns.reduce((acc, t) => {
        const val = parseFloat(t.altQty); // Read directly from Transaction
        const safeVal = isNaN(val) ? 0 : val; // If empty/invalid, assume 0
        return t.type === 'IN' ? acc + safeVal : acc - safeVal;
      }, 0);

      return { 
        ...item._doc, 
        quantity: qty, 
        altQuantity: totalAltQty, // Send the exact sum
        id: item._id 
      };
    }));

    res.json(itemsWithQty);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. ADD ITEM
app.post('/api/items', async (req, res) => {
  try {
    const newItem = new Item(req.body);
    const savedItem = await newItem.save();
    res.json({ ...savedItem._doc, id: savedItem._id, quantity: 0, altQuantity: 0 });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// 3. UPDATE ITEM (Cascading Rename)
app.put('/api/items/:id', async (req, res) => {
  try {
    const oldItem = await Item.findById(req.params.id);
    if (!oldItem) return res.status(404).json({ error: "Item not found" });

    const oldName = oldItem.name;
    const newName = req.body.name;

    const updatedItem = await Item.findByIdAndUpdate(req.params.id, req.body, { new: true });

    if (oldName !== newName) {
      console.log(`Renaming transactions from "${oldName}" to "${newName}"`);
      await Transaction.updateMany(
        { itemName: oldName },
        { $set: { itemName: newName } }
      );
    }

    res.json({ ...updatedItem._doc, id: updatedItem._id });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// 4. DELETE ITEM (Cascading Delete)
app.delete('/api/items/:id', async (req, res) => {
  try {
    const item = await Item.findById(req.params.id);
    if (!item) return res.status(404).json({ error: "Item not found" });

    const itemName = item.name;

    await Item.findByIdAndDelete(req.params.id);
    await Transaction.deleteMany({ itemName: itemName });
    
    console.log(`Deleted Item "${itemName}" and all its transactions.`);

    res.json({ message: "Item and history deleted" });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- TRANSACTION ROUTES ---
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

// LOGIN MOCK
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (username === 'admin' && password === '123') res.json({ role: 'admin' });
  else if (username === 'staff' && password === '123') res.json({ role: 'staff' });
  else res.status(401).json({ message: 'Invalid credentials' });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
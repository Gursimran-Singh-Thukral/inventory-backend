import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

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

// Added index for faster sorting
const transactionSchema = new mongoose.Schema({
  date: String,
  type: String, 
  itemName: { type: String, index: true }, 
  quantity: Number,  
  altQty: mongoose.Schema.Types.Mixed,
  remarks: String,
  unit: String,
  altUnit: String,
  rate: Number
});

// JSON Helpers
transactionSchema.set('toJSON', { virtuals: true, versionKey: false, transform: function (doc, ret) { ret.id = ret._id; delete ret._id; } });
itemSchema.set('toJSON', { virtuals: true, versionKey: false, transform: function (doc, ret) { ret.id = ret._id; delete ret._id; } });

const Item = mongoose.model('Item', itemSchema);
const Transaction = mongoose.model('Transaction', transactionSchema);

app.get('/', (req, res) => res.send("Backend is Running! 🚀"));

// --- STREAMING GET ITEMS (ZERO RAM USAGE) ---
app.get('/api/items', async (req, res) => {
  try {
    // 1. Fetch Items (Fast)
    const items = await Item.find().select('name unit altUnit factor alertQty').lean();
    
    // 2. Prepare the Map
    const stockMap = {}; 
    
    // 3. STREAM Transactions (One by One)
    // This cursor acts like a stream. It never loads the full list into RAM.
    const cursor = Transaction.find({}, 'itemName type quantity altQty').cursor();

    for (let t = await cursor.next(); t != null; t = await cursor.next()) {
      if (!t.itemName) continue;

      const key = t.itemName.toString().trim().toLowerCase();
      
      if (!stockMap[key]) {
        stockMap[key] = { primary: 0, alt: 0 };
      }

      const type = t.type ? t.type.toUpperCase().trim() : "IN";
      const qty = Number(t.quantity) || 0;
      
      // Parse Alt Qty
      let rawAlt = t.altQty || 0;
      // Simple parse to avoid RegEx overhead on every row if possible
      let altVal = typeof rawAlt === 'number' ? rawAlt : parseFloat(String(rawAlt).replace(/[^0-9.]/g, "")) || 0;

      if (type === 'IN') {
        stockMap[key].primary += qty;
        stockMap[key].alt += altVal;
      } else {
        stockMap[key].primary -= qty;
        stockMap[key].alt -= altVal;
      }
    }

    // 4. Merge results
    const itemsWithQty = items.map(item => {
      const name = item.name ? item.name.toString() : "";
      const cleanName = name.trim().toLowerCase();
      const stats = stockMap[cleanName] || { primary: 0, alt: 0 };

      return { 
        ...item, 
        quantity: stats.primary, 
        altQuantity: stats.alt, 
        id: item._id.toString()
      };
    });

    res.json(itemsWithQty);
  } catch (err) {
    console.error("STREAM ERROR:", err);
    res.status(500).json({ error: "Server Error" });
  }
});

// --- CRUD API ---

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
    // Update background
    if (updatedItem) Transaction.updateMany({ itemName: req.body.name }, { $set: { itemName: req.body.name } }).catch(() => {});
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
    const txns = await Transaction.find().sort({ date: -1 }).limit(200);
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
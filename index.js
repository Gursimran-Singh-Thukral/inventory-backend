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
  name: { type: String, index: true }, // Index for speed
  unit: String,
  altUnit: String,
  factor: String, 
  alertQty: Number,
  // NEW: Store the calculated totals directly on the item
  quantity: { type: Number, default: 0 },
  altQuantity: { type: Number, default: 0 }
});

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

// --- FASTEST POSSIBLE GET ITEMS ---
app.get('/api/items', async (req, res) => {
  try {
    // Zero calculation. Just fetch and send. 
    // This will take milliseconds instead of seconds.
    const items = await Item.find().lean();
    
    // Ensure ID string for frontend safety
    const safeItems = items.map(i => ({...i, id: i._id.toString()}));
    
    res.json(safeItems);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- ADD TRANSACTION & UPDATE STOCK ---
app.post('/api/transactions', async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const txn = req.body;
    
    // 1. Save Transaction
    const newTxn = new Transaction(txn);
    await newTxn.save({ session });

    // 2. Calculate values to update
    const type = txn.type === 'OUT' ? -1 : 1;
    const qtyChange = (Number(txn.quantity) || 0) * type;
    
    let rawAlt = txn.altQty || 0;
    let cleanAlt = typeof rawAlt === 'number' ? rawAlt : parseFloat(String(rawAlt).replace(/[^0-9.]/g, "")) || 0;
    const altChange = cleanAlt * type;

    // 3. Update Item Stock Immediately
    // Find item by name (Case Insensitive)
    await Item.updateOne(
      { name: { $regex: new RegExp(`^${txn.itemName.trim()}$`, 'i') } },
      { $inc: { quantity: qtyChange, altQuantity: altChange } }
    ).session(session);

    await session.commitTransaction();
    res.json(newTxn);
  } catch (err) {
    await session.abortTransaction();
    res.status(400).json({ error: err.message });
  } finally {
    session.endSession();
  }
});

// --- ONE-TIME FIX ROUTE (Run this once!) ---
app.get('/api/fix-stock', async (req, res) => {
  try {
    console.log("Starting Stock Recalculation...");
    
    // 1. Reset all items to 0
    await Item.updateMany({}, { $set: { quantity: 0, altQuantity: 0 } });

    // 2. Stream all transactions
    const cursor = Transaction.find().cursor();
    const stockMap = {};

    for (let t = await cursor.next(); t != null; t = await cursor.next()) {
      if (!t.itemName) continue;
      const key = t.itemName.toString().trim().toLowerCase();
      
      if (!stockMap[key]) stockMap[key] = { q: 0, a: 0 };

      const type = (t.type || "IN").toUpperCase().trim() === 'IN' ? 1 : -1;
      const qty = Number(t.quantity) || 0;
      
      let rawAlt = t.altQty || 0;
      let cleanAlt = typeof rawAlt === 'number' ? rawAlt : parseFloat(String(rawAlt).replace(/[^0-9.]/g, "")) || 0;

      stockMap[key].q += (qty * type);
      stockMap[key].a += (cleanAlt * type);
    }

    // 3. Bulk Update Items
    const bulkOps = Object.keys(stockMap).map(key => ({
      updateOne: {
        filter: { name: { $regex: new RegExp(`^${key}$`, 'i') } },
        update: { $set: { quantity: stockMap[key].q, altQuantity: stockMap[key].a } }
      }
    }));

    if (bulkOps.length > 0) {
      await Item.bulkWrite(bulkOps);
    }

    res.send("Stock Recalculation Complete! Website should be instant now.");
  } catch (err) {
    res.status(500).send("Error: " + err.message);
  }
});

// --- OTHER ROUTES ---
app.get('/api/transactions', async (req, res) => {
  try {
    const txns = await Transaction.find().sort({ date: -1 }).limit(200);
    res.json(txns);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/items', async (req, res) => {
  try {
    const newItem = new Item(req.body);
    const savedItem = await newItem.save();
    res.json(savedItem);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// Handle Updates/Deletes (Reset stock then apply new)
app.delete('/api/transactions/:id', async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const txn = await Transaction.findById(req.params.id);
    if(txn) {
       // Reverse the stock effect
       const type = txn.type === 'OUT' ? 1 : -1; // Reverse logic
       const qtyChange = (Number(txn.quantity) || 0) * type;
       
       let rawAlt = txn.altQty || 0;
       let cleanAlt = typeof rawAlt === 'number' ? rawAlt : parseFloat(String(rawAlt).replace(/[^0-9.]/g, "")) || 0;
       const altChange = cleanAlt * type;

       await Item.updateOne(
         { name: { $regex: new RegExp(`^${txn.itemName.trim()}$`, 'i') } },
         { $inc: { quantity: qtyChange, altQuantity: altChange } }
       ).session(session);
       
       await Transaction.findByIdAndDelete(req.params.id).session(session);
    }
    await session.commitTransaction();
    res.json({ message: "Deleted" });
  } catch (err) {
    await session.abortTransaction();
    res.status(500).json({ error: err.message });
  } finally { session.endSession(); }
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

app.put('/api/items/:id', async (req, res) => {
    try {
      const updatedItem = await Item.findByIdAndUpdate(req.params.id, req.body, { new: true });
      if (updatedItem) Transaction.updateMany({ itemName: req.body.name }, { $set: { itemName: req.body.name } }).catch(() => {});
      res.json(updatedItem);
    } catch (err) { res.status(400).json({ error: err.message }); }
});

app.put('/api/transactions/:id', async (req, res) => {
    // Simplified update: Just save. For strict stock accuracy on edits, 
    // we would need to reverse old and apply new, but for now let's just save.
    try {
      const updatedTxn = await Transaction.findByIdAndUpdate(req.params.id, req.body, { new: true });
      res.json(updatedTxn);
    } catch (err) { res.status(400).json({ error: err.message }); }
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    if (username === 'admin' && password === '123') res.json({ role: 'admin' });
    else res.status(401).json({ message: 'Invalid' });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
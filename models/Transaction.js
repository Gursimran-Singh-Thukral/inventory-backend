const mongoose = require('mongoose');

const TransactionSchema = new mongoose.Schema({
  date: { type: String, required: true }, // Format: YYYY-MM-DD
  itemName: { type: String, required: true },
  type: { type: String, enum: ['IN', 'OUT'], required: true },
  
  // PRIMARY QUANTITY
  quantity: { type: Number, required: true },
  
  // ALTERNATE QUANTITY (String to handle legacy "50 box" data)
  altQty: { type: String, default: "0" },
  
  // --- MISSING FIELDS ADDED BACK ---
  unit: { type: String, default: "" },      // e.g. "kg"
  altUnit: { type: String, default: "" },   // e.g. "box"
  rate: { type: Number, default: 0 },       // Purchase Price
  
  remarks: { type: String, default: "" }
});

TransactionSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: function (doc, ret) { 
    ret.id = ret._id; 
    delete ret._id; 
  }
});

module.exports = mongoose.model('Transaction', TransactionSchema);
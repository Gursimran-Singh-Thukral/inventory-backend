const mongoose = require('mongoose');

const TransactionSchema = new mongoose.Schema({
  date: { type: String, required: true }, // Format: YYYY-MM-DD
  itemName: { type: String, required: true },
  type: { type: String, enum: ['IN', 'OUT'], required: true },
  quantity: { type: Number, required: true },
  altQty: { type: String, default: "-" },
  remarks: { type: String, default: "" }
});

TransactionSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: function (doc, ret) { delete ret._id; }
});

module.exports = mongoose.model('Transaction', TransactionSchema);
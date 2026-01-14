const mongoose = require('mongoose');

const ItemSchema = new mongoose.Schema({
  name: { type: String, required: true },
  unit: { type: String, required: true },
  altUnit: { type: String, default: "-" },
  factor: { type: String, default: "Manual" }, // e.g., "50" or "Manual"
  alertQty: { type: Number, required: true },
  quantity: { type: Number, default: 0 } // Live Stock Count
});

// This helps frontend use 'id' instead of '_id'
ItemSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: function (doc, ret) { delete ret._id; }
});

module.exports = mongoose.model('Item', ItemSchema);
const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true }, // In a real app, we would hash this!
  role: { type: String, enum: ['admin', 'staff'], required: true }
});

UserSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: function (doc, ret) { delete ret._id; delete ret.password; }
});

module.exports = mongoose.model('User', UserSchema);
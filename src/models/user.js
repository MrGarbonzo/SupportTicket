const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  telegramId: {
    type: Number,
    required: true,
    unique: true,
  },
  username: {
    type: String,
    required: false,
  },
  firstName: {
    type: String,
    required: false,
  },
  lastName: {
    type: String,
    required: false,
  },
  isStaff: {
    type: Boolean,
    default: false,
  },
  role: {
    type: String,
    enum: ['user', 'support', 'admin'],
    default: 'user',
  },
  state: {
    type: Object,
    default: {},
  },
  activeTicket: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Ticket',
    required: false,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  lastActive: {
    type: Date,
    default: Date.now,
  },
});

const User = mongoose.model('User', UserSchema);

module.exports = User;
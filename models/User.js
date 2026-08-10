const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema(
  {
    name: { 
      type: String, 
      required: true 
    },
    email: { 
      type: String, 
      required: true, 
      unique: true, 
      lowercase: true,
      trim: true
    },
    password: { 
      type: String, 
      required: true 
    },
    subscriptionStatus: { 
      type: String, 
      enum: ['active', 'inactive', 'trial'], 
      default: 'inactive' 
    },
    isTrial: {
      type: Boolean,
      default: false
    },
    trialRenderLimit: {
      type: Number,
      default: 0
    },
    renderCount: {
      type: Number,
      default: 0
    },
    licenseKey: { 
      type: String 
    },
    expiresAt: { 
      type: Date 
    },
    maxDevices: { 
      type: Number, 
      default: 2 
    },
    devices: [
      {
        deviceId    : { type: String, required: true },
        deviceName  : { type: String },
        platform    : { type: String },
        osVersion   : { type: String },
        machineName : { type: String },
        refreshToken: { type: String },
        registeredAt: { type: Date, default: Date.now },
        lastSeen    : { type: Date, default: Date.now }
      }
    ],
    isAdmin: {
      type: Boolean,
      default: false
    },
    singleActiveSession: {
      type: Boolean,
      default: false
    },
    currentSessionToken: {
      type: String
    }
  },
  { timestamps: true }
);

// Hash password before saving
userSchema.pre('save', async function () {
  if (!this.isModified('password')) return;
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

// Compare password method
userSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

module.exports = mongoose.model('User', userSchema);

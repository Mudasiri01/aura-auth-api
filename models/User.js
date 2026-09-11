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

    // ── Role ─────────────────────────────────────────────────────────────────
    // 'user' | 'admin'
    // Kept in sync with legacy isAdmin field via pre-save hook (see below).
    role: {
      type: String,
      enum: ['user', 'admin'],
      default: 'user'
    },

    // ── Account Status ───────────────────────────────────────────────────────
    // Controlled by Admin only. Never trusted from client.
    status: {
      type: String,
      enum: ['active', 'suspended', 'disabled'],
      default: 'active'
    },

    // ── Subscription ─────────────────────────────────────────────────────────
    subscriptionStatus: { 
      type: String, 
      enum: ['active', 'inactive', 'trial', 'cancelled'], 
      default: 'inactive' 
    },
    subscriptionStartDate: {
      type: Date
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

    // ── Devices ───────────────────────────────────────────────────────────────
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

    // ── Legacy Admin Flag (kept for backward compatibility) ───────────────────
    // isAdmin is kept in sync with role. Both are checked in adminMiddleware.
    isAdmin: {
      type: Boolean,
      default: false
    },

    // ── Session ───────────────────────────────────────────────────────────────
    singleActiveSession: {
      type: Boolean,
      default: false
    },
    currentSessionToken: {
      type: String
    },

    // ── Tracking ──────────────────────────────────────────────────────────────
    lastLogin: {
      type: Date
    }
  },
  { timestamps: true }
);

// ─── Pre-save: Hash password ─────────────────────────────────────────────────
userSchema.pre('save', async function () {
  if (this.isModified('password')) {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
  }

  // ── Sync role ↔ isAdmin (backward compatibility) ───────────────────────────
  // If isAdmin was set directly (legacy code path), sync role.
  // If role was set directly (new code path), sync isAdmin.
  if (this.isModified('isAdmin')) {
    this.role = this.isAdmin ? 'admin' : 'user';
  } else if (this.isModified('role')) {
    this.isAdmin = this.role === 'admin';
  } else if (this.isNew) {
    // On creation: derive each from the other
    if (this.isAdmin && this.role === 'user') {
      this.role = 'admin';
    } else if (this.role === 'admin' && !this.isAdmin) {
      this.isAdmin = true;
    }
  }
});

// ─── Compare password ────────────────────────────────────────────────────────
userSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

module.exports = mongoose.model('User', userSchema);

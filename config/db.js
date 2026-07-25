const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    if (!process.env.MONGO_URI) {
      console.error('Error connecting to MongoDB:\nMONGO_URI is not defined in environment variables');
      process.exit(1);
    }
    const conn = await mongoose.connect(process.env.MONGO_URI);
    console.log(`✅ MongoDB Connected Successfully: ${conn.connection.host}`);
  } catch (error) {
    console.error(`Error connecting to MongoDB:\n${error.message}`);
    process.exit(1);
  }
};

module.exports = connectDB;

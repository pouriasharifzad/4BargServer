const mongoose = require('mongoose');

const connectDB = async () => {
    console.log('Attempting to connect to MongoDB...');
    try {
        const connection = await mongoose.connect('mongodb://localhost/4Bargdb', {
            useNewUrlParser: true,
            useUnifiedTopology: true,
            serverSelectionTimeoutMS: 5000 // 5 ثانیه تایم‌اوت
        });
        console.log('Connected to MongoDB:', connection.connection.host);
    } catch (err) {
        console.error('MongoDB connection error:', err);
        process.exit(1);
    }
};

module.exports = connectDB;
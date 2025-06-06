const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    experience: { type: Number, default: 500 },
    coins: { type: Number, default: 500 },
    avatar: { type: String, default: null },
    usernameChanged: { type: Boolean, default: false }
});

module.exports = mongoose.model('User', userSchema);
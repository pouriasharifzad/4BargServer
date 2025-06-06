const jwt = require('jsonwebtoken');
const User = require('../models/User');

const JWT_SECRET = 'your-secret-key';

const verifyToken = (socket, data) => {
    console.log(`[${socket.id}] Received verify_token request`);
    const { requestId, token } = data;
    jwt.verify(token, JWT_SECRET, (err, decoded) => {
        if (err) {
            console.log(`[${socket.id}] Token verification failed: ${err.message}`);
            socket.emit('verify_token_response', {
                requestId,
                success: false,
                message: 'توکن نامعتبر است'
            });
        } else {
            console.log(`[${socket.id}] Token verified, userId: ${decoded.userId}`);
            socket.emit('verify_token_response', {
                requestId,
                success: true,
                userId: decoded.userId
            });
        }
    });
};

const register = async (socket, request) => {
    console.log(`[${socket.id}] Received register request: ${JSON.stringify(request)}`);
    const { requestId, data } = request;
    if (!data || typeof data !== 'object') {
        console.log(`[${socket.id}] Invalid data in register request: ${JSON.stringify(data)}`);
        socket.emit('register_response', {
            requestId,
            success: false,
            message: 'داده‌های ارسالی نامعتبر است'
        });
        return;
    }
    const { username, email, password } = data;
    if (!username || !email || !password) {
        console.log(`[${socket.id}] Missing fields in data: ${JSON.stringify(data)}`);
        socket.emit('register_response', {
            requestId,
            success: false,
            message: 'همه فیلدها باید پر شوند'
        });
        return;
    }
    try {
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            console.log(`[${socket.id}] Email already exists: ${email}`);
            socket.emit('register_response', {
                requestId,
                success: false,
                message: 'ایمیل قبلاً ثبت شده است'
            });
            return;
        }
        const user = new User({ username, email, password });
        await user.save();
        const token = jwt.sign({ userId: user._id }, JWT_SECRET, { expiresIn: '90d' });
        console.log(`[${socket.id}] User registered, userId: ${user._id}`);
        socket.emit('register_response', {
            requestId,
            success: true,
            message: 'Registered successfully',
            userId: user._id,
            username: user.username,
            token
        });
    } catch (err) {
        console.error(`[${socket.id}] Register error: ${err.message}`);
        socket.emit('register_response', {
            requestId,
            success: false,
            message: 'خطا در ثبت‌نام'
        });
    }
};

const login = async (socket, request) => {
    console.log(`[${socket.id}] Received login request: ${JSON.stringify(request)}`);
    const { requestId, data } = request;
    if (!data || typeof data !== 'object') {
        console.log(`[${socket.id}] Invalid data in login request: ${JSON.stringify(data)}`);
        socket.emit('login_response', {
            requestId,
            success: false,
            message: 'داده‌های ارسالی نامعتبر است'
        });
        return;
    }
    const { email, password } = data;
    if (!email || !password) {
        console.log(`[${socket.id}] Missing fields in data: ${JSON.stringify(data)}`);
        socket.emit('login_response', {
            requestId,
            success: false,
            message: 'ایمیل و رمز عبور باید وارد شوند'
        });
        return;
    }
    try {
        const user = await User.findOne({ email, password });
        if (!user) {
            console.log(`[${socket.id}] Login failed: Invalid email or password`);
            socket.emit('login_response', {
                requestId,
                success: false,
                message: 'ایمیل یا رمز عبور اشتباه است'
            });
            return;
        }
        const token = jwt.sign({ userId: user._id }, JWT_SECRET, { expiresIn: '90d' });
        console.log(`[${socket.id}] Token verified, userId: ${user._id}`);
        socket.emit('login_response', {
            requestId,
            success: true,
            message: 'Logged in successfully',
            userId: user._id,
            username: user.username,
            token
        });
    } catch (err) {
        console.error(`[${socket.id}] Login error: ${err.message}`);
        socket.emit('login_response', {
            requestId,
            success: false,
            message: 'خطا در ورود'
        });
    }
};

const refreshToken = async (socket, request) => {
    console.log(`[${socket.id}] Received refresh_token request: ${JSON.stringify(request)}`);
    const { requestId, data } = request;
    if (!data || typeof data !== 'object' || !data.token) {
        console.log(`[${socket.id}] Invalid data in refresh_token request: ${JSON.stringify(data)}`);
        socket.emit('refresh_token_response', {
            requestId,
            success: false,
            message: 'داده‌های ارسالی نامعتبر است'
        });
        return;
    }
    const { token } = data;
    try {
        jwt.verify(token, JWT_SECRET, (err, decoded) => {
            if (err) {
                console.log(`[${socket.id}] Refresh token verification failed: ${err.message}`);
                socket.emit('refresh_token_response', {
                    requestId,
                    success: false,
                    message: 'توکن نامعتبر است'
                });
                return;
            }
            const newToken = jwt.sign({ userId: decoded.userId }, JWT_SECRET, { expiresIn: '90d' });
            console.log(`[${socket.id}] Token refreshed, new token generated for userId: ${decoded.userId}`);
            socket.emit('refresh_token_response', {
                requestId,
                success: true,
                token: newToken,
                message: 'توکن با موفقیت رفرش شد'
            });
        });
    } catch (err) {
        console.error(`[${socket.id}] Refresh token error: ${err.message}`);
        socket.emit('refresh_token_response', {
            requestId,
            success: false,
            message: 'خطا در رفرش توکن'
        });
    }
};

module.exports = { verifyToken, register, login, refreshToken };
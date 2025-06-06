const jwt = require('jsonwebtoken');

const JWT_SECRET = 'your-secret-key';

const authenticateToken = (socket, request, next) => {
    const { data, token } = request;
    if (!token) {
        console.log(`[${socket.id}] No token provided for event: ${data?.event || 'undefined'}`);
        socket.emit(`${data?.event || 'unknown'}_response`, {
            requestId: request.requestId,
            success: false,
            message: '???? ???? ???? ???'
        });
        return;
    }
    jwt.verify(token, JWT_SECRET, (err, decoded) => {
        if (err) {
            console.log(`[${socket.id}] Invalid token for event: ${data?.event || 'undefined'}`);
            socket.emit(`${data?.event || 'unknown'}_response`, {
                requestId: request.requestId,
                success: false,
                message: '???? ??????? ???'
            });
            return;
        }
        socket.userId = decoded.userId;
        console.log(`[${socket.id}] Token verified, userId: ${socket.userId}`);
        next();
    });
};

module.exports = { authenticateToken };
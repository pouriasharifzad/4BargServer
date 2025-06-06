const userStatusMap = new Map(); // Global Map to track user statuses

// Function to update user status and broadcast to clients
const updateUserStatus = (io, userId, status) => {
    console.log(`[userStatus] Updating status for userId: ${userId} to ${status}`);
    userStatusMap.set(userId, status);
    console.log(`[userStatus] Current userStatusMap: ${JSON.stringify([...userStatusMap.entries()])}`);
    io.emit('user_status_update', { userId, status });
    console.log(`[userStatus] Emitted user_status_update for userId: ${userId}, status: ${status}`);
};

module.exports = { updateUserStatus, userStatusMap };
const User = require('../models/User');
const FriendRequest = require('../models/FriendRequest');
const Friendship = require('../models/Friendship');

const searchUsers = async (socket, request) => {
    const { requestId, data } = request;
    const { query } = data;
    console.log(`[Server] Received searchUsers request - requestId: ${requestId}, query: ${query}`);
    try {
        const users = await User.find({
            $or: [
                { username: { $regex: query, $options: 'i' } },
                { email: { $regex: query, $options: 'i' } }
            ]
        }).select('username email experience avatar');
        console.log(`[Server] Sending searchUsers response - requestId: ${requestId}, users count: ${users.length}`);
        socket.emit('search_users_response', { requestId, success: true, users });
    } catch (err) {
        console.error(`[Server] Error in searchUsers - requestId: ${requestId}, error: ${err.message}`);
        socket.emit('search_users_response', { requestId, success: false, message: 'خطا در جستجوی کاربران' });
    }
};

const sendFriendRequest = async (socket, request) => {
    const { requestId, data } = request;
    const { toUserId } = data;
    console.log(`[Server] Received sendFriendRequest request - requestId: ${requestId}, toUserId: ${toUserId}`);
    try {
        const existingRequest = await FriendRequest.findOne({ from: socket.userId, to: toUserId });
        if (existingRequest) {
            console.log(`[Server] Sending sendFriendRequest response - requestId: ${requestId}, message: درخواست دوستی قبلاً ارسال شده است`);
            socket.emit('send_friend_request_response', { requestId, success: false, message: 'درخواست دوستی قبلاً ارسال شده است' });
            return;
        }
        const friendRequest = new FriendRequest({ from: socket.userId, to: toUserId });
        await friendRequest.save();
        console.log(`[Server] Sending sendFriendRequest response - requestId: ${requestId}, message: درخواست دوستی ارسال شد`);
        socket.emit('send_friend_request_response', { requestId, success: true, message: 'درخواست دوستی ارسال شد' });
    } catch (err) {
        console.error(`[Server] Error in sendFriendRequest - requestId: ${requestId}, error: ${err.message}`);
        socket.emit('send_friend_request_response', { requestId, success: false, message: 'خطا در ارسال درخواست دوستی' });
    }
};

const getFriendRequests = async (socket, request) => {
    const { requestId } = request;
    console.log(`[Server] Received getFriendRequests request - requestId: ${requestId}`);
    try {
        const requests = await FriendRequest.find({ to: socket.userId, status: 'pending' }).populate('from', 'username avatar');
        console.log(`[Server] Sending getFriendRequests response - requestId: ${requestId}, requests count: ${requests.length}`);
        socket.emit('get_friend_requests_response', { requestId, success: true, requests });
    } catch (err) {
        console.error(`[Server] Error in getFriendRequests - requestId: ${requestId}, error: ${err.message}`);
        socket.emit('get_friend_requests_response', { requestId, success: false, message: 'خطا در دریافت درخواست‌های دوستی' });
    }
};

const acceptFriendRequest = async (socket, request) => {
    const { requestId, data } = request;
    const { requestId: friendRequestId } = data;
    console.log(`[Server] Received acceptFriendRequest request - requestId: ${requestId}, friendRequestId: ${friendRequestId}`);
    try {
        const friendRequest = await FriendRequest.findById(friendRequestId);
        if (!friendRequest || friendRequest.to.toString() !== socket.userId) {
            console.log(`[Server] Sending acceptFriendRequest response - requestId: ${requestId}, message: درخواست دوستی نامعتبر است`);
            socket.emit('accept_friend_request_response', { requestId, success: false, message: 'درخواست دوستی نامعتبر است' });
            return;
        }
        friendRequest.status = 'accepted';
        await friendRequest.save();
        const friendship = new Friendship({ user1: friendRequest.from, user2: friendRequest.to });
        await friendship.save();
        console.log(`[Server] Sending acceptFriendRequest response - requestId: ${requestId}, message: درخواست دوستی پذیرفته شد`);
        socket.emit('accept_friend_request_response', { requestId, success: true, message: 'درخواست دوستی پذیرفته شد' });
    } catch (err) {
        console.error(`[Server] Error in acceptFriendRequest - requestId: ${requestId}, error: ${err.message}`);
        socket.emit('accept_friend_request_response', { requestId, success: false, message: 'خطا در پذیرش درخواست دوستی' });
    }
};

const rejectFriendRequest = async (socket, request) => {
    const { requestId, data } = request;
    const { requestId: friendRequestId } = data;
    console.log(`[Server] Received rejectFriendRequest request - requestId: ${requestId}, friendRequestId: ${friendRequestId}`);
    try {
        const friendRequest = await FriendRequest.findById(friendRequestId);
        if (!friendRequest || friendRequest.to.toString() !== socket.userId) {
            console.log(`[Server] Sending rejectFriendRequest response - requestId: ${requestId}, message: درخواست دوستی نامعتبر است`);
            socket.emit('reject_friend_request_response', { requestId, success: false, message: 'درخواست دوستی نامعتبر است' });
            return;
        }
        friendRequest.status = 'rejected';
        await friendRequest.save();
        console.log(`[Server] Sending rejectFriendRequest response - requestId: ${requestId}, message: درخواست دوستی رد شد`);
        socket.emit('reject_friend_request_response', { requestId, success: true, message: 'درخواست دوستی رد شد' });
    } catch (err) {
        console.error(`[Server] Error in rejectFriendRequest - requestId: ${requestId}, error: ${err.message}`);
        socket.emit('reject_friend_request_response', { requestId, success: false, message: 'خطا در رد درخواست دوستی' });
    }
};

const getFriends = async (socket, request) => {
    const { requestId } = request;
    console.log(`[Server] Received getFriends request - requestId: ${requestId}`);
    try {
        const friendships = await Friendship.find({
            $or: [{ user1: socket.userId }, { user2: socket.userId }]
        }).populate('user1', 'username avatar experience').populate('user2', 'username avatar experience');
        const friends = friendships.map(friendship => {
            if (friendship.user1._id.toString() === socket.userId) {
                return friendship.user2;
            } else {
                return friendship.user1;
            }
        });
        console.log(`[Server] Sending getFriends response - requestId: ${requestId}, friends count: ${friends.length}`);
        socket.emit('get_friends_response', { requestId, success: true, friends });
    } catch (err) {
        console.error(`[Server] Error in getFriends - requestId: ${requestId}, error: ${err.message}`);
        socket.emit('get_friends_response', { requestId, success: false, message: 'خطا در دریافت لیست دوستان' });
    }
};

module.exports = {
    searchUsers,
    sendFriendRequest,
    getFriendRequests,
    acceptFriendRequest,
    rejectFriendRequest,
    getFriends
};
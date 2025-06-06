const User = require('../models/User');
const PendingAvatar = require('../models/PendingAvatar');

const getProfile = (socket, request) => {
    const { requestId, data } = request;
    const { userId } = data;
    console.log(`[${socket.id}] Received get_profile for userId: ${userId}`);

    User.findById(userId)
        .then(user => {
            if (!user) {
                socket.emit('get_profile_response', { requestId, success: false, message: 'کاربر پیدا نشد' });
                return;
            }

            const profileData = {
                username: user.username,
                email: user.email,
                experience: user.experience,
                coins: user.coins,
                avatar: user.avatar || null
            };
            socket.emit('get_profile_response', { requestId, success: true, data: profileData });
        })
        .catch(err => {
            socket.emit('get_profile_response', { requestId, success: false, message: 'خطا در دریافت اطلاعات' });
            console.error(`[${socket.id}] Error in get_profile: ${err.message}`);
        });
};

const updateProfile = (socket, request) => {
    const { requestId, data } = request;
    const { userId, username } = data;
    console.log(`[${socket.id}] Received update_profile: ${JSON.stringify({ userId, username })}`);

    User.findById(userId)
        .then(user => {
            if (!user) {
                socket.emit('update_profile_response', { requestId, success: false, message: 'کاربر پیدا نشد' });
                return;
            }

            if (username && username !== user.username) {
                if (user.usernameChanged) {
                    socket.emit('update_profile_response', { 
                        requestId, 
                        success: false, 
                        message: 'نام کاربری قبلاً تغییر کرده و قابل ویرایش مجدد نیست' 
                    });
                    return;
                }
                return User.findOne({ username })
                    .then(existingUser => {
                        if (existingUser && existingUser._id.toString() !== userId) {
                            socket.emit('update_profile_response', { 
                                requestId, 
                                success: false, 
                                message: 'این نام کاربری قبلاً استفاده شده است' 
                            });
                            return;
                        }
                        user.username = username;
                        user.usernameChanged = true;
                        return user.save()
                            .then(() => {
                                socket.emit('update_profile_response', { 
                                    requestId, 
                                    success: true, 
                                    message: 'پروفایل با موفقیت به‌روزرسانی شد' 
                                });
                            });
                    });
            } else {
                return user.save()
                    .then(() => {
                        socket.emit('update_profile_response', { 
                            requestId, 
                            success: true, 
                            message: 'پروفایل با موفقیت به‌روزرسانی شد' 
                        });
                    });
            }
        })
        .catch(err => {
            socket.emit('update_profile_response', { 
                requestId, 
                success: false, 
                message: 'خطا در به‌روزرسانی' 
            });
            console.error(`[${socket.id}] Error in update_profile: ${err.message}`);
        });
};

const handleAvatarUpdate = (user, avatar, socket, requestId) => {
    if (avatar) {
        const pendingAvatar = new PendingAvatar({
            userId: user._id,
            avatar: avatar
        });
        return pendingAvatar.save()
            .then(() => {
                socket.emit('update_profile_response', { 
                    requestId, 
                    success: true, 
                    message: 'نام کاربری با موفقیت به‌روزرسانی شد. آواتار شما در انتظار تأیید است.' 
                });
                socket.broadcast.emit('new_pending_avatar', { userId: user._id, avatar });
            });
    } else {
        return user.save()
            .then(() => {
                socket.emit('update_profile_response', { 
                    requestId, 
                    success: true, 
                    message: 'پروفایل با موفقیت به‌روزرسانی شد' 
                });
            });
    }
};

const getPendingAvatars = async (req, res) => {
    try {
        const pendingAvatars = await PendingAvatar.find({ status: 'pending' })
            .populate({
                path: 'userId',
                select: 'username',
                match: { username: { $exists: true } }
            })
            .sort({ createdAt: -1 });

        const validAvatars = pendingAvatars.filter(avatar => avatar.userId !== null);

        res.render('admin/avatars', { pendingAvatars: validAvatars });
    } catch (err) {
        console.error('Error fetching pending avatars:', err.message);
        res.status(500).send(`خطا در دریافت آواتارهای در انتظار: ${err.message}`);
    }
};

const approveAvatar = async (req, res) => {
    const { id } = req.params;
    try {
        const pendingAvatar = await PendingAvatar.findById(id);
        if (!pendingAvatar) {
            return res.status(404).send('آواتار پیدا نشد');
        }

        const user = await User.findById(pendingAvatar.userId);
        if (!user) {
            return res.status(404).send('کاربر پیدا نشد');
        }

        user.avatar = pendingAvatar.avatar;
        pendingAvatar.status = 'approved';
        await user.save();
        await pendingAvatar.save();

        req.io.to(pendingAvatar.userId.toString()).emit('avatar_status', {
            status: 'approved',
            message: 'عکس شما تأیید شد'
        });

        res.redirect('/admin/avatars');
    } catch (err) {
        console.error('Error approving avatar:', err);
        res.status(500).send('خطا در تأیید آواتار');
    }
};

const rejectAvatar = async (req, res) => {
    const { id } = req.params;
    try {
        const pendingAvatar = await PendingAvatar.findById(id);
        if (!pendingAvatar) {
            return res.status(404).send('آواتار پیدا نشد');
        }

        pendingAvatar.status = 'rejected';
        await pendingAvatar.save();

        req.io.to(pendingAvatar.userId.toString()).emit('avatar_status', {
            status: 'rejected',
            message: 'عکس شما به دلیل مغایرت با قوانین رد شد. لطفاً مجدداً برای آپلود عکس اقدام کنید'
        });

        res.redirect('/admin/avatars');
    } catch (err) {
        console.error('Error rejecting avatar:', err);
        res.status(500).send('خطا در رد آواتار');
    }
};

const checkPendingAvatar = (socket, request) => {
    const { requestId, data } = request;
    const { userId } = data;
    console.log(`[${socket.id}] Received check_pending_avatar for userId: ${userId}`);

    PendingAvatar.findOne({ userId: userId, status: 'pending' })
        .then(pendingAvatar => {
            if (pendingAvatar) {
                socket.emit('check_pending_avatar_response', { 
                    requestId, 
                    success: true, 
                    pendingAvatar: {
                        avatar: pendingAvatar.avatar,
                        createdAt: pendingAvatar.createdAt
                    }
                });
            } else {
                socket.emit('check_pending_avatar_response', { 
                    requestId, 
                    success: true, 
                    pendingAvatar: null 
                });
            }
        })
        .catch(err => {
            socket.emit('check_pending_avatar_response', { 
                requestId, 
                success: false, 
                message: 'خطا در بررسی آواتار در انتظار' 
            });
            console.error(`[${socket.id}] Error in check_pending_avatar: ${err.message}`);
        });
};

const checkAvatarStatus = (socket, request) => {
    const { requestId, data } = request;
    const { userId } = data;
    console.log(`[${socket.id}] Received check_avatar_status for userId: ${userId}`);

    PendingAvatar.findOne({ userId: userId, status: 'pending' })
        .then(pendingAvatar => {
            if (pendingAvatar) {
                socket.emit('check_avatar_status_response', {
                    requestId,
                    success: true,
                    status: 'pending',
                    message: 'عکس شما در حال بررسی است'
                });
            } else {
                User.findById(userId)
                    .then(user => {
                        if (user && user.avatar) {
                            socket.emit('check_avatar_status_response', {
                                requestId,
                                success: true,
                                status: 'approved',
                                message: 'عکس شما تأیید شده است'
                            });
                        } else {
                            PendingAvatar.findOne({ userId: userId, status: 'rejected' })
                                .then(rejectedAvatar => {
                                    if (rejectedAvatar) {
                                        socket.emit('check_avatar_status_response', {
                                            requestId,
                                            success: true,
                                            status: 'rejected',
                                            message: 'عکس شما به دلیل مغایرت با قوانین رد شده. لطفاً دوباره تلاش کنید'
                                        });
                                    } else {
                                        socket.emit('check_avatar_status_response', {
                                            requestId,
                                            success: true,
                                            status: 'no_avatar',
                                            message: 'عکسی برای شما ثبت نشده است'
                                        });
                                    }
                                });
                        }
                    })
                    .catch(err => {
                        socket.emit('check_avatar_status_response', {
                            requestId,
                            success: false,
                            message: 'خطا در دریافت اطلاعات کاربر'
                        });
                    });
            }
        })
        .catch(err => {
            socket.emit('check_avatar_status_response', {
                requestId,
                success: false,
                message: 'خطا در بررسی وضعیت عکس'
            });
        });
};

const avatarChunks = new Map();

const handleAvatarChunk = (socket, data, chunk, type) => {
    if (!data || typeof data !== 'object') {
        console.error(`[${socket.id}] Invalid data received for avatar chunk: ${data}`);
        if (type === 'chunk') {
            socket.emit(`upload_avatar_error_${data?.uploadId || 'unknown'}`, 'داده نامعتبر است');
        }
        return;
    }

    const { uploadId, userId, totalChunks, chunkIndex } = data;

    if (!userId) {
        console.error(`[${socket.id}] userId is missing in ${type} data: ${JSON.stringify(data)}`);
        if (type === 'chunk') {
            socket.emit(`upload_avatar_error_${uploadId || 'unknown'}`, 'شناسه کاربر نامعتبر است');
        }
        return;
    }

    if (type === 'init') {
        avatarChunks.set(uploadId, { userId, totalChunks, chunks: new Array(totalChunks).fill(null) });
        console.log(`[${socket.id}] Avatar upload initialized: ${uploadId}, Total chunks: ${totalChunks}, userId: ${userId}`);
        return;
    }

    if (type === 'chunk') {
        const uploadData = avatarChunks.get(uploadId);
        if (!uploadData) {
            socket.emit(`upload_avatar_error_${uploadId}`, 'آپلود نامعتبر است');
            return;
        }

        uploadData.chunks[chunkIndex] = chunk;
        console.log(`[${socket.id}] Received chunk ${chunkIndex + 1}/${totalChunks} for uploadId: ${uploadId}, userId: ${userId}`);

        if (uploadData.chunks.every(chunk => chunk !== null)) {
            const completeImage = Buffer.concat(uploadData.chunks);
            const base64Image = completeImage.toString('base64');

            User.findById(userId)
                .then(user => {
                    if (!user) {
                        socket.emit(`upload_avatar_error_${uploadId}`, 'کاربر پیدا نشد');
                        console.error(`[${socket.id}] User not found for userId: ${userId}`);
                        return;
                    }

                    const pendingAvatar = new PendingAvatar({
                        userId: user._id,
                        avatar: base64Image
                    });

                    pendingAvatar.save()
                        .then(() => {
                            socket.emit(`upload_avatar_complete_${uploadId}`, { success: true, message: 'عکس شما ارسال شد و بعد از تأیید مدیریت به‌روزرسانی خواهد شد' });
                            socket.broadcast.emit('new_pending_avatar', { userId: user._id, avatar: base64Image });
                            avatarChunks.delete(uploadId);
                        })
                        .catch(err => {
                            socket.emit(`upload_avatar_error_${uploadId}`, 'خطا در ذخیره آواتار');
                            console.error(`[${socket.id}] Error saving avatar: ${err.message}`);
                        });
                })
                .catch(err => {
                    socket.emit(`upload_avatar_error_${uploadId}`, 'خطا در یافتن کاربر');
                    console.error(`[${socket.id}] Error finding user: ${err.message}, userId: ${userId}`);
                });
        }
    }
};

module.exports = { getProfile, updateProfile, getPendingAvatars, approveAvatar, rejectAvatar, handleAvatarChunk, checkPendingAvatar, checkAvatarStatus };
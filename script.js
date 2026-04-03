let currentUser = null;
let currentPostId = null;
let currentChatUser = null;
let currentProfileUser = null;
let selectedMediaFile = null;
let selectedMediaType = null;
let editingPostId = null;
let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;
let typingTimeout = null;
let currentReportPostId = null;
let selectedReportReason = null;
let readModeActive = false;
let hideLikesActive = false;
let currentImageUrls = [];
let currentImageIndex = 0;
let pollOptions = [];

let agoraClient = null;
let localTracks = { videoTrack: null, audioTrack: null };
let isCallActive = false;

let badWordsList = ['كس', 'عير', 'قحب', 'زنا', 'سكس', 'porn', 'sex', 'fuck', 'shit', 'bitch'];

function showToast(message, duration = 2000) {
    const toast = document.getElementById('customToast');
    if (!toast) return;
    toast.textContent = message;
    toast.style.opacity = '1';
    setTimeout(() => {
        toast.style.opacity = '0';
    }, duration);
}

function openImageViewer(images, index) {
    currentImageUrls = images;
    currentImageIndex = index;
    const viewer = document.getElementById('imageViewerModal');
    const viewerImg = document.getElementById('viewerImage');
    if (viewerImg && images[index]) {
        viewerImg.src = images[index];
    }
    viewer.classList.add('open');
}

function closeImageViewer() {
    document.getElementById('imageViewerModal').classList.remove('open');
}

function prevImage() {
    if (currentImageIndex > 0) {
        currentImageIndex--;
        document.getElementById('viewerImage').src = currentImageUrls[currentImageIndex];
    }
}

function nextImage() {
    if (currentImageIndex < currentImageUrls.length - 1) {
        currentImageIndex++;
        document.getElementById('viewerImage').src = currentImageUrls[currentImageIndex];
    }
}

function formatTime(timestamp) {
    const now = Date.now();
    const diff = now - timestamp;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 0) return `${days} يوم`;
    if (hours > 0) return `${hours} ساعة`;
    if (minutes > 0) return `${minutes} دقيقة`;
    return `${seconds} ثانية`;
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function extractHashtags(text) {
    const hashtags = text.match(/#[\w\u0600-\u06FF]+/g) || [];
    return hashtags.map(tag => tag.substring(1));
}

function containsBadWords(text) {
    if (!text) return false;
    const lowerText = text.toLowerCase();
    for (const word of badWordsList) {
        if (lowerText.includes(word.toLowerCase())) {
            return true;
        }
    }
    return false;
}

function filterBadWords(text) {
    if (!text) return '';
    let filtered = text;
    for (const word of badWordsList) {
        const regex = new RegExp(word, 'gi');
        filtered = filtered.replace(regex, '*'.repeat(word.length));
    }
    return filtered;
}

async function uploadToCloudinary(file) {
    const url = `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/upload`;
    const formData = new FormData();
    formData.append('file', file);
    formData.append('upload_preset', UPLOAD_PRESET);
    
    try {
        showToast('جاري رفع الملف...');
        const response = await fetch(url, { method: 'POST', body: formData });
        const data = await response.json();
        if (data.secure_url) {
            showToast('تم رفع الملف بنجاح!');
            return data.secure_url;
        }
        throw new Error('Upload failed');
    } catch (error) {
        console.error('Cloudinary upload error:', error);
        showToast('فشل رفع الملف');
        return null;
    }
}

async function startVoiceRecording() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream);
        audioChunks = [];
        
        mediaRecorder.ondataavailable = (event) => {
            audioChunks.push(event.data);
        };
        
        mediaRecorder.onstop = async () => {
            const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
            const audioUrl = await uploadToCloudinary(audioBlob);
            if (audioUrl && currentChatUser) {
                const chatId = getChatId(currentUser.uid, currentChatUser.uid);
                await db.ref(`chats/${chatId}`).push({
                    senderId: currentUser.uid,
                    audioUrl: audioUrl,
                    timestamp: Date.now(),
                    read: false
                });
                showToast('تم إرسال الرسالة الصوتية');
            }
            stream.getTracks().forEach(track => track.stop());
        };
        
        mediaRecorder.start();
        isRecording = true;
        document.getElementById('recordingIndicator').style.display = 'flex';
        showToast('جاري التسجيل... اضغط مرة أخرى للإيقاف');
    } catch (error) {
        console.error('Recording error:', error);
        showToast('لا يمكن الوصول إلى الميكروفون');
    }
}

function stopVoiceRecording() {
    if (mediaRecorder && isRecording) {
        mediaRecorder.stop();
        isRecording = false;
        document.getElementById('recordingIndicator').style.display = 'none';
    }
}

function toggleVoiceRecording() {
    if (isRecording) {
        stopVoiceRecording();
    } else {
        startVoiceRecording();
    }
}

function onTyping() {
    if (!currentChatUser) return;
    const chatId = getChatId(currentUser.uid, currentChatUser.uid);
    db.ref(`typing/${chatId}/${currentUser.uid}`).set(true);
    
    if (typingTimeout) clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
        db.ref(`typing/${chatId}/${currentUser.uid}`).remove();
    }, 1000);
}

function listenForTyping(chatId) {
    db.ref(`typing/${chatId}`).on('value', (snapshot) => {
        const typing = snapshot.val();
        const indicator = document.getElementById('typingIndicator');
        if (typing && Object.keys(typing).length > 0 && !typing[currentUser.uid]) {
            indicator.style.display = 'block';
        } else {
            indicator.style.display = 'none';
        }
    });
}

function addEmojiToPost(emoji) {
    const textarea = document.getElementById('postText');
    textarea.value += emoji;
    textarea.focus();
}

function openStickerPicker() {
    const picker = document.getElementById('stickerPicker');
    if (picker.style.display === 'grid') {
        picker.style.display = 'none';
    } else {
        picker.style.display = 'grid';
    }
}

function addStickerToPost(sticker) {
    const textarea = document.getElementById('postText');
    textarea.value += sticker;
    textarea.focus();
    document.getElementById('stickerPicker').style.display = 'none';
}

function addPollToCompose() {
    const pollBuilder = document.getElementById('pollBuilder');
    if (pollBuilder.style.display === 'none') {
        pollBuilder.style.display = 'block';
    } else {
        pollBuilder.style.display = 'none';
        pollOptions = [];
        document.getElementById('pollQuestion').value = '';
        document.getElementById('pollOption1').value = '';
        document.getElementById('pollOption2').value = '';
    }
}

function addPollOption() {
    const container = document.getElementById('pollBuilder');
    const inputCount = container.querySelectorAll('input[type="text"]').length;
    if (inputCount < 6) {
        const newInput = document.createElement('input');
        newInput.type = 'text';
        newInput.placeholder = `خيار ${inputCount + 1}`;
        newInput.className = 'chat-input';
        newInput.style.width = '100%';
        newInput.style.marginBottom = '4px';
        container.insertBefore(newInput, container.querySelector('button'));
    } else {
        showToast('لا يمكن إضافة أكثر من 6 خيارات');
    }
}

function toggleSchedulePicker() {
    const picker = document.getElementById('schedulePicker');
    if (picker.style.display === 'none') {
        picker.style.display = 'block';
    } else {
        picker.style.display = 'none';
    }
}

async function schedulePost() {
    const scheduleDate = document.getElementById('scheduleDate').value;
    if (!scheduleDate) {
        showToast('الرجاء تحديد تاريخ ووقت');
        return;
    }
    const scheduleTime = new Date(scheduleDate).getTime();
    if (scheduleTime <= Date.now()) {
        showToast('الرجاء تحديد وقت مستقبلي');
        return;
    }
    
    const text = document.getElementById('postText').value;
    if (!text && !selectedMediaFile) {
        showToast('الرجاء كتابة نص أو إضافة وسائط');
        return;
    }
    
    const scheduledPost = {
        userId: currentUser.uid,
        userName: currentUser.displayName || currentUser.name,
        userAvatar: currentUser.avatar || "",
        text: text,
        mediaUrl: selectedMediaFile ? await uploadToCloudinary(selectedMediaFile) : "",
        mediaType: selectedMediaFile ? selectedMediaFile.type.split('/')[0] : "",
        scheduleTime: scheduleTime,
        timestamp: Date.now()
    };
    
    await db.ref(`scheduledPosts/${currentUser.uid}`).push(scheduledPost);
    showToast('تم جدولة المنشور');
    closeCompose();
    checkScheduledPosts();
}

async function checkScheduledPosts() {
    const snapshot = await db.ref(`scheduledPosts/${currentUser.uid}`).once('value');
    const scheduled = snapshot.val();
    if (scheduled) {
        for (const [id, post] of Object.entries(scheduled)) {
            if (post.scheduleTime <= Date.now()) {
                const postRef = db.ref('posts').push();
                await postRef.set({
                    id: postRef.key,
                    userId: post.userId,
                    userName: post.userName,
                    userAvatar: post.userAvatar,
                    text: post.text,
                    mediaUrl: post.mediaUrl,
                    mediaType: post.mediaType,
                    hashtags: extractHashtags(post.text),
                    likes: {},
                    views: 0,
                    commentsCount: 0,
                    edited: false,
                    timestamp: Date.now()
                });
                await db.ref(`scheduledPosts/${currentUser.uid}/${id}`).remove();
                showToast('تم نشر المنشور المجدول');
            }
        }
    }
}

function createHeartAnimation(x, y) {
    const heart = document.createElement('div');
    heart.className = 'heart-animation';
    heart.innerHTML = '❤️';
    heart.style.left = x + 'px';
    heart.style.top = y + 'px';
    document.body.appendChild(heart);
    setTimeout(() => {
        heart.remove();
    }, 600);
}

async function exportUserData() {
    showToast('جاري تصدير بياناتك...');
    const userData = {
        profile: {
            name: currentUser.displayName,
            email: currentUser.email,
            bio: currentUser.bio,
            avatar: currentUser.avatar,
            createdAt: currentUser.createdAt
        },
        posts: [],
        followers: [],
        following: []
    };
    
    const postsSnapshot = await db.ref('posts').once('value');
    const posts = postsSnapshot.val();
    if (posts) {
        userData.posts = Object.values(posts).filter(p => p.userId === currentUser.uid);
    }
    
    const followersSnapshot = await db.ref(`followers/${currentUser.uid}`).once('value');
    if (followersSnapshot.exists()) {
        userData.followers = Object.keys(followersSnapshot.val());
    }
    
    const followingSnapshot = await db.ref(`following/${currentUser.uid}`).once('value');
    if (followingSnapshot.exists()) {
        userData.following = Object.keys(followingSnapshot.val());
    }
    
    const dataStr = JSON.stringify(userData, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
    const exportFileDefaultName = `spark_data_${Date.now()}.json`;
    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();
    showToast('تم تصدير بياناتك بنجاح');
}

async function createAlbum() {
    const albumName = prompt('اسم الألبوم:');
    if (!albumName) return;
    
    const albumRef = db.ref(`albums/${currentUser.uid}`).push();
    await albumRef.set({
        name: albumName,
        images: [],
        createdAt: Date.now()
    });
    showToast('تم إنشاء الألبوم');
    openAlbums();
}

async function openAlbums() {
    const snapshot = await db.ref(`albums/${currentUser.uid}`).once('value');
    const albums = snapshot.val();
    const container = document.getElementById('albumsList');
    
    if (!albums) {
        container.innerHTML = '<div class="text-center p-4 text-gray-500">لا توجد ألبومات</div>';
    } else {
        let html = '';
        for (const [id, album] of Object.entries(albums)) {
            html += `
                <div class="album-card" onclick="openAlbum('${id}')">
                    ${album.images && album.images[0] ? `<img src="${album.images[0]}" class="album-cover">` : '<div class="album-cover" style="background: linear-gradient(135deg, #ff6b35, #f7b733); display: flex; align-items: center; justify-content: center;"><i class="fas fa-folder-open" style="font-size: 48px; color: white;"></i></div>'}
                    <div style="font-weight: 600; margin-top: 8px;">${escapeHtml(album.name)}</div>
                    <div style="font-size: 11px; color: #8e8e8e;">${album.images ? album.images.length : 0} صورة</div>
                </div>
            `;
        }
        container.innerHTML = html;
    }
    document.getElementById('albumsPanel').classList.add('open');
}

function closeAlbums() {
    document.getElementById('albumsPanel').classList.remove('open');
}

async function openAlbum(albumId) {
    const snapshot = await db.ref(`albums/${currentUser.uid}/${albumId}`).once('value');
    const album = snapshot.val();
    if (album && album.images && album.images.length > 0) {
        openImageViewer(album.images, 0);
    } else {
        showToast('لا توجد صور في هذا الألبوم');
    }
}

function toggleReadMode() {
    readModeActive = !readModeActive;
    const toggle = document.getElementById('readModeToggle');
    if (readModeActive) {
        document.body.classList.add('read-mode');
        toggle.classList.add('active');
        localStorage.setItem('readMode', 'true');
        showToast('تم تفعيل وضع القراءة');
    } else {
        document.body.classList.remove('read-mode');
        toggle.classList.remove('active');
        localStorage.setItem('readMode', 'false');
        showToast('تم إلغاء وضع القراءة');
    }
}

function toggleHideLikes() {
    hideLikesActive = !hideLikesActive;
    const toggle = document.getElementById('hideLikesToggle');
    if (hideLikesActive) {
        toggle.classList.add('active');
        localStorage.setItem('hideLikes', 'true');
        showToast('تم إخفاء عدد الإعجابات');
    } else {
        toggle.classList.remove('active');
        localStorage.setItem('hideLikes', 'false');
        showToast('تم إظهار عدد الإعجابات');
    }
    loadFeed();
}

async function pinComment(postId, commentId) {
    await db.ref(`posts/${postId}/pinnedComment`).set(commentId);
    showToast('تم تثبيت التعليق');
    loadComments(postId);
}

async function quotePost(postId, originalText, originalUser) {
    openCompose();
    document.getElementById('postText').value = `اقتباس من @${originalUser}: "${originalText.substring(0, 100)}"\n\n`;
    window.quoteOriginalPostId = postId;
}

async function initAgoraCall() {
    if (!agoraClient) {
        agoraClient = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });
    }
    return agoraClient;
}

async function startVideoCallWithAgora(channelName, userId) {
    try {
        const client = await initAgoraCall();
        const token = null;
        
        await client.join(AGORA_APP_ID_CALL, channelName, token, userId);
        
        localTracks.videoTrack = await AgoraRTC.createCameraVideoTrack();
        localTracks.audioTrack = await AgoraRTC.createMicrophoneAudioTrack();
        
        await client.publish([localTracks.videoTrack, localTracks.audioTrack]);
        
        const localPlayer = document.getElementById('localVideo');
        if (localPlayer) localTracks.videoTrack.play(localPlayer);
        
        client.on("user-published", async (user, mediaType) => {
            await client.subscribe(user, mediaType);
            if (mediaType === "video") {
                const remotePlayer = document.getElementById('remoteVideo');
                if (remotePlayer) user.videoTrack.play(remotePlayer);
            }
            if (mediaType === "audio") user.audioTrack.play();
        });
        
        isCallActive = true;
        showToast('تم بدء المكالمة');
        
    } catch (error) {
        console.error('Error starting video call:', error);
        showToast('فشل بدء المكالمة');
    }
}

async function endVideoCall() {
    if (agoraClient) {
        if (localTracks.videoTrack) localTracks.videoTrack.close();
        if (localTracks.audioTrack) localTracks.audioTrack.close();
        await agoraClient.leave();
        isCallActive = false;
        showToast('تم إنهاء المكالمة');
    }
    document.getElementById('videoCallModal').classList.remove('open');
}

window.startVideoCallWithCurrentUser = async function() {
    if (!currentChatUser) return;
    const channelName = `call_${getChatId(currentUser.uid, currentChatUser.uid)}`;
    document.getElementById('videoCallModal').classList.add('open');
    await startVideoCallWithAgora(channelName, currentUser.uid);
    const notifRef = db.ref(`notifications/${currentChatUser.uid}`).push();
    await notifRef.set({ type: 'call', userId: currentUser.uid, userName: currentUser.displayName || currentUser.name, channelName: channelName, timestamp: Date.now(), read: false });
};

window.toggleTheme = function() {
    document.body.classList.toggle('dark-mode');
    const isDark = document.body.classList.contains('dark-mode');
    const themeIcon = document.getElementById('themeToggle');
    if (themeIcon) {
        if (isDark) {
            themeIcon.classList.remove('fa-adjust');
            themeIcon.classList.add('fa-sun');
        } else {
            themeIcon.classList.remove('fa-sun');
            themeIcon.classList.add('fa-adjust');
        }
    }
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
    showToast(isDark ? 'الوضع الليلي' : 'الوضع النهاري');
};

window.toggleDoNotDisturb = async function() {
    const dndToggle = document.getElementById('dndToggle');
    const isDnd = dndToggle.classList.contains('active');
    
    if (isDnd) {
        dndToggle.classList.remove('active');
        await db.ref(`users/${currentUser.uid}/dnd`).set(false);
        showToast('تم تفعيل الإشعارات');
    } else {
        dndToggle.classList.add('active');
        await db.ref(`users/${currentUser.uid}/dnd`).set(true);
        showToast('تم تفعيل عدم الإزعاج');
    }
};

async function loadDndStatus() {
    const snapshot = await db.ref(`users/${currentUser.uid}/dnd`).once('value');
    const isDnd = snapshot.val();
    const dndToggle = document.getElementById('dndToggle');
    if (isDnd && dndToggle) {
        dndToggle.classList.add('active');
    } else if (dndToggle) {
        dndToggle.classList.remove('active');
    }
}

window.logout = async function() {
    try {
        await auth.signOut();
        showToast('تم تسجيل الخروج بنجاح');
        setTimeout(() => {
            location.reload();
        }, 1000);
    } catch (error) {
        console.error('Logout error:', error);
        showToast('حدث خطأ أثناء تسجيل الخروج');
    }
};

window.switchAuth = function(form) {
    document.getElementById('loginForm').classList.remove('active');
    document.getElementById('registerForm').classList.remove('active');
    document.getElementById(`${form}Form`).classList.add('active');
};

window.login = async function() {
    const email = document.getElementById('loginEmail')?.value;
    const password = document.getElementById('loginPassword')?.value;
    const msgDiv = document.getElementById('loginMsg');

    if (!email || !password) {
        if (msgDiv) msgDiv.textContent = 'الرجاء إدخال البريد الإلكتروني وكلمة المرور';
        return;
    }

    try {
        showToast('جاري تسجيل الدخول...');
        const userCredential = await auth.signInWithEmailAndPassword(email, password);
        currentUser = userCredential.user;
        
        const snapshot = await db.ref(`users/${currentUser.uid}`).once('value');
        if (snapshot.exists()) {
            currentUser = { ...currentUser, ...snapshot.val() };
        } else {
            await db.ref(`users/${currentUser.uid}`).set({
                uid: currentUser.uid,
                name: currentUser.displayName || email.split('@')[0],
                email: email,
                bio: "مرحباً! أنا في SPARK ✨",
                avatar: "",
                cover: "",
                website: "",
                verified: false,
                isAdmin: false,
                blockedUsers: {},
                mutedUntil: 0,
                createdAt: Date.now()
            });
        }
        
        if (email === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
            showToast('🌟 مرحباً بك في لوحة التحكم يا مدير!');
            await db.ref(`users/${currentUser.uid}`).update({ 
                isAdmin: true, 
                verified: true,
                name: 'Admin SPARK'
            });
            currentUser.isAdmin = true;
            currentUser.verified = true;
        }
        
        document.getElementById('authScreen').style.display = 'none';
        document.getElementById('mainApp').style.display = 'block';
        
        showToast(`مرحباً ${currentUser.displayName || currentUser.name || 'مستخدم'}!`);
        
        loadFeed();
        loadNotifications();
        loadTrendingHashtags();
        loadDndStatus();
        checkScheduledPosts();
        
        const savedTheme = localStorage.getItem('theme');
        if (savedTheme === 'dark') document.body.classList.add('dark-mode');
        
        const savedReadMode = localStorage.getItem('readMode');
        if (savedReadMode === 'true') {
            readModeActive = true;
            document.getElementById('readModeToggle')?.classList.add('active');
            document.body.classList.add('read-mode');
        }
        
        const savedHideLikes = localStorage.getItem('hideLikes');
        if (savedHideLikes === 'true') {
            hideLikesActive = true;
            document.getElementById('hideLikesToggle')?.classList.add('active');
        }
        
        await recordProfileView(currentUser.uid);
        
    } catch (error) {
        console.error('Login error:', error);
        if (msgDiv) msgDiv.textContent = error.message;
        showToast(error.message);
    }
};

window.register = async function() {
    const name = document.getElementById('regName')?.value;
    const email = document.getElementById('regEmail')?.value;
    const password = document.getElementById('regPass')?.value;
    const confirmPass = document.getElementById('regConfirmPass')?.value;
    const msgDiv = document.getElementById('regMsg');

    if (!name || !email || !password) {
        if (msgDiv) msgDiv.textContent = 'الرجاء ملء جميع الحقول';
        return;
    }

    if (password !== confirmPass) {
        if (msgDiv) msgDiv.textContent = 'كلمة المرور غير متطابقة';
        return;
    }

    try {
        showToast('جاري إنشاء الحساب...');
        const userCredential = await auth.createUserWithEmailAndPassword(email, password);
        await userCredential.user.updateProfile({ displayName: name });
        
        await db.ref(`users/${userCredential.user.uid}`).set({
            uid: userCredential.user.uid,
            name: name,
            email: email,
            bio: "مرحباً! أنا في SPARK ✨",
            avatar: "",
            cover: "",
            website: "",
            verified: false,
            isAdmin: email === ADMIN_EMAIL,
            blockedUsers: {},
            mutedUntil: 0,
            createdAt: Date.now()
        });

        currentUser = userCredential.user;
        currentUser.name = name;
        
        document.getElementById('authScreen').style.display = 'none';
        document.getElementById('mainApp').style.display = 'block';
        loadFeed();
        loadTrendingHashtags();
        showToast(`أهلاً بك ${name}!`);
    } catch (error) {
        console.error('Register error:', error);
        if (msgDiv) msgDiv.textContent = error.message;
        showToast(error.message);
    }
};

async function recordProfileView(viewedUserId) {
    if (viewedUserId === currentUser.uid) return;
    
    const viewRef = db.ref(`profileViews/${viewedUserId}/${currentUser.uid}`);
    await viewRef.set({
        viewerId: currentUser.uid,
        viewerName: currentUser.displayName || currentUser.name,
        viewerAvatar: currentUser.avatar || '',
        timestamp: Date.now()
    });
}

window.openProfileViews = async function() {
    const snapshot = await db.ref(`profileViews/${currentProfileUser || currentUser.uid}`).once('value');
    const views = snapshot.val();
    const container = document.getElementById('profileViewsList');
    
    if (!views) {
        container.innerHTML = '<div class="text-center p-4 text-gray-500">لا توجد مشاهدات بعد</div>';
    } else {
        let html = '';
        const viewsArray = Object.values(views).sort((a, b) => b.timestamp - a.timestamp).slice(0, 50);
        for (const view of viewsArray) {
            html += `<div class="follower-item" onclick="closeProfileViews(); openProfile('${view.viewerId}')">
                <div class="post-avatar" style="width: 44px; height: 44px;">${view.viewerAvatar ? `<img src="${view.viewerAvatar}">` : '<i class="fas fa-user text-white text-xl flex items-center justify-center h-full"></i>'}</div>
                <div><div style="font-weight: 600;">${escapeHtml(view.viewerName)}</div><div style="font-size: 11px; color: #8e8e8e;">${formatTime(view.timestamp)}</div></div>
            </div>`;
        }
        container.innerHTML = html;
    }
    document.getElementById('profileViewsPanel').classList.add('open');
};

window.closeProfileViews = function() {
    document.getElementById('profileViewsPanel').classList.remove('open');
};

window.savePost = async function(postId) {
    const saveRef = db.ref(`savedPosts/${currentUser.uid}/${postId}`);
    const snapshot = await saveRef.once('value');
    
    if (snapshot.exists()) {
        await saveRef.remove();
        showToast('تم إزالة من القائمة المحفوظة');
    } else {
        await saveRef.set(true);
        showToast('تم حفظ المنشور');
    }
    loadFeed();
};

window.openSavedPosts = async function() {
    const snapshot = await db.ref(`savedPosts/${currentUser.uid}`).once('value');
    const savedPosts = snapshot.val();
    const container = document.getElementById('savedPostsGrid');
    
    if (!savedPosts) {
        container.innerHTML = '<div class="text-center p-8 text-gray-500" style="grid-column: span 3;">لا توجد منشورات محفوظة</div>';
    } else {
        let html = '';
        for (const postId of Object.keys(savedPosts)) {
            const postSnapshot = await db.ref(`posts/${postId}`).once('value');
            const post = postSnapshot.val();
            if (post) {
                html += `<div class="grid-item" onclick="openComments('${postId}')">
                    ${post.mediaUrl ? (post.mediaType === 'image' ? `<img src="${post.mediaUrl}">` : `<video src="${post.mediaUrl}"></video>`) : '<div class="flex items-center justify-center h-full bg-gray-100 dark:bg-gray-800"><i class="fas fa-file-alt text-2xl text-gray-500"></i></div>'}
                </div>`;
            }
        }
        container.innerHTML = html || '<div class="text-center p-8 text-gray-500" style="grid-column: span 3;">لا توجد منشورات محفوظة</div>';
    }
    document.getElementById('savedPostsPanel').classList.add('open');
};

window.closeSavedPosts = function() {
    document.getElementById('savedPostsPanel').classList.remove('open');
};

window.pinPost = async function(postId) {
    const currentPinned = await db.ref(`users/${currentUser.uid}/pinnedPost`).once('value');
    if (currentPinned.val() === postId) {
        await db.ref(`users/${currentUser.uid}/pinnedPost`).remove();
        showToast('تم إلغاء تثبيت المنشور');
    } else {
        await db.ref(`users/${currentUser.uid}/pinnedPost`).set(postId);
        showToast('تم تثبيت المنشور في ملفك الشخصي');
    }
    loadFeed();
    if (currentProfileUser) loadProfilePosts(currentProfileUser);
};

window.openReportModal = function(postId) {
    currentReportPostId = postId;
    selectedReportReason = null;
    document.querySelectorAll('.report-reason').forEach(el => el.classList.remove('selected'));
    document.getElementById('reportModal').classList.add('open');
};

window.selectReportReason = function(element, reason) {
    document.querySelectorAll('.report-reason').forEach(el => el.classList.remove('selected'));
    element.classList.add('selected');
    selectedReportReason = reason;
};

window.closeReportModal = function() {
    document.getElementById('reportModal').classList.remove('open');
    currentReportPostId = null;
    selectedReportReason = null;
};

window.submitReport = async function() {
    if (!selectedReportReason || !currentReportPostId) {
        showToast('الرجاء اختيار سبب الإبلاغ');
        return;
    }
    
    await db.ref(`reports/${currentReportPostId}`).push({
        reporterId: currentUser.uid,
        reporterName: currentUser.displayName || currentUser.name,
        reason: selectedReportReason,
        timestamp: Date.now()
    });
    
    showToast('تم إرسال البلاغ، شكراً لك');
    closeReportModal();
};

window.muteUser = async function(userId, minutes = 60) {
    const muteUntil = Date.now() + (minutes * 60 * 1000);
    await db.ref(`users/${userId}/mutedUntil`).set(muteUntil);
    showToast(`تم تقييد المستخدم لمدة ${minutes} دقيقة`);
    openAdminPanel();
};

async function isUserMuted(userId) {
    const snapshot = await db.ref(`users/${userId}/mutedUntil`).once('value');
    const muteUntil = snapshot.val();
    return muteUntil && muteUntil > Date.now();
}

window.changeAvatar = async function() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (file) {
            const url = await uploadToCloudinary(file);
            if (url) {
                await db.ref(`users/${currentUser.uid}`).update({ avatar: url });
                currentUser.avatar = url;
                if (currentProfileUser) openProfile(currentProfileUser);
                else openProfile(currentUser.uid);
                showToast('تم تغيير الصورة الشخصية بنجاح');
            }
        }
    };
    input.click();
};

window.changeCover = async function() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (file) {
            const url = await uploadToCloudinary(file);
            if (url) {
                await db.ref(`users/${currentUser.uid}`).update({ cover: url });
                currentUser.cover = url;
                if (currentProfileUser) openProfile(currentProfileUser);
                else openProfile(currentUser.uid);
                showToast('تم تغيير صورة الغلاف بنجاح');
            }
        }
    };
    input.click();
};

async function blockUser(userId) {
    await db.ref(`users/${currentUser.uid}/blockedUsers/${userId}`).set(true);
    showToast('تم حظر المستخدم');
    loadFeed();
}

async function unblockUser(userId) {
    await db.ref(`users/${currentUser.uid}/blockedUsers/${userId}`).remove();
    showToast('تم إلغاء حظر المستخدم');
    loadFeed();
}

async function isBlocked(userId) {
    const snapshot = await db.ref(`users/${currentUser.uid}/blockedUsers/${userId}`).once('value');
    return snapshot.exists();
}

window.createPost = async function() {
    let text = document.getElementById('postText')?.value;
    
    if (containsBadWords(text)) {
        showToast('⚠️ المنشور يحتوي على كلمات ممنوعة');
        return;
    }
    
    if (!text && !selectedMediaFile) {
        showToast('الرجاء كتابة نص أو إضافة وسائط');
        return;
    }
    
    text = filterBadWords(text);
    
    const isMuted = await isUserMuted(currentUser.uid);
    if (isMuted) {
        showToast('⚠️ أنت مقيد مؤقتاً ولا يمكنك النشر');
        return;
    }

    let mediaUrl = "", mediaType = "";
    if (selectedMediaFile) {
        mediaType = selectedMediaFile.type.split('/')[0];
        mediaUrl = await uploadToCloudinary(selectedMediaFile);
        if (!mediaUrl) return;
    }
    
    if (mediaType === 'image' && mediaUrl) {
        const albumName = prompt('هل تريد إضافة هذه الصورة إلى ألبوم؟ (اتركه فارغاً للتخطي)', '');
        if (albumName) {
            let albumExists = false;
            const albumsSnapshot = await db.ref(`albums/${currentUser.uid}`).once('value');
            const albums = albumsSnapshot.val();
            if (albums) {
                for (const [id, album] of Object.entries(albums)) {
                    if (album.name === albumName) {
                        albumExists = true;
                        await db.ref(`albums/${currentUser.uid}/${id}/images`).push(mediaUrl);
                        break;
                    }
                }
            }
            if (!albumExists) {
                const albumRef = db.ref(`albums/${currentUser.uid}`).push();
                await albumRef.set({
                    name: albumName,
                    images: [mediaUrl],
                    createdAt: Date.now()
                });
            }
            showToast(`تم إضافة الصورة إلى ألبوم ${albumName}`);
        }
    }

    const hashtags = extractHashtags(text);
    const postRef = db.ref('posts').push();
    
    let quoteData = null;
    if (window.quoteOriginalPostId) {
        const originalPostSnapshot = await db.ref(`posts/${window.quoteOriginalPostId}`).once('value');
        const originalPost = originalPostSnapshot.val();
        if (originalPost) {
            quoteData = {
                originalPostId: window.quoteOriginalPostId,
                originalText: originalPost.text,
                originalUser: originalPost.userName
            };
        }
        delete window.quoteOriginalPostId;
    }
    
    let pollData = null;
    const pollQuestion = document.getElementById('pollQuestion')?.value;
    if (pollQuestion) {
        const options = [];
        const optionInputs = document.querySelectorAll('#pollBuilder input[type="text"]');
        for (let i = 0; i < optionInputs.length; i++) {
            if (optionInputs[i].value) {
                options.push(optionInputs[i].value);
            }
        }
        if (options.length >= 2) {
            pollData = {
                question: pollQuestion,
                options: options,
                votes: {},
                totalVotes: 0
            };
        }
    }
    
    await postRef.set({
        id: postRef.key,
        userId: currentUser.uid,
        userName: currentUser.displayName || currentUser.name,
        userAvatar: currentUser.avatar || "",
        text: text,
        mediaUrl: mediaUrl,
        mediaType: mediaType,
        hashtags: hashtags,
        likes: {},
        views: 0,
        commentsCount: 0,
        edited: false,
        quote: quoteData,
        poll: pollData,
        timestamp: Date.now()
    });
    
    for (const tag of hashtags) {
        await db.ref(`hashtags/${tag.toLowerCase()}/${postRef.key}`).set(true);
    }

    document.getElementById('postText').value = "";
    document.getElementById('mediaPreview').innerHTML = "";
    document.getElementById('mediaPreview').style.display = "none";
    document.getElementById('pollBuilder').style.display = "none";
    document.getElementById('pollQuestion').value = "";
    document.getElementById('pollOption1').value = "";
    document.getElementById('pollOption2').value = "";
    selectedMediaFile = null;
    editingPostId = null;
    closeCompose();
    loadFeed();
    loadTrendingHashtags();
    showToast('تم نشر المنشور بنجاح!');
};

window.deletePost = async function(postId) {
    if (!confirm('هل أنت متأكد من حذف هذا المنشور؟')) return;
    const postSnapshot = await db.ref(`posts/${postId}`).once('value');
    const post = postSnapshot.val();
    if (post.userId !== currentUser.uid && !currentUser.isAdmin) {
        showToast('لا يمكنك حذف منشور ليس لك');
        return;
    }
    if (post.hashtags) {
        for (const tag of post.hashtags) {
            await db.ref(`hashtags/${tag.toLowerCase()}/${postId}`).remove();
        }
    }
    await db.ref(`posts/${postId}`).remove();
    loadFeed();
    loadTrendingHashtags();
    showToast('تم حذف المنشور');
};

window.likePost = async function(postId) {
    const likeRef = db.ref(`posts/${postId}/likes/${currentUser.uid}`);
    const snapshot = await likeRef.once('value');
    
    if (snapshot.exists()) {
        await likeRef.remove();
    } else {
        await likeRef.set(true);
        const postSnapshot = await db.ref(`posts/${postId}`).once('value');
        const post = postSnapshot.val();
        if (post && post.userId !== currentUser.uid) {
            const dndSnapshot = await db.ref(`users/${post.userId}/dnd`).once('value');
            if (!dndSnapshot.val()) {
                const notifRef = db.ref(`notifications/${post.userId}`).push();
                await notifRef.set({
                    type: 'like',
                    userId: currentUser.uid,
                    userName: currentUser.displayName || currentUser.name,
                    postId: postId,
                    timestamp: Date.now(),
                    read: false
                });
            }
        }
    }
    loadFeed();
};

window.sharePost = async function(postId) {
    const postSnapshot = await db.ref(`posts/${postId}`).once('value');
    const post = postSnapshot.val();
    const shareRef = db.ref('posts').push();
    await shareRef.set({
        id: shareRef.key,
        userId: currentUser.uid,
        userName: currentUser.displayName || currentUser.name,
        userAvatar: currentUser.avatar || "",
        text: `شارك منشور: ${post.text.substring(0, 100)}`,
        originalPostId: postId,
        originalUser: post.userName,
        timestamp: Date.now()
    });
    showToast('تمت المشاركة!');
};

window.votePoll = async function(postId, optionIndex) {
    const postRef = db.ref(`posts/${postId}/poll`);
    const snapshot = await postRef.once('value');
    const poll = snapshot.val();
    
    if (poll && poll.votes && poll.votes[currentUser.uid]) {
        showToast('لقد صوت مسبقاً');
        return;
    }
    
    const voteRef = db.ref(`posts/${postId}/poll/votes/${currentUser.uid}`);
    await voteRef.set(optionIndex);
    await db.ref(`posts/${postId}/poll/totalVotes`).transaction(current => (current || 0) + 1);
    loadFeed();
};

async function incrementPostViews(postId) {
    await db.ref(`posts/${postId}/views`).transaction(current => (current || 0) + 1);
}

async function loadTrendingHashtags() {
    const hashtagSnapshot = await db.ref('hashtags').once('value');
    const hashtags = hashtagSnapshot.val();
    if (!hashtags) return;
    
    const trending = [];
    for (const [tag, posts] of Object.entries(hashtags)) {
        trending.push({ tag, count: Object.keys(posts).length });
    }
    trending.sort((a, b) => b.count - a.count);
    const top5 = trending.slice(0, 5);
    
    const container = document.getElementById('trendingList');
    if (container) {
        container.innerHTML = top5.map((item, index) => `
            <div class="trending-item" onclick="searchHashtag('${item.tag}')">
                <div class="trending-rank">#${index + 1}</div>
                <div class="trending-hashtag">#${escapeHtml(item.tag)}</div>
                <div class="trending-count">${item.count} منشور</div>
            </div>
        `).join('');
    }
}

async function loadFeed() {
    const feedContainer = document.getElementById('feedContainer');
    if (!feedContainer) return;
    
    feedContainer.innerHTML = '<div class="loading"><div class="spinner"></div><span>جاري التحميل...</span></div>';

    const snapshot = await db.ref('posts').once('value');
    const posts = snapshot.val();
    if (!posts) {
        feedContainer.innerHTML = '<div class="text-center p-8 text-gray-500">لا توجد منشورات بعد</div>';
        return;
    }

    const blockedSnapshot = await db.ref(`users/${currentUser?.uid}/blockedUsers`).once('value');
    const blockedUsers = blockedSnapshot.val() || {};
    
    const pinnedPostId = await db.ref(`users/${currentUser?.uid}/pinnedPost`).once('value');
    const pinnedId = pinnedPostId.val();
    
    let postsArray = Object.values(posts)
        .filter(post => !blockedUsers[post.userId])
        .sort((a, b) => b.timestamp - a.timestamp);
    
    if (pinnedId) {
        const pinnedIndex = postsArray.findIndex(p => p.id === pinnedId);
        if (pinnedIndex > -1) {
            const pinnedPost = postsArray[pinnedIndex];
            postsArray.splice(pinnedIndex, 1);
            postsArray.unshift(pinnedPost);
        }
    }
    
    let html = '';
    for (const post of postsArray) {
        await incrementPostViews(post.id);
        
        // جلب معلومات المستخدم للتحقق من التوثيق
        const userInfoSnapshot = await db.ref(`users/${post.userId}`).once('value');
        const userInfo = userInfoSnapshot.val();
        const isUserVerified = userInfo?.verified || false;
        
        const isLiked = post.likes && post.likes[currentUser?.uid];
        const likesCount = post.likes ? Object.keys(post.likes).length : 0;
        const isOwner = post.userId === currentUser?.uid;
        const isPinned = pinnedId === post.id;
        const savedSnapshot = await db.ref(`savedPosts/${currentUser?.uid}/${post.id}`).once('value');
        const isSaved = savedSnapshot.exists();
        
        let formattedText = escapeHtml(post.text);
        if (post.hashtags) {
            post.hashtags.forEach(tag => {
                const regex = new RegExp(`#${tag}`, 'gi');
                formattedText = formattedText.replace(regex, `<span class="post-hashtags" onclick="searchHashtag('${tag}')">#${tag}</span>`);
            });
        }
        
        formattedText = formattedText.replace(/@(\w+)/g, '<span class="post-hashtags" onclick="searchUser(\'$1\')">@$1</span>');
        
        let pollHtml = '';
        if (post.poll && post.poll.question) {
            pollHtml = '<div class="poll-container">';
            pollHtml += `<div style="font-weight: 600; margin-bottom: 8px;">📊 ${escapeHtml(post.poll.question)}</div>`;
            for (let i = 0; i < post.poll.options.length; i++) {
                const voteCount = post.poll.votes ? Object.values(post.poll.votes).filter(v => v === i).length : 0;
                const percentage = post.poll.totalVotes > 0 ? (voteCount / post.poll.totalVotes * 100).toFixed(1) : 0;
                pollHtml += `
                    <div class="poll-option" onclick="votePoll('${post.id}', ${i})">
                        <div class="poll-progress" style="width: ${percentage}%;"></div>
                        <div class="poll-option-text">
                            <span>${escapeHtml(post.poll.options[i])}</span>
                            ${!hideLikesActive ? `<span>${percentage}% (${voteCount} صوت)</span>` : ''}
                        </div>
                    </div>
                `;
            }
            pollHtml += `<div style="font-size: 11px; color: #8e8e8e; margin-top: 8px;">${post.poll.totalVotes || 0} صوت</div>`;
            pollHtml += '</div>';
        }
        
        let quoteHtml = '';
        if (post.quote) {
            quoteHtml = `
                <div class="quote-post" onclick="openComments('${post.quote.originalPostId}')">
                    <div style="font-weight: 600;">@${escapeHtml(post.quote.originalUser)}</div>
                    <div style="font-size: 13px;">${escapeHtml(post.quote.originalText?.substring(0, 100))}</div>
                </div>
            `;
        }
        
        let mediaHtml = '';
        if (post.mediaUrl) {
            if (post.mediaType === 'image') {
                mediaHtml = `<img src="${post.mediaUrl}" class="post-image" onclick="event.stopPropagation(); openImageViewer(['${post.mediaUrl}'], 0)">`;
            } else if (post.mediaType === 'video') {
                mediaHtml = `<video src="${post.mediaUrl}" class="post-video" controls onclick="event.stopPropagation()"></video>`;
            }
        }
        
        html += `
            <div class="post-card ${isPinned ? 'pinned' : ''} fade-in" ondblclick="likePost('${post.id}'); createHeartAnimation(event.clientX, event.clientY)">
                ${isPinned ? '<div class="pinned-badge"><i class="fas fa-thumbtack"></i> مثبت</div>' : ''}
                <div class="post-header">
                    <div class="post-user-info" onclick="openProfile('${post.userId}')">
                        <div class="post-avatar">
                            ${post.userAvatar ? `<img src="${post.userAvatar}">` : '<i class="fas fa-user text-white text-xl flex items-center justify-center h-full"></i>'}
                        </div>
                        <div>
                            <div class="post-username">${escapeHtml(post.userName)} ${isUserVerified ? '<i class="fas fa-check-circle text-[#ff6b35] text-xs mr-1"></i>' : ''}</div>
                            <div class="post-time">${formatTime(post.timestamp)} ${post.edited ? '· معدل' : ''}</div>
                        </div>
                    </div>
                    <div style="display: flex; gap: 12px;">
                        ${(isOwner || currentUser?.isAdmin) ? `<button class="post-menu" onclick="event.stopPropagation(); deletePost('${post.id}')"><i class="fas fa-trash-alt"></i></button>` : ''}
                        ${isOwner ? `<button class="post-menu" onclick="event.stopPropagation(); pinPost('${post.id}')"><i class="fas fa-thumbtack"></i></button>` : ''}
                        <button class="post-menu" onclick="event.stopPropagation(); savePost('${post.id}')"><i class="fas fa-bookmark" style="${isSaved ? 'color: #f7b733;' : ''}"></i></button>
                        <button class="post-menu" onclick="event.stopPropagation(); quotePost('${post.id}', '${escapeHtml(post.text)}', '${escapeHtml(post.userName)}')"><i class="fas fa-quote-right"></i></button>
                        <button class="post-menu" onclick="event.stopPropagation(); openReportModal('${post.id}')"><i class="fas fa-flag"></i></button>
                    </div>
                </div>
                ${mediaHtml}
                ${pollHtml}
                ${quoteHtml}
                <div class="post-actions">
                    <button class="post-action ${isLiked ? 'active' : ''}" onclick="likePost('${post.id}')"><i class="fas fa-heart"></i></button>
                    <button class="post-action" onclick="openComments('${post.id}')"><i class="fas fa-comment"></i></button>
                    <button class="post-action" onclick="sharePost('${post.id}')"><i class="fas fa-paper-plane"></i></button>
                </div>
                ${likesCount > 0 && !hideLikesActive ? `<div class="post-likes">${likesCount} إعجاب</div>` : ''}
                <div class="post-caption"><span onclick="openProfile('${post.userId}')">${escapeHtml(post.userName)}</span> ${formattedText}</div>
                ${post.commentsCount > 0 ? `<div class="post-comments" onclick="openComments('${post.id}')">عرض جميع التعليقات (${post.commentsCount})</div>` : ''}
                <div class="post-views"><i class="far fa-eye"></i> ${post.views || 0} مشاهدة</div>
            </div>
        `;
    }
    feedContainer.innerHTML = html;
}

window.searchUser = async function(username) {
    openSearch();
    document.getElementById('searchInput').value = username;
    await searchAll();
};

window.searchHashtag = async function(tag) {
    openSearch();
    document.getElementById('searchInput').value = `#${tag}`;
    await searchAll();
};

window.openComments = async function(postId) {
    currentPostId = postId;
    document.getElementById('commentsPanel').classList.add('open');
    await loadComments(postId);
};

async function loadComments(postId) {
    const snapshot = await db.ref(`comments/${postId}`).once('value');
    const comments = snapshot.val();
    const commentsList = document.getElementById('commentsList');
    if (!commentsList) return;
    
    const pinnedCommentId = await db.ref(`posts/${postId}/pinnedComment`).once('value');
    const pinnedId = pinnedCommentId.val();
    
    if (!comments) {
        commentsList.innerHTML = '<div class="text-center p-4 text-gray-500">لا توجد تعليقات</div>';
        return;
    }
    
    let commentsArray = Object.entries(comments).map(([id, comment]) => ({ id, ...comment }));
    if (pinnedId) {
        const pinnedIndex = commentsArray.findIndex(c => c.id === pinnedId);
        if (pinnedIndex > -1) {
            const pinnedComment = commentsArray[pinnedIndex];
            commentsArray.splice(pinnedIndex, 1);
            commentsArray.unshift(pinnedComment);
        }
    }
    
    let html = '';
    for (const comment of commentsArray) {
        const userSnapshot = await db.ref(`users/${comment.userId}`).once('value');
        const userData = userSnapshot.val();
        const isCommentOwner = comment.userId === currentUser?.uid;
        html += `
            <div class="chat-message">
                <div class="message-bubble">
                    <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
                        <span style="font-weight: 600; cursor: pointer;" onclick="closeComments(); openProfile('${comment.userId}')">${escapeHtml(userData?.name || 'مستخدم')}</span>
                        <span style="font-size: 10px; color: #8e8e8e;">${formatTime(comment.timestamp)}</span>
                        ${comment.id === pinnedId ? '<span style="background: #ff6b35; color: white; padding: 2px 6px; border-radius: 12px; font-size: 9px;">📌 مثبت</span>' : ''}
                        ${isCommentOwner ? `<button class="post-menu" onclick="pinComment('${postId}', '${comment.id}')" style="margin-right: auto;"><i class="fas fa-thumbtack"></i></button>` : ''}
                    </div>
                    <div>${escapeHtml(filterBadWords(comment.text))}</div>
                </div>
            </div>
        `;
    }
    commentsList.innerHTML = html;
}

window.addComment = async function() {
    let text = document.getElementById('commentInput')?.value;
    if (!text || !currentPostId) return;
    
    if (containsBadWords(text)) {
        showToast('⚠️ التعليق يحتوي على كلمات ممنوعة');
        return;
    }
    
    text = filterBadWords(text);
    
    const isMuted = await isUserMuted(currentUser.uid);
    if (isMuted) {
        showToast('⚠️ أنت مقيد مؤقتاً ولا يمكنك التعليق');
        return;
    }
    
    const commentRef = db.ref(`comments/${currentPostId}`).push();
    await commentRef.set({
        userId: currentUser.uid,
        userName: currentUser.displayName || currentUser.name,
        text: text,
        timestamp: Date.now()
    });
    
    const postRef = db.ref(`posts/${currentPostId}`);
    const snapshot = await postRef.once('value');
    const post = snapshot.val();
    await postRef.update({ commentsCount: (post.commentsCount || 0) + 1 });
    
    if (post.userId !== currentUser.uid) {
        const dndSnapshot = await db.ref(`users/${post.userId}/dnd`).once('value');
        if (!dndSnapshot.val()) {
            const notifRef = db.ref(`notifications/${post.userId}`).push();
            await notifRef.set({
                type: 'comment',
                userId: currentUser.uid,
                userName: currentUser.displayName || currentUser.name,
                postId: currentPostId,
                text: text,
                timestamp: Date.now(),
                read: false
            });
        }
    }
    
    document.getElementById('commentInput').value = '';
    await loadComments(currentPostId);
    loadFeed();
    showToast('تم إضافة التعليق');
};

window.openMyProfile = function() { if (currentUser) openProfile(currentUser.uid); };

window.openProfile = async function(userId) {
    currentProfileUser = userId;
    const snapshot = await db.ref(`users/${userId}`).once('value');
    const userData = snapshot.val();
    if (!userData) return;
    
    await recordProfileView(userId);
    
    const profileCover = document.getElementById('profileCover');
    if (profileCover) {
        if (userData.cover) {
            profileCover.style.backgroundImage = `url(${userData.cover})`;
            profileCover.style.backgroundSize = 'cover';
            profileCover.style.backgroundPosition = 'center';
        } else {
            profileCover.style.backgroundImage = 'linear-gradient(135deg, #ff6b35, #f7b733)';
        }
    }
    
    const profileAvatarLarge = document.getElementById('profileAvatarLarge');
    profileAvatarLarge.innerHTML = userData.avatar ? `<img src="${userData.avatar}" style="width:100%;height:100%;object-fit:cover">` : '<i class="fas fa-user text-5xl text-white flex items-center justify-center h-full"></i>';
    
    document.getElementById('profileName').innerHTML = `${escapeHtml(userData.name)} ${userData.verified ? '<i class="fas fa-check-circle text-[#ff6b35] text-sm mr-1"></i>' : ''}`;
    document.getElementById('profileBio').textContent = userData.bio || "مرحباً! أنا في SPARK ✨";
    
    const websiteEl = document.getElementById('profileWebsite');
    if (userData.website) {
        websiteEl.innerHTML = `<a href="${userData.website}" target="_blank" style="color: #ff6b35;">${userData.website}</a>`;
    } else {
        websiteEl.innerHTML = '';
    }
    
    const followersSnapshot = await db.ref(`followers/${userId}`).once('value');
    const followingSnapshot = await db.ref(`following/${userId}`).once('value');
    const viewsSnapshot = await db.ref(`profileViews/${userId}`).once('value');
    
    document.getElementById('profileFollowersCount').textContent = followersSnapshot.exists() ? Object.keys(followersSnapshot.val()).length : 0;
    document.getElementById('profileFollowingCount').textContent = followingSnapshot.exists() ? Object.keys(followingSnapshot.val()).length : 0;
    document.getElementById('profileViewsCount').textContent = viewsSnapshot.exists() ? Object.keys(viewsSnapshot.val()).length : 0;
    
    const postsSnapshot = await db.ref('posts').once('value');
    const posts = postsSnapshot.val();
    document.getElementById('profilePostsCount').textContent = posts ? Object.values(posts).filter(p => p.userId === userId).length : 0;
    
    const buttonsDiv = document.getElementById('profileButtons');
    if (userId !== currentUser.uid) {
        const isFollowing = await checkIfFollowing(userId);
        const isBlockedUser = await isBlocked(userId);
        const isMuted = await isUserMuted(userId);
        buttonsDiv.innerHTML = `
            <button class="profile-btn ${isFollowing ? '' : 'profile-btn-primary'}" onclick="toggleFollow('${userId}')">${isFollowing ? 'متابَع' : 'متابعة'}</button>
            <button class="profile-btn" onclick="openChat('${userId}')"><i class="fas fa-comment"></i> راسل</button>
            <button class="profile-btn" onclick="startVideoCallWithUser('${userId}')"><i class="fas fa-video"></i></button>
            ${isBlockedUser ? `<button class="profile-btn" onclick="unblockUser('${userId}')">إلغاء الحظر</button>` : `<button class="profile-btn" onclick="blockUser('${userId}')">حظر</button>`}
            ${currentUser.isAdmin ? `<button class="profile-btn" onclick="muteUser('${userId}', 60)">${isMuted ? 'إلغاء التقييد' : 'تقييد'}</button>` : ''}
        `;
    } else {
        let adminButton = '';
        if (currentUser.isAdmin || currentUser.email === ADMIN_EMAIL) {
            adminButton = `<button class="profile-btn profile-btn-primary" onclick="openAdminPanel()"><i class="fas fa-cog"></i> لوحة التحكم</button>`;
        }
        buttonsDiv.innerHTML = `
            <button class="profile-btn" onclick="openEditProfileModal()"><i class="fas fa-edit"></i> تعديل</button>
            <button class="profile-btn" onclick="changeAvatar()"><i class="fas fa-camera"></i> صورة</button>
            <button class="profile-btn" onclick="changeCover()"><i class="fas fa-image"></i> غلاف</button>
            ${adminButton}
        `;
    }
    
    await loadProfilePosts(userId);
    document.getElementById('profilePanel').classList.add('open');
};

async function checkIfFollowing(userId) {
    const snapshot = await db.ref(`followers/${userId}/${currentUser.uid}`).once('value');
    return snapshot.exists();
}

window.toggleFollow = async function(userId) {
    const isFollowing = await checkIfFollowing(userId);
    if (isFollowing) {
        await db.ref(`followers/${userId}/${currentUser.uid}`).remove();
        await db.ref(`following/${currentUser.uid}/${userId}`).remove();
        showToast('تم إلغاء المتابعة');
    } else {
        await db.ref(`followers/${userId}/${currentUser.uid}`).set({ uid: currentUser.uid, name: currentUser.displayName || currentUser.name, timestamp: Date.now() });
        await db.ref(`following/${currentUser.uid}/${userId}`).set({ uid: userId, timestamp: Date.now() });
        showToast('تم المتابعة');
        const dndSnapshot = await db.ref(`users/${userId}/dnd`).once('value');
        if (!dndSnapshot.val()) {
            const notifRef = db.ref(`notifications/${userId}`).push();
            await notifRef.set({ type: 'follow', userId: currentUser.uid, userName: currentUser.displayName || currentUser.name, timestamp: Date.now(), read: false });
        }
    }
    openProfile(userId);
};

async function loadProfilePosts(userId) {
    const postsSnapshot = await db.ref('posts').once('value');
    const posts = postsSnapshot.val();
    const userPosts = posts ? Object.values(posts).filter(p => p.userId === userId).sort((a, b) => b.timestamp - a.timestamp) : [];
    const grid = document.getElementById('profilePostsGrid');
    if (!grid) return;
    if (userPosts.length === 0) { grid.innerHTML = '<div class="text-center p-8 text-gray-500" style="grid-column: span 3;">لا توجد منشورات</div>'; return; }
    let html = '';
    for (const post of userPosts) {
        html += `<div class="grid-item" onclick="openComments('${post.id}')">
            ${post.mediaUrl ? (post.mediaType === 'image' ? `<img src="${post.mediaUrl}">` : `<video src="${post.mediaUrl}"></video>`) : '<div class="flex items-center justify-center h-full bg-gray-100 dark:bg-gray-800"><i class="fas fa-file-alt text-2xl text-gray-500"></i></div>'}
            <div class="grid-item-overlay">
                <span><i class="fas fa-heart"></i> ${post.likes ? Object.keys(post.likes).length : 0}</span>
                <span><i class="fas fa-comment"></i> ${post.commentsCount || 0}</span>
            </div>
        </div>`;
    }
    grid.innerHTML = html;
}

window.loadProfileMedia = async function(userId) {
    const postsSnapshot = await db.ref('posts').once('value');
    const posts = postsSnapshot.val();
    const userPosts = posts ? Object.values(posts).filter(p => p.userId === userId && p.mediaUrl).sort((a, b) => b.timestamp - a.timestamp) : [];
    const grid = document.getElementById('profilePostsGrid');
    if (!grid) return;
    if (userPosts.length === 0) { grid.innerHTML = '<div class="text-center p-8 text-gray-500" style="grid-column: span 3;">لا توجد وسائط</div>'; return; }
    let html = '';
    for (const post of userPosts) {
        html += `<div class="grid-item" onclick="openComments('${post.id}')">${post.mediaType === 'image' ? `<img src="${post.mediaUrl}">` : `<video src="${post.mediaUrl}"></video>`}</div>`;
    }
    grid.innerHTML = html;
};

window.openEditProfileModal = function() {
    document.getElementById('editName').value = currentUser.displayName || currentUser.name || '';
    document.getElementById('editBio').value = currentUser.bio || '';
    document.getElementById('editWebsite').value = currentUser.website || '';
    document.getElementById('editProfileModal').classList.add('open');
};

window.closeEditProfileModal = function() { 
    document.getElementById('editProfileModal').classList.remove('open'); 
};

window.saveProfileEdit = async function() {
    const newName = document.getElementById('editName')?.value;
    const newBio = document.getElementById('editBio')?.value;
    const newWebsite = document.getElementById('editWebsite')?.value;
    
    if (newName && newName.trim()) {
        await currentUser.updateProfile({ displayName: newName.trim() });
    }
    
    await db.ref(`users/${currentUser.uid}`).update({ 
        name: newName || currentUser.name,
        bio: newBio || "", 
        website: newWebsite || "" 
    });
    
    currentUser.name = newName || currentUser.name;
    currentUser.bio = newBio || "";
    currentUser.website = newWebsite || "";
    currentUser.displayName = newName || currentUser.displayName;
    
    closeEditProfileModal();
    openProfile(currentUser.uid);
    showToast('تم حفظ التغييرات');
};

function getChatId(user1, user2) { return [user1, user2].sort().join('_'); }

window.openChat = async function(userId) {
    const snapshot = await db.ref(`users/${userId}`).once('value');
    currentChatUser = snapshot.val();
    document.getElementById('chatUserName').textContent = currentChatUser.name;
    const chatAvatar = document.getElementById('chatAvatar');
    chatAvatar.innerHTML = currentChatUser.avatar ? `<img src="${currentChatUser.avatar}" style="width:100%;height:100%;object-fit:cover">` : '<i class="fas fa-user text-white text-xl flex items-center justify-center h-full"></i>';
    
    const lastSeenSnapshot = await db.ref(`users/${userId}/lastSeen`).once('value');
    const lastSeen = lastSeenSnapshot.val();
    const lastSeenEl = document.getElementById('chatLastSeen');
    if (lastSeen) {
        lastSeenEl.textContent = `آخر ظهور ${formatTime(lastSeen)}`;
    } else {
        lastSeenEl.textContent = '';
    }
    
    const chatId = getChatId(currentUser.uid, userId);
    listenForTyping(chatId);
    await loadChatMessages(userId);
    document.getElementById('chatPanel').classList.add('open');
};

async function loadChatMessages(userId) {
    const chatId = getChatId(currentUser.uid, userId);
    db.ref(`chats/${chatId}`).off();
    db.ref(`chats/${chatId}`).on('value', (snapshot) => {
        const messages = snapshot.val();
        const container = document.getElementById('chatMessages');
        if (!container) return;
        if (!messages) { container.innerHTML = '<div class="text-center p-4 text-gray-500">لا توجد رسائل بعد</div>'; return; }
        let html = '';
        const messagesArray = Object.values(messages).sort((a, b) => a.timestamp - b.timestamp);
        for (const [msgId, msg] of Object.entries(messages)) {
            const isSent = msg.senderId === currentUser.uid;
            const isRead = msg.read;
            const reaction = msg.reaction;
            
            html += `<div class="chat-message ${isSent ? 'sent' : ''}" ondblclick="showReactionPopup('${msgId}', ${isSent})">
                <div class="message-bubble ${isSent ? 'sent' : ''}">
                    ${msg.text ? escapeHtml(msg.text) : ''}
                    ${msg.imageUrl ? `<img src="${msg.imageUrl}" class="message-image" onclick="openImageViewer(['${msg.imageUrl}'], 0)">` : ''}
                    ${msg.audioUrl ? `<audio controls class="audio-player" src="${msg.audioUrl}"></audio>` : ''}
                    ${reaction ? `<div class="message-reactions">${reaction.reaction}</div>` : ''}
                </div>
                ${isSent ? `<div class="message-status"><i class="fas fa-check${isRead ? '-double' : ''}"></i></div>` : ''}
            </div>`;
        }
        container.innerHTML = html;
        container.scrollTop = container.scrollHeight;
        
        for (const [msgId, msg] of Object.entries(messages)) {
            if (!msg.read && msg.senderId !== currentUser.uid) {
                db.ref(`chats/${chatId}/${msgId}/read`).set(true);
            }
        }
    });
}

window.sendChatMessage = async function() {
    const input = document.getElementById('chatMessageInput');
    let text = input?.value;
    if (!text || !currentChatUser) return;
    
    if (containsBadWords(text)) {
        showToast('⚠️ الرسالة تحتوي على كلمات ممنوعة');
        return;
    }
    
    text = filterBadWords(text);
    
    const chatId = getChatId(currentUser.uid, currentChatUser.uid);
    await db.ref(`chats/${chatId}`).push({ 
        senderId: currentUser.uid, 
        text: text, 
        timestamp: Date.now(), 
        read: false 
    });
    input.value = '';
    db.ref(`typing/${chatId}/${currentUser.uid}`).remove();
};

window.sendChatImage = async function(input) {
    const file = input.files[0];
    if (file && currentChatUser) {
        const url = await uploadToCloudinary(file);
        if (url) {
            const chatId = getChatId(currentUser.uid, currentChatUser.uid);
            await db.ref(`chats/${chatId}`).push({ senderId: currentUser.uid, imageUrl: url, timestamp: Date.now(), read: false });
        }
    }
    input.value = '';
};

function showReactionPopup(messageId, isSent) {
    const popup = document.getElementById('reactionsPopup');
    if (!popup) return;
    popup.style.display = 'flex';
    popup.style.opacity = '1';
    window.currentReactionMessageId = messageId;
    window.currentReactionIsSent = isSent;
    
    setTimeout(() => {
        popup.style.opacity = '0';
        setTimeout(() => {
            popup.style.display = 'none';
        }, 200);
    }, 3000);
}

async function sendReaction(reaction) {
    const messageId = window.currentReactionMessageId;
    if (!messageId) return;
    
    const chatId = getChatId(currentUser.uid, currentChatUser.uid);
    await db.ref(`chats/${chatId}/${messageId}/reaction`).set({
        reaction: reaction,
        userId: currentUser.uid
    });
    showToast(`تم إرسال ${reaction}`);
}

setInterval(async () => {
    if (currentUser) {
        await db.ref(`users/${currentUser.uid}/lastSeen`).set(Date.now());
    }
}, 60000);

window.openConversations = async function() {
    const conversationsList = document.getElementById('conversationsList');
    conversationsList.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
    const snapshot = await db.ref('chats').once('value');
    const chats = snapshot.val();
    if (!chats) { conversationsList.innerHTML = '<div class="text-center p-4 text-gray-500">لا توجد محادثات</div>'; document.getElementById('conversationsPanel')?.classList.add('open'); return; }
    const conversations = [];
    for (const [chatId, messages] of Object.entries(chats)) {
        const [user1, user2] = chatId.split('_');
        const otherUserId = user1 === currentUser.uid ? user2 : user1;
        const userSnapshot = await db.ref(`users/${otherUserId}`).once('value');
        const userData = userSnapshot.val();
        const messagesArray = Object.values(messages);
        const lastMessage = messagesArray.sort((a, b) => b.timestamp - a.timestamp)[0];
        conversations.push({ userId: otherUserId, userData: userData, lastMessage: lastMessage, timestamp: lastMessage.timestamp });
    }
    conversations.sort((a, b) => b.timestamp - a.timestamp);
    let html = '';
    for (const conv of conversations) {
        let unreadCount = 0;
        const messagesSnapshot = await db.ref(`chats/${getChatId(currentUser.uid, conv.userId)}`).once('value');
        const messages = messagesSnapshot.val();
        if (messages) {
            unreadCount = Object.values(messages).filter(m => !m.read && m.senderId !== currentUser.uid).length;
        }
        html += `<div class="follower-item" onclick="closeConversations(); openChat('${conv.userId}')">
            <div class="post-avatar" style="width: 48px; height: 48px;">${conv.userData?.avatar ? `<img src="${conv.userData.avatar}">` : '<i class="fas fa-user text-white text-xl flex items-center justify-center h-full"></i>'}</div>
            <div style="flex: 1;">
                <div style="font-weight: 600;">${escapeHtml(conv.userData?.name || 'مستخدم')}</div>
                <div style="font-size: 12px; color: #8e8e8e;">${conv.lastMessage.text ? conv.lastMessage.text.substring(0, 30) : (conv.lastMessage.audioUrl ? 'رسالة صوتية' : (conv.lastMessage.imageUrl ? 'صورة' : ''))}</div>
            </div>
            ${unreadCount > 0 ? `<div style="background: #ff6b35; color: white; border-radius: 50%; width: 20px; height: 20px; display: flex; align-items: center; justify-content: center; font-size: 10px;">${unreadCount}</div>` : ''}
        </div>`;
    }
    conversationsList.innerHTML = html;
    document.getElementById('conversationsPanel')?.classList.add('open');
};

async function loadNotifications() {
    if (!currentUser) return;
    db.ref(`notifications/${currentUser.uid}`).on('value', (snapshot) => {
        const notifications = snapshot.val();
        const notifIcon = document.getElementById('notifIcon');
        if (!notifIcon) return;
        const existingBadge = notifIcon.querySelector('.notification-badge');
        if (notifications) {
            const unread = Object.values(notifications).filter(n => !n.read).length;
            if (unread > 0) {
                if (!existingBadge) {
                    notifIcon.innerHTML = '<i class="far fa-bell"></i><div class="notification-badge">' + unread + '</div>';
                } else {
                    existingBadge.textContent = unread;
                }
            } else if (existingBadge) {
                notifIcon.innerHTML = '<i class="far fa-bell"></i>';
            }
        } else if (existingBadge) {
            notifIcon.innerHTML = '<i class="far fa-bell"></i>';
        }
    });
}

window.openNotifications = async function() {
    const snapshot = await db.ref(`notifications/${currentUser.uid}`).once('value');
    const notifications = snapshot.val();
    const container = document.getElementById('notificationsList');
    if (!notifications) { container.innerHTML = '<div class="text-center p-4 text-gray-500">لا توجد إشعارات</div>'; document.getElementById('notificationsPanel')?.classList.add('open'); return; }
    let html = '';
    const sorted = Object.entries(notifications).sort((a, b) => b[1].timestamp - a[1].timestamp);
    for (const [id, notif] of sorted) {
        html += `<div class="follower-item" onclick="markNotificationRead('${id}'); ${notif.type === 'like' ? `openComments('${notif.postId}')` : notif.type === 'comment' ? `openComments('${notif.postId}')` : notif.type === 'call' ? `window.location.reload()` : `openProfile('${notif.userId}')`}">
            <div class="post-avatar" style="width: 44px; height: 44px;"><i class="fas ${notif.type === 'like' ? 'fa-heart' : notif.type === 'comment' ? 'fa-comment' : notif.type === 'call' ? 'fa-video' : 'fa-user-plus'} text-white text-xl flex items-center justify-center h-full"></i></div>
            <div style="flex: 1;">
                <div><span style="font-weight: 600;">${escapeHtml(notif.userName)}</span> ${notif.type === 'like' ? 'أعجب بمنشورك' : notif.type === 'comment' ? `علق على منشورك: ${notif.text?.substring(0, 50)}` : notif.type === 'call' ? 'أجرى مكالمة فيديو معك' : 'بدأ بمتابعتك'}</div>
                <div style="font-size: 11px; color: #8e8e8e;">${formatTime(notif.timestamp)}</div>
            </div>
        </div>`;
    }
    container.innerHTML = html;
    document.getElementById('notificationsPanel')?.classList.add('open');
    const updates = {};
    for (const id of Object.keys(notifications)) updates[`notifications/${currentUser.uid}/${id}/read`] = true;
    await db.ref().update(updates);
    loadNotifications();
};

window.markNotificationRead = async function(notifId) { 
    await db.ref(`notifications/${currentUser.uid}/${notifId}`).update({ read: true }); 
    loadNotifications(); 
};

window.searchAll = async function() {
    const query = document.getElementById('searchInput')?.value.toLowerCase();
    if (!query) { document.getElementById('searchResults').innerHTML = ''; return; }
    
    const usersSnapshot = await db.ref('users').once('value');
    const users = usersSnapshot.val();
    const hashtagSnapshot = await db.ref('hashtags').once('value');
    const hashtags = hashtagSnapshot.val();
    
    let results = [];
    if (users) results.push(...Object.values(users).filter(u => u.name?.toLowerCase().includes(query) || u.email?.toLowerCase().includes(query)).map(u => ({ type: 'user', data: u })));
    if (hashtags && query.startsWith('#')) {
        const tag = query.substring(1);
        if (hashtags[tag]) results.push({ type: 'hashtag', data: { tag: tag, count: Object.keys(hashtags[tag]).length } });
    } else if (hashtags) {
        for (const [tag, posts] of Object.entries(hashtags)) {
            if (tag.toLowerCase().includes(query)) {
                results.push({ type: 'hashtag', data: { tag: tag, count: Object.keys(posts).length } });
            }
        }
    }
    
    let html = '';
    for (const result of results) {
        if (result.type === 'user') html += `<div class="follower-item" onclick="closeSearch(); openProfile('${result.data.uid}')">
            <div class="post-avatar" style="width: 44px; height: 44px;">${result.data.avatar ? `<img src="${result.data.avatar}">` : '<i class="fas fa-user text-white text-xl flex items-center justify-center h-full"></i>'}</div>
            <div><div style="font-weight: 600;">${escapeHtml(result.data.name)}</div><div style="font-size: 12px; color: #8e8e8e;">${escapeHtml(result.data.email)}</div></div>
        </div>`;
        else if (result.type === 'hashtag') html += `<div class="follower-item" onclick="closeSearch(); searchHashtag('${result.data.tag}')">
            <div class="post-avatar" style="width: 44px; height: 44px; background: linear-gradient(135deg, #ff6b35, #f7b733); display: flex; align-items: center; justify-content: center;"><i class="fas fa-hashtag text-white text-xl"></i></div>
            <div><div style="font-weight: 600; color: #ff6b35;">#${escapeHtml(result.data.tag)}</div><div style="font-size: 12px; color: #8e8e8e;">${result.data.count} منشور</div></div>
        </div>`;
    }
    
    document.getElementById('searchResults').innerHTML = html || '<div class="text-center p-4 text-gray-500">لا توجد نتائج</div>';
};

window.openAdminPanel = async function() {
    if (currentUser.email !== ADMIN_EMAIL && !currentUser.isAdmin) {
        showToast('🚫 غير مصرح لك بالدخول إلى لوحة التحكم');
        return;
    }
    
    showToast('🔧 جاري تحميل لوحة التحكم...');
    
    const usersSnapshot = await db.ref('users').once('value');
    const postsSnapshot = await db.ref('posts').once('value');
    const commentsSnapshot = await db.ref('comments').once('value');
    const usersCount = usersSnapshot.exists() ? Object.keys(usersSnapshot.val()).length : 0;
    const postsCount = postsSnapshot.exists() ? Object.keys(postsSnapshot.val()).length : 0;
    let commentsCount = 0;
    if (commentsSnapshot.exists()) for (const pc of Object.values(commentsSnapshot.val())) commentsCount += Object.keys(pc).length;
    document.getElementById('adminUsersCount').textContent = usersCount;
    document.getElementById('adminPostsCount').textContent = postsCount;
    document.getElementById('adminCommentsCount').textContent = commentsCount;
    
    let usersHtml = '';
    if (usersSnapshot.exists()) {
        for (const [uid, user] of Object.entries(usersSnapshot.val())) {
            if (uid !== currentUser.uid) {
                const isMuted = await isUserMuted(uid);
                usersHtml += `<div class="admin-item"><div><div class="admin-item-name">${escapeHtml(user.name)}</div><div class="admin-item-email">${escapeHtml(user.email)}</div></div><div>${!user.verified ? `<button class="admin-verify-btn" onclick="verifyUser('${uid}')">✅ توثيق</button>` : '<span class="text-green-500">✅ موثق</span>'}<button class="admin-mute-btn" onclick="muteUser('${uid}', 60)">🔇 تقييد</button><button class="admin-delete-btn" onclick="deleteUser('${uid}')">🗑️ حذف</button></div></div>`;
            }
        }
    }
    document.getElementById('adminUsersList').innerHTML = usersHtml || '<div class="text-center p-4 text-gray-500">لا يوجد مستخدمين</div>';
    
    let postsHtml = '';
    if (postsSnapshot.exists()) {
        for (const post of Object.values(postsSnapshot.val()).sort((a, b) => b.timestamp - a.timestamp).slice(0, 20)) {
            postsHtml += `<div class="admin-item"><div><div class="admin-item-name">${escapeHtml(post.userName)}</div><div class="admin-item-email">${escapeHtml(post.text?.substring(0, 50) || '')}</div></div><button class="admin-delete-btn" onclick="deletePost('${post.id}')">🗑️ حذف</button></div>`;
        }
    }
    document.getElementById('adminPostsList').innerHTML = postsHtml || '<div class="text-center p-4 text-gray-500">لا توجد منشورات</div>';
    
    document.getElementById('adminPanel').classList.add('open');
};

window.verifyUser = async function(userId) { 
    await db.ref(`users/${userId}`).update({ verified: true }); 
    showToast('✅ تم توثيق المستخدم بنجاح');
    
    if (currentUser && currentUser.uid === userId) {
        currentUser.verified = true;
        const userSnapshot = await db.ref(`users/${userId}`).once('value');
        const userData = userSnapshot.val();
        currentUser = { ...currentUser, ...userData };
    }
    
    openAdminPanel();
    if (currentProfileUser === userId) {
        openProfile(userId);
    }
    loadFeed();
};

window.deleteUser = async function(userId) { 
    if (confirm('⚠️ هل أنت متأكد من حذف هذا المستخدم نهائياً؟')) { 
        await db.ref(`users/${userId}`).remove(); 
        showToast('🗑️ تم حذف المستخدم'); 
        openAdminPanel(); 
        loadFeed();
    } 
};

window.closeAdmin = function() { document.getElementById('adminPanel').classList.remove('open'); };

window.startVideoCallWithUser = async function(userId) {
    const channelName = `call_${getChatId(currentUser.uid, userId)}`;
    document.getElementById('videoCallModal').classList.add('open');
    await startVideoCallWithAgora(channelName, currentUser.uid);
    const notifRef = db.ref(`notifications/${userId}`).push();
    await notifRef.set({ type: 'call', userId: currentUser.uid, userName: currentUser.displayName || currentUser.name, channelName: channelName, timestamp: Date.now(), read: false });
};

window.endVideoCall = endVideoCall;

window.openFollowersList = async function(type) {
    document.getElementById('followersTitle').textContent = type === 'followers' ? 'المتابعون' : 'المتابَعون';
    const refPath = type === 'followers' ? `followers/${currentProfileUser}` : `following/${currentProfileUser}`;
    const snapshot = await db.ref(refPath).once('value');
    const data = snapshot.val();
    const container = document.getElementById('followersList');
    if (!data) { container.innerHTML = '<div class="text-center p-4 text-gray-500">لا يوجد ' + (type === 'followers' ? 'متابعون' : 'متابَعون') + '</div>'; document.getElementById('followersPanel')?.classList.add('open'); return; }
    let html = '';
    for (const [userId] of Object.entries(data)) {
        const userSnapshot = await db.ref(`users/${userId}`).once('value');
        const userData = userSnapshot.val();
        html += `<div class="follower-item" onclick="closeFollowers(); openProfile('${userId}')">
            <div class="post-avatar" style="width: 48px; height: 48px;">${userData?.avatar ? `<img src="${userData.avatar}">` : '<i class="fas fa-user text-white text-xl flex items-center justify-center h-full"></i>'}</div>
            <div><div style="font-weight: 600;">${escapeHtml(userData?.name || 'مستخدم')}</div><div style="font-size: 12px; color: #8e8e8e;">${escapeHtml(userData?.bio?.substring(0, 50) || '')}</div></div>
        </div>`;
    }
    container.innerHTML = html;
    document.getElementById('followersPanel')?.classList.add('open');
};

window.openStories = async function() { await loadStories(); document.getElementById('storiesPanel')?.classList.add('open'); };
async function loadStories() {
    const snapshot = await db.ref('stories').once('value');
    const stories = snapshot.val();
    const container = document.getElementById('storiesList');
    container.innerHTML = `<div class="story-card" onclick="addStory()"><div class="add-story-btn"><i class="fas fa-plus"></i></div><div class="story-name">إضافة قصة</div></div>`;
    if (stories) {
        for (const [storyId, story] of Object.entries(stories)) {
            const userSnapshot = await db.ref(`users/${story.userId}`).once('value');
            const userData = userSnapshot.val();
            if (Date.now() - story.timestamp < 86400000) {
                container.innerHTML += `<div class="story-card" onclick="viewStory('${storyId}')"><div class="story-ring"><div class="story-avatar" style="background-image: url('${story.mediaUrl}'); background-size: cover; background-position: center;"></div></div><div class="story-name">${escapeHtml(userData?.name || '')}</div></div>`;
            }
        }
    }
}
window.addStory = async function() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*,video/*';
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (file) {
            const url = await uploadToCloudinary(file);
            if (url) {
                await db.ref('stories').push({ userId: currentUser.uid, mediaUrl: url, mediaType: file.type.split('/')[0], timestamp: Date.now() });
                showToast('تم إضافة القصة');
                await loadStories();
            }
        }
    };
    input.click();
};
function viewStory(storyId) { showToast('مشاهدة القصة قريباً...'); }

window.closeCompose = function() { 
    document.getElementById('composeModal').classList.remove('open'); 
    document.getElementById('postText').value = ''; 
    document.getElementById('mediaPreview').innerHTML = ''; 
    document.getElementById('mediaPreview').style.display = 'none'; 
    document.getElementById('pollBuilder').style.display = 'none';
    document.getElementById('schedulePicker').style.display = 'none';
    selectedMediaFile = null; 
    editingPostId = null; 
};
window.openCompose = function() { document.getElementById('composeModal').classList.add('open'); };
window.closeComments = function() { document.getElementById('commentsPanel').classList.remove('open'); currentPostId = null; };
window.closeProfile = function() { document.getElementById('profilePanel').classList.remove('open'); };
window.closeChat = function() { 
    document.getElementById('chatPanel').classList.remove('open'); 
    if (isRecording) stopVoiceRecording(); 
    if (currentChatUser) {
        const chatId = getChatId(currentUser.uid, currentChatUser.uid);
        db.ref(`chats/${chatId}`).off();
        db.ref(`typing/${chatId}`).off();
    }
    currentChatUser = null; 
};
window.closeConversations = function() { document.getElementById('conversationsPanel').classList.remove('open'); };
window.closeNotifications = function() { document.getElementById('notificationsPanel').classList.remove('open'); };
window.closeSearch = function() { document.getElementById('searchPanel').classList.remove('open'); document.getElementById('searchInput').value = ''; document.getElementById('searchResults').innerHTML = ''; };
window.openSearch = function() { document.getElementById('searchPanel').classList.add('open'); };
window.closeStories = function() { document.getElementById('storiesPanel').classList.remove('open'); };
window.closeFollowers = function() { document.getElementById('followersPanel').classList.remove('open'); };
window.goToHome = function() { switchTab('home'); };
window.switchTab = function(tab) { if (tab === 'home') loadFeed(); };
window.previewMedia = function(input, type) {
    const file = input.files[0];
    if (file) {
        selectedMediaFile = file;
        const preview = document.getElementById('mediaPreview');
        const reader = new FileReader();
        reader.onload = function(e) {
            if (type === 'image') preview.innerHTML = `<img src="${e.target.result}"><div class="remove-media" onclick="removeSelectedMedia()" style="position: absolute; top: 8px; right: 8px; background: black; color: white; border-radius: 50%; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; cursor: pointer;"><i class="fas fa-times"></i></div>`;
            else if (type === 'video') preview.innerHTML = `<video src="${e.target.result}" controls></video><div class="remove-media" onclick="removeSelectedMedia()" style="position: absolute; top: 8px; right: 8px; background: black; color: white; border-radius: 50%; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; cursor: pointer;"><i class="fas fa-times"></i></div>`;
            preview.style.display = 'block';
        };
        reader.readAsDataURL(file);
    }
};
function removeSelectedMedia() {
    selectedMediaFile = null;
    document.getElementById('mediaPreview').innerHTML = '';
    document.getElementById('mediaPreview').style.display = 'none';
}
window.toggleVoiceRecording = toggleVoiceRecording;

auth.onAuthStateChanged(async (user) => {
    if (user) {
        currentUser = user;
        const snapshot = await db.ref(`users/${user.uid}`).once('value');
        if (snapshot.exists()) {
            currentUser = { ...currentUser, ...snapshot.val() };
        } else {
            await db.ref(`users/${user.uid}`).set({ 
                uid: user.uid, 
                name: user.displayName || user.email.split('@')[0], 
                email: user.email, 
                bio: "مرحباً! أنا في SPARK ✨", 
                avatar: "", 
                cover: "", 
                website: "",
                verified: false, 
                isAdmin: user.email === ADMIN_EMAIL,
                blockedUsers: {},
                mutedUntil: 0,
                createdAt: Date.now() 
            });
            currentUser.isAdmin = user.email === ADMIN_EMAIL;
        }
        document.getElementById('authScreen').style.display = 'none';
        document.getElementById('mainApp').style.display = 'block';
        const savedTheme = localStorage.getItem('theme');
        if (savedTheme === 'dark') document.body.classList.add('dark-mode');
        
        const savedReadMode = localStorage.getItem('readMode');
        if (savedReadMode === 'true') {
            readModeActive = true;
            document.getElementById('readModeToggle')?.classList.add('active');
            document.body.classList.add('read-mode');
        }
        
        const savedHideLikes = localStorage.getItem('hideLikes');
        if (savedHideLikes === 'true') {
            hideLikesActive = true;
            document.getElementById('hideLikesToggle')?.classList.add('active');
        }
        
        loadFeed();
        loadNotifications();
        loadTrendingHashtags();
        loadDndStatus();
        checkScheduledPosts();
    } else {
        document.getElementById('authScreen').style.display = 'flex';
        document.getElementById('mainApp').style.display = 'none';
    }
});

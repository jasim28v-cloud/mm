let currentUser = null;
let currentPostId = null;
let currentChatUser = null;
let currentProfileUser = null;
let selectedMediaFile = null;
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

let agoraClient = null;
let localTracks = { videoTrack: null, audioTrack: null };
let isCallActive = false;

let lastPostKey = null;
let isLoadingMore = false;
let hasMorePosts = true;

let badWordsList = ['كس', 'عير', 'قحب', 'زنا', 'سكس', 'porn', 'sex', 'fuck', 'shit', 'bitch'];

// ========== دوال مساعدة ==========
function showToast(message, duration = 2000) {
    const toast = document.getElementById('customToast');
    if (!toast) return;
    toast.textContent = message;
    toast.style.opacity = '1';
    setTimeout(() => {
        toast.style.opacity = '0';
    }, duration);
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

// ========== عرض الصور ==========
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

// ========== عرض الفيديو ==========
function openVideoModal(videoUrl) {
    const oldModal = document.querySelector('.video-modal');
    if (oldModal) oldModal.remove();
    
    const modal = document.createElement('div');
    modal.className = 'video-modal';
    modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.95);z-index:2000;display:flex;align-items:center;justify-content:center;cursor:pointer';
    
    const video = document.createElement('video');
    video.src = videoUrl;
    video.controls = true;
    video.autoplay = true;
    video.style.cssText = 'max-width:90%;max-height:90%;border-radius:20px;box-shadow:0 0 50px rgba(0,0,0,0.5)';
    
    const closeBtn = document.createElement('div');
    closeBtn.innerHTML = '&times;';
    closeBtn.style.cssText = 'position:absolute;top:20px;right:20px;font-size:40px;color:white;cursor:pointer;font-weight:bold;width:50px;height:50px;display:flex;align-items:center;justify-content:center;border-radius:50%;background:rgba(0,0,0,0.5)';
    
    modal.appendChild(video);
    modal.appendChild(closeBtn);
    document.body.appendChild(modal);
    
    const closeModal = () => {
        video.pause();
        modal.remove();
    };
    
    modal.onclick = (e) => { if (e.target === modal) closeModal(); };
    closeBtn.onclick = closeModal;
}

// ========== تحميل المنشورات (Pagination) ==========
async function loadFeed(reset = true) {
    const feedContainer = document.getElementById('feedContainer');
    if (!feedContainer) return;
    
    if (reset) {
        feedContainer.innerHTML = '<div class="loading"><div class="spinner"></div><span>جاري التحميل...</span></div>';
        lastPostKey = null;
        hasMorePosts = true;
    }

    const blockedSnapshot = await db.ref(`users/${currentUser?.uid}/blockedUsers`).once('value');
    const blockedUsers = blockedSnapshot.val() || {};
    
    let query = db.ref('posts').orderByChild('timestamp').limitToLast(10);
    if (lastPostKey && !reset) {
        query = db.ref('posts').orderByChild('timestamp').endAt(lastPostKey).limitToLast(10);
    }
    
    const snapshot = await query.once('value');
    const posts = snapshot.val();
    
    if (!posts || Object.keys(posts).length === 0) {
        if (reset) {
            feedContainer.innerHTML = '<div class="text-center p-8 text-gray-500">لا توجد منشورات بعد</div>';
        }
        hasMorePosts = false;
        return;
    }
    
    let postsArray = Object.values(posts)
        .filter(post => !blockedUsers[post.userId])
        .sort((a, b) => b.timestamp - a.timestamp);
    
    if (postsArray.length > 0) {
        lastPostKey = postsArray[postsArray.length - 1].timestamp;
    }
    
    if (postsArray.length < 10) hasMorePosts = false;
    
    const pinnedPostId = await db.ref(`users/${currentUser?.uid}/pinnedPost`).once('value');
    const pinnedId = pinnedPostId.val();
    
    if (pinnedId && reset) {
        const pinnedSnapshot = await db.ref(`posts/${pinnedId}`).once('value');
        const pinnedPost = pinnedSnapshot.val();
        if (pinnedPost && !blockedUsers[pinnedPost.userId]) {
            postsArray = [pinnedPost, ...postsArray.filter(p => p.id !== pinnedId)];
        }
    }
    
    let html = '';
    for (const post of postsArray) {
        db.ref(`posts/${post.id}/views`).transaction(current => (current || 0) + 1);
        
        const isLiked = post.likes && post.likes[currentUser?.uid];
        const likesCount = post.likes ? Object.keys(post.likes).length : 0;
        const isOwner = post.userId === currentUser?.uid;
        const isPinned = pinnedId === post.id;
        const isUserVerified = post.userVerified || false;
        
        let formattedText = escapeHtml(post.text);
        if (post.hashtags) {
            post.hashtags.forEach(tag => {
                const regex = new RegExp(`#${tag}`, 'gi');
                formattedText = formattedText.replace(regex, `<span class="post-hashtags" onclick="searchHashtag('${tag}')">#${tag}</span>`);
            });
        }
        
        formattedText = formattedText.replace(/@(\w+)/g, '<span class="post-hashtags" onclick="searchUser(\'$1\')">@$1</span>');
        
        let mediaHtml = '';
        if (post.mediaUrl) {
            if (post.mediaType === 'image') {
                mediaHtml = `<div class="post-media-wrapper" onclick="event.stopPropagation(); openImageViewer(['${post.mediaUrl}'], 0)">
                    <img src="${post.mediaUrl}" class="post-media" loading="lazy">
                </div>`;
            } else if (post.mediaType === 'video') {
                mediaHtml = `<div class="post-media-wrapper video-wrapper" onclick="event.stopPropagation(); openVideoModal('${post.mediaUrl}')">
                    <video src="${post.mediaUrl}" class="post-media" preload="metadata"></video>
                    <div class="play-icon-overlay">
                        <i class="fas fa-play"></i>
                    </div>
                </div>`;
            }
        }
        
        html += `
            <div class="post-card ${isPinned ? 'pinned' : ''} fade-in" data-post-id="${post.id}">
                ${isPinned ? '<div class="pinned-badge"><i class="fas fa-thumbtack"></i> مثبت</div>' : ''}
                <div class="post-header">
                    <div class="post-user-info" onclick="openProfile('${post.userId}')">
                        <div class="post-avatar">
                            ${post.userAvatar ? `<img src="${post.userAvatar}">` : '<i class="fas fa-user text-white text-xl flex items-center justify-center h-full"></i>'}
                        </div>
                        <div>
                            <div class="post-username">${escapeHtml(post.userName)} ${isUserVerified ? '<i class="fas fa-check-circle text-[#ff6b35] text-xs mr-1"></i>' : ''}</div>
                            <div class="post-time">${formatTime(post.timestamp)}</div>
                        </div>
                    </div>
                    <div style="display: flex; gap: 12px;">
                        ${(isOwner || currentUser?.isAdmin) ? `<button class="post-menu" onclick="event.stopPropagation(); deletePost('${post.id}')"><i class="fas fa-trash-alt"></i></button>` : ''}
                        <button class="post-menu" onclick="event.stopPropagation(); savePost('${post.id}')"><i class="fas fa-bookmark"></i></button>
                        <button class="post-menu" onclick="event.stopPropagation(); openReportModal('${post.id}')"><i class="fas fa-flag"></i></button>
                    </div>
                </div>
                ${mediaHtml}
                <div class="post-actions">
                    <button class="post-action like-btn ${isLiked ? 'active' : ''}" data-post-id="${post.id}" onclick="likePost('${post.id}')"><i class="fas fa-heart"></i></button>
                    <button class="post-action" onclick="openComments('${post.id}')"><i class="fas fa-comment"></i></button>
                    <button class="post-action" onclick="sharePost('${post.id}')"><i class="fas fa-paper-plane"></i></button>
                </div>
                ${likesCount > 0 && !hideLikesActive ? `<div class="post-likes">${likesCount} إعجاب</div>` : ''}
                <div class="post-caption"><span onclick="openProfile('${post.userId}')">${escapeHtml(post.userName)}</span> ${formattedText}</div>
                ${post.commentsCount > 0 ? `<div class="post-comments" onclick="openComments('${post.id}')">عرض جميع التعليقات (${post.commentsCount})</div>` : ''}
            </div>
        `;
    }
    
    if (reset) {
        feedContainer.innerHTML = html;
    } else {
        feedContainer.insertAdjacentHTML('beforeend', html);
    }
    
    if (hasMorePosts) {
        let loadMoreBtn = document.getElementById('loadMoreBtn');
        if (!loadMoreBtn) {
            loadMoreBtn = document.createElement('div');
            loadMoreBtn.id = 'loadMoreBtn';
            loadMoreBtn.innerHTML = '<button onclick="loadMorePosts()" style="width:100%;padding:12px;background:none;border:1px solid #dbdbdb;border-radius:12px;margin:16px 0;cursor:pointer">📥 تحميل المزيد</button>';
            feedContainer.appendChild(loadMoreBtn);
        }
    } else {
        const loadMoreBtn = document.getElementById('loadMoreBtn');
        if (loadMoreBtn) loadMoreBtn.remove();
    }
}

async function loadMorePosts() {
    if (isLoadingMore || !hasMorePosts) return;
    isLoadingMore = true;
    await loadFeed(false);
    isLoadingMore = false;
}

// ========== الإعجاب ==========
window.likePost = async function(postId) {
    const likeBtn = document.querySelector(`.like-btn[data-post-id="${postId}"]`);
    const isCurrentlyLiked = likeBtn?.classList.contains('active');
    
    if (likeBtn) {
        likeBtn.classList.toggle('active');
    }
    
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
                await db.ref(`notifications/${post.userId}`).push({
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
};

// ========== حفظ وحذف المنشور ==========
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
    loadFeed(true);
    showToast('تم حذف المنشور');
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
        timestamp: Date.now()
    });
    showToast('تمت المشاركة!');
    loadFeed(true);
};

// ========== إنشاء منشور ==========
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

    let mediaUrl = "", mediaType = "";
    if (selectedMediaFile) {
        mediaType = selectedMediaFile.type.split('/')[0];
        mediaUrl = await uploadToCloudinary(selectedMediaFile);
        if (!mediaUrl) return;
    }

    const hashtags = extractHashtags(text);
    const postRef = db.ref('posts').push();
    
    await postRef.set({
        id: postRef.key,
        userId: currentUser.uid,
        userName: currentUser.displayName || currentUser.name,
        userAvatar: currentUser.avatar || "",
        userVerified: currentUser.verified || false,
        text: text,
        mediaUrl: mediaUrl,
        mediaType: mediaType,
        hashtags: hashtags,
        likes: {},
        views: 0,
        commentsCount: 0,
        timestamp: Date.now()
    });
    
    for (const tag of hashtags) {
        await db.ref(`hashtags/${tag.toLowerCase()}/${postRef.key}`).set(true);
    }

    document.getElementById('postText').value = "";
    document.getElementById('mediaPreview').innerHTML = "";
    document.getElementById('mediaPreview').style.display = "none";
    selectedMediaFile = null;
    closeCompose();
    loadFeed(true);
    loadTrendingHashtags();
    showToast('تم نشر المنشور بنجاح!');
};

// ========== التعليقات ==========
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
    
    if (!comments) {
        commentsList.innerHTML = '<div class="text-center p-4 text-gray-500">لا توجد تعليقات</div>';
        return;
    }
    
    let commentsArray = Object.entries(comments).map(([id, comment]) => ({ id, ...comment }));
    commentsArray.sort((a, b) => b.timestamp - a.timestamp);
    
    let html = '';
    for (const comment of commentsArray) {
        const userSnapshot = await db.ref(`users/${comment.userId}`).once('value');
        const userData = userSnapshot.val();
        html += `
            <div class="chat-message">
                <div class="message-bubble">
                    <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
                        <span style="font-weight: 600; cursor: pointer;" onclick="closeComments(); openProfile('${comment.userId}')">${escapeHtml(userData?.name || 'مستخدم')}</span>
                        <span style="font-size: 10px; color: #8e8e8e;">${formatTime(comment.timestamp)}</span>
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
            await db.ref(`notifications/${post.userId}`).push({
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
    showToast('تم إضافة التعليق');
};

// ========== الملف الشخصي ==========
window.openMyProfile = function() { if (currentUser) openProfile(currentUser.uid); };

window.openProfile = async function(userId) {
    currentProfileUser = userId;
    const snapshot = await db.ref(`users/${userId}`).once('value');
    const userData = snapshot.val();
    if (!userData) return;
    
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
    
    document.getElementById('profileFollowersCount').textContent = followersSnapshot.exists() ? Object.keys(followersSnapshot.val()).length : 0;
    document.getElementById('profileFollowingCount').textContent = followingSnapshot.exists() ? Object.keys(followingSnapshot.val()).length : 0;
    
    const postsSnapshot = await db.ref('posts').once('value');
    const posts = postsSnapshot.val();
    document.getElementById('profilePostsCount').textContent = posts ? Object.values(posts).filter(p => p.userId === userId).length : 0;
    
    const buttonsDiv = document.getElementById('profileButtons');
    if (userId !== currentUser.uid) {
        const isFollowing = await checkIfFollowing(userId);
        buttonsDiv.innerHTML = `
            <button class="profile-btn ${isFollowing ? '' : 'profile-btn-primary'}" onclick="toggleFollow('${userId}')">${isFollowing ? 'متابَع' : 'متابعة'}</button>
            <button class="profile-btn" onclick="openChat('${userId}')"><i class="fas fa-comment"></i> راسل</button>
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
            await db.ref(`notifications/${userId}`).push({ type: 'follow', userId: currentUser.uid, userName: currentUser.displayName || currentUser.name, timestamp: Date.now(), read: false });
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
            ${post.mediaUrl ? (post.mediaType === 'image' ? `<img src="${post.mediaUrl}" loading="lazy" style="width:100%;height:100%;object-fit:cover">` : `<video src="${post.mediaUrl}" style="width:100%;height:100%;object-fit:cover" preload="metadata"></video>`) : '<div class="flex items-center justify-center h-full bg-gray-100 dark:bg-gray-800"><i class="fas fa-file-alt text-2xl text-gray-500"></i></div>'}
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
        if (post.mediaType === 'image') {
            html += `<div class="grid-item" onclick="openComments('${post.id}')"><img src="${post.mediaUrl}" loading="lazy" style="width:100%;height:100%;object-fit:cover"></div>`;
        } else if (post.mediaType === 'video') {
            html += `<div class="grid-item" onclick="openVideoModal('${post.mediaUrl}')" style="position:relative;cursor:pointer;">
                <video src="${post.mediaUrl}" style="width:100%;height:100%;object-fit:cover" preload="metadata"></video>
                <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);background:rgba(0,0,0,0.6);width:40px;height:40px;border-radius:50%;display:flex;align-items:center;justify-content:center"><i class="fas fa-play" style="color:white;font-size:18px"></i></div>
            </div>`;
        }
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
                openProfile(currentUser.uid);
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
                openProfile(currentUser.uid);
                showToast('تم تغيير صورة الغلاف بنجاح');
            }
        }
    };
    input.click();
};

// ========== الدردشة ==========
function getChatId(user1, user2) { return [user1, user2].sort().join('_'); }

window.openChat = async function(userId) {
    const snapshot = await db.ref(`users/${userId}`).once('value');
    currentChatUser = snapshot.val();
    document.getElementById('chatUserName').textContent = currentChatUser.name;
    const chatAvatar = document.getElementById('chatAvatar');
    chatAvatar.innerHTML = currentChatUser.avatar ? `<img src="${currentChatUser.avatar}" style="width:100%;height:100%;object-fit:cover">` : '<i class="fas fa-user text-white text-xl flex items-center justify-center h-full"></i>';
    
    const chatId = getChatId(currentUser.uid, userId);
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
            
            html += `<div class="chat-message ${isSent ? 'sent' : ''}">
                <div class="message-bubble ${isSent ? 'sent' : ''}">
                    ${msg.text ? escapeHtml(msg.text) : ''}
                    ${msg.imageUrl ? `<img src="${msg.imageUrl}" class="message-image" onclick="openImageViewer(['${msg.imageUrl}'], 0)">` : ''}
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

// ========== البحث ==========
window.searchAll = async function() {
    const query = document.getElementById('searchInput')?.value.toLowerCase();
    if (!query) { document.getElementById('searchResults').innerHTML = ''; return; }
    
    const usersSnapshot = await db.ref('users').once('value');
    const users = usersSnapshot.val();
    
    let results = [];
    if (users) {
        results.push(...Object.values(users).filter(u => u.name?.toLowerCase().includes(query) || u.email?.toLowerCase().includes(query)).map(u => ({ type: 'user', data: u })));
    }
    
    let html = '';
    for (const result of results) {
        if (result.type === 'user') {
            html += `<div class="follower-item" onclick="closeSearch(); openProfile('${result.data.uid}')">
                <div class="post-avatar" style="width: 44px; height: 44px;">${result.data.avatar ? `<img src="${result.data.avatar}">` : '<i class="fas fa-user text-white text-xl flex items-center justify-center h-full"></i>'}</div>
                <div><div style="font-weight: 600;">${escapeHtml(result.data.name)}</div><div style="font-size: 12px; color: #8e8e8e;">${escapeHtml(result.data.email)}</div></div>
            </div>`;
        }
    }
    
    document.getElementById('searchResults').innerHTML = html || '<div class="text-center p-4 text-gray-500">لا توجد نتائج</div>';
};

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

// ========== الإشعارات ==========
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
        html += `<div class="follower-item" onclick="markNotificationRead('${id}'); ${notif.type === 'like' ? `openComments('${notif.postId}')` : notif.type === 'comment' ? `openComments('${notif.postId}')` : `openProfile('${notif.userId}')`}">
            <div class="post-avatar" style="width: 44px; height: 44px;"><i class="fas ${notif.type === 'like' ? 'fa-heart' : notif.type === 'comment' ? 'fa-comment' : 'fa-user-plus'} text-white text-xl flex items-center justify-center h-full"></i></div>
            <div style="flex: 1;">
                <div><span style="font-weight: 600;">${escapeHtml(notif.userName)}</span> ${notif.type === 'like' ? 'أعجب بمنشورك' : notif.type === 'comment' ? `علق على منشورك: ${notif.text?.substring(0, 50)}` : 'بدأ بمتابعتك'}</div>
                <div style="font-size: 11px; color: #8e8e8e;">${formatTime(notif.timestamp)}</div>
            </div>
        </div>`;
    }
    container.innerHTML = html;
    document.getElementById('notificationsPanel')?.classList.add('open');
    const updates = {};
    for (const id of Object.keys(notifications)) updates[`notifications/${currentUser.uid}/${id}/read`] = true;
    await db.ref().update(updates);
};

window.markNotificationRead = async function(notifId) { 
    await db.ref(`notifications/${currentUser.uid}/${notifId}`).update({ read: true }); 
};

// ========== الترند ==========
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

// ========== الإعدادات ==========
window.toggleTheme = function() {
    document.body.classList.toggle('dark-mode');
    const isDark = document.body.classList.contains('dark-mode');
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
    showToast(isDark ? 'الوضع الليلي' : 'الوضع النهاري');
};

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
    loadFeed(true);
}

// ========== الإبلاغ ==========
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

// ========== لوحة التحكم ==========
window.openAdminPanel = async function() {
    if (currentUser.email !== ADMIN_EMAIL && !currentUser.isAdmin) {
        showToast('🚫 غير مصرح لك بالدخول إلى لوحة التحكم');
        return;
    }
    
    const usersSnapshot = await db.ref('users').once('value');
    const postsSnapshot = await db.ref('posts').once('value');
    const usersCount = usersSnapshot.exists() ? Object.keys(usersSnapshot.val()).length : 0;
    const postsCount = postsSnapshot.exists() ? Object.keys(postsSnapshot.val()).length : 0;
    document.getElementById('adminUsersCount').textContent = usersCount;
    document.getElementById('adminPostsCount').textContent = postsCount;
    
    let usersHtml = '';
    if (usersSnapshot.exists()) {
        for (const [uid, user] of Object.entries(usersSnapshot.val())) {
            if (uid !== currentUser.uid) {
                usersHtml += `<div class="admin-item"><div><div class="admin-item-name">${escapeHtml(user.name)}</div><div class="admin-item-email">${escapeHtml(user.email)}</div></div><div>${!user.verified ? `<button class="admin-verify-btn" onclick="verifyUser('${uid}')">✅ توثيق</button>` : '<span class="text-green-500">✅ موثق</span>'}<button class="admin-delete-btn" onclick="deleteUser('${uid}')">🗑️ حذف</button></div></div>`;
            }
        }
    }
    document.getElementById('adminUsersList').innerHTML = usersHtml || '<div class="text-center p-4 text-gray-500">لا يوجد مستخدمين</div>';
    
    document.getElementById('adminPanel').classList.add('open');
};

window.verifyUser = async function(userId) { 
    await db.ref(`users/${userId}`).update({ verified: true }); 
    showToast('✅ تم توثيق المستخدم بنجاح');
    if (currentUser && currentUser.uid === userId) {
        currentUser.verified = true;
    }
    openAdminPanel();
    if (currentProfileUser === userId) {
        openProfile(userId);
    }
    loadFeed(true);
};

window.deleteUser = async function(userId) { 
    if (confirm('⚠️ هل أنت متأكد من حذف هذا المستخدم نهائياً؟')) { 
        await db.ref(`users/${userId}`).remove(); 
        showToast('🗑️ تم حذف المستخدم'); 
        openAdminPanel(); 
        loadFeed(true);
    } 
};

window.closeAdmin = function() { document.getElementById('adminPanel').classList.remove('open'); };

// ========== دوال إضافية ==========
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
                if (post.mediaType === 'image') {
                    html += `<div class="grid-item" onclick="openComments('${postId}')"><img src="${post.mediaUrl}" loading="lazy" style="width:100%;height:100%;object-fit:cover"></div>`;
                } else if (post.mediaType === 'video') {
                    html += `<div class="grid-item" onclick="openVideoModal('${post.mediaUrl}')" style="position:relative;cursor:pointer;">
                        <video src="${post.mediaUrl}" style="width:100%;height:100%;object-fit:cover" preload="metadata"></video>
                        <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);background:rgba(0,0,0,0.6);width:40px;height:40px;border-radius:50%;display:flex;align-items:center;justify-content:center"><i class="fas fa-play" style="color:white;font-size:18px"></i></div>
                    </div>`;
                } else {
                    html += `<div class="grid-item" onclick="openComments('${postId}')"><div class="flex items-center justify-center h-full bg-gray-100 dark:bg-gray-800"><i class="fas fa-file-alt text-2xl text-gray-500"></i></div></div>`;
                }
            }
        }
        container.innerHTML = html || '<div class="text-center p-8 text-gray-500" style="grid-column: span 3;">لا توجد منشورات محفوظة</div>';
    }
    document.getElementById('savedPostsPanel').classList.add('open');
};

window.closeSavedPosts = function() { document.getElementById('savedPostsPanel').classList.remove('open'); };
window.closeCompose = function() { 
    document.getElementById('composeModal').classList.remove('open'); 
    document.getElementById('postText').value = ''; 
    document.getElementById('mediaPreview').innerHTML = ''; 
    document.getElementById('mediaPreview').style.display = 'none'; 
    selectedMediaFile = null; 
};
window.openCompose = function() { document.getElementById('composeModal').classList.add('open'); };
window.closeComments = function() { document.getElementById('commentsPanel').classList.remove('open'); currentPostId = null; };
window.closeProfile = function() { document.getElementById('profilePanel').classList.remove('open'); };
window.closeChat = function() { 
    document.getElementById('chatPanel').classList.remove('open'); 
    if (currentChatUser) {
        const chatId = getChatId(currentUser.uid, currentChatUser.uid);
        db.ref(`chats/${chatId}`).off();
    }
    currentChatUser = null; 
};
window.closeConversations = function() { document.getElementById('conversationsPanel').classList.remove('open'); };
window.closeNotifications = function() { document.getElementById('notificationsPanel').classList.remove('open'); };
window.closeSearch = function() { document.getElementById('searchPanel').classList.remove('open'); document.getElementById('searchInput').value = ''; document.getElementById('searchResults').innerHTML = ''; };
window.openSearch = function() { document.getElementById('searchPanel').classList.add('open'); };
window.goToHome = function() { loadFeed(true); };
window.previewMedia = function(input, type) {
    const file = input.files[0];
    if (file) {
        selectedMediaFile = file;
        const preview = document.getElementById('mediaPreview');
        const reader = new FileReader();
        reader.onload = function(e) {
            if (type === 'image') preview.innerHTML = `<img src="${e.target.result}" style="max-height:250px;border-radius:12px;width:100%;object-fit:cover"><div class="remove-media" onclick="removeSelectedMedia()" style="position:absolute;top:8px;right:8px;background:black;color:white;border-radius:50%;width:24px;height:24px;display:flex;align-items:center;justify-content:center;cursor:pointer"><i class="fas fa-times"></i></div>`;
            else if (type === 'video') preview.innerHTML = `<video src="${e.target.result}" controls style="max-height:250px;border-radius:12px;width:100%"></video><div class="remove-media" onclick="removeSelectedMedia()" style="position:absolute;top:8px;right:8px;background:black;color:white;border-radius:50%;width:24px;height:24px;display:flex;align-items:center;justify-content:center;cursor:pointer"><i class="fas fa-times"></i></div>`;
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

// ========== Auth ==========
window.logout = async function() {
    try {
        await auth.signOut();
        showToast('تم تسجيل الخروج بنجاح');
        setTimeout(() => {
            location.reload();
        }, 1000);
    } catch (error) {
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
                isAdmin: email === ADMIN_EMAIL,
                blockedUsers: {},
                createdAt: Date.now()
            });
        }
        
        if (email === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
            showToast('🌟 مرحباً بك في لوحة التحكم يا مدير!');
            await db.ref(`users/${currentUser.uid}`).update({ isAdmin: true, verified: true });
            currentUser.isAdmin = true;
            currentUser.verified = true;
        }
        
        document.getElementById('authScreen').style.display = 'none';
        document.getElementById('mainApp').style.display = 'block';
        
        showToast(`مرحباً ${currentUser.displayName || currentUser.name || 'مستخدم'}!`);
        
        loadFeed(true);
        loadNotifications();
        loadTrendingHashtags();
        
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
        
    } catch (error) {
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
            createdAt: Date.now()
        });

        currentUser = userCredential.user;
        currentUser.name = name;
        
        document.getElementById('authScreen').style.display = 'none';
        document.getElementById('mainApp').style.display = 'block';
        loadFeed(true);
        loadTrendingHashtags();
        showToast(`أهلاً بك ${name}!`);
    } catch (error) {
        if (msgDiv) msgDiv.textContent = error.message;
        showToast(error.message);
    }
};

// ========== Auth State Listener ==========
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
        
        loadFeed(true);
        loadNotifications();
        loadTrendingHashtags();
    } else {
        document.getElementById('authScreen').style.display = 'flex';
        document.getElementById('mainApp').style.display = 'none';
    }
});

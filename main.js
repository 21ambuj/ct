// main.js

// Firebase Configuration (Loaded from config.js)
let firebaseConfig = {}; 
if (typeof API_CONFIG !== 'undefined' && API_CONFIG.FIREBASE_CONFIG) {
    firebaseConfig = API_CONFIG.FIREBASE_CONFIG;
    if (!firebaseConfig.apiKey || !firebaseConfig.authDomain || !firebaseConfig.projectId) {
        console.error("CRITICAL: Firebase configuration in config.js is missing essential properties (apiKey, authDomain, projectId).");
        showError("Firebase configuration is incomplete. App functionality will be limited.");
        firebaseConfig = { apiKey: "", authDomain: "", projectId: "" }; 
    } else {
        console.log("Firebase configuration loaded successfully from config.js.");
    }
} else {
    console.error("CRITICAL: API_CONFIG or API_CONFIG.FIREBASE_CONFIG is not defined. Ensure config.js is loaded before this script and properly structured.");
    showError("Firebase configuration is missing. App functionality will be limited.");
    firebaseConfig = { apiKey: "", authDomain: "", projectId: "" }; 
}

// Firebase Imports
import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, collection, addDoc, query, orderBy, onSnapshot, serverTimestamp, getDocs, writeBatch, doc, deleteDoc, updateDoc, getDoc, limit } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js"; // 'limit' is crucial here
import { getAnalytics } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-analytics.js";

let app;
if (!getApps().length) { app = initializeApp(firebaseConfig); } else { app = getApp(); }
const auth = getAuth(app);
const db = getFirestore(app);
const analytics = getAnalytics(app); 
const appIdForPath = firebaseConfig.appId || 'default-app-id-if-missing';

// DOM Element Variables
let chatBox, chatBoxWrapper, userInput, sendBtn, fileUploadBtn, fileInput, cameraBtn, voiceInputBtn, 
    imagePreviewContainer, imagePreview, removeImageBtn, loadingIndicator, errorMessageDisplay, 
    googleSignInBtnHeader, userDetailsHeaderDiv, userDisplayNameHeaderSpan, signOutBtnHeader, 
    interactiveChatSection, alternativeVoiceSection, swipeDownPromptElement, newChatBtn, 
    signInPromptBelowVoiceBot, inlineSignInBtn, cameraModal, videoPreviewModal, 
    captureModalBtn, closeCameraModalBtn, sessionsListEl, featuresSection, feedbackSection, appFooter,
    chatHistoryToggleBtn, chatHistorySidebar, sidebarOverlay;

// State Variables
let currentBase64Image = null, currentMimeType = null, mediaStream = null, 
    speechRecognition = null, isRecording = false, currentUserId = null;

let activeSessionId = null; // Can be a Firestore ID or "TEMP_NEW_SESSION"
let messagesUnsubscribe = null; 
let sessionsUnsubscribe = null; 

// API Configuration
let geminiApiUrl = '';
const placeholderGeminiKeyString = "YOUR_ACTUAL_GEMINI_API_KEY_PLACEHOLDER"; // Used to check if the key in config.js is still a placeholder

if (typeof API_CONFIG !== 'undefined' && API_CONFIG.GOOGLE_API_KEY && API_CONFIG.GOOGLE_API_KEY.trim() !== "" && API_CONFIG.GOOGLE_API_KEY !== placeholderGeminiKeyString) {
    geminiApiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${API_CONFIG.GOOGLE_API_KEY}`;
    console.log("Gemini API Key loaded successfully from config.js.");
} else {
    let errorMessage = "CRITICAL: Gemini API key issue in config.js. AI chat functionality will not work.";
    if (typeof API_CONFIG === 'undefined') {
        errorMessage = "CRITICAL: API_CONFIG is not defined. Ensure config.js is loaded before this script.";
    } else if (!API_CONFIG.GOOGLE_API_KEY || API_CONFIG.GOOGLE_API_KEY.trim() === "") {
        errorMessage = "CRITICAL: API_CONFIG.GOOGLE_API_KEY is missing or empty in config.js.";
    } else if (API_CONFIG.GOOGLE_API_KEY === placeholderGeminiKeyString) {
        errorMessage = `CRITICAL: API_CONFIG.GOOGLE_API_KEY in config.js is still the placeholder value: "${placeholderGeminiKeyString}". Please replace it with your actual key.`;
    }
    console.error(errorMessage);
    showError("Gemini API key is not configured correctly. AI chat is disabled.");
    
    // Disable chat input if API key is missing/invalid (check if elements exist first)
    const userInputElOnInit = document.getElementById('userInput');
    const sendBtnElOnInit = document.getElementById('sendBtn');
    if(userInputElOnInit) userInputElOnInit.disabled = true;
    if(sendBtnElOnInit) sendBtnElOnInit.disabled = true;
} 

const botPersonaInstructions = `SYSTEM GUIDELINES: You are a smart ChatIQ bot. Aim for concise and precise responses. For simple questions, keep answers to around 5-6 lines or 50 words. For more complex requests, like recipes or explanations, provide a more detailed answer as needed. You are smart and intelligent and can answer any question asked by the user. Answer in a more humanized form. Use Markdown for formatting like lists (* item), bold (**bold**), or italics (*italics*) when it enhances clarity. For code, always use triple backticks. --- User's request is below. If the user's message specifically asks one of the predefined questions above (who are you, your name, who made you), use ONLY the predefined answer. Otherwise, answer their question following all the general persona guidelines. If an image is provided, consider it in your response along with the text.`;

// --- Utility Functions ---
function showError(messageText) { 
    console.error("ChatIQ Error:", messageText); 
    const errorElement = document.getElementById('errorMessage');
    if (errorElement) {
        errorElement.textContent = messageText; 
        errorElement.classList.remove('hidden');
        setTimeout(() => { errorElement.classList.add('hidden'); }, 5000);
    } else { 
        // Fallback for early errors before DOM is fully ready
        // alert("Notice: " + messageText); 
        console.warn("showError called before #errorMessage was available. Message:", messageText);
    }
}

// --- DOMContentLoaded: Initialize after page loads ---
document.addEventListener('DOMContentLoaded', () => {
    // Assign all DOM Elements
    chatBox = document.getElementById('chatBox'); 
    chatBoxWrapper = document.getElementById('chatBoxWrapper'); 
    userInput = document.getElementById('userInput'); 
    sendBtn = document.getElementById('sendBtn');
    fileUploadBtn = document.getElementById('fileUploadBtn'); 
    fileInput = document.getElementById('fileInput'); 
    cameraBtn = document.getElementById('cameraBtn');
    voiceInputBtn = document.getElementById('voiceInputBtn'); 
    imagePreviewContainer = document.getElementById('imagePreviewContainer');
    imagePreview = document.getElementById('imagePreview'); 
    removeImageBtn = document.getElementById('removeImageBtn');
    loadingIndicator = document.getElementById('loadingIndicator'); 
    errorMessageDisplay = document.getElementById('errorMessage'); 
    googleSignInBtnHeader = document.getElementById('googleSignInBtnHeader');
    userDetailsHeaderDiv = document.getElementById('userDetailsHeader');
    userDisplayNameHeaderSpan = document.getElementById('userDisplayNameHeader');
    signOutBtnHeader = document.getElementById('signOutBtnHeader');
    interactiveChatSection = document.getElementById('interactiveChatSection');
    alternativeVoiceSection = document.getElementById('alternativeVoiceSection');
    swipeDownPromptElement = document.getElementById('swipeDownPrompt');
    newChatBtn = document.getElementById('newChatBtn');
    signInPromptBelowVoiceBot = document.getElementById('signInPromptBelowVoiceBot');
    inlineSignInBtn = document.getElementById('inlineSignInBtn');
    cameraModal = document.getElementById('cameraModal');
    videoPreviewModal = document.getElementById('videoPreviewModal');
    captureModalBtn = document.getElementById('captureModalBtn');
    closeCameraModalBtn = document.getElementById('closeCameraModalBtn');
    sessionsListEl = document.getElementById('sessionsList');
    featuresSection = document.getElementById('featuresSection');
    feedbackSection = document.getElementById('feedbackSection');
    appFooter = document.getElementById('appFooter');
    chatHistoryToggleBtn = document.getElementById('chatHistoryToggleBtn');
    chatHistorySidebar = document.getElementById('chatHistorySidebar');
    sidebarOverlay = document.getElementById('sidebarOverlay');
    
    initializeSpeechRecognition(); 
    setupEventListeners();
    setupAuthListener(); 
});

// --- Event Listener Setup ---
function setupEventListeners() { 
    if(googleSignInBtnHeader) googleSignInBtnHeader.addEventListener('click', signInWithGoogle);
    if(signOutBtnHeader) signOutBtnHeader.addEventListener('click', signOutUser);
    if(newChatBtn) newChatBtn.addEventListener('click', startNewUnsavedChat); // Calls unsaved chat UI
    if(inlineSignInBtn) inlineSignInBtn.addEventListener('click', signInWithGoogle); 

    if(sendBtn) sendBtn.addEventListener('click', handleSendMessageWrapper);
    if(userInput) userInput.addEventListener('keypress', (e) => { 
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessageWrapper(); }
    });
    if(fileUploadBtn) fileUploadBtn.addEventListener('click', () => fileInput.click());
    if(fileInput) fileInput.addEventListener('change', handleFileSelect);
    if(removeImageBtn) removeImageBtn.addEventListener('click', removeImagePreview);
    
    if(cameraBtn) cameraBtn.addEventListener('click', openCameraModal); 
    if(captureModalBtn) captureModalBtn.addEventListener('click', captureImageFromModal);
    if(closeCameraModalBtn) closeCameraModalBtn.addEventListener('click', closeCameraModalAndStream);

    if(voiceInputBtn) voiceInputBtn.addEventListener('click', toggleVoiceInput);

    if (chatHistoryToggleBtn && chatHistorySidebar && sidebarOverlay) {
        chatHistoryToggleBtn.addEventListener('click', () => {
            chatHistorySidebar.classList.toggle('-translate-x-full');
            sidebarOverlay.classList.toggle('hidden');
        });
        sidebarOverlay.addEventListener('click', () => {
            chatHistorySidebar.classList.add('-translate-x-full');
            sidebarOverlay.classList.add('hidden');
        });
    }
}

// --- Firebase Authentication ---
async function signInWithGoogle() { 
    if (!auth) { showError("Firebase Auth not available."); return; }
    const provider = new GoogleAuthProvider();
    try { await signInWithPopup(auth, provider); } 
    catch (error) { console.error("Google Sign-In Error:", error); showError(`Sign-In Failed: ${error.message}`); }
}

async function signOutUser() { 
    if (!auth) { showError("Firebase Auth not available."); return; }
    try { 
        await signOut(auth); 
        activeSessionId = null; 
        if(sessionsListEl) sessionsListEl.innerHTML = ''; 
        if(chatBox) chatBox.innerHTML = '';
    } 
    catch (error) { console.error("Sign Out Error:", error); showError("Error signing out: " + error.message); }
}

function setupAuthListener() { 
    if (!auth) { 
        console.error("Firebase Auth not initialized for listener."); 
        showError("Critical: Auth service not ready."); 
        if(interactiveChatSection) { interactiveChatSection.style.display = 'none'; interactiveChatSection.classList.remove('flex-1'); }
        if(alternativeVoiceSection) alternativeVoiceSection.style.display = 'block';
        if(signInPromptBelowVoiceBot) signInPromptBelowVoiceBot.style.display = 'block';
        if(featuresSection) featuresSection.style.display = 'block';
        if(feedbackSection) feedbackSection.style.display = 'block';
        if(appFooter) appFooter.style.display = 'block';
        if(googleSignInBtnHeader) googleSignInBtnHeader.style.display = 'inline-block';
        if(userDetailsHeaderDiv) userDetailsHeaderDiv.style.display = 'none';
        if(newChatBtn) newChatBtn.style.display = 'none';
        if(chatHistoryToggleBtn) chatHistoryToggleBtn.style.display = 'none'; 
        if(chatHistorySidebar) {
             chatHistorySidebar.classList.add('sm:w-0', 'sm:p-0'); 
             chatHistorySidebar.classList.remove('sm:w-64', 'sm:p-3', 'sm:border-r', 'sm:border-slate-200');
             chatHistorySidebar.classList.add('-translate-x-full'); 
        }
        if(sidebarOverlay) sidebarOverlay.classList.add('hidden');
        return; 
    }

    onAuthStateChanged(auth, (user) => {
        if (user) { 
            currentUserId = user.uid;
            if(userDisplayNameHeaderSpan) userDisplayNameHeaderSpan.textContent = `Hi, ${user.displayName || user.email.split('@')[0] || 'User'}!`;
            if(googleSignInBtnHeader) googleSignInBtnHeader.style.display = 'none';
            if(newChatBtn) newChatBtn.style.display = 'inline-block'; 
            if(userDetailsHeaderDiv) userDetailsHeaderDiv.style.display = 'flex';
            
            if(interactiveChatSection) { interactiveChatSection.style.display = 'flex'; interactiveChatSection.classList.add('flex-1'); }
            if(alternativeVoiceSection) alternativeVoiceSection.style.display = 'none'; 
            if(signInPromptBelowVoiceBot) signInPromptBelowVoiceBot.style.display = 'none';
            if(featuresSection) featuresSection.style.display = 'none'; 
            if(feedbackSection) feedbackSection.style.display = 'none'; 
            if(appFooter) appFooter.style.display = 'none'; 

            if(swipeDownPromptElement) swipeDownPromptElement.style.display = 'inline-flex'; 
            if(chatHistorySidebar) { 
                chatHistorySidebar.classList.remove('sm:w-0', 'sm:p-0');
                chatHistorySidebar.classList.add('sm:w-64', 'sm:p-3', 'sm:border-r', 'sm:border-slate-200');
            }
            if(chatHistoryToggleBtn) chatHistoryToggleBtn.style.display = 'block'; 
            
            loadChatSessions(); 
            startNewUnsavedChat(); // Always start with a new, unsaved chat UI

        } else { 
            currentUserId = null; activeSessionId = null;
            if(userDisplayNameHeaderSpan) userDisplayNameHeaderSpan.textContent = '';
            if(googleSignInBtnHeader) googleSignInBtnHeader.style.display = 'inline-block';
            if(newChatBtn) newChatBtn.style.display = 'none'; 
            if(userDetailsHeaderDiv) userDetailsHeaderDiv.style.display = 'none';

            if(interactiveChatSection) { interactiveChatSection.style.display = 'none'; interactiveChatSection.classList.remove('flex-1'); }
            if(alternativeVoiceSection) alternativeVoiceSection.style.display = 'block';
            if(signInPromptBelowVoiceBot) signInPromptBelowVoiceBot.style.display = 'block';
            if(featuresSection) featuresSection.style.display = 'block'; 
            if(feedbackSection) feedbackSection.style.display = 'block'; 
            if(appFooter) appFooter.style.display = 'block'; 

            if(swipeDownPromptElement) swipeDownPromptElement.style.display = 'none';
            if(chatHistorySidebar) { 
                chatHistorySidebar.classList.add('sm:w-0', 'sm:p-0');
                chatHistorySidebar.classList.remove('sm:w-64', 'sm:p-3', 'sm:border-r', 'sm:border-slate-200');
                chatHistorySidebar.classList.add('-translate-x-full'); 
            }
            if(chatHistoryToggleBtn) chatHistoryToggleBtn.style.display = 'none'; 
            if(sidebarOverlay) sidebarOverlay.classList.add('hidden');

            if(messagesUnsubscribe) messagesUnsubscribe(); 
            if(sessionsUnsubscribe) sessionsUnsubscribe();
            if(chatBox) chatBox.innerHTML = '<div class="text-center text-gray-500 p-4">Sign in to chat & see history.</div>';
            if(sessionsListEl) sessionsListEl.innerHTML = '';
        }
    });
}

// --- Chat Session Management ---
function startNewUnsavedChat() {
    activeSessionId = "TEMP_NEW_SESSION"; 
    if (chatBox) {
        chatBox.innerHTML = ''; 
        addMessageToChat("New chat. Your conversation will be saved once you send a message.", "bot"); 
    }
    if (sessionsListEl) {
        sessionsListEl.querySelectorAll('.session-item.active').forEach(item => {
            item.classList.remove('active', 'bg-blue-100', 'text-blue-700');
        });
    }
    console.log("UI prepared for new, unsaved chat. ActiveSessionId:", activeSessionId);
    if (chatHistorySidebar && !chatHistorySidebar.classList.contains('-translate-x-full') && window.innerWidth < 640) {
        chatHistorySidebar.classList.add('-translate-x-full');
        if(sidebarOverlay) sidebarOverlay.classList.add('hidden');
    }
}

async function deleteSession(sessionIdToDelete) {
    if (!currentUserId || !db || !sessionIdToDelete) { showError("Cannot delete session."); return; }
    if (!window.confirm("Delete this chat session permanently?")) return;
    try {
        const messagesPath = `artifacts/${appIdForPath}/users/${currentUserId}/sessions/${sessionIdToDelete}/messages`;
        const messagesQuery = query(collection(db, messagesPath));
        const messagesSnapshot = await getDocs(messagesQuery);
        const batch = writeBatch(db);
        messagesSnapshot.forEach(docMsg => { batch.delete(docMsg.ref); });
        await batch.commit();
        const sessionDocPath = `artifacts/${appIdForPath}/users/${currentUserId}/sessions/${sessionIdToDelete}`;
        await deleteDoc(doc(db, sessionDocPath)); 
        if (activeSessionId === sessionIdToDelete) {
            activeSessionId = null; // Clear active session
            startNewUnsavedChat(); // Go to a new unsaved chat state
        }
        // loadChatSessions will refresh the list. If no sessions remain, it will call startNewUnsavedChat via its empty check.
    } catch (error) { console.error(`Error deleting session ${sessionIdToDelete}:`, error); showError("Failed to delete chat: " + error.message); }
}

function loadChatSessions() {
    if (!currentUserId || !db || !sessionsListEl) {
        if (sessionsListEl) sessionsListEl.innerHTML = '<div class="text-xs text-gray-400 p-2 text-center">Sign in to see history.</div>';
        return;
    }
    if (sessionsUnsubscribe) sessionsUnsubscribe(); 
    const sessionsColPath = `artifacts/${appIdForPath}/users/${currentUserId}/sessions`;
    const q = query(collection(db, sessionsColPath), orderBy("lastActivity", "desc")); 
    sessionsUnsubscribe = onSnapshot(q, (snapshot) => {
        if (!sessionsListEl) return;
        sessionsListEl.innerHTML = ''; 
        
        if (snapshot.empty) {
            sessionsListEl.innerHTML = '<div class="text-xs text-gray-400 p-2 text-center">No chat history yet.</div>';
            // If no sessions and current active chat is not already a TEMP one, prepare new unsaved chat UI.
            // This is mainly to handle the case where the last session was deleted.
            if (activeSessionId !== "TEMP_NEW_SESSION") {
                startNewUnsavedChat();
            }
            return;
        }

        snapshot.forEach((docSnap) => {
            const session = docSnap.data(); const sessionId = docSnap.id;
            const item = document.createElement('div');
            item.dataset.sessionId = sessionId; 
            item.classList.add('session-item', 'p-2', 'rounded-md', 'cursor-pointer', 'text-sm', 'text-slate-700', 'flex', 'justify-between', 'items-center', 'hover:bg-slate-200');
            
            if (sessionId === activeSessionId && activeSessionId !== "TEMP_NEW_SESSION") {
                 item.classList.add('active', 'bg-blue-100', 'text-blue-700'); 
            }
            const titleSpan = document.createElement('span');
            titleSpan.textContent = session.title || `Chat ${session.createdAt?.toDate().toLocaleDateString() || ''}`;
            titleSpan.classList.add('truncate', 'flex-1', 'mr-2'); item.appendChild(titleSpan);
            const deleteBtn = document.createElement('button');
            deleteBtn.innerHTML = '&times;'; 
            deleteBtn.classList.add('text-red-400', 'hover:text-red-600', 'font-bold', 'px-2', 'py-1', 'rounded', 'hover:bg-red-100');
            deleteBtn.title = "Delete session"; deleteBtn.onclick = (e) => { e.stopPropagation(); deleteSession(sessionId); };
            item.appendChild(deleteBtn); item.onclick = () => selectSession(sessionId);
            sessionsListEl.appendChild(item);
        });
    }, (error) => {
        console.error("Error loading chat sessions:", error); showError("Could not load chat sessions: " + error.message);
        if (sessionsListEl) sessionsListEl.innerHTML = '<div class="text-xs text-red-500 p-2 text-center">Error loading history.</div>';
    });
}

function selectSession(sessionId) {
    if (!sessionId || sessionId === "TEMP_NEW_SESSION") { 
        console.warn("selectSession: invalid or temporary sessionId."); 
        // If trying to select a temp session, effectively start a new unsaved chat
        startNewUnsavedChat();
        return; 
    }
    if (activeSessionId === sessionId && chatBoxWrapper && chatBoxWrapper.scrollTop !== undefined && chatBox.innerHTML && !chatBox.innerHTML.includes('Loading chat...')) return; 
    
    activeSessionId = sessionId; // Set to a real ID
    if (messagesUnsubscribe) messagesUnsubscribe(); 
    if (chatBox) chatBox.innerHTML = '<div class="text-center text-gray-400 p-4">Loading chat...</div>'; 
    loadChatHistory(activeSessionId);

    if (sessionsListEl) {
        sessionsListEl.querySelectorAll('.session-item').forEach(item => {
            const isCurrentItemActive = item.dataset.sessionId === sessionId;
            item.classList.toggle('active', isCurrentItemActive);
            item.classList.toggle('bg-blue-100', isCurrentItemActive);
            item.classList.toggle('text-blue-700', isCurrentItemActive);
        });
    }
    if (chatHistorySidebar && !chatHistorySidebar.classList.contains('-translate-x-full') && window.innerWidth < 640) {
        chatHistorySidebar.classList.add('-translate-x-full');
        if(sidebarOverlay) sidebarOverlay.classList.add('hidden');
    }
}

async function saveMessageToFirestore(messageData) { 
    if (!currentUserId) { showError("Cannot save message: Not signed in."); return; }
    if (!db) { showError("Cannot save message: DB not available."); return; }

    let sessionToSaveToId = activeSessionId;

    if (activeSessionId === "TEMP_NEW_SESSION") {
        const firstMessageContent = messageData.type === 'text' ? messageData.content : "Chat with image";
        let newSessionName = "New Chat"; // Default title
        if (firstMessageContent) {
            newSessionName = firstMessageContent.substring(0, 35) + (firstMessageContent.length > 35 ? '...' : '');
        }
        
        try {
            const sessionsColPath = `artifacts/${appIdForPath}/users/${currentUserId}/sessions`;
            const sessionRef = await addDoc(collection(db, sessionsColPath), {
                title: newSessionName, 
                createdAt: serverTimestamp(),
                lastActivity: serverTimestamp() 
            });
            activeSessionId = sessionRef.id; // Update global activeSessionId
            sessionToSaveToId = activeSessionId;
            console.log("New session created in Firestore with ID:", activeSessionId, "and title:", newSessionName);
            // loadChatHistory will be called for this new activeSessionId after the first message is saved.
            // loadChatSessions will also pick up this new session.
            // Visually update the sidebar to mark this new session as active
            if (sessionsListEl) {
                 sessionsListEl.querySelectorAll('.session-item.active').forEach(item => {
                    item.classList.remove('active', 'bg-blue-100', 'text-blue-700');
                });
                // The new item will be added and marked active by loadChatSessions when it refreshes
            }
        } catch (error) {
            console.error("Error creating new session in Firestore:", error);
            showError("Could not save message: failed to create new session.");
            return; 
        }
    }

    if (!sessionToSaveToId || sessionToSaveToId === "TEMP_NEW_SESSION") {
        showError("Cannot save message: No valid active session ID.");
        return;
    }

    try {
        const messagesColPath = `artifacts/${appIdForPath}/users/${currentUserId}/sessions/${sessionToSaveToId}/messages`; 
        await addDoc(collection(db, messagesColPath), { ...messageData, userId: currentUserId, timestamp: serverTimestamp() }); 
        
        const sessionDocRef = doc(db, `artifacts/${appIdForPath}/users/${currentUserId}/sessions/${sessionToSaveToId}`);
        await updateDoc(sessionDocRef, { lastActivity: serverTimestamp() });
    } catch (error) {
        console.error("Error saving message to Firestore messages subcollection:", error); 
        showError("Error saving message: " + error.message); 
    }
}

function loadChatHistory(sessionIdToLoad) { 
    if (!db || !chatBoxWrapper || !sessionIdToLoad || !currentUserId || sessionIdToLoad === "TEMP_NEW_SESSION") { 
        if (sessionIdToLoad === "TEMP_NEW_SESSION" && chatBox) {
            // UI for TEMP_NEW_SESSION is handled by startNewUnsavedChat
        } else if (chatBox) {
            chatBox.innerHTML = '<div class="text-center text-gray-500 p-4">Select a chat or start a new one.</div>';
        }
        console.warn("loadChatHistory: Prerequisites not met or trying to load TEMP session. Session ID:", sessionIdToLoad);
        return; 
    }
    if (messagesUnsubscribe) messagesUnsubscribe(); 
    const messagesColPath = `artifacts/${appIdForPath}/users/${currentUserId}/sessions/${sessionIdToLoad}/messages`;
    const q = query(collection(db, messagesColPath), orderBy("timestamp", "asc")); 
    if(chatBox) chatBox.innerHTML = ''; // Clear before loading
    
    messagesUnsubscribe = onSnapshot(q, (snapshot) => {
        if (!chatBox || !chatBoxWrapper) return; 
        if(chatBox) chatBox.innerHTML = ''; let msgCount = 0; 
        snapshot.forEach((docMsg) => { 
            msgCount++; const msg = docMsg.data();  
            if (msg.type === 'image') addImageToChatLog(msg.content, msg.mimeType, msg.sender);  
            else addMessageToChat(msg.content, msg.sender);  
        });
        // Welcome message for truly empty (saved) sessions, not for TEMP_NEW_SESSION
        if (msgCount === 0 && !snapshot.metadata.hasPendingWrites && activeSessionId !== "TEMP_NEW_SESSION") {  
             addMessageToChat("This chat is empty. Send a message to start!", "bot");
        }
        if(chatBoxWrapper) chatBoxWrapper.scrollTop = chatBoxWrapper.scrollHeight; 
    }, (error) => { 
        console.error(`Error loading messages for ${sessionIdToLoad}:`, error); 
        showError("Failed to load messages: " + error.message); 
        if (chatBox) chatBox.innerHTML = `<div class="text-center text-red-500 p-4">Error loading messages for this chat.</div>`;
    });
}

function addMessageToChat(text, sender) { 
    if (!chatBox || !chatBoxWrapper) return; 
    const messageDiv = document.createElement('div'); 
    messageDiv.classList.add('flex', sender === 'user' ? 'justify-end' : 'justify-start', 'w-full', 'py-1'); 
    const bubbleDiv = document.createElement('div'); 
    bubbleDiv.classList.add(sender === 'user' ? 'chat-bubble-user' : 'chat-bubble-bot'); 
    
    const codeBlockRegex = /```(\w*)\n([\s\S]*?)\n```/gm; 
    let lastIndex = 0; 
    const contentFragment = document.createDocumentFragment(); 

    text.replace(codeBlockRegex, (match, lang, codeContent, offset) => { 
        if (offset > lastIndex) { 
            contentFragment.appendChild(document.createTextNode(text.substring(lastIndex, offset))); 
        } 
        const codeContainer = document.createElement('div');
        codeContainer.classList.add('code-block-container', 'relative');
        const preElement = document.createElement('pre'); 
        const codeElement = document.createElement('code'); 
        if (lang) codeElement.classList.add(`language-${lang}`); 
        codeElement.textContent = codeContent.trim(); 
        preElement.appendChild(codeElement); 
        codeContainer.appendChild(preElement);
        const copyButton = document.createElement('button');
        copyButton.innerHTML = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path></svg><span class="ml-1">Copy</span>`;
        copyButton.classList.add('absolute', 'top-2', 'right-2', 'bg-slate-700', 'hover:bg-slate-600', 'text-white', 'text-xs', 'font-semibold', 'py-1', 'px-2', 'rounded-md', 'opacity-75', 'hover:opacity-100', 'transition-opacity', 'flex', 'items-center', 'z-10');
        copyButton.title = "Copy code";
        copyButton.addEventListener('click', () => {
            const codeToCopy = codeElement.textContent;
            const tempTextArea = document.createElement('textarea');
            tempTextArea.value = codeToCopy;
            document.body.appendChild(tempTextArea);
            tempTextArea.select();
            try {
                document.execCommand('copy');
                copyButton.innerHTML = `<svg class="w-4 h-4 text-green-400" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"></path></svg><span class="ml-1 text-green-400">Copied!</span>`;
                setTimeout(() => {
                   copyButton.innerHTML = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path></svg><span class="ml-1">Copy</span>`;
                }, 2000);
            } catch (err) { console.error('Failed to copy: ', err); showError("Failed to copy code."); }
            document.body.removeChild(tempTextArea);
        });
        codeContainer.appendChild(copyButton);
        contentFragment.appendChild(codeContainer); 
        lastIndex = offset + match.length; 
        return match; 
    }); 
    if (lastIndex < text.length) { contentFragment.appendChild(document.createTextNode(text.substring(lastIndex))); } 
    bubbleDiv.appendChild(contentFragment); 
    messageDiv.appendChild(bubbleDiv); 
    chatBox.appendChild(messageDiv); 
    if(chatBoxWrapper) chatBoxWrapper.scrollTop = chatBoxWrapper.scrollHeight; 
}

function addImageToChatLog(base64, mime, sender) { 
    if (!chatBox || !chatBoxWrapper) return; const div = document.createElement('div'); 
    div.classList.add('flex', sender === 'user' ? 'justify-end' : 'justify-start', 'w-full', 'my-1'); 
    const bubble = document.createElement('div'); bubble.classList.add('image-chat-bubble'); 
    bubble.style.backgroundColor = sender === 'user' ? '#DBEAFE' : '#D1FAE5'; 
    const img = document.createElement('img'); img.src = `data:${mime};base64,${base64}`; 
    img.alt = sender === 'user' ? "User image" : "Bot image"; 
    bubble.appendChild(img); div.appendChild(bubble); chatBox.appendChild(div); chatBoxWrapper.scrollTop = chatBoxWrapper.scrollHeight; 
}

function showLoading(isLoading) { if(!loadingIndicator) return; loadingIndicator.classList.toggle('hidden', !isLoading); }

async function handleSendMessageWrapper() { 
    if (!userInput || !chatBoxWrapper ) { showError("Chat not ready."); return; } 
    if (!currentUserId ) { // Removed activeSessionId check here, saveMessageToFirestore will handle TEMP_NEW_SESSION
        showError("Please sign in to send messages."); 
        return; 
    } 
    await handleSendMessage(); 
}

async function handleSendMessage() { 
    const textContent = userInput.value.trim(); 
    const imageBase64 = currentBase64Image; 
    const imageMimeType = currentMimeType;
    
    if (!textContent && !imageBase64) { showError("Please type, speak, or upload an image."); return; }
    if (!currentUserId) { showError("Not signed in. Cannot send message."); return; } // activeSessionId can be TEMP

    const currentMessageTextForHistoryContext = textContent; 

    // This will create the session if activeSessionId is "TEMP_NEW_SESSION"
    // and update activeSessionId to the real Firestore ID.
    if (imageBase64 && imageMimeType) {
        await saveMessageToFirestore({ sender: 'user', type: 'image', content: imageBase64, mimeType: imageMimeType });
    }
    if (textContent) {
        await saveMessageToFirestore({ sender: 'user', type: 'text', content: textContent });
    }
    
    // If session creation failed within saveMessageToFirestore, activeSessionId might still be TEMP or an error shown.
    // The API call should only proceed if we have a real session ID for context.
    if (activeSessionId === "TEMP_NEW_SESSION") {
        console.warn("handleSendMessage: Attempting to send to API but session is still temporary. This indicates an issue saving the first message or creating the session.");
        showLoading(false); // Ensure loading is stopped if we can't proceed
        // showError might have already been called by saveMessageToFirestore
        return; 
    }
    
    if(userInput) userInput.value = ''; 
    removeImagePreview(); 
    showLoading(true); 

    if (textContent && containsVulgar(textContent)) { 
        const VULGAR_MSG = "Inappropriate language detected."; 
        await saveMessageToFirestore({ sender: 'bot', type: 'text', content: VULGAR_MSG }); 
        showLoading(false); speakResponse(VULGAR_MSG); return; 
    }

    try {
        let conversationHistoryContents = []; 

        if (activeSessionId && activeSessionId !== "TEMP_NEW_SESSION" && currentUserId) {
            const messagesQuery = query(
                collection(db, `artifacts/${appIdForPath}/users/${currentUserId}/sessions/${activeSessionId}/messages`),
                orderBy("timestamp", "desc"),
                limit(10) 
            );
            const messagesSnapshot = await getDocs(messagesQuery);
            let tempHistoryArray = [];
            messagesSnapshot.docs.forEach(doc => { tempHistoryArray.push(doc.data()); });
            tempHistoryArray.reverse(); 
            
            for (const msg of tempHistoryArray) {
                // Exclude the user's current message which is already saved and will be part of the current turn
                if (msg.sender === 'user' && msg.type === 'text' && msg.content === currentMessageTextForHistoryContext && !imageBase64 && msg === tempHistoryArray[tempHistoryArray.length -1] ) {
                     // This condition might be too aggressive if timestamps are very close.
                     // The goal is to not include the *just sent* user message in the *historical* context.
                     // Since we query *after* saving, the current user message is in tempHistoryArray.
                     // We can rely on the Gemini API to handle the sequence if the current message is the last in history.
                     // A simpler approach: just send the last N messages, and the current query is the newest "user" turn.
                } else if (msg.type === 'text') { 
                    conversationHistoryContents.push({
                        role: msg.sender === 'user' ? 'user' : 'model',
                        parts: [{ text: msg.content }]
                    });
                }
            }
        }

        let currentPromptText = botPersonaInstructions; 
        if (textContent) {
            currentPromptText += "\n\nUSER QUERY:\n" + textContent; // Changed from CURRENT USER QUERY
        } else if (imageBase64 && !textContent) { 
            currentPromptText += "\n\nUSER QUERY:\n(No text provided, please analyze the image below and respond accordingly.)";
        }
        
        let currentUserMessageParts = [{ text: currentPromptText }];
        if (imageBase64 && imageMimeType) {
            currentUserMessageParts.push({ inlineData: { mimeType: imageMimeType, data: imageBase64 } });
        }
        
        const finalContentsForApi = [...conversationHistoryContents, { role: "user", parts: currentUserMessageParts }];
        
        const payload = { contents: finalContentsForApi };
        
        if (!geminiApiUrl) { showError("Gemini API URL not configured."); showLoading(false); return; }
        const resp = await fetch(geminiApiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        
        let botResponseText = "Sorry, issue processing request."; 
        if (!resp.ok) { 
            const errD = await resp.json().catch(()=>({error:{message:"API error/parse fail"}})); 
            botResponseText = `API Error (${resp.status}): ${errD.error?.message || resp.statusText || "Unknown"}`; 
            if (resp.status === 429) botResponseText = "API limit hit. Try later.";
        } else { 
            const res = await resp.json(); 
            if (res.candidates?.[0]?.content?.parts?.[0]?.text) botResponseText = res.candidates[0].content.parts[0].text;
            else if (res.promptFeedback?.blockReason) botResponseText = `Blocked: ${res.promptFeedback.blockReason}.`;
            else if (res.candidates?.[0]?.finishReason && res.candidates[0].finishReason !== "STOP") botResponseText = `AI stopped: ${res.candidates[0].finishReason}.`;
        }
        
        if (currentUserId && activeSessionId && activeSessionId !== "TEMP_NEW_SESSION") { 
            await saveMessageToFirestore({ sender: 'bot', type: 'text', content: botResponseText }); 
        } else {
            console.error("Session became invalid or was temporary before saving bot response. Displaying in UI only.");
            addMessageToChat(botResponseText, 'bot'); // Still show in UI if session saving failed
        }
        speakResponse(botResponseText);
    } catch (error) { 
         let detailedErrorMessage;
        if (error instanceof ReferenceError) { 
            detailedErrorMessage = `Programming error: ${error.message}. Check imports (like 'limit').`;
        } else if (error && error.message) {
            detailedErrorMessage = `Gemini API error: ${error.message}`; 
        } else if (typeof error === 'string') {
            detailedErrorMessage = `Gemini API error: ${error}`;
        } else {
            detailedErrorMessage = "Gemini API call failed unexpectedly. Check console.";
        }
        console.error('Full error object in handleSendMessage catch:', error); 
        showError(detailedErrorMessage); 
        if (currentUserId && activeSessionId && activeSessionId !== "TEMP_NEW_SESSION") { 
            await saveMessageToFirestore({ sender: 'bot', type: 'text', content: detailedErrorMessage });
        } else {
             addMessageToChat(detailedErrorMessage, 'bot'); // Still show error in UI
        }
    } finally { showLoading(false); }
}

function initializeSpeechRecognition() { 
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SR) { 
        speechRecognition = new SR(); speechRecognition.continuous = false; speechRecognition.lang = 'en-US'; 
        speechRecognition.interimResults = false; speechRecognition.maxAlternatives = 1;
        speechRecognition.onresult = (e) => { const r = e.results[0][0].transcript.trim(); if(userInput)userInput.value=r; stopRecording(); if(r)handleSendMessageWrapper(); else showError("Voice input empty.");};
        speechRecognition.onerror = (e) => { let m=`Speech error: ${e.error}.`; if(e.error==='no-speech')m="No speech."; else if(e.error==='audio-capture')m="Mic error."; else if(e.error==='not-allowed')m="Mic denied."; else if(e.error==='language-not-supported')m=`Lang '${speechRecognition.lang}' not supported.`; showError(m); stopRecording();};
        speechRecognition.onend = () => { if (isRecording) stopRecording(); };
    } else { if(voiceInputBtn) voiceInputBtn.disabled = true; showError('Voice input not supported.'); }
}

async function speakResponse(textToSpeak) { 
    if('speechSynthesis' in window) window.speechSynthesis.cancel(); 
    let langCode = 'en-US'; if(/[\u0900-\u097F]/.test(textToSpeak)) langCode = 'hi-IN'; 
    if('speechSynthesis' in window){
        const utterance = new SpeechSynthesisUtterance(textToSpeak); utterance.lang = langCode; 
        try { 
            const voices = window.speechSynthesis.getVoices(); 
            if(voices.length > 0){ const voice = voices.find(v => v.lang === langCode); if(voice) utterance.voice = voice;}
        } catch(e) { console.warn("Could not set voices for TTS:", e); }
        window.speechSynthesis.speak(utterance);
    } else console.warn('Browser SpeechSynthesis not available.');
}

function toggleVoiceInput(){ if(!speechRecognition){ showError('Voice input unavailable.'); return; } if(isRecording) stopRecording(); else startRecording();}
function startRecording() { 
    if (!speechRecognition) { showError("Speech recognition not ready."); return; }
    try { 
        if(userInput) userInput.value = ""; if('speechSynthesis' in window) window.speechSynthesis.cancel(); 
        speechRecognition.start(); isRecording = true; 
        if(voiceInputBtn) { voiceInputBtn.classList.add('recording'); voiceInputBtn.title = "Stop Recording"; }
    } catch(e){
        if(e.name === 'InvalidStateError'){ stopRecording(); } 
        else { showError("Voice recording error: " + e.message); isRecording = false; if(voiceInputBtn) { voiceInputBtn.classList.remove('recording'); voiceInputBtn.title = "Voice Input"; }}
    }
}
function stopRecording(){ 
    if(speechRecognition && isRecording) { try { speechRecognition.stop(); } catch (e) { console.warn("Error stopping speech recognition:", e.message); }}
    isRecording = false; if(voiceInputBtn) { voiceInputBtn.classList.remove('recording'); voiceInputBtn.title = "Voice Input"; }
}

function handleFileSelect(e){ 
    const f=e.target.files[0]; if(f&&f.type.startsWith('image/')){ closeCameraModalAndStream(); 
    const r=new FileReader(); r.onload=(ev)=>{if(imagePreview)imagePreview.src=ev.target.result; currentBase64Image=ev.target.result.split(',')[1]; currentMimeType=f.type; if(imagePreviewContainer)imagePreviewContainer.classList.remove('hidden');}; r.readAsDataURL(f);
    } else if(f){ showError("Please select an image file."); if(fileInput)fileInput.value=null;}
}
function removeImagePreview(){ if(imagePreview)imagePreview.src='#'; if(imagePreviewContainer)imagePreviewContainer.classList.add('hidden'); currentBase64Image=null; currentMimeType=null; if(fileInput)fileInput.value=null; }
async function openCameraModal() { 
    removeImagePreview(); if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) { 
    try { mediaStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }); if(videoPreviewModal) videoPreviewModal.srcObject = mediaStream; if(cameraModal) { cameraModal.classList.remove('hidden'); cameraModal.classList.add('flex'); }} 
    catch (err) { showError("Camera error: " + err.message);}} else { showError("Camera API not supported.");}}
function closeCameraModalAndStream() { if (mediaStream) { mediaStream.getTracks().forEach(t => t.stop()); mediaStream = null; } if(videoPreviewModal) videoPreviewModal.srcObject = null; if(cameraModal) {cameraModal.classList.add('hidden'); cameraModal.classList.remove('flex');}}
function captureImageFromModal() { 
    if (!mediaStream || !videoPreviewModal || !videoPreviewModal.videoWidth) { showError("Camera not ready."); return; } 
    const canv = document.createElement('canvas'); canv.width=videoPreviewModal.videoWidth; canv.height=videoPreviewModal.videoHeight; const ctx=canv.getContext('2d');
    if (!ctx) { showError("Canvas context error."); return; } ctx.drawImage(videoPreviewModal,0,0,canv.width,canv.height); 
    const dUrl=canv.toDataURL('image/png'); if(imagePreview)imagePreview.src=dUrl; currentBase64Image=dUrl.split(',')[1]; currentMimeType='image/png'; 
    if(imagePreviewContainer)imagePreviewContainer.classList.remove('hidden'); closeCameraModalAndStream(); showError("Image captured!"); 
}
function containsVulgar(t){if(!t)return false; const V=["badword","offensive"];return V.some(b=>t.toLowerCase().includes(b));}

let welcomeSpeechInProgress = false;
function speakWelcomeMessageInternal(text) {
    if ('speechSynthesis' in window) {
        if (welcomeSpeechInProgress && window.speechSynthesis.speaking) { return; }
        const msg = new SpeechSynthesisUtterance(text);
        welcomeSpeechInProgress = true;
        msg.onstart = () => { welcomeSpeechInProgress = true; }; 
        msg.onend = () => { welcomeSpeechInProgress = false; };
        msg.onerror = () => { welcomeSpeechInProgress = false; }; 
        window.speechSynthesis.speak(msg);
    }
}
function speakWelcomeMessage() { 
    speakWelcomeMessageInternal("Please sign in with Google to use all features and save your chat history. You can also use voice chat, image recognition, and AI suggestions.");
}
function speakWelcomeMessageOnHover() { 
    if ('speechSynthesis' in window && !window.speechSynthesis.speaking && !welcomeSpeechInProgress) {
         speakWelcomeMessageInternal("Please sign in with Google to use all features and save your chat history. You can also use voice chat, image recognition, and AI suggestions.");
    }
}
window.speakWelcomeMessage = speakWelcomeMessage;
window.speakWelcomeMessageOnHover = speakWelcomeMessageOnHover;

function startListeningAdapter() { 
    const chatSect = document.getElementById('interactiveChatSection'); const signInB = document.getElementById('googleSignInBtnHeader');
    if (currentUserId && chatSect) { chatSect.scrollIntoView({behavior:'smooth',block:'start'}); setTimeout(() => { if(userInput)userInput.focus({preventScroll:true}); toggleVoiceInput();},300);} 
    else if (signInB && signInB.style.display !== 'none') signInB.click(); else showError("Please sign in to use voice chat.");
}
window.startListeningAdapter = startListeningAdapter;

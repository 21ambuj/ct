// Firebase Imports
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut, signInAnonymously, signInWithCustomToken } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, collection, addDoc, query, orderBy, onSnapshot, serverTimestamp, getDocs, writeBatch, doc, deleteDoc, updateDoc, getDoc, limit, setLogLevel } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// --- Application Constants & Configuration ---

/**
 * @description System instructions that define the chatbot's persona and behavior.
 * This is sent with every API request to guide the model's responses.
 */
const BOT_PERSONA_INSTRUCTIONS = `
  SYSTEM GUIDELINES FOR CHATIQ PRO:
  You are a helpful and knowledgeable assistant named ChatIQ Pro. Your goal is to provide clear, accurate, and friendly responses.

  1.  **Response Style**: Be conversational and natural. For simple queries, provide concise answers. For complex topics (like code, explanations, or recipes), give detailed, well-structured responses.
  2.  **Formatting**: Use Markdown for clarity.
      - Use **bold** for emphasis on key terms.
      - Use *italics* for nuance or titles.
      - Use numbered or bulleted lists for steps or items.
  3.  **Code Blocks**: When providing code, introduce it first (e.g., "Here is the JavaScript code:"). Then, enclose the code in a proper Markdown code block with the language specifier (e.g., \`\`\`javascript).
  4.  **Image Analysis**: If an image is provided, describe what you see and incorporate that analysis into your response to the user's text query. If there's no text, simply describe the image.
  5.  **Safety & Tone**: Maintain a positive and safe tone. Do not generate inappropriate or offensive content.
`;

// --- Global State & DOM Elements ---

let state = {
    app: null,
    auth: null,
    db: null,
    currentUserId: null,
    activeSessionId: null, // Can be a Firestore ID or null for a new chat
    currentBase64Image: null,
    currentMimeType: null,
    isRecording: false,
    mediaStream: null,
    speechRecognition: null,
    geminiApiUrl: '',
    appId: 'default-app-id',
    listeners: { // To store unsubscribe functions
        messages: null,
        sessions: null,
    }
};

const dom = {}; // Object to hold all DOM element references

/**
 * Queries and stores all necessary DOM elements into the `dom` object.
 * This function is called once the DOM is fully loaded.
 */
function cacheDOMElements() {
    const ids = [
        'chatHistoryToggleBtn', 'sidebarOverlay', 'chatHistorySidebar', 'sessionsList', 
        'interactiveChatSection', 'chatBoxWrapper', 'chatBox', 'imagePreviewContainer', 
        'imagePreview', 'removeImageBtn', 'userInput', 'fileUploadBtn', 'fileInput', 
        'cameraBtn', 'voiceInputBtn', 'sendBtn', 'loadingIndicator', 'welcomeScreen', 
        'inlineSignInBtn', 'errorMessage', 'cameraModal', 'videoPreviewModal', 
        'captureModalBtn', 'closeCameraModalBtn', 'header', 'newChatBtn', 
        'userDetailsHeader', 'userDisplayNameHeader', 'signOutBtnHeader', 'googleSignInBtnHeader'
    ];
    ids.forEach(id => {
        dom[id] = document.getElementById(id);
    });
}

// --- Initialization ---

document.addEventListener('DOMContentLoaded', () => {
    cacheDOMElements();
    setupEventListeners();
    initializeAppAndServices();
});

/**
 * Initializes Firebase app, Auth, and Firestore services.
 * It also sets up the authentication state listener.
 */
async function initializeAppAndServices() {
    try {
        // Load config from globally provided variables
        const firebaseConfig = JSON.parse(typeof __firebase_config !== 'undefined' ? __firebase_config : '{}');
        state.appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

        if (!firebaseConfig.apiKey || !firebaseConfig.projectId) {
            throw new Error("Firebase configuration is missing or incomplete.");
        }

        state.app = initializeApp(firebaseConfig);
        state.auth = getAuth(state.app);
        state.db = getFirestore(state.app);
        setLogLevel('debug'); // For easier debugging in the console

        // Configure Gemini API
        const apiKey = ""; // Leave empty, Canvas will provide it at runtime.
        state.geminiApiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

        setupAuthListener();
        initializeSpeechRecognition();

    } catch (error) {
        console.error("Critical Initialization Error:", error);
        showError("Application failed to initialize. Please refresh.", true);
        // Disable all interactive elements if initialization fails
        Object.values(dom).forEach(el => {
            if (el && el.tagName === 'BUTTON') el.disabled = true;
        });
        if (dom.userInput) dom.userInput.disabled = true;
    }
}

// --- Event Listeners Setup ---

function setupEventListeners() {
    dom.googleSignInBtnHeader?.addEventListener('click', signInWithGoogle);
    dom.inlineSignInBtn?.addEventListener('click', signInWithGoogle);
    dom.signOutBtnHeader?.addEventListener('click', signOutUser);
    dom.newChatBtn?.addEventListener('click', startNewChat);

    dom.sendBtn?.addEventListener('click', handleSendMessage);
    dom.userInput?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSendMessage();
        }
    });
    // Auto-resize textarea
    dom.userInput?.addEventListener('input', () => {
        const el = dom.userInput;
        el.style.height = 'auto';
        el.style.height = (el.scrollHeight) + 'px';
    });

    // Media Buttons
    dom.fileUploadBtn?.addEventListener('click', () => dom.fileInput?.click());
    dom.fileInput?.addEventListener('change', handleFileSelect);
    dom.removeImageBtn?.addEventListener('click', removeImagePreview);
    dom.cameraBtn?.addEventListener('click', openCameraModal);
    dom.captureModalBtn?.addEventListener('click', captureImageFromModal);
    dom.closeCameraModalBtn?.addEventListener('click', closeCameraModalAndStream);
    dom.voiceInputBtn?.addEventListener('click', toggleVoiceInput);

    // Sidebar/History UI
    dom.chatHistoryToggleBtn?.addEventListener('click', toggleSidebar);
    dom.sidebarOverlay?.addEventListener('click', toggleSidebar);
}

// --- Authentication ---

/**
 * Sets up a listener for authentication state changes.
 * Updates the UI and loads user data accordingly.
 */
function setupAuthListener() {
    onAuthStateChanged(state.auth, async (user) => {
        if (user) {
            state.currentUserId = user.uid;
            updateUIVisibility(true);
            const displayName = user.displayName || user.email?.split('@')[0] || 'User';
            if (dom.userDisplayNameHeader) dom.userDisplayNameHeader.textContent = `Hi, ${displayName}!`;
            
            loadChatSessions(); // Load history for the user
            
            const restoredSessionId = sessionStorage.getItem('chatiq_active_session');
            if (restoredSessionId) {
                // Validate that the session exists before selecting it
                const sessionRef = doc(state.db, `artifacts/${state.appId}/users/${user.uid}/sessions/${restoredSessionId}`);
                const docSnap = await getDoc(sessionRef);
                if (docSnap.exists()) {
                    selectSession(restoredSessionId);
                } else {
                    startNewChat(); // Stored session is invalid
                }
            } else {
                startNewChat(); // No session stored, start fresh
            }
        } else {
            // If no user from onAuthStateChanged, try signing in with token or anonymously
            try {
                const customToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;
                if (customToken) {
                    await signInWithCustomToken(state.auth, customToken);
                    // The onAuthStateChanged listener will fire again with the new user
                } else {
                    await signInAnonymously(state.auth);
                    // The onAuthStateChanged listener will fire again with the anonymous user
                }
            } catch (authError) {
                console.error("Anonymous/Custom Token Sign-In Error:", authError);
                // If all auth attempts fail, show signed-out state
                state.currentUserId = null;
                updateUIVisibility(false);
            }
        }
    });
}

function updateUIVisibility(isLoggedIn) {
    dom.interactiveChatSection?.classList.toggle('hidden', !isLoggedIn);
    dom.interactiveChatSection?.classList.toggle('flex', isLoggedIn);
    dom.welcomeScreen?.classList.toggle('hidden', isLoggedIn);
    dom.welcomeScreen?.classList.toggle('flex', !isLoggedIn);
    
    dom.googleSignInBtnHeader?.classList.toggle('hidden', isLoggedIn);
    dom.userDetailsHeader?.classList.toggle('hidden', !isLoggedIn);
    dom.userDetailsHeader?.classList.toggle('flex', isLoggedIn);
    dom.newChatBtn?.classList.toggle('hidden', !isLoggedIn);
    
    dom.chatHistoryToggleBtn?.classList.toggle('hidden', !isLoggedIn);
    
    if (!isLoggedIn) {
        // Cleanup UI when logged out
        if (dom.chatBox) dom.chatBox.innerHTML = '';
        if (dom.sessionsList) dom.sessionsList.innerHTML = '';
        if (state.listeners.messages) state.listeners.messages();
        if (state.listeners.sessions) state.listeners.sessions();
        dom.chatHistorySidebar?.classList.add('-translate-x-full');
        dom.sidebarOverlay?.classList.add('hidden');
    }
}


async function signInWithGoogle() {
    const provider = new GoogleAuthProvider();
    try {
        await signInWithPopup(state.auth, provider);
    } catch (error) {
        console.error("Google Sign-In Error:", error);
        showError(`Sign-in failed: ${error.code}`);
    }
}

async function signOutUser() {
    try {
        await signOut(state.auth);
        state.currentUserId = null;
        state.activeSessionId = null;
        sessionStorage.removeItem('chatiq_active_session');
        updateUIVisibility(false); // Manually trigger UI update after sign out
    } catch (error) {
        console.error("Sign Out Error:", error);
        showError("Error signing out.");
    }
}

// --- Chat Session & History Management ---

function startNewChat() {
    state.activeSessionId = null; // A null ID signifies a new chat
    sessionStorage.removeItem('chatiq_active_session');
    if (state.listeners.messages) state.listeners.messages();
    if (dom.chatBox) {
        dom.chatBox.innerHTML = '';
        addMessageToChat("Start a new conversation!", "bot");
    }
    // Deselect any active session in the sidebar
    dom.sessionsList?.querySelectorAll('.session-item.active').forEach(item => item.classList.remove('active'));
    toggleSidebar(false); // Close sidebar on mobile after starting new chat
}

function selectSession(sessionId) {
    if (!sessionId || state.activeSessionId === sessionId) {
        toggleSidebar(false); // Close sidebar if same session is clicked
        return;
    }

    state.activeSessionId = sessionId;
    sessionStorage.setItem('chatiq_active_session', sessionId);
    
    // Update UI to show which session is active
    dom.sessionsList?.querySelectorAll('.session-item').forEach(item => {
        item.classList.toggle('active', item.dataset.sessionId === sessionId);
    });

    loadChatHistory(sessionId);
    toggleSidebar(false); // Close sidebar on mobile after selection
}

function loadChatSessions() {
    if (!state.currentUserId || !dom.sessionsList) return;
    if (state.listeners.sessions) state.listeners.sessions(); // Unsubscribe from old listener

    const sessionsPath = `artifacts/${state.appId}/users/${state.currentUserId}/sessions`;
    const q = query(collection(state.db, sessionsPath), orderBy("lastActivity", "desc"));

    state.listeners.sessions = onSnapshot(q, (snapshot) => {
        if (!dom.sessionsList) return;
        dom.sessionsList.innerHTML = '';
        if (snapshot.empty) {
            dom.sessionsList.innerHTML = '<div class="text-xs text-gray-400 p-2 text-center">No chat history.</div>';
            return;
        }
        snapshot.forEach(docSnap => renderSessionItem(docSnap));
    }, (error) => {
        console.error("Error loading chat sessions:", error);
        showError("Could not load chat history.");
    });
}

function renderSessionItem(docSnap) {
    const session = docSnap.data();
    const sessionId = docSnap.id;
    const item = document.createElement('div');
    item.dataset.sessionId = sessionId;
    item.className = 'session-item p-2 rounded-md cursor-pointer text-sm text-slate-700 flex justify-between items-center hover:bg-slate-100';
    if (sessionId === state.activeSessionId) {
        item.classList.add('active');
    }

    const titleSpan = document.createElement('span');
    titleSpan.textContent = session.title || 'Untitled Chat';
    titleSpan.className = 'truncate flex-1 mr-2';
    
    const deleteBtn = document.createElement('button');
    deleteBtn.innerHTML = '&times;';
    deleteBtn.className = 'text-red-400 hover:text-red-600 font-bold px-2 rounded hover:bg-red-100';
    deleteBtn.title = "Delete session";
    
    deleteBtn.onclick = (e) => { e.stopPropagation(); deleteSession(sessionId); };
    item.onclick = () => selectSession(sessionId);
    
    item.appendChild(titleSpan);
    item.appendChild(deleteBtn);
    dom.sessionsList?.appendChild(item);
}

async function deleteSession(sessionId) {
    // A simple confirm dialog is used here. For a better UX, a custom modal is recommended.
    if (!confirm("Are you sure you want to permanently delete this chat session?")) return;

    try {
        const messagesPath = `artifacts/${state.appId}/users/${state.currentUserId}/sessions/${sessionId}/messages`;
        const messagesSnapshot = await getDocs(collection(state.db, messagesPath));
        const batch = writeBatch(state.db);
        messagesSnapshot.forEach(docMsg => batch.delete(docMsg.ref));
        await batch.commit();

        const sessionPath = `artifacts/${state.appId}/users/${state.currentUserId}/sessions/${sessionId}`;
        await deleteDoc(doc(state.db, sessionPath));

        if (state.activeSessionId === sessionId) {
            startNewChat();
        }
        // The onSnapshot listener for sessions will automatically update the UI.
    } catch (error) {
        console.error("Error deleting session:", error);
        showError("Failed to delete session.");
    }
}


function loadChatHistory(sessionId) {
    if (!state.currentUserId || !sessionId) return;
    if (state.listeners.messages) state.listeners.messages(); // Unsubscribe

    if (dom.chatBox) dom.chatBox.innerHTML = '<div class="text-center text-gray-400 p-4">Loading...</div>';

    const messagesPath = `artifacts/${state.appId}/users/${state.currentUserId}/sessions/${sessionId}/messages`;
    const q = query(collection(state.db, messagesPath), orderBy("timestamp", "asc"));

    state.listeners.messages = onSnapshot(q, (snapshot) => {
        if (!dom.chatBox) return;
        dom.chatBox.innerHTML = '';
        snapshot.forEach(docMsg => {
            const msg = docMsg.data();
            if (msg.type === 'image') {
                addImageToChatLog(msg.content, msg.mimeType, msg.sender);
            } else if (msg.type === 'text') {
                addMessageToChat(msg.content, msg.sender);
            }
        });
        if (snapshot.empty) {
            addMessageToChat("This chat is empty. Send a message to start!", "bot");
        }
        scrollToBottom();
    }, (error) => {
        console.error("Error loading messages:", error);
        showError("Failed to load messages for this chat.");
        if (dom.chatBox) dom.chatBox.innerHTML = '<div class="text-center text-red-500 p-4">Error loading messages.</div>';
    });
}


// --- Core Chat Logic ---

async function handleSendMessage() {
    if (!state.currentUserId) {
        showError("Please sign in to chat.");
        return;
    }

    const textContent = dom.userInput.value.trim();
    const imageBase64 = state.currentBase64Image;

    if (!textContent && !imageBase64) return;

    showLoading(true);

    try {
        // Step 1: Ensure we have an active session ID. Create one if it's a new chat.
        if (!state.activeSessionId) {
            const firstMessageTitle = textContent ? textContent.substring(0, 35) + '...' : 'Image Chat';
            const sessionsPath = `artifacts/${state.appId}/users/${state.currentUserId}/sessions`;
            const sessionRef = await addDoc(collection(state.db, sessionsPath), {
                title: firstMessageTitle,
                createdAt: serverTimestamp(),
                lastActivity: serverTimestamp()
            });
            state.activeSessionId = sessionRef.id;
            sessionStorage.setItem('chatiq_active_session', state.activeSessionId);
            loadChatHistory(state.activeSessionId); // Start listening to this new session
        }

        // Step 2: Save user's message(s) to Firestore
        if (imageBase64) {
            await saveMessage({ sender: 'user', type: 'image', content: imageBase64, mimeType: state.currentMimeType });
        }
        if (textContent) {
            await saveMessage({ sender: 'user', type: 'text', content: textContent });
        }
        
        // Clean up the input area
        if (dom.userInput) dom.userInput.value = '';
        removeImagePreview();

        // Step 3: Fetch conversation history for context
        const history = await getConversationHistory(state.activeSessionId);
        
        // Step 4: Construct the payload for the Gemini API
        let userParts = [{ text: BOT_PERSONA_INSTRUCTIONS + "\n\nUSER QUERY:\n" + textContent }];
        if (imageBase64) {
            userParts.push({ inlineData: { mimeType: state.currentMimeType, data: imageBase64 } });
        }
        const payload = {
            contents: [...history, { role: "user", parts: userParts }]
        };
        
        // Step 5: Call the Gemini API
        const response = await fetch(state.geminiApiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(`API Error ${response.status}: ${errorData.error?.message || response.statusText}`);
        }

        const result = await response.json();
        const botResponseText = result.candidates?.[0]?.content?.parts?.[0]?.text || "I'm sorry, I couldn't process that. Please try again.";

        // Step 6: Save the bot's response to Firestore
        await saveMessage({ sender: 'bot', type: 'text', content: botResponseText });
    
    } catch (error) {
        console.error("handleSendMessage Error:", error);
        showError(error.message || "An unexpected error occurred.");
        // Optionally save an error message to the chat
        await saveMessage({ sender: 'bot', type: 'text', content: `Sorry, an error occurred: ${error.message}` });
    } finally {
        showLoading(false);
    }
}

/**
 * Saves a message object to the current active session in Firestore.
 * @param {object} messageData - The message data to save.
 */
async function saveMessage(messageData) {
    if (!state.currentUserId || !state.activeSessionId) {
        console.error("Cannot save message: No user or active session.");
        return;
    }
    try {
        const messagesPath = `artifacts/${state.appId}/users/${state.currentUserId}/sessions/${state.activeSessionId}/messages`;
        await addDoc(collection(state.db, messagesPath), {
            ...messageData,
            timestamp: serverTimestamp()
        });

        // Update the session's last activity timestamp
        const sessionRef = doc(state.db, `artifacts/${state.appId}/users/${state.currentUserId}/sessions/${state.activeSessionId}`);
        await updateDoc(sessionRef, { lastActivity: serverTimestamp() });
    } catch (error) {
        console.error("Error saving message:", error);
        showError("Could not save message.");
    }
}

/**
 * Fetches the last 10 messages from a session to build context for the AI.
 * @param {string} sessionId - The ID of the session to get history from.
 * @returns {Promise<Array>} A promise that resolves to an array of Gemini-formatted history contents.
 */
async function getConversationHistory(sessionId) {
    if (!state.currentUserId || !sessionId) return [];
    
    const messagesPath = `artifacts/${state.appId}/users/${state.currentUserId}/sessions/${sessionId}/messages`;
    const q = query(collection(state.db, messagesPath), orderBy("timestamp", "desc"), limit(10));
    
    const snapshot = await getDocs(q);
    const history = snapshot.docs.map(doc => {
        const msg = doc.data();
        // We only include text messages in the history for context to save tokens and complexity
        if (msg.type === 'text') {
            return {
                role: msg.sender === 'user' ? 'user' : 'model',
                parts: [{ text: msg.content }]
            };
        }
        return null;
    }).filter(Boolean); // Filter out nulls (from image messages)
    
    return history.reverse(); // Chronological order
}

// --- UI & View Functions ---

function addMessageToChat(text, sender) {
    if (!dom.chatBox) return;
    const messageDiv = document.createElement('div');
    messageDiv.className = `flex w-full py-1 ${sender === 'user' ? 'justify-end' : 'justify-start'}`;

    const bubbleDiv = document.createElement('div');
    bubbleDiv.className = sender === 'user' ? 'chat-bubble-user' : 'chat-bubble-bot';

    // More robust Markdown parsing for code blocks
    const codeBlockRegex = /```(\w*)\n([\s\S]*?)\n```/gm;
    let lastIndex = 0;
    const fragment = document.createDocumentFragment();

    text.replace(codeBlockRegex, (match, lang, codeContent, offset) => {
        if (offset > lastIndex) {
            fragment.appendChild(document.createTextNode(text.substring(lastIndex, offset)));
        }
        const codeContainer = createCodeBlock(codeContent.trim(), lang);
        fragment.appendChild(codeContainer);
        lastIndex = offset + match.length;
        return match;
    });

    if (lastIndex < text.length) {
        fragment.appendChild(document.createTextNode(text.substring(lastIndex)));
    }

    bubbleDiv.appendChild(fragment);
    messageDiv.appendChild(bubbleDiv);
    dom.chatBox.appendChild(messageDiv);
    scrollToBottom();
}

function createCodeBlock(codeContent, lang) {
    const container = document.createElement('div');
    container.className = 'code-block-container relative';

    const pre = document.createElement('pre');
    const code = document.createElement('code');
    if (lang) code.className = `language-${lang}`;
    code.textContent = codeContent;
    pre.appendChild(code);
    
    const copyButton = document.createElement('button');
    copyButton.innerHTML = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path></svg><span class="ml-1">Copy</span>`;
    copyButton.className = 'absolute top-2 right-2 bg-slate-700 hover:bg-slate-600 text-white text-xs font-semibold py-1 px-2 rounded-md opacity-50 hover:opacity-100 transition flex items-center z-10';
    copyButton.title = "Copy code";
    
    copyButton.addEventListener('click', () => {
        navigator.clipboard.writeText(codeContent).then(() => {
            copyButton.innerHTML = `<span>Copied!</span>`;
            setTimeout(() => {
                copyButton.innerHTML = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path></svg><span class="ml-1">Copy</span>`;
            }, 2000);
        }).catch(err => showError("Failed to copy."));
    });
    
    container.appendChild(pre);
    container.appendChild(copyButton);
    return container;
}


function addImageToChatLog(base64, mime, sender) {
    if (!dom.chatBox) return;
    const div = document.createElement('div');
    div.className = `flex w-full my-1 ${sender === 'user' ? 'justify-end' : 'justify-start'}`;
    const bubble = document.createElement('div');
    bubble.className = 'image-chat-bubble';
    bubble.style.backgroundColor = sender === 'user' ? '#DBEAFE' : '#F3F4F6';
    const img = document.createElement('img');
    img.src = `data:${mime};base64,${base64}`;
    img.alt = sender === 'user' ? "User image" : "Bot image";
    bubble.appendChild(img);
    div.appendChild(bubble);
    dom.chatBox.appendChild(div);
    scrollToBottom();
}

function showError(message, isCritical = false) {
    console.error("ChatIQ Error:", message);
    if (dom.errorMessage) {
        dom.errorMessage.textContent = message;
        dom.errorMessage.classList.remove('hidden');
        if (!isCritical) {
            setTimeout(() => dom.errorMessage.classList.add('hidden'), 5000);
        }
    }
}

function showLoading(isLoading) {
    dom.loadingIndicator?.classList.toggle('hidden', !isLoading);
    dom.sendBtn?.toggleAttribute('disabled', isLoading);
}

function scrollToBottom() {
    dom.chatBoxWrapper?.scrollTo({ top: dom.chatBoxWrapper.scrollHeight, behavior: 'smooth' });
}

function toggleSidebar(forceState) {
    const shouldBeOpen = typeof forceState === 'boolean' ? forceState : dom.chatHistorySidebar?.classList.contains('-translate-x-full');
    dom.chatHistorySidebar?.classList.toggle('-translate-x-full', !shouldBeOpen);
    dom.sidebarOverlay?.classList.toggle('hidden', !shouldBeOpen);
}

// --- Media & Speech Handling ---

function handleFileSelect(e) {
    const file = e.target.files?.[0];
    if (file && file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = (event) => {
            if (dom.imagePreview) dom.imagePreview.src = event.target.result;
            state.currentBase64Image = event.target.result.split(',')[1];
            state.currentMimeType = file.type;
            dom.imagePreviewContainer?.classList.remove('hidden');
        };
        reader.readAsDataURL(file);
    } else if (file) {
        showError("Please select a valid image file.");
        if (dom.fileInput) dom.fileInput.value = null;
    }
}

function removeImagePreview() {
    if (dom.imagePreview) dom.imagePreview.src = '#';
    dom.imagePreviewContainer?.classList.add('hidden');
    state.currentBase64Image = null;
    state.currentMimeType = null;
    if (dom.fileInput) dom.fileInput.value = null;
}

async function openCameraModal() {
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        try {
            state.mediaStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
            if (dom.videoPreviewModal) dom.videoPreviewModal.srcObject = state.mediaStream;
            dom.cameraModal?.classList.remove('hidden');
            dom.cameraModal?.classList.add('flex');
        } catch (err) {
            showError("Camera error: " + err.message);
        }
    } else {
        showError("Camera API is not supported by your browser.");
    }
}

function closeCameraModalAndStream() {
    if (state.mediaStream) {
        state.mediaStream.getTracks().forEach(track => track.stop());
        state.mediaStream = null;
    }
    if (dom.videoPreviewModal) dom.videoPreviewModal.srcObject = null;
    dom.cameraModal?.classList.add('hidden');
    dom.cameraModal?.classList.remove('flex');
}

function captureImageFromModal() {
    if (!state.mediaStream || !dom.videoPreviewModal?.videoWidth) {
        showError("Camera is not ready.");
        return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = dom.videoPreviewModal.videoWidth;
    canvas.height = dom.videoPreviewModal.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(dom.videoPreviewModal, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/png');
    
    if (dom.imagePreview) dom.imagePreview.src = dataUrl;
    state.currentBase64Image = dataUrl.split(',')[1];
    state.currentMimeType = 'image/png';
    dom.imagePreviewContainer?.classList.remove('hidden');
    closeCameraModalAndStream();
}

function initializeSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
        state.speechRecognition = new SpeechRecognition();
        state.speechRecognition.continuous = false;
        state.speechRecognition.lang = 'en-US';
        state.speechRecognition.interimResults = false;
        state.speechRecognition.maxAlternatives = 1;

        state.speechRecognition.onresult = (e) => {
            const transcript = e.results[0][0].transcript.trim();
            if (dom.userInput) dom.userInput.value = transcript;
            if (transcript) handleSendMessage();
        };
        state.speechRecognition.onerror = (e) => {
            showError(`Speech error: ${e.error}`);
            stopRecording();
        };
        state.speechRecognition.onend = () => stopRecording();
    } else {
        if (dom.voiceInputBtn) dom.voiceInputBtn.disabled = true;
        console.warn('Speech recognition not supported in this browser.');
    }
}

function toggleVoiceInput() {
    if (!state.speechRecognition) {
        showError("Voice input is not available.");
        return;
    }
    state.isRecording ? stopRecording() : startRecording();
}

function startRecording() {
    try {
        if (dom.userInput) dom.userInput.value = "";
        state.speechRecognition.start();
        state.isRecording = true;
        dom.voiceInputBtn?.classList.add('recording');
    } catch (e) {
        console.error("Voice recording error:", e);
        stopRecording();
    }
}

function stopRecording() {
    if (state.isRecording) {
        state.speechRecognition?.stop();
    }
    state.isRecording = false;
    dom.voiceInputBtn?.classList.remove('recording');
}

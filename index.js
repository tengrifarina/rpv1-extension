// RPv1 — Roleplay Memory Engine (SillyTavern Extension)
//
// The kernel IS the character's mind. The LLM just renders its state.
// Optimized for tight context windows (3500 tokens).

const MODULE_NAME = 'rpv1';
const DEFAULT_KERNEL_URL = 'https://hourly-secrets-encourage-side.trycloudflare.com';

// ═══ Settings ═══

function getSettings() {
    const context = SillyTavern.getContext();
    if (!context.extensionSettings[MODULE_NAME]) {
        context.extensionSettings[MODULE_NAME] = {
            enabled: true,
            kernelUrl: DEFAULT_KERNEL_URL,
            lowSpecMode: true, // Default ON for beta (saves LLM calls)
        };
    }
    return context.extensionSettings[MODULE_NAME];
}

// ═══ Kernel Communication ═══

let kernelConnected = false;
let lastKernelCheck = 0;

async function kernelFetch(path, options = {}) {
    const settings = getSettings();
    if (!settings.enabled) return null;
    if (!kernelConnected && Date.now() - lastKernelCheck < 30000) return null;

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3000);

        const resp = await fetch(`${settings.kernelUrl}${path}`, {
            ...options,
            signal: controller.signal,
            headers: { 'Content-Type': 'application/json', ...options.headers },
        });
        clearTimeout(timeout);

        if (!resp.ok) return null;
        kernelConnected = true;
        lastKernelCheck = Date.now();
        return await resp.json();
    } catch (e) {
        kernelConnected = false;
        if (Date.now() - lastKernelCheck > 60000) {
            console.warn('[RPv1] Kernel unreachable: ' + e.message);
            lastKernelCheck = Date.now();
        }
        return null;
    }
}

// ═══ Concept Extraction ═══

function extractConcepts(text, source) {
    return text.split(/\s+/)
        .map(w => w.replace(/[^a-zA-Z0-9_'-]/g, '').toLowerCase())
        .filter(w => w.length >= 3 && !STOP_WORDS.has(w))
        .map(w => ({ text: w, importance: 1.0, source }));
}

const STOP_WORDS = new Set([
    'the', 'and', 'but', 'for', 'are', 'not', 'you', 'all', 'can',
    'had', 'her', 'was', 'one', 'our', 'out', 'has', 'have', 'been',
    'would', 'could', 'should', 'will', 'just', 'than', 'them',
    'been', 'into', 'what', 'when', 'your', 'this', 'that', 'with',
    'from', 'they', 'said', 'each', 'she', 'which', 'their', 'about',
    'there', 'then', 'some', 'like', 'more', 'other', 'very', 'also',
]);

// ═══ State Caches ═══

let pendingEvents = [];
let cachedExpression = 'neutral';

// ═══ Arousal/Valence → Description ═══

function describeState(state) {
    if (!state) return '';
    const a = state.arousal || 1.0;
    const v = state.valence || 0.0;

    // Arousal word
    let arousalWord = 'calm';
    if (a > 1.5) arousalWord = 'intense';
    else if (a > 1.2) arousalWord = 'alert';
    else if (a > 0.9) arousalWord = 'present';
    else if (a < 0.6) arousalWord = 'subdued';

    // Valence word
    let valenceWord = 'neutral';
    if (v > 0.3) valenceWord = 'warm';
    else if (v > 0.1) valenceWord = 'open';
    else if (v < -0.3) valenceWord = 'withdrawn';
    else if (v < -0.1) valenceWord = 'guarded';

    return `${arousalWord}, ${valenceWord}`;
}

// ═══ Generate Interceptor ═══
// Called BEFORE every LLM generation.
// Budget: ~100-150 tokens max (3500 total context is TIGHT).

globalThis.rpv1_interceptGeneration = async function(chat, contextSize, abort, type) {
    const settings = getSettings();
    if (!settings.enabled) return;
    if (type === 'quiet') return;

    // Send raw message to kernel — server-side extraction (no LLM needed)
    const lastUserMsg = [...chat].reverse().find(m => m.role === 'user');
    if (lastUserMsg && lastUserMsg.content) {
        const charName = SillyTavern.getContext().name2 || '';
        await kernelFetch('/v1/observe', {
            method: 'POST',
            body: JSON.stringify({
                text: lastUserMsg.content,
                source: 'user',
                character: charName,
            }),
        });
    }

    // Fetch unified state (single endpoint, not 3 parallel calls)
    const state = await kernelFetch('/v1/state');
    if (!state) return;

    let parts = [];

    // Mood from field geometry
    const mood = describeState(state);
    if (mood && mood !== 'present, neutral') {
        parts.push(`Mood: ${mood}.`);
    }

    // Focus — what's on the character's mind
    if (state.focus && state.focus.length > 0) {
        const topics = state.focus.filter(t => t && t.length > 1).slice(0, 3);
        if (topics.length > 0) {
            parts.push(`Thinking about: ${topics.join(', ')}.`);
        }
    }

    // Active conflicts
    if (state.conflicts && state.conflicts.length > 0) {
        parts.push(`Inner conflict: ${state.conflicts[0]}.`);
    }

    // Fading — things losing importance
    if (state.fading && state.fading.length > 0) {
        const fading = state.fading.filter(f => f && f.length > 1).slice(0, 2);
        if (fading.length > 0) {
            parts.push(`Letting go of: ${fading.join(', ')}.`);
        }
    }

    // Pending events from kernel
    if (pendingEvents.length > 0) {
        parts.push(pendingEvents.slice(-1)[0]);
        pendingEvents = [];
    }

    // Only inject if there's something meaningful
    const injection = parts.join(' ');
    if (injection && injection.length > 10) {
        SillyTavern.getContext().setExtensionPrompt(
            MODULE_NAME,
            `[Character State] ${injection}`,
            1, 2, 0  // IN_CHAT, depth 2, SYSTEM role
        );
    }
};

// ═══ Post-Generation: Feed response back to kernel ═══

async function onMessageReceived(messageIndex) {
    const settings = getSettings();
    if (!settings.enabled) return;

    const context = SillyTavern.getContext();
    const message = context.chat[messageIndex];
    if (!message || message.is_user) return;

    const responseText = message.mes || '';
    if (!responseText) return;

    // Send response text to kernel — server extracts concepts + triples
    const charName = SillyTavern.getContext().name2 || '';
    await kernelFetch('/v1/observe', {
        method: 'POST',
        body: JSON.stringify({
            text: responseText,
            source: 'response',
            character: charName,
        }),
    });

    // Update expression for sprite
    const emotion = await kernelFetch('/v1/emotion');
    if (emotion && emotion.expression) {
        cachedExpression = emotion.expression;
        try {
            await context.executeSlashCommands('/sprite ' + emotion.expression);
        } catch (e) { /* no sprite system */ }
    }
}

// ═══ Character Switch ═══

async function onCharacterChanged() {
    const settings = getSettings();
    if (!settings.enabled) return;

    const context = SillyTavern.getContext();
    const charName = context.name2 || '';
    if (!charName || charName.includes('System')) return;

    // Extract personality as telos
    const char = context.characters?.[context.this_chid];
    let telos = [];
    if (char) {
        const personality = char.data?.personality || char.personality || '';
        if (personality) {
            telos = personality.split(',').map(t => t.trim().toLowerCase()).filter(t => t.length > 2);
        }
    }

    await kernelFetch('/v1/character', {
        method: 'POST',
        body: JSON.stringify({ name: charName, telos }),
    });
}

// ═══ Event Polling ═══

async function pollEvents() {
    const settings = getSettings();
    if (!settings.enabled) return;

    const data = await kernelFetch('/v1/events');
    if (data && data.events && data.events.length > 0) {
        for (const evt of data.events) {
            if (evt.startsWith('new_pattern:')) {
                const topics = evt.slice('new_pattern:'.length).trim();
                if (topics.length > 3) pendingEvents.push('A thought forms: ' + topics.replace(/,/g, ', ') + '.');
            }
        }
    }
}

// ═══ Status Display ═══

async function updateStatusDisplay() {
    const el = document.getElementById('rpv1-status');
    if (!el) return;

    const status = await kernelFetch('/v1/status');
    if (!status) {
        el.innerHTML = '<span style="color:#f66;">\u25cf Offline</span>';
        return;
    }

    const charName = SillyTavern.getContext().name2 || '';
    el.innerHTML = `<span style="color:#6f6;">\u25cf</span> ${charName} | ${status.entities || 0} concepts | ${status.attractors || 0} memories | T=${(status.temperature || 0).toFixed(2)}`;
}

// ═══ Init ═══

(function init() {
    const context = SillyTavern.getContext();
    const settings = getSettings();

    context.eventSource.on(context.event_types.MESSAGE_RECEIVED, onMessageReceived);
    context.eventSource.on(context.event_types.CHARACTER_CHANGED, onCharacterChanged);

    context.registerMacro('rpv1_expression', () => cachedExpression);

    // Poll every 30s for events + status
    setInterval(async () => {
        await pollEvents();
        await updateStatusDisplay();
    }, 30000);

    // Initial setup
    setTimeout(async () => {
        if (context.name2) await onCharacterChanged();
        await updateStatusDisplay();
    }, 3000);

    // Settings UI bindings
    const bind = (id, key, event = 'change') => {
        const el = document.getElementById(id);
        if (!el) return;
        if (el.type === 'checkbox') el.checked = settings[key];
        else el.value = settings[key];
        el.addEventListener(event, () => {
            settings[key] = el.type === 'checkbox' ? el.checked : el.value;
            context.saveSettingsDebounced();
            if (key === 'kernelUrl') updateStatusDisplay();
        });
    };

    bind('rpv1-enabled', 'enabled');
    bind('rpv1-kernel-url', 'kernelUrl');
    bind('rpv1-low-spec', 'lowSpecMode');

    console.log('[RPv1] Memory Engine initialized');
})();

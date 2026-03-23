# RPv1 — Memory Engine for SillyTavern

Characters that remember you. Emotions that emerge from conversation, not keywords.

## What It Does

- **Persistent memory** — your character remembers across sessions
- **Emotional state** — mood emerges from conversation dynamics, not scripted responses
- **Character consistency** — personality anchored by physics, not prompt repetition
- **Natural forgetting** — unimportant things fade, important things persist

## Install (30 seconds)

1. Open SillyTavern
2. Go to **Extensions → Install Extension**
3. Paste this URL: `https://github.com/tengrifarina/rpv1-extension`
4. Enable **"RPv1 — Memory Engine"** in the extensions panel
5. Chat with any character as usual

The kernel URL is pre-configured. No setup needed.

## How It Works

The extension sends conversation concepts to a remote cognitive engine. The engine maintains a persistent "mind" for each character — tracking what they know, how they feel, and what's on their mind. Before each generation, it injects a brief character state into the prompt:

```
[Character State] Mood: alert, warm. Thinking about: dinner, care, gesture.
Inner conflict: trust vs vulnerability. Letting go of: argument.
```

The LLM reads this and writes a character with genuine emotional continuity.

## Requirements

- SillyTavern (any recent version)
- Any LLM backend (KoboldCPP, OpenAI, local llama.cpp, etc.)
- Internet connection (the cognitive engine runs in the cloud)

## Settings

- **Enabled** — toggle the extension on/off
- **Kernel URL** — pre-filled, don't change unless told to
- **Low Spec Mode** — ON by default. Skips LLM-based triple extraction to save tokens.

## Beta

This is an early beta. Report issues in the Discord.

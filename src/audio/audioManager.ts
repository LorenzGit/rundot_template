import { store } from "../state/store.ts";

export type SfxCue = "tap" | "start" | "bounce" | "reward" | "error";

export interface AudioDebugSnapshot {
    contextState: AudioContextState | "locked";
    musicRunning: boolean;
    musicStep: number;
    scheduledMusicNotes: number;
    activeMusicVoices: number;
    activeSfxVoices: number;
    suppressedSfx: number;
}

const CHORDS = [
    { bass: 130.81, tones: [261.63, 329.63, 392.0, 493.88] }, // Cmaj7
    { bass: 110.0, tones: [220.0, 261.63, 329.63, 392.0] }, // Am7
    { bass: 87.31, tones: [174.61, 220.0, 261.63, 329.63] }, // Fmaj7
    { bass: 98.0, tones: [196.0, 246.94, 293.66, 329.63] }, // G6
] as const;

const MENU_PATTERN = [0, null, 2, null, 1, null, 3, 2] as const;
const PLAY_PATTERN = [0, 2, null, 1, 3, null, 2, 1] as const;
const MUSIC_STEP_SECONDS = 60 / 68 / 2;
const SCHEDULE_AHEAD_SECONDS = 0.28;

class AudioManager {
    private context: AudioContext | null = null;
    private master: GainNode | null = null;
    private musicBus: GainNode | null = null;
    private sfxBus: GainNode | null = null;
    private musicTimer = 0;
    private musicStep = 0;
    private nextMusicTime = 0;
    private musicVoices = new Set<OscillatorNode>();
    private sfxVoices = new Set<OscillatorNode>();
    private lastCueAt = new Map<SfxCue, number>();
    private scheduledMusicNotes = 0;
    private suppressedSfx = 0;
    private paused = false;
    private hostPaused = false;
    private hostOverlayVisible = false;
    private pageHidden = document.visibilityState !== "visible";
    private bound = false;

    bind(): void {
        if (this.bound) return;
        this.bound = true;
        store.subscribe(() => this.sync());
        document.addEventListener("visibilitychange", () => {
            this.pageHidden = document.visibilityState !== "visible";
            this.applyPauseState();
        });
    }

    async unlock(): Promise<boolean> {
        try {
            this.ensureGraph();
            if (!this.context) return false;
            if (this.paused) return false;
            if (this.context.state === "suspended") {
                // WebKit leaves resume() pending FOREVER when the call is not
                // backed by recognized user activation. Never let that hang a
                // caller — UI actions may await unlock before proceeding.
                await Promise.race([
                    this.context.resume(),
                    new Promise<void>((resolve) => window.setTimeout(resolve, 300)),
                ]);
            }
            this.sync();
            return this.context.state === "running";
        } catch (error) {
            console.warn("[audio] WebAudio unavailable", error);
            return false;
        }
    }

    setPaused(paused: boolean): void {
        this.hostPaused = paused;
        this.applyPauseState();
    }

    /**
     * Host-owned UI such as ads and checkout sheets may not emit lifecycle
     * events. Keep this interruption separate from player mute settings and
     * host pause so one signal cannot accidentally clear another.
     */
    setHostOverlayVisible(visible: boolean): void {
        this.hostOverlayVisible = visible;
        this.applyPauseState();
    }

    private applyPauseState(): void {
        this.paused = this.hostPaused || this.pageHidden || this.hostOverlayVisible;
        if (!this.context) return;
        if (this.paused) {
            this.stopMusic();
            void this.context.suspend().catch(() => undefined);
        } else {
            void this.context
                .resume()
                .then(() => this.sync())
                .catch(() => undefined);
        }
    }

    play(cue: SfxCue): void {
        const state = store.get();
        if (!this.context || !this.sfxBus || this.paused || !state.sfxEnabled || state.sfxVolume <= 0) return;

        const cooldowns: Record<SfxCue, number> = {
            tap: 55,
            start: 180,
            bounce: 90,
            reward: 260,
            error: 220,
        };
        const realNow = performance.now();
        if (realNow - (this.lastCueAt.get(cue) ?? -Infinity) < cooldowns[cue]) {
            this.suppressedSfx += 1;
            return;
        }
        this.lastCueAt.set(cue, realNow);

        const cues: Record<
            SfxCue,
            {
                frequency: number;
                endFrequency: number;
                duration: number;
                peak: number;
                type: OscillatorType;
            }
        > = {
            tap: { frequency: 440, endFrequency: 493.88, duration: 0.045, peak: 0.045, type: "sine" },
            start: { frequency: 293.66, endFrequency: 440, duration: 0.18, peak: 0.065, type: "triangle" },
            bounce: { frequency: 196, endFrequency: 220, duration: 0.035, peak: 0.028, type: "sine" },
            reward: { frequency: 523.25, endFrequency: 783.99, duration: 0.24, peak: 0.065, type: "triangle" },
            error: { frequency: 146.83, endFrequency: 110, duration: 0.16, peak: 0.05, type: "triangle" },
        };
        const definition = cues[cue];
        const now = this.context.currentTime;
        const oscillator = this.context.createOscillator();
        const envelope = this.context.createGain();
        oscillator.type = definition.type;
        oscillator.frequency.setValueAtTime(definition.frequency, now);
        oscillator.frequency.exponentialRampToValueAtTime(definition.endFrequency, now + definition.duration);
        envelope.gain.setValueAtTime(0.0001, now);
        envelope.gain.exponentialRampToValueAtTime(definition.peak, now + 0.008);
        envelope.gain.exponentialRampToValueAtTime(0.0001, now + definition.duration);
        oscillator.connect(envelope).connect(this.sfxBus);
        this.trackVoice(oscillator, envelope, this.sfxVoices);
        oscillator.start(now);
        oscillator.stop(now + definition.duration + 0.02);
    }

    debugSnapshot(): AudioDebugSnapshot {
        return {
            contextState: this.context?.state ?? "locked",
            musicRunning: this.musicTimer !== 0,
            musicStep: this.musicStep,
            scheduledMusicNotes: this.scheduledMusicNotes,
            activeMusicVoices: this.musicVoices.size,
            activeSfxVoices: this.sfxVoices.size,
            suppressedSfx: this.suppressedSfx,
        };
    }

    private ensureGraph(): void {
        if (this.context) return;
        const AudioContextCtor = window.AudioContext;
        if (!AudioContextCtor) return;
        this.context = new AudioContextCtor();
        this.master = this.context.createGain();
        this.musicBus = this.context.createGain();
        this.sfxBus = this.context.createGain();
        const limiter = this.context.createDynamicsCompressor();
        limiter.threshold.value = -20;
        limiter.knee.value = 18;
        limiter.ratio.value = 4;
        limiter.attack.value = 0.004;
        limiter.release.value = 0.24;
        this.musicBus.connect(this.master);
        this.sfxBus.connect(this.master);
        this.master.connect(limiter).connect(this.context.destination);
    }

    private sync(): void {
        if (!this.context || !this.master || !this.musicBus || !this.sfxBus) return;
        const state = store.get();
        const now = this.context.currentTime;
        this.musicBus.gain.setTargetAtTime(state.musicEnabled ? state.musicVolume : 0, now, 0.12);
        this.sfxBus.gain.setTargetAtTime(state.sfxEnabled ? state.sfxVolume : 0, now, 0.03);
        this.master.gain.setTargetAtTime(this.paused ? 0 : 0.58, now, 0.08);
        if (state.musicEnabled && state.musicVolume > 0 && !this.paused && this.context.state === "running") {
            this.startMusic();
        } else {
            this.stopMusic();
        }
    }

    /**
     * A restrained 68 BPM major-seventh motif. It replaces the previous pair
     * of permanently beating oscillators with short, enveloped notes and rests.
     */
    private startMusic(): void {
        if (!this.context || !this.musicBus || this.musicTimer !== 0) return;
        this.nextMusicTime = this.context.currentTime + 0.06;
        this.scheduleMusic();
        this.musicTimer = window.setInterval(() => this.scheduleMusic(), 90);
    }

    private scheduleMusic(): void {
        if (!this.context || !this.musicBus || this.paused) return;
        while (this.nextMusicTime < this.context.currentTime + SCHEDULE_AHEAD_SECONDS) {
            const pattern = store.get().phase === "playing" ? PLAY_PATTERN : MENU_PATTERN;
            const patternStep = this.musicStep % pattern.length;
            const chord = CHORDS[Math.floor(this.musicStep / pattern.length) % CHORDS.length] ?? CHORDS[0];
            const toneIndex = pattern[patternStep] ?? null;
            if (patternStep === 0) this.scheduleMusicVoice(chord.bass, this.nextMusicTime, 2.4, 0.012, "sine");
            if (toneIndex !== null) {
                this.scheduleMusicVoice(chord.tones[toneIndex], this.nextMusicTime, 0.92, 0.022, "sine");
                this.scheduleMusicVoice(chord.tones[toneIndex] * 2, this.nextMusicTime, 0.48, 0.004, "triangle");
                this.scheduledMusicNotes += 1;
            }
            this.musicStep += 1;
            this.nextMusicTime += MUSIC_STEP_SECONDS;
        }
    }

    private scheduleMusicVoice(
        frequency: number,
        startAt: number,
        duration: number,
        peak: number,
        type: OscillatorType,
    ): void {
        if (!this.context || !this.musicBus) return;
        const oscillator = this.context.createOscillator();
        const filter = this.context.createBiquadFilter();
        const envelope = this.context.createGain();
        oscillator.type = type;
        oscillator.frequency.setValueAtTime(frequency, startAt);
        filter.type = "lowpass";
        filter.frequency.setValueAtTime(type === "sine" ? 1_450 : 1_100, startAt);
        filter.Q.value = 0.35;
        envelope.gain.setValueAtTime(0.0001, startAt);
        envelope.gain.exponentialRampToValueAtTime(peak, startAt + 0.025);
        envelope.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
        oscillator.connect(filter).connect(envelope).connect(this.musicBus);
        this.trackVoice(oscillator, envelope, this.musicVoices, filter);
        oscillator.start(startAt);
        oscillator.stop(startAt + duration + 0.03);
    }

    private trackVoice(
        oscillator: OscillatorNode,
        envelope: GainNode,
        collection: Set<OscillatorNode>,
        filter?: BiquadFilterNode,
    ): void {
        collection.add(oscillator);
        oscillator.addEventListener(
            "ended",
            () => {
                collection.delete(oscillator);
                oscillator.disconnect();
                filter?.disconnect();
                envelope.disconnect();
            },
            { once: true },
        );
    }

    private stopMusic(): void {
        if (this.musicTimer) window.clearInterval(this.musicTimer);
        this.musicTimer = 0;
        if (!this.context) return;
        const stopAt = this.context.currentTime + 0.08;
        for (const oscillator of this.musicVoices) {
            try {
                oscillator.stop(stopAt);
            } catch {
                /* already stopped */
            }
        }
        this.musicVoices.clear();
    }
}

export const audioManager = new AudioManager();

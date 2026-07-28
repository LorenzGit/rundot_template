import {
    AnimatedSprite,
    Graphics,
    Rectangle,
    type Application,
    type FederatedPointerEvent,
    type Texture,
    type Ticker,
} from "pixi.js";
import { audioManager } from "../audio/audioManager.ts";
import { createTweenController, ease } from "./tween.ts";
import { createParticleEmitter } from "./particles.ts";
import { runtimeServices } from "../systems/runtimeServices.ts";
import { dailySystems } from "../systems/dailySystems.ts";
import { completeDemoLevel } from "../systems/demoAnalytics.ts";
import { store } from "../state/store.ts";
import type { Stage } from "./stage.ts";

export interface Scene {
    destroy(): void;
}

function createFrames(app: Application): Texture[] {
    const colors = [0xff8a83, 0xffa078, 0xff7e9c, 0xff8a83];
    return colors.map((color, index) => {
        const frame = new Graphics()
            .circle(25, 42, 18)
            .fill(color)
            .circle(95, 42, 18)
            .fill(color)
            .circle(60, 62, 47)
            .fill(color)
            .circle(45 + index, 55, 6)
            .fill(0xffffff)
            .circle(75 - index, 55, 6)
            .fill(0xffffff)
            .circle(45 + index, 57, 2.5)
            .fill(0x4b3295)
            .circle(75 - index, 57, 2.5)
            .fill(0x4b3295)
            .circle(32, 72, 6)
            .fill({ color: 0xffd1c9, alpha: 0.72 })
            .circle(88, 72, 6)
            .fill({ color: 0xffd1c9, alpha: 0.72 })
            .moveTo(47, 74)
            .quadraticCurveTo(60, 86 + index, 73, 74)
            .stroke({ color: 0xffffff, width: 5, cap: "round" })
            .circle(44, 31, 8)
            .fill({ color: 0xffffff, alpha: 0.28 });
        const texture = app.renderer.generateTexture(frame);
        frame.destroy();
        return texture;
    });
}

export function createDemoScene(app: Application, stage: Stage): Scene {
    const settings = store.get();
    const reducedMotion = settings.reducedMotion;
    const highQuality = settings.quality === "high";
    const frames = createFrames(app);
    const backdrop = new Graphics();
    const sprite = new AnimatedSprite(frames);
    const emitter = createParticleEmitter(stage.root);
    const tweens = createTweenController();
    const baseSize = Math.min(stage.designWidth(), stage.designHeight()) * 0.23;

    stage.root.addChild(backdrop);
    sprite.anchor.set(0.5);
    sprite.width = baseSize;
    sprite.height = baseSize;
    const baseScale = sprite.scale.x;
    sprite.x = stage.designWidth() / 2;
    sprite.y = stage.designHeight() / 2;
    sprite.animationSpeed = highQuality ? 0.12 : 0.07;
    if (reducedMotion) sprite.gotoAndStop(0);
    else sprite.play();
    stage.root.addChild(sprite);

    let vx = 300;
    let vy = 240;
    let alive = true;

    const punch = () => {
        if (reducedMotion) return;
        tweens.addTween(
            (value) => sprite.scale.set(value),
            sprite.scale.x,
            baseScale * 1.14,
            ease.outCubic,
            () => {
                if (!alive) return;
                tweens.addTween(
                    (value) => sprite.scale.set(value),
                    baseScale * 1.14,
                    baseScale,
                    ease.outBack,
                    undefined,
                    { durationMs: 180 },
                );
            },
            { durationMs: 90 },
        );
    };

    const redrawBackdrop = () => {
        const width = stage.designWidth();
        const height = stage.designHeight();
        backdrop
            .clear()
            .rect(0, 0, width, height)
            .fill({ color: 0x4f3ba5, alpha: 0.24 })
            .circle(width * 0.16, height * 0.24, Math.min(width, height) * 0.12)
            .fill({ color: 0x73d8ff, alpha: 0.17 })
            .circle(width * 0.86, height * 0.74, Math.min(width, height) * 0.18)
            .fill({ color: 0x64dfad, alpha: 0.14 })
            .circle(width * 0.78, height * 0.18, 12)
            .fill({ color: 0xffe36d, alpha: 0.72 })
            .circle(width * 0.22, height * 0.78, 8)
            .fill({ color: 0xffffff, alpha: 0.48 });
        stage.root.hitArea = new Rectangle(0, 0, width, height);
    };

    stage.root.eventMode = "static";
    stage.root.cursor = "pointer";
    const redirect = (event: FederatedPointerEvent) => {
        const point = event.getLocalPosition(stage.root);
        const dx = point.x - sprite.x;
        const dy = point.y - sprite.y;
        const distance = Math.hypot(dx, dy) || 1;
        const speed = highQuality ? 410 : 340;
        vx = (dx / distance) * speed;
        vy = (dy / distance) * speed;
        punch();
        audioManager.play("tap");
        void runtimeServices.haptic("light");
        if (!reducedMotion) {
            emitter.burst(sprite.x, sprite.y, {
                burst: highQuality ? 12 : 5,
                lifeMaxMs: highQuality ? 420 : 240,
                hue: 334,
            });
        }
    };
    stage.root.on("pointerdown", redirect);

    redrawBackdrop();
    const offResize = stage.onResize(() => {
        redrawBackdrop();
        sprite.x = Math.min(sprite.x, stage.designWidth() - baseSize / 2);
        sprite.y = Math.min(sprite.y, stage.designHeight() - baseSize / 2);
    });

    const tick = (ticker: Ticker) => {
        const dt = ticker.deltaMS / 1000;
        sprite.x += vx * dt;
        sprite.y += vy * dt;
        if (!reducedMotion) sprite.rotation += dt * 0.55;
        tweens.update(dt);
        emitter.update(dt);

        const half = baseSize / 2;
        const maxY = stage.designHeight();
        let bounced = false;
        if (sprite.x < half) {
            sprite.x = half;
            vx = Math.abs(vx);
            bounced = true;
        }
        const maxX = stage.designWidth();
        if (sprite.x > maxX - half) {
            sprite.x = maxX - half;
            vx = -Math.abs(vx);
            bounced = true;
        }
        if (sprite.y < half) {
            sprite.y = half;
            vy = Math.abs(vy);
            bounced = true;
        }
        if (sprite.y > maxY - half) {
            sprite.y = maxY - half;
            vy = -Math.abs(vy);
            bounced = true;
        }

        if (bounced) {
            const nextScore = store.get().score + 1;
            store.patch({ score: nextScore });
            dailySystems.recordQuestProgress("bounces");
            audioManager.play("bounce");
            punch();
            if (!reducedMotion) {
                emitter.burst(sprite.x, sprite.y, {
                    burst: highQuality ? 18 : 6,
                    lifeMaxMs: highQuality ? 560 : 280,
                    hue: 42,
                });
            }
            if (nextScore === 10) {
                void runtimeServices.haptic("success");
                completeDemoLevel(nextScore);
                runtimeServices.track("demo_ten_bounces", { quality: settings.quality });
            }
        }
    };
    app.ticker.add(tick);

    return {
        destroy() {
            alive = false;
            app.ticker.remove(tick);
            offResize();
            tweens.clear();
            emitter.destroy();
            stage.root.off("pointerdown", redirect);
            backdrop.destroy();
            sprite.stop();
            sprite.destroy();
            for (const texture of frames) texture.destroy(true);
        },
    };
}

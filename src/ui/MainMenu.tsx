import packageJson from "../../package.json";
import { saveSystem } from "../systems/save.ts";
import { formatNumber, t } from "../systems/localization.ts";
import { dailySystems } from "../systems/dailySystems.ts";
import { startDemoLevel } from "../systems/demoAnalytics.ts";
import { store, useStore, type MenuScreen } from "../state/store.ts";

type MenuIconName = "calendar" | "quests" | "shop" | "stats" | "run" | "settings";

const destinations: Array<{
    screen: MenuScreen;
    icon: MenuIconName;
    label: string;
    accent: string;
}> = [
    { screen: "daily-rewards", icon: "calendar", label: "MenuDailyRewards", accent: "sunny" },
    { screen: "daily-quests", icon: "quests", label: "MenuDailyQuests", accent: "mint" },
    { screen: "shop", icon: "shop", label: "MenuShop", accent: "coral" },
    { screen: "stats", icon: "stats", label: "MenuStats", accent: "sky" },
    { screen: "run-features", icon: "run", label: "MenuRunFeatures", accent: "violet" },
    { screen: "settings", icon: "settings", label: "MenuSettings", accent: "blue" },
];

function MenuIcon({ name }: { name: MenuIconName }) {
    if (name === "calendar") {
        return (
            <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6 3v3M18 3v3M4 8h16M5 5h14a2 2 0 0 1 2 2v12H3V7a2 2 0 0 1 2-2Z" />
                <path d="m8 14 2 2 5-5" />
            </svg>
        );
    }
    if (name === "quests") {
        return (
            <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6 4h12v16H6zM9 8h6M9 12h6M9 16h4" />
                <path d="M4 7h2M4 11h2M4 15h2" />
            </svg>
        );
    }
    if (name === "shop") {
        return (
            <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M5 9h14l-1 11H6L5 9Z" />
                <path d="M8 10V7a4 4 0 0 1 8 0v3M9 14h6" />
            </svg>
        );
    }
    if (name === "stats") {
        return (
            <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M5 19V9h4v10M10 19V5h4v14M15 19v-7h4v7M3 19h18" />
            </svg>
        );
    }
    if (name === "run") {
        return (
            <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 3 6.5 6v6L12 15l5.5-3V6L12 3Z" />
                <path d="m6.5 12-3 2v4l4 2.5 4.5-2.7V15M17.5 12l3 2v4l-4 2.5-4.5-2.7" />
            </svg>
        );
    }
    // Stroke-first gear (lucide-style). The previous filled-cog paths looked
    // broken under the template's fill:none + stroke icon treatment.
    return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.6.85 1 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
        </svg>
    );
}

export default function MainMenu() {
    useStore((state) => state.locale);
    const coins = useStore((state) => state.coins);
    const level = useStore((state) => state.level);

    // Click sound + haptic come from useButtonFeedback (App.tsx) — the
    // .play-button class maps to the heavier "start" cue there.
    const play = () => {
        store.patch({ phase: "playing", score: 0, totalPlays: store.get().totalPlays + 1 });
        startDemoLevel();
        dailySystems.recordQuestProgress("plays");
        void saveSystem.flush();
    };

    return (
        <main className="menu-shell pt-safe-top pb-safe-bottom">
            <header className="menu-header">
                <p className="eyebrow">RUN GAME STARTER</p>
                <div className="menu-logo">
                    <span className="menu-logo-top">PIXEL</span>
                    <h1>FOUNDRY</h1>
                    <span className="menu-logo-bolt" aria-hidden="true">
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path d="m13.5 2-8 12h6l-1 8 8-12h-6l1-8Z" />
                        </svg>
                    </span>
                </div>
                <p className="menu-subtitle">{t("MenuSubtitle")}</p>
            </header>

            <section className="player-strip" aria-label="Player summary">
                <div className="player-level">
                    <span className="player-avatar" aria-hidden="true">
                        <span />
                        <span />
                    </span>
                    <span>LEVEL {formatNumber(level)}</span>
                </div>
                <div className="player-currency">
                    <span className="coin-glyph" aria-hidden="true">
                        C
                    </span>
                    <strong>{formatNumber(coins)}</strong>
                </div>
            </section>

            <button type="button" className="play-button" onClick={play}>
                <span>{t("ButtonPlay")}</span>
                <span className="play-glyph" aria-hidden="true">
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="m9 6 9 6-9 6V6Z" />
                    </svg>
                </span>
            </button>

            <nav className="menu-grid" aria-label="Game menus">
                {destinations.map(({ screen, icon, label, accent }) => (
                    <button
                        type="button"
                        className={`menu-tile menu-tile-${accent}`}
                        key={screen}
                        onClick={() => store.patch({ menuScreen: screen })}
                    >
                        <span className="menu-icon" aria-hidden="true">
                            <MenuIcon name={icon} />
                        </span>
                        <span>{t(label)}</span>
                    </button>
                ))}
            </nav>

            <p className="template-stamp">REFERENCE DEMO · v{packageJson.version}</p>
        </main>
    );
}

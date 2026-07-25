import type { ReactNode } from "react";
import { audioManager } from "../audio/audioManager.ts";
import { store, type MenuScreen } from "../state/store.ts";
import { t } from "../systems/localization.ts";

export default function MenuScreenLayout({
    title,
    kicker,
    children,
    backScreen = "main",
}: {
    title: string;
    kicker: string;
    children: ReactNode;
    backScreen?: MenuScreen;
}) {
    const back = async () => {
        await audioManager.unlock();
        audioManager.play("tap");
        store.patch({ menuScreen: backScreen });
    };
    return (
        <main className="subscreen pt-safe-top pb-safe-bottom">
            <header className="subscreen-header">
                <button type="button" className="back-button" onClick={() => void back()} aria-label={t("ButtonBack")}>
                    ‹
                </button>
                <div>
                    <p className="eyebrow">{kicker}</p>
                    <h2>{title}</h2>
                </div>
            </header>
            <div className="subscreen-content" data-testid="screen-scroll-region">
                {children}
                <span className="subscreen-end" data-testid="screen-end" aria-hidden="true" />
            </div>
        </main>
    );
}

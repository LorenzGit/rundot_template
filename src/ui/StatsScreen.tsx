import MenuScreenLayout from "./MenuScreenLayout.tsx";
import { formatNumber, t } from "../systems/localization.ts";
import { useStore } from "../state/store.ts";

export default function StatsScreen() {
    const state = useStore((value) => value);
    const stats: Array<[string, number]> = [
        ["BEST BOUNCES", state.bestScore],
        ["TOTAL PLAYS", state.totalPlays],
        ["LEVEL", state.level],
        ["COINS", state.coins],
    ];
    return (
        <MenuScreenLayout title={t("MenuStats")} kicker="PLAYER RECORD">
            <p className="screen-copy">{t("StatsBody")}</p>
            <div className="stats-grid">
                {stats.map(([label, value]) => (
                    <article key={label}>
                        <span>{label}</span>
                        <strong>{formatNumber(value)}</strong>
                    </article>
                ))}
            </div>
        </MenuScreenLayout>
    );
}

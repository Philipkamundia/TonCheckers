/**
 * useTelegram.ts — Telegram Mini App SDK hook
 *
 * PRD §16 compliance:
 * - BackButton: uses native TG API, no custom UI back buttons anywhere
 * - MainButton: primary CTAs (Find Match, Confirm Stake) use TG MainButton
 * - HapticFeedback: move confirmations, wins, losses
 * - Theme: respects Telegram colorScheme (light/dark)
 * - Viewport: handles dynamic viewport changes (keyboard, panels)
 * - initData: available for backend validation on every request
 */
import { useEffect, useCallback } from 'react';
function getTg() {
    return window.Telegram?.WebApp ?? null;
}
export function useTelegram() {
    const tg = getTg();
    // ─── Initialisation ───────────────────────────────────────────────────────
    useEffect(() => {
        if (!tg)
            return;
        tg.ready();
        tg.expand(); // Full-height mini app
    }, []);
    // ─── Theme ────────────────────────────────────────────────────────────────
    const isDark = tg?.colorScheme === 'dark';
    const themeVars = tg?.themeParams ?? {};
    // ─── initData (for backend auth) ─────────────────────────────────────────
    const initData = tg?.initData ?? '';
    const tgUser = tg?.initDataUnsafe?.user ?? null;
    // ─── BackButton (PRD §16: no custom back buttons) ─────────────────────────
    const showBackButton = useCallback((onBack) => {
        if (!tg)
            return;
        tg.BackButton.show();
        tg.BackButton.onClick(onBack);
        return () => {
            tg.BackButton.offClick(onBack);
            tg.BackButton.hide();
        };
    }, [tg]);
    const hideBackButton = useCallback(() => {
        tg?.BackButton.hide();
    }, [tg]);
    // ─── MainButton (PRD §16: primary CTAs) ───────────────────────────────────
    const showMainButton = useCallback((text, onClick, options) => {
        if (!tg)
            return;
        tg.MainButton.setText(text);
        if (options?.color)
            tg.MainButton.color = options.color;
        if (options?.textColor)
            tg.MainButton.textColor = options.textColor;
        if (options?.disabled)
            tg.MainButton.disable();
        else
            tg.MainButton.enable();
        tg.MainButton.onClick(onClick);
        tg.MainButton.show();
        return () => {
            tg.MainButton.offClick(onClick);
            tg.MainButton.hide();
        };
    }, [tg]);
    const hideMainButton = useCallback(() => {
        tg?.MainButton.hide();
    }, [tg]);
    const setMainButtonLoading = useCallback((loading) => {
        if (!tg)
            return;
        if (loading) {
            tg.MainButton.showProgress(false);
            tg.MainButton.disable();
        }
        else {
            tg.MainButton.hideProgress();
            tg.MainButton.enable();
        }
    }, [tg]);
    // ─── HapticFeedback (PRD §16) ─────────────────────────────────────────────
    const haptic = {
        impact: (style = 'medium') => tg?.HapticFeedback.impactOccurred(style),
        success: () => tg?.HapticFeedback.notificationOccurred('success'),
        error: () => tg?.HapticFeedback.notificationOccurred('error'),
        warning: () => tg?.HapticFeedback.notificationOccurred('warning'),
        selection: () => tg?.HapticFeedback.selectionChanged(),
    };
    // ─── Viewport (PRD §16: handle dynamic viewport changes) ──────────────────
    const viewportHeight = tg?.viewportHeight ?? window.innerHeight;
    const stableViewportHeight = tg?.viewportStableHeight ?? window.innerHeight;
    const close = useCallback(() => tg?.close(), [tg]);
    return {
        tg,
        isDark,
        themeVars,
        initData,
        tgUser,
        viewportHeight,
        stableViewportHeight,
        showBackButton,
        hideBackButton,
        showMainButton,
        hideMainButton,
        setMainButtonLoading,
        haptic,
        close,
        isAvailable: !!tg,
    };
}

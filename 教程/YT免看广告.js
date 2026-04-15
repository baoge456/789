// ==UserScript==
// @name         YouTube 纯净观影 · 免广告+屏蔽Shorts
// @namespace    http://tampermonkey.net/
// @version      2.3
// @description  强力屏蔽YouTube视频广告、横幅广告、会员推广、Shorts干扰，保持界面清爽。支持开关控制。
// @author       助手定制
// @match        *://www.youtube.com/*
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @run-at       document-start
// @license      MIT
// ==/UserScript==

(function() {
    'use strict';

    // 配置存储 (可动态开关)
    let SETTINGS = {
        blockAds: true,          // 屏蔽视频广告 & 推广
        blockShorts: true,       // 屏蔽首页/侧边栏Shorts
        blockBanners: true,      // 屏蔽顶部横幅/会员推广
        cleanSidebar: true       // 隐藏右侧推荐栏广告 (非视频页)
    };

    // 加载保存的配置
    function loadSettings() {
        SETTINGS.blockAds = GM_getValue('blockAds', true);
        SETTINGS.blockShorts = GM_getValue('blockShorts', true);
        SETTINGS.blockBanners = GM_getValue('blockBanners', true);
        SETTINGS.cleanSidebar = GM_getValue('cleanSidebar', true);
    }
    function saveSettings() {
        GM_setValue('blockAds', SETTINGS.blockAds);
        GM_setValue('blockShorts', SETTINGS.blockShorts);
        GM_setValue('blockBanners', SETTINGS.blockBanners);
        GM_setValue('cleanSidebar', SETTINGS.cleanSidebar);
    }

    // ========== 1. 强力样式屏蔽 (最快最稳) ==========
    function injectBlockStyles() {
        let css = '';

        // 屏蔽视频播放前的广告 overlay、跳过按钮广告容器、广告卡片
        if (SETTINGS.blockAds) {
            css += `
                /* 视频播放器内广告 */
                .video-ads, .ytp-ad-module, .ytp-ad-player-overlay, .ytp-ad-image-overlay,
                .ytp-ad-text-overlay, .ytp-ad-simple-ad-badge, .ytp-ad-action-interstitial,
                .ytp-ad-skip-button-container, .ytp-ad-skip-button-modern,
                .ytp-ad-preview-container, .ytp-ad-preview-text, .ad-container,
                #player-ads, .ytd-action-companion-ad-renderer, .ytd-companion-slot-renderer,
                .ytp-ad-progress-list, .ytp-ad-progress, .ad-showing, .ad-interrupting,
                .ytp-ad-player-overlay-instream, .ytp-ad-image-overlay-container,
                /* 页面内赞助商卡片 */
                ytd-ad-slot-renderer, ytd-ad-slot-renderer[class*="ad"],
                ytd-display-ad-renderer, ytd-promoted-sparkles-web-renderer,
                ytd-video-masthead-ad-advertiser-info-renderer, ytd-banner-promo-renderer,
                #masthead-ad, #feed-pyv-container, ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-ads"] {
                    display: none !important;
                    height: 0 !important;
                    min-height: 0 !important;
                    opacity: 0 !important;
                    pointer-events: none !important;
                }
                /* 跳过广告按钮加速 (自动点按) 由MutationObserver负责 */
            `;
        }

        // 屏蔽 Shorts (首页网格、侧边栏、导肮栏)
        if (SETTINGS.blockShorts) {
            css += `
                ytd-rich-shelf-renderer[is-shorts],
                ytd-reel-shelf-renderer,
                ytd-rich-section-renderer:has(ytd-rich-shelf-renderer[is-shorts]),
                ytd-guide-entry-renderer a[href="/shorts"],
                ytd-mini-guide-entry-renderer[aria-label="Shorts"],
                ytd-guide-entry-renderer:has(a[href="/shorts"]),
                ytd-browse[page-subtype="home"] ytd-rich-item-renderer:has([overlay-style="SHORTS"]),
                ytd-video-renderer:has([aria-label*="Shorts"]),
                [is-shorts], #shorts-container, ytd-reel-video-renderer,
                ytd-shorts-lockup-view-model, ytd-reel-player-overlay-renderer {
                    display: none !important;
                }
            `;
        }

        // 屏蔽顶部会员横幅、促销条
        if (SETTINGS.blockBanners) {
            css += `
                ytd-mealbar-promo-renderer,
                #premium-container, ytd-prefetch-renderer,
                ytd-video-masthead-ad-v3-renderer,
                ytd-banner-promo-renderer, .ytd-banner-promo-renderer,
                ytd-player-legacy-desktop-watch-ads-renderer,
                .ytp-iv-player-content, .ytp-cards-teaser {
                    display: none !important;
                }
            `;
        }

        // 右侧栏隐藏广告组件 (视频页关联广告)
        if (SETTINGS.cleanSidebar) {
            css += `
                #secondary ytd-ad-slot-renderer,
                #secondary ytd-display-ad-renderer,
                #secondary .ytd-item-section-renderer:has(ytd-ad-slot-renderer) {
                    display: none !important;
                }
            `;
        }

        // 额外辅助：移除视频水印、商品链接 (可选)
        css += `
            .ytp-ce-element, .ytp-cards-teaser, .ytp-product-list-item,
            .ytp-shopping-card, .video-annotations {
                display: none !important;
            }
        `;

        GM_addStyle(css);
    }

    // ========== 2. 动态DOM监控 (自动点击跳过按钮 + 清理动态广告) ==========
    function killDynamicAds() {
        // 查找并点击跳过广告按钮 (最通用选择器)
        const skipBtn = document.querySelector('.ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button, .ytp-ad-skip-button-container button');
        if (skipBtn && skipBtn.offsetParent !== null) {
            skipBtn.click();
            console.log('✅ [YT助手] 已自动跳过广告');
        }

        // 对付 overlay 关闭按钮
        const closeBtn = document.querySelector('.ytp-ad-overlay-close-button, .ytp-ad-image-overlay-close-button');
        if (closeBtn) closeBtn.click();

        // 移除播放器内出现的动态广告层 (再保险)
        const adOverlays = document.querySelectorAll('.ytp-ad-player-overlay, .ytp-ad-image-overlay, .video-ads');
        adOverlays.forEach(el => el.style.display = 'none');
    }

    // 持续监控广告变化 (setInterval + 轮询)
    let adKillInterval = null;
    function startAdWatcher() {
        if (adKillInterval) clearInterval(adKillInterval);
        adKillInterval = setInterval(() => {
            if (!SETTINGS.blockAds) return;
            // 视频页才频繁检测，避免性能浪费
            if (location.href.includes('/watch')) {
                killDynamicAds();
            }
            // 额外清理新加载的 Shorts 元素 (动态加载)
            if (SETTINGS.blockShorts) {
                const newShorts = document.querySelectorAll('ytd-rich-shelf-renderer[is-shorts], ytd-reel-shelf-renderer, [is-shorts]');
                newShorts.forEach(el => { if (el.style.display !== 'none') el.style.display = 'none'; });
            }
        }, 800);
    }

    // ========== 3. MutationObserver 监听页面切换/新注入广告 ==========
    let observer = null;
    function initObserver() {
        if (observer) observer.disconnect();
        observer = new MutationObserver((mutations) => {
            // 检测页面 URL 变化 (SPA)
            if (window.location.href !== window._lastUrl) {
                window._lastUrl = window.location.href;
                // 稍等页面渲染后再执行一次清理
                setTimeout(() => {
                    killDynamicAds();
                    // 如果进入 /shorts 页面但屏蔽开启，强制跳转? 轻量：隐藏内容
                    if (SETTINGS.blockShorts && window.location.pathname.includes('/shorts')) {
                        document.body.style.overflow = 'auto';
                        const shortsContainer = document.querySelector('#shorts-container, ytd-reel-player-overlay-renderer');
                        if (shortsContainer) shortsContainer.style.display = 'none';
                    }
                }, 200);
            }
            // 如果有新的广告节点出现，立刻隐藏
            if (SETTINGS.blockAds) {
                for (let node of mutations) {
                    if (node.addedNodes.length) {
                        killDynamicAds();
                        break;
                    }
                }
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }

    // ========== 4. 额外清理 Shorts 页面重定向 (可选) ==========
    function handleShortsRedirect() {
        if (!SETTINGS.blockShorts) return;
        if (window.location.pathname.includes('/shorts')) {
            // 如果用户不幸点进了shorts页面，尝试替换为普通观看页面？这里不强干预，但隐藏混乱元素
            setTimeout(() => {
                const shortsPlayer = document.querySelector('ytd-reel-player-overlay-renderer, #shorts-container');
                if (shortsPlayer) shortsPlayer.style.display = 'none';
                document.body.style.background = '#0f0f0f';
            }, 100);
        }
    }

    // ========== 5. 注册菜单命令 ==========
    function registerMenus() {
        GM_registerMenuCommand(`${SETTINGS.blockAds ? '✅' : '❌'} 屏蔽视频广告`, () => {
            SETTINGS.blockAds = !SETTINGS.blockAds;
            saveSettings();
            location.reload();
        });
        GM_registerMenuCommand(`${SETTINGS.blockShorts ? '✅' : '❌'} 屏蔽 Shorts`, () => {
            SETTINGS.blockShorts = !SETTINGS.blockShorts;
            saveSettings();
            location.reload();
        });
        GM_registerMenuCommand(`${SETTINGS.blockBanners ? '✅' : '❌'} 屏蔽横幅推广`, () => {
            SETTINGS.blockBanners = !SETTINGS.blockBanners;
            saveSettings();
            location.reload();
        });
        GM_registerMenuCommand(`${SETTINGS.cleanSidebar ? '✅' : '❌'} 清理右侧广告`, () => {
            SETTINGS.cleanSidebar = !SETTINGS.cleanSidebar;
            saveSettings();
            location.reload();
        });
        GM_registerMenuCommand(`🔄 刷新页面生效`, () => location.reload());
    }

    // ========== 6. 初始化 ==========
    function init() {
        loadSettings();
        injectBlockStyles();      // 样式立刻生效
        startAdWatcher();         // 循环点击跳过
        initObserver();           // 监听动态内容
        handleShortsRedirect();
        registerMenus();

        // 监听 youtube 的spa导航事件 (yt-navigate-finish)
        window.addEventListener('yt-navigate-finish', () => {
            killDynamicAds();
            handleShortsRedirect();
            // 重设一次样式确保新渲染的广告被干掉
            setTimeout(() => {
                killDynamicAds();
                if (SETTINGS.blockShorts) {
                    document.querySelectorAll('ytd-rich-shelf-renderer[is-shorts]').forEach(el => el.style.display = 'none');
                }
            }, 300);
        });
        console.log('🧹 YouTube纯净观影已启动 | 广告屏蔽 + Shorts过滤 | 点击油猴图标可开关功能');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
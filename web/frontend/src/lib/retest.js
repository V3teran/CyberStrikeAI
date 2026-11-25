/**
 * 漏洞复测的跨页交接：漏洞页创建分支后写入待发送提示词，
 * 聊天页加载到对应分支时取出并自动发送；sessionStorage 使刷新后仍可恢复。
 */
export const RETEST_AUTOSEND_KEY = 'csai-retest-autosend';

function readEntry() {
    try {
        const raw = sessionStorage.getItem(RETEST_AUTOSEND_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch (error) {
        return null;
    }
}

export function queueRetestAutosend(conversationId, prompt) {
    try {
        sessionStorage.setItem(RETEST_AUTOSEND_KEY, JSON.stringify({
            conversationId: String(conversationId || ''),
            prompt: String(prompt || '')
        }));
    } catch (error) { /* storage unavailable */ }
}

export function peekRetestAutosend(conversationId) {
    const entry = readEntry();
    return entry && entry.conversationId === conversationId ? entry : null;
}

export function consumeRetestAutosend(conversationId) {
    if (!peekRetestAutosend(conversationId)) return;
    try {
        sessionStorage.removeItem(RETEST_AUTOSEND_KEY);
    } catch (error) { /* storage unavailable */ }
}

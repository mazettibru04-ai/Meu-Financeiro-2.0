export function ensureUserId() {
  const userId = window.userId;
  if (!userId || typeof userId !== "string") return null;
  return userId;
}

export function escapeHtml(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export async function runSafely(action, fallbackMessage) {
  try {
    return await action();
  } catch (error) {
    console.error(fallbackMessage, error);
    alert(fallbackMessage);
    return null;
  }
}

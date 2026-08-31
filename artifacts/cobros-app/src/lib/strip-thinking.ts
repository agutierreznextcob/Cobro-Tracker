/**
 * Removes model reasoning blocks before they reach the rendered conversation.
 * It also hides an unfinished or chunk-split opening tag while an SSE response
 * is still arriving.
 */
export function stripThinkingBlocks(content: string): string {
  let visible = content.replace(/<think\b[^>]*>[\s\S]*?<\/think\s*>/gi, "");
  visible = visible.replace(/<think\b[^>]*>[\s\S]*$/gi, "");

  const lastOpeningBracket = visible.lastIndexOf("<");
  if (lastOpeningBracket >= 0) {
    const suffix = visible.slice(lastOpeningBracket).toLowerCase();
    if ("<think>".startsWith(suffix) || /^<think\b[^>]*$/.test(suffix)) {
      visible = visible.slice(0, lastOpeningBracket);
    }
  }

  return visible;
}
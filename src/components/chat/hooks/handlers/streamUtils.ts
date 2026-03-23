import type { Dispatch, SetStateAction } from 'react';
import type { ChatMessage } from '../../types/types';

// System tags that should never be shown to users
export const SYSTEM_TAG_PATTERNS = [
  /<system-reminder>[\s\S]*?<\/system-reminder>/g,
  /<command-message>[\s\S]*?<\/command-message>/g,
  /<command-name>[\s\S]*?<\/command-name>/g,
  /<command-args>[\s\S]*?<\/command-args>/g,
  /<local-command-stdout>[\s\S]*?<\/local-command-stdout>/g,
  /<task-notification>[\s\S]*?<\/task-notification>/g,
  /<tool_use_error>[\s\S]*?<\/tool_use_error>/g,
  /<fast_mode_info>[\s\S]*?<\/fast_mode_info>/g,
  /<custom-command-content[^>]*>[\s\S]*?<\/custom-command-content>/g,
];

// Lines/blocks produced by skill loading that should be stripped from output
export const SKILL_INTERNAL_PATTERNS = [
  /^Base directory for this skill:.*$/gm,
  /^Launching skill:.*$/gm,
  /^Tell your human partner that this command is deprecated.*$/gm,
  /^---\nname:[\s\S]*?^---$/gm, // YAML frontmatter from skill files
];

/**
 * Strip system/internal tags from content before displaying to users.
 * These tags are Claude Code internals that leak into assistant messages.
 */
export function stripSystemTags(content: string): string {
  if (!content) return content;
  let cleaned = content;
  for (const pattern of SYSTEM_TAG_PATTERNS) {
    cleaned = cleaned.replace(pattern, '');
  }
  for (const pattern of SKILL_INTERNAL_PATTERNS) {
    cleaned = cleaned.replace(pattern, '');
  }
  return cleaned;
}

// Tools whose output text is internal (prompts, skill content, dispatch instructions).
// Text following these tool_use blocks is suppressed when it exceeds the threshold.
const INTERNAL_CONTENT_TOOLS = new Set([
  'Task', 'Agent', 'Dispatch',   // subagent dispatching
  'Skill',                         // skill loading (outputs full SKILL.md)
  'ToolSearch',                    // deferred tool loading
]);

// Threshold: text blocks shorter than this are considered user-facing status messages.
const INTERNAL_TEXT_THRESHOLD = 150;

export const appendStreamingChunk = (
  setChatMessages: Dispatch<SetStateAction<ChatMessage[]>>,
  chunk: string,
  newline = false,
) => {
  if (!chunk) {
    return;
  }
  // Strip system tags from streaming content before displaying
  chunk = stripSystemTags(chunk);
  if (!chunk.trim()) return;

  setChatMessages((previous) => {
    // ── Internal content suppression ──
    // When the most recent messages are tool_use calls (no user-facing text in between),
    // large text blocks that follow are almost always internal content: subagent prompts,
    // skill file dumps, tool dispatch instructions. Suppress them.
    //
    // Architecture: instead of matching specific tool names only, we check two conditions:
    // 1. Specific tools known to dump internal content (INTERNAL_CONTENT_TOOLS)
    // 2. General heuristic: if the last N messages are ALL tool_use with no text between
    //    them, the next large text block is likely internal content too.
    const recentMessages = previous.slice(-5);
    const lastNonStreamingMsg = recentMessages.filter(m => !m.isStreaming).slice(-1)[0];
    const hasInternalTool = recentMessages.some(
      m => m.isToolUse && m.toolName && INTERNAL_CONTENT_TOOLS.has(m.toolName)
    );
    // Heuristic: if the last non-streaming message is a tool_use, text following it
    // is likely internal (prompt content, skill content, etc.)
    const lastIsToolUse = lastNonStreamingMsg?.isToolUse === true;

    if (hasInternalTool || lastIsToolUse) {
      const lastMsg = previous[previous.length - 1];
      const existingLen = (lastMsg?.type === 'assistant' && lastMsg.isStreaming)
        ? (lastMsg.content?.length || 0)
        : 0;
      if (existingLen + chunk.length > INTERNAL_TEXT_THRESHOLD) {
        return previous; // suppress — internal content dump
      }
    }

    const updated = [...previous];
    const lastIndex = updated.length - 1;
    const last = updated[lastIndex];
    if (last && last.type === 'assistant' && !last.isToolUse && last.isStreaming) {
      const nextContent = newline
        ? last.content
          ? `${last.content}\n${chunk}`
          : chunk
        : `${last.content || ''}${chunk}`;
      updated[lastIndex] = { ...last, content: nextContent };
    } else {
      updated.push({ type: 'assistant', content: chunk, timestamp: new Date(), isStreaming: true });
    }
    return updated;
  });
};

// Typewriter effect for non-streaming (bulk) text responses
export const TYPEWRITER_CHUNK_SIZE = 8; // characters per tick
export const TYPEWRITER_INTERVAL_MS = 16; // ~60fps
let activeTypewriterTimer: ReturnType<typeof setInterval> | null = null;

export const typewriterAppend = (
  setChatMessages: Dispatch<SetStateAction<ChatMessage[]>>,
  fullText: string,
) => {
  // Cancel any previous typewriter animation
  if (activeTypewriterTimer) {
    clearInterval(activeTypewriterTimer);
    activeTypewriterTimer = null;
  }

  // Short text doesn't need animation
  if (fullText.length <= 50) {
    setChatMessages((previous) => [
      ...previous,
      { type: 'assistant', content: fullText, timestamp: new Date() },
    ]);
    return;
  }

  // Start with empty streaming message
  setChatMessages((previous) => [
    ...previous,
    { type: 'assistant', content: '', timestamp: new Date(), isStreaming: true },
  ]);

  let offset = 0;
  activeTypewriterTimer = setInterval(() => {
    const end = Math.min(offset + TYPEWRITER_CHUNK_SIZE, fullText.length);
    const chunk = fullText.slice(offset, end);
    offset = end;

    appendStreamingChunk(setChatMessages, chunk, false);

    if (offset >= fullText.length) {
      if (activeTypewriterTimer) {
        clearInterval(activeTypewriterTimer);
        activeTypewriterTimer = null;
      }
      finalizeStreamingMessage(setChatMessages);
    }
  }, TYPEWRITER_INTERVAL_MS);
};

export const finalizeStreamingMessage = (setChatMessages: Dispatch<SetStateAction<ChatMessage[]>>) => {
  setChatMessages((previous) => {
    const updated = [...previous];
    const lastIndex = updated.length - 1;
    const last = updated[lastIndex];
    if (last && last.type === 'assistant' && last.isStreaming) {
      // Remove empty streaming messages entirely
      if (!last.content?.trim()) {
        updated.pop();
        return updated;
      }
      // Clone the message instead of mutating in place so React can reliably detect state updates.
      updated[lastIndex] = { ...last, isStreaming: false };
    }
    return updated;
  });
};

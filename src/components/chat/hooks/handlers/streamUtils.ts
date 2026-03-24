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
// Text following these tool_use blocks is suppressed entirely.
const INTERNAL_CONTENT_TOOLS = new Set([
  'Task', 'Agent', 'Dispatch',   // subagent dispatching
  'Skill',                         // skill loading (outputs full SKILL.md)
  'ToolSearch',                    // deferred tool loading
]);

// Patterns that indicate the start of internal/skill content in a text chunk
const INTERNAL_CONTENT_MARKERS = [
  /^Base directory for this skill:/,
  /^Launching skill:/,
  /^# .+\n\n>/,                    // markdown heading followed by blockquote (skill docs)
  /^ARGUMENTS:/,
  /^<SUBAGENT-STOP>/,
  /^<EXTREMELY-IMPORTANT>/,
  /^<HARD-GATE>/,
];

// Track whether we're in an internal content suppression zone.
// This persists across chunks until a non-tool user-facing message resets it.
let _suppressionActive = false;

/** Reset suppression state (call on session boundaries like claude-complete). */
export function resetInternalSuppression() {
  _suppressionActive = false;
}

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
    // Detect and suppress skill prompts, subagent instructions, and other
    // internal content that should not be shown to users.
    //
    // Strategy: look back through ALL recent messages (not just last 5) to
    // find internal tools, and suppress ALL text after them until a user
    // message or non-tool assistant message breaks the chain.

    // Check if current streaming content starts with internal markers
    const lastMsg = previous[previous.length - 1];
    const currentStreamContent = (lastMsg?.type === 'assistant' && lastMsg.isStreaming)
      ? (lastMsg.content || '') + chunk
      : chunk;

    const startsWithInternalMarker = INTERNAL_CONTENT_MARKERS.some(
      pattern => pattern.test(currentStreamContent.trim())
    );

    if (startsWithInternalMarker) {
      _suppressionActive = true;
      // Remove partially displayed content if the marker was detected after initial chunks
      if (lastMsg?.type === 'assistant' && lastMsg.isStreaming && lastMsg.content) {
        const updated = [...previous];
        updated[updated.length - 1] = { ...lastMsg, content: '', isStreaming: true };
        return updated;
      }
      return previous;
    }

    // Check for internal tools in recent history (scan further back than 5)
    if (!_suppressionActive) {
      const scanLimit = Math.min(previous.length, 15);
      const recentMessages = previous.slice(-scanLimit);
      // Walk backwards to find the last non-streaming message
      for (let i = recentMessages.length - 1; i >= 0; i--) {
        const msg = recentMessages[i];
        if (msg.isStreaming) continue;
        // If last non-streaming is a user message, not suppressing
        if (msg.type === 'user') break;
        // If last non-streaming is a tool_use with internal tool, suppress
        if (msg.isToolUse && msg.toolName && INTERNAL_CONTENT_TOOLS.has(msg.toolName)) {
          _suppressionActive = true;
          break;
        }
        // If it's a finalized assistant text message (not tool), not suppressing
        if (msg.type === 'assistant' && !msg.isToolUse && msg.content?.trim()) break;
        // If it's any tool_use, keep scanning
        if (msg.isToolUse) continue;
        break;
      }
    }

    if (_suppressionActive) {
      return previous; // suppress — internal content dump
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

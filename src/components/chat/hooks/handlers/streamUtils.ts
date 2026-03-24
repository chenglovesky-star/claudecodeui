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

// ── Internal content suppression state machine ──
// States:
//   NORMAL      – text blocks are displayed normally
//   SUPPRESSING  – an internal tool was just invoked; suppress ALL subsequent
//                  text blocks until a user-visible tool or new assistant turn
//                  switches back to NORMAL.
//
// Transitions:
//   NORMAL      → SUPPRESSING   via activateInternalSuppression()  (internal tool_use)
//   SUPPRESSING → NORMAL        via deactivateInternalSuppression() (user-visible tool_use / turn end)
//   any         → NORMAL        via resetInternalSuppression()      (session boundary)

type SuppressionState = 'NORMAL' | 'SUPPRESSING';
let _suppressionState: SuppressionState = 'NORMAL';

/** Enter SUPPRESSING state: all text blocks are dropped until deactivated. */
export function activateInternalSuppression() {
  _suppressionState = 'SUPPRESSING';
}

/** Return to NORMAL state: text blocks are displayed again. */
export function deactivateInternalSuppression() {
  _suppressionState = 'NORMAL';
}

/** Check whether the current text block should be suppressed (consumes nothing — state-based). */
export function shouldSuppressTextBlock(): boolean {
  return _suppressionState === 'SUPPRESSING';
}

// Whether the current streaming content block is being suppressed
let _currentBlockSuppressed = false;

/** Mark current block as suppressed (called from claudeHandler on content_block_start). */
export function setCurrentBlockSuppressed(suppressed: boolean) {
  _currentBlockSuppressed = suppressed;
}

/** Reset suppression state (call on session boundaries like claude-complete). */
export function resetInternalSuppression() {
  _suppressionState = 'NORMAL';
  _currentBlockSuppressed = false;
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
    // When a text block is marked for suppression (via shouldSuppressTextBlock()
    // in claudeHandler), all chunks within that block are dropped.
    // This prevents skill prompts, subagent instructions, and other
    // tool-related internal content from being displayed.
    if (_currentBlockSuppressed) {
      return previous; // suppress — internal content following tool_use
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

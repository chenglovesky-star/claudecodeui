import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronUp, ChevronDown, X, CaseSensitive, Regex } from 'lucide-react';
import type { SearchAddon } from '@xterm/addon-search';

type TerminalSearchBarProps = {
  searchAddon: SearchAddon | null;
  onClose: () => void;
};

export default function TerminalSearchBar({ searchAddon, onClose }: TerminalSearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [isRegex, setIsRegex] = useState(false);
  const [isCaseSensitive, setIsCaseSensitive] = useState(false);
  const [matchInfo, setMatchInfo] = useState('');

  // Auto-focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const doSearch = useCallback((direction: 'next' | 'prev') => {
    if (!searchAddon || !query) return;
    const options = { regex: isRegex, caseSensitive: isCaseSensitive };
    if (direction === 'next') {
      searchAddon.findNext(query, options);
    } else {
      searchAddon.findPrevious(query, options);
    }
  }, [searchAddon, query, isRegex, isCaseSensitive]);

  // Trigger search on query/options change
  useEffect(() => {
    if (query) {
      doSearch('next');
    } else {
      searchAddon?.clearDecorations();
    }
  }, [query, isRegex, isCaseSensitive, doSearch, searchAddon]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      doSearch(e.shiftKey ? 'prev' : 'next');
    }
  }, [doSearch]);

  return (
    <div className="absolute right-2 top-2 z-20 flex items-center gap-1 rounded-md border border-gray-600 bg-gray-800 px-2 py-1 shadow-lg">
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Search..."
        className="w-40 bg-transparent text-xs text-gray-200 outline-none placeholder:text-gray-500"
      />
      <span className="min-w-[36px] text-center text-[10px] text-gray-500">
        {matchInfo || ''}
      </span>
      <button
        onClick={() => doSearch('prev')}
        className="rounded p-0.5 text-gray-400 hover:bg-gray-700 hover:text-gray-200"
        title="Previous match (Shift+Enter)"
      >
        <ChevronUp className="h-3.5 w-3.5" />
      </button>
      <button
        onClick={() => doSearch('next')}
        className="rounded p-0.5 text-gray-400 hover:bg-gray-700 hover:text-gray-200"
        title="Next match (Enter)"
      >
        <ChevronDown className="h-3.5 w-3.5" />
      </button>
      <div className="mx-0.5 h-4 w-px bg-gray-600" />
      <button
        onClick={() => setIsRegex(!isRegex)}
        className={`rounded p-0.5 ${isRegex ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:bg-gray-700 hover:text-gray-200'}`}
        title="Regex"
      >
        <Regex className="h-3.5 w-3.5" />
      </button>
      <button
        onClick={() => setIsCaseSensitive(!isCaseSensitive)}
        className={`rounded p-0.5 ${isCaseSensitive ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:bg-gray-700 hover:text-gray-200'}`}
        title="Case sensitive"
      >
        <CaseSensitive className="h-3.5 w-3.5" />
      </button>
      <div className="mx-0.5 h-4 w-px bg-gray-600" />
      <button
        onClick={onClose}
        className="rounded p-0.5 text-gray-400 hover:bg-gray-700 hover:text-gray-200"
        title="Close (Escape)"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

import type { CliPromptOption } from '../../hooks/useCliPromptDetection';

type CliPromptOverlayProps = {
  options: CliPromptOption[];
  onSelect: (number: string) => void;
  onEsc: () => void;
};

export default function CliPromptOverlay({ options, onSelect, onEsc }: CliPromptOverlayProps) {
  return (
    <div
      className="absolute inset-x-0 bottom-0 z-10 border-t border-gray-700/80 bg-gray-800/95 px-3 py-2 backdrop-blur-sm"
      onMouseDown={(e) => e.preventDefault()}
    >
      <div className="flex flex-wrap items-center gap-2">
        {options.map((opt) => (
          <button
            type="button"
            key={opt.number}
            onClick={() => onSelect(opt.number)}
            className="max-w-36 truncate rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-700"
            title={`${opt.number}. ${opt.label}`}
          >
            {opt.number}. {opt.label}
          </button>
        ))}
        <button
          type="button"
          onClick={onEsc}
          className="rounded bg-gray-700 px-3 py-1.5 text-xs font-medium text-gray-200 transition-colors hover:bg-gray-600"
        >
          Esc
        </button>
      </div>
    </div>
  );
}

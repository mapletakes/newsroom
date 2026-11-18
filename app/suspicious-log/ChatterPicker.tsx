'use client';

import { useId, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import type { ChattersResponse, LogChatter } from '@/lib/suspicious-log-query';
import { relativeTime } from '@/lib/url';
import { StatusDot } from './StatusDot';

export type PickedChatter = { id: string; name: string };

async function fetchChatters(q: string): Promise<ChattersResponse> {
  const r = await fetch(`/api/suspicious-log/chatters${q ? `?q=${encodeURIComponent(q)}` : ''}`);
  if (!r.ok) throw new Error('Failed to load chatters');
  return r.json();
}

/**
 * Finds one chatter in the log. Focusing the box lists the most recently active
 * chatters; typing narrows the list. Choosing one swaps the box for a chip, and
 * the log below shows only that person.
 */
export function ChatterPicker({
  selected,
  onSelect,
  onClear,
}: {
  selected: PickedChatter | null;
  onSelect: (chatter: PickedChatter) => void;
  onClear: () => void;
}) {
  const listId = useId();
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const query = useDebouncedValue(text.trim().replace(/^@/, ''), 200);
  const { data, isPending, isError } = useQuery({
    queryKey: queryKeys.suspiciousChatters(query),
    queryFn: () => fetchChatters(query),
    enabled: open && !selected,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
  const chatters = data?.chatters ?? [];
  const activeIndex = Math.min(active, Math.max(0, chatters.length - 1));

  const pick = (chatter: LogChatter) => {
    setText('');
    setOpen(false);
    onSelect({ id: chatter.id, name: chatter.name });
  };

  if (selected) {
    return (
      <div className="flex h-8 items-center gap-2 border border-ink bg-paper px-2 font-mono text-xs">
        <span className="max-w-[12rem] truncate font-bold" title={selected.name}>
          {selected.name}
        </span>
        <button
          type="button"
          onClick={onClear}
          aria-label="Clear chatter"
          className="text-ink/60 hover:text-rust"
        >
          ×
        </button>
      </div>
    );
  }

  const emptyMessage = isPending
    ? 'Loading…'
    : isError
      ? 'Couldn’t load chatters'
      : text.trim()
        ? 'No matching chatters'
        : 'No chatters logged yet';

  return (
    <div className="relative w-full sm:w-64">
      <input
        type="text"
        role="combobox"
        aria-label="Chatter"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && chatters[activeIndex] ? `${listId}-${activeIndex}` : undefined}
        autoComplete="off"
        spellCheck={false}
        value={text}
        placeholder="Find a chatter…"
        onChange={(e) => {
          setText(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setOpen(true);
            setActive(Math.min(activeIndex + 1, chatters.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive(Math.max(activeIndex - 1, 0));
          } else if (e.key === 'Enter' && open && chatters[activeIndex]) {
            e.preventDefault();
            pick(chatters[activeIndex]);
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
        className="h-8 w-full border border-ink/30 bg-paper px-2 font-mono text-xs focus:border-ink focus:outline-none"
      />
      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Chatters"
          // Keeps the input focused while an option is clicked, so the blur
          // above doesn't close the list before the click lands.
          onMouseDown={(e) => e.preventDefault()}
          className="absolute z-30 mt-1 max-h-72 w-full min-w-[18rem] overflow-auto border border-ink bg-paper font-mono text-xs shadow-md"
        >
          {chatters.length === 0 ? (
            <li role="presentation" className="px-2 py-2 text-ink/60">
              {emptyMessage}
            </li>
          ) : (
            chatters.map((chatter, i) => (
              <li
                key={chatter.id}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === activeIndex}
                onClick={() => pick(chatter)}
                onMouseEnter={() => setActive(i)}
                className={`flex cursor-pointer items-center gap-2 px-2 py-1.5 ${i === activeIndex ? 'bg-ink/10' : ''}`}
              >
                <StatusDot status={chatter.status} />
                <span className="truncate font-bold">{chatter.name}</span>
                <span className="ml-auto shrink-0 text-ink/50">{relativeTime(chatter.last_seen)}</span>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

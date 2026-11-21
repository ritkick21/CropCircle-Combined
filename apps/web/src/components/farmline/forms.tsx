'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Mic } from 'lucide-react';

export const action =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-[#174531] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#23573e] disabled:opacity-50';
export const secondary =
  'inline-flex items-center justify-center gap-2 rounded-lg border border-[#aebca8] bg-white px-3 py-2 text-sm font-semibold text-[#174531] hover:bg-[#edf1e5] disabled:opacity-50';
export const field = 'mt-1 w-full rounded-lg border bg-white px-3 py-2 text-base font-normal';
export const panel = 'min-w-0 rounded-2xl border bg-[#fffdf7] p-4 sm:p-6';
export const formText = (data: FormData, name: string) => String(data.get(name) ?? '').trim();

export function ActionForm({
  children,
  submit,
  label,
  reset = false,
}: {
  children: ReactNode;
  submit: (data: FormData) => Promise<void>;
  label: string;
  reset?: boolean;
}) {
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => setReady(true), []);
  return (
    <form
      method="post"
      className="space-y-3"
      onSubmit={async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        setBusy(true);
        setError('');
        try {
          await submit(new FormData(form));
          if (reset) form.reset();
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : 'Unable to save. Try again.');
        } finally {
          setBusy(false);
        }
      }}
    >
      <fieldset disabled={!ready || busy} className="min-w-0 space-y-3">
        {children}
      </fieldset>
      <button className={action} disabled={!ready || busy}>
        {busy ? 'Saving…' : label}
      </button>
      {error && (
        <p className="text-sm text-red-800" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

type Recognition = {
  lang: string;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  abort: () => void;
};
type DictationWindow = Window & {
  SpeechRecognition?: new () => Recognition;
  webkitSpeechRecognition?: new () => Recognition;
};

export function Dictation({ append }: { append: (value: string) => void }) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [note, setNote] = useState('');
  const active = useRef<Recognition | null>(null);

  useEffect(() => {
    const browser = window as DictationWindow;
    setSupported(Boolean(browser.SpeechRecognition ?? browser.webkitSpeechRecognition));
    return () => {
      if (active.current) {
        active.current.onresult = active.current.onerror = active.current.onend = null;
        active.current.abort();
      }
    };
  }, []);

  if (!supported) return null;
  return (
    <div className="space-y-1">
      <button
        type="button"
        className={secondary}
        disabled={listening}
        onClick={() => {
          const browser = window as DictationWindow;
          const SpeechRecognition = browser.SpeechRecognition ?? browser.webkitSpeechRecognition;
          if (!SpeechRecognition) return;
          const recognition = new SpeechRecognition();
          active.current = recognition;
          recognition.lang = document.documentElement.lang || 'en';
          recognition.onresult = (event) => {
            const transcript = Array.from(event.results)
              .map((result) => result[0]?.transcript ?? '')
              .join(' ')
              .trim();
            if (transcript) append(transcript);
          };
          recognition.onerror = () =>
            setNote('Dictation was unavailable. You can type the symptoms below.');
          recognition.onend = () => {
            active.current = null;
            setListening(false);
          };
          setNote('');
          try {
            recognition.start();
            setListening(true);
          } catch {
            active.current = null;
            setNote('Dictation was unavailable. You can type the symptoms below.');
          }
        }}
      >
        <Mic aria-hidden className="size-4" /> {listening ? 'Listening…' : 'Dictate symptoms'}
      </button>
      {note && (
        <p role="status" className="text-sm">
          {note}
        </p>
      )}
    </div>
  );
}

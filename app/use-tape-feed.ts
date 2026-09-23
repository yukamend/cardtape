'use client';

import { useEffect, useRef, useState } from 'react';
import {
  TapeFrameBuffer,
  TAPE_INSERTS_PER_FRAME,
  type TapeEvent,
  type TapeMessage,
} from '../packages/core/src/tape';
import { isPublishedSnapshot, type PublishedSnapshot } from '../packages/core/src/published-snapshot';

export type TapeConnection = 'connecting' | 'connected' | 'disconnected';

export interface TapeFeed {
  rows: TapeEvent[];
  snapshot: PublishedSnapshot | null;
  connection: TapeConnection;
  mode: 'live' | 'demo-replay';
  received: number;
  pending: number;
}

function tapeUrl(): string {
  return process.env.NEXT_PUBLIC_TAPE_WS_URL as string;
}

export function useTapeFeed(paused: boolean): TapeFeed {
  const [buffer] = useState(() => new TapeFrameBuffer());
  const pausedRef = useRef(paused);
  const frameRef = useRef<number | null>(null);
  const [rows, setRows] = useState<TapeEvent[]>([]);
  const [snapshot, setSnapshot] = useState<PublishedSnapshot | null>(null);
  const [connection, setConnection] = useState<TapeConnection>('connecting');
  const [mode, setMode] = useState<'live' | 'demo-replay'>('live');
  const [received, setReceived] = useState(0);
  const [pending, setPending] = useState(0);

  useEffect(() => {
    pausedRef.current = paused;
    if (!paused) {
      const frame = window.requestAnimationFrame(() => setRows(buffer.snapshot()));
      return () => window.cancelAnimationFrame(frame);
    }
    return undefined;
  }, [buffer, paused]);

  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_TAPE_WS_URL) {
      let closed = false;
      const poll = async () => {
        try {
          const response = await fetch('/snapshots/current.json', { cache: 'no-store' });
          if (!response.ok) throw new Error(`Snapshot returned ${response.status}`);
          const next: unknown = await response.json();
          if (!isPublishedSnapshot(next)) throw new Error('Invalid published snapshot');
          if (!closed) {
            buffer.replace(next.tape);
            setSnapshot(next);
            setRows(buffer.snapshot());
            setReceived(next.tape.length);
            setPending(0);
            setConnection('connected');
          }
        } catch {
          if (!closed) setConnection('disconnected');
        }
      };
      void poll();
      const timer = window.setInterval(() => void poll(), 60_000);
      return () => { closed = true; window.clearInterval(timer); };
    }
    let socket: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let closed = false;

    const scheduleFrame = () => {
      if (frameRef.current !== null) return;
      frameRef.current = window.requestAnimationFrame(() => {
        frameRef.current = null;
        const next = buffer.flush(TAPE_INSERTS_PER_FRAME);
        setReceived(buffer.received);
        setPending(buffer.pending);
        if (!pausedRef.current) setRows(next);
        if (buffer.pending > 0) scheduleFrame();
      });
    };

    const connect = () => {
      if (closed) return;
      setConnection('connecting');
      socket = new WebSocket(tapeUrl());
      socket.addEventListener('open', () => setConnection('connected'));
      socket.addEventListener('message', (message) => {
        try {
          const parsed = JSON.parse(String(message.data)) as TapeMessage;
          if (parsed.type === 'snapshot') {
            buffer.replace(parsed.events);
            setPending(0);
            if (!pausedRef.current) setRows(buffer.snapshot());
          } else if (parsed.type === 'event') {
            buffer.enqueue(parsed.event);
            setPending(buffer.pending);
            scheduleFrame();
          } else if (parsed.type === 'status') {
            setMode(parsed.mode);
          }
        } catch {
          // A malformed message cannot be allowed to break the live tape.
        }
      });
      socket.addEventListener('close', () => {
        setConnection('disconnected');
        if (!closed) reconnectTimer = setTimeout(connect, 1_000);
      });
      socket.addEventListener('error', () => socket?.close());
    };

    connect();
    return () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
      socket?.close();
    };
  }, [buffer]);

  return { rows, snapshot, connection, mode, received, pending };
}

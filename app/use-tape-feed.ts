'use client';

import { useEffect, useRef, useState } from 'react';
import {
  TapeFrameBuffer,
  TAPE_INSERTS_PER_FRAME,
  type TapeEvent,
  type TapeMessage,
} from '../packages/core/src/tape';

export type TapeConnection = 'connecting' | 'connected' | 'disconnected';

export interface TapeFeed {
  rows: TapeEvent[];
  connection: TapeConnection;
  mode: 'live' | 'demo-replay';
  received: number;
  pending: number;
}

function tapeUrl(): string {
  if (process.env.NEXT_PUBLIC_TAPE_WS_URL) return process.env.NEXT_PUBLIC_TAPE_WS_URL;
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.hostname}:8788/tape`;
}

export function useTapeFeed(paused: boolean): TapeFeed {
  const [buffer] = useState(() => new TapeFrameBuffer());
  const pausedRef = useRef(paused);
  const frameRef = useRef<number | null>(null);
  const [rows, setRows] = useState<TapeEvent[]>([]);
  const [connection, setConnection] = useState<TapeConnection>('connecting');
  const [mode, setMode] = useState<'live' | 'demo-replay'>('demo-replay');
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

  return { rows, connection, mode, received, pending };
}
